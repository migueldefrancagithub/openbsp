import { convexTest } from "convex-test";
import { afterAll, describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import schema from "../schema";
import { runChecklist } from "../lib/ai/checklist";

const previous = { key: process.env.WABA_TOKEN_ENCRYPTION_KEY_V1, mock: process.env.AI_MOCK_PROVIDER_ENABLED };
process.env.WABA_TOKEN_ENCRYPTION_KEY_V1 = "b".repeat(64);
process.env.AI_MOCK_PROVIDER_ENABLED = "1";
afterAll(() => {
  if (previous.key === undefined) delete process.env.WABA_TOKEN_ENCRYPTION_KEY_V1; else process.env.WABA_TOKEN_ENCRYPTION_KEY_V1 = previous.key;
  if (previous.mock === undefined) delete process.env.AI_MOCK_PROVIDER_ENABLED; else process.env.AI_MOCK_PROVIDER_ENABLED = previous.mock;
});

async function seed(t: ReturnType<typeof convexTest>) {
  const base = await t.run(async (ctx) => {
    const tenantId = await ctx.db.insert("tenants", { name: "Clinic", vertical: "clinic", plan: "starter", settings: { defaultLocale: "pt-MZ", timezone: "Africa/Maputo", retentionDays: 730 }, createdAt: Date.now() });
    const make = async (role: "owner" | "agent") => {
      const userId = await ctx.db.insert("users", { name: role });
      const memberId = await ctx.db.insert("members", { tenantId, userId, role, status: "active", createdAt: Date.now() });
      await ctx.db.insert("sessions", { userId, activeTenantId: tenantId, updatedAt: Date.now() });
      return { userId, memberId };
    };
    const owner = await make("owner");
    const agent = await make("agent");
    const now = Date.now();
    const channelId = await ctx.db.insert("channels", {
      tenantId, publicId: "hub_agentsxxxxxxxxxxxxxxxxxx".slice(0, 28), kind: "whatsapp", provider: "iasolution_hub", operationalTerritory: "openbsp", externalAccountId: "c-ag", displayName: "Piloto", status: "active", sendMode: "allowlist", outboundAllowlist: ["258840000099"], connectionState: "allowlist_only", webhookStatus: "verified", createdBy: owner.memberId, createdAt: now, updatedAt: now,
    });
    const knowledgeId = await ctx.db.insert("clinicKnowledgeItems", { tenantId, kind: "faq", title: "Horário", body: "Seg-Sex 8h-17h", status: "active", currentVersion: 2, createdBy: owner.memberId, createdAt: now, updatedAt: now });
    return { tenantId, owner, agent, channelId, knowledgeId };
  });
  return { ...base, asOwner: t.withIdentity({ subject: base.owner.userId }), asAgent: t.withIdentity({ subject: base.agent.userId }) };
}

describe("AI agents", () => {
  it("runs the checklist rules deterministically", () => {
    const now = Date.now();
    const base = {
      agent: { name: "A", objective: "reception" as const, channelId: undefined, config: { instructions: "x".repeat(30), tone: "friendly" as const, knowledgeItemIds: [], tools: ["consultar_agenda"], handoff: { keywords: [], onLowConfidence: true, onClinicalQuestion: false, message: "short" }, fallbackMessage: "short", maxRepliesPerThread: 8 } },
      channel: null,
      knowledge: [],
      providerReady: false,
      providerConfigured: false,
      dailyBudgetUsdCents: 0,
      now,
    };
    const codes = runChecklist(base).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["CHANNEL_REQUIRED", "KNOWLEDGE_REQUIRED", "TOOL_REQUIRED", "FALLBACK_REQUIRED", "HANDOFF_MESSAGE_REQUIRED", "HANDOFF_CLINICAL_REQUIRED", "PROVIDER_NOT_CONFIGURED", "BUDGET_REQUIRED", "SANDBOX_NOT_RUN", "DPIA_PROVIDER"]));
    const audit = runChecklist({ ...base, agent: { ...base.agent, objective: "audit", config: { ...base.agent.config, tools: ["reservar_slot"] } } }).map((i) => i.code);
    expect(audit).toContain("TOOL_FORBIDDEN");
    expect(audit).not.toContain("KNOWLEDGE_REQUIRED");
  });

  it("creates drafts with sensible defaults, blocks publish until ready, then freezes a version", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    await expect(s.asAgent.mutation(api.aiAgents.create, { name: "X", objective: "reception" })).rejects.toThrow(/FORBIDDEN_CAPABILITY/);
    const agentId = await s.asOwner.mutation(api.aiAgents.create, { name: "Recepção", objective: "reception", channelId: s.channelId });
    let detail = await s.asOwner.query(api.aiAgents.get, { agentId });
    expect(detail.agent.config.tools).toContain("reservar_slot");
    expect(detail.agent.status).toBe("draft");
    const blockers = detail.issues.filter((i) => i.severity === "blocker").map((i) => i.code);
    expect(blockers).toEqual(expect.arrayContaining(["KNOWLEDGE_REQUIRED", "PROVIDER_NOT_CONFIGURED"]));
    await expect(s.asOwner.mutation(api.aiAgents.publish, { agentId })).rejects.toThrow(/AI_AGENT_NOT_PUBLISHABLE/);

    // Configure the mock provider (platform env), mark it tested, add knowledge.
    await s.asOwner.mutation(api.aiSettings.update, { provider: "mock" });
    await s.asOwner.action(api.aiProviders.probe, {});
    await s.asOwner.mutation(api.aiAgents.updateDraft, { agentId, config: { ...detail.agent.config, knowledgeItemIds: [s.knowledgeId], tools: [...detail.agent.config.tools, "nope"] } });
    detail = await s.asOwner.query(api.aiAgents.get, { agentId });
    expect(detail.agent.config.tools).not.toContain("nope"); // sanitized
    expect(detail.issues.filter((i) => i.severity === "blocker")).toEqual([]);
    expect(detail.issues.map((i) => i.code)).toContain("SANDBOX_NOT_RUN");

    await expect(s.asAgent.mutation(api.aiAgents.publish, { agentId })).rejects.toThrow(/FORBIDDEN_CAPABILITY/);
    const published = await s.asOwner.mutation(api.aiAgents.publish, { agentId });
    expect(published.version).toBe(1);
    const version = await t.run(async (ctx) => (await ctx.db.get(published.versionId)) as Doc<"aiAgentVersions">);
    expect(version.knowledgeSnapshot).toEqual([expect.objectContaining({ itemId: s.knowledgeId, version: 2, title: "Horário" })]);
    detail = await s.asOwner.query(api.aiAgents.get, { agentId });
    expect(detail.agent).toMatchObject({ status: "active", currentVersion: 1, publishedVersionId: published.versionId });

    // Editing the draft after publish does not change the frozen version.
    await s.asOwner.mutation(api.aiAgents.updateDraft, { agentId, config: { ...detail.agent.config, instructions: "Instruções novas e diferentes para a versão 2." } });
    const frozen = await t.run(async (ctx) => (await ctx.db.get(published.versionId)) as Doc<"aiAgentVersions">);
    expect(frozen.config.instructions).not.toContain("versão 2");

    // Conflict: a second active reception agent on the same channel is blocked.
    const second = await s.asOwner.mutation(api.aiAgents.create, { name: "Outra recepção", objective: "reception", channelId: s.channelId });
    const secondDetail = await s.asOwner.query(api.aiAgents.get, { agentId: second });
    await s.asOwner.mutation(api.aiAgents.updateDraft, { agentId: second, config: { ...secondDetail.agent.config, knowledgeItemIds: [s.knowledgeId] } });
    expect((await s.asOwner.query(api.aiAgents.validate, { agentId: second })).map((i) => i.code)).toContain("AGENT_CONFLICT");

    await s.asOwner.mutation(api.aiAgents.setStatus, { agentId, status: "paused" });
    expect((await s.asOwner.query(api.aiAgents.list, {})).find((a) => a._id === agentId)?.status).toBe("paused");
    await expect(s.asOwner.mutation(api.aiAgents.remove, { agentId })).rejects.toThrow(/AI_AGENT_INVALID_STATE/);
    await s.asOwner.mutation(api.aiAgents.remove, { agentId: second });
    expect((await s.asOwner.query(api.aiAgents.list, {})).map((a) => a._id)).toEqual([agentId]);
    const audit = await t.run(async (ctx) => (await ctx.db.query("auditLog").collect()).map((r) => r.action));
    expect(audit).toEqual(expect.arrayContaining(["ai.agent.created", "ai.agent.published", "ai.agent.paused", "ai.agent.deleted"]));
  });
});
