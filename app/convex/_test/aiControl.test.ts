import { convexTest } from "convex-test";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import schema from "../schema";

const previous = { key: process.env.WABA_TOKEN_ENCRYPTION_KEY_V1, mock: process.env.AI_MOCK_PROVIDER_ENABLED };
process.env.WABA_TOKEN_ENCRYPTION_KEY_V1 = "e".repeat(64);
process.env.AI_MOCK_PROVIDER_ENABLED = "1";
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
afterAll(() => {
  if (previous.key === undefined) delete process.env.WABA_TOKEN_ENCRYPTION_KEY_V1; else process.env.WABA_TOKEN_ENCRYPTION_KEY_V1 = previous.key;
  if (previous.mock === undefined) delete process.env.AI_MOCK_PROVIDER_ENABLED; else process.env.AI_MOCK_PROVIDER_ENABLED = previous.mock;
});

async function seed(t: ReturnType<typeof convexTest>) {
  const base = await t.run(async (ctx) => {
    const tenantId = await ctx.db.insert("tenants", { name: "Clínica", vertical: "clinic", plan: "starter", settings: { defaultLocale: "pt-MZ", timezone: "Africa/Maputo", retentionDays: 730 }, createdAt: Date.now() });
    const userId = await ctx.db.insert("users", { name: "Owner" });
    const memberId = await ctx.db.insert("members", { tenantId, userId, role: "owner", status: "active", createdAt: Date.now() });
    await ctx.db.insert("sessions", { userId, activeTenantId: tenantId, updatedAt: Date.now() });
    const now = Date.now();
    const channelId = await ctx.db.insert("channels", { tenantId, publicId: "hub_controlxxxxxxxxxxxxxxxxx".slice(0, 28), kind: "whatsapp", provider: "iasolution_hub", operationalTerritory: "openbsp", externalAccountId: "c-ctl", displayName: "Piloto", status: "active", sendMode: "allowlist", outboundAllowlist: ["258840000099"], connectionState: "allowlist_only", webhookStatus: "verified", createdBy: memberId, createdAt: now, updatedAt: now });
    const threadId = await ctx.db.insert("channelThreads", { tenantId, channelId, threadKey: "258840000099", lastEventAt: now, lastEventKind: "message.text", unreadCount: 0, leadStatus: "interested", automationMode: "bot", serviceWindowExpiresAt: now + 3_600_000, createdAt: now, updatedAt: now });
    await ctx.db.insert("channelEvents", { tenantId, channelId, eventKey: "in:1", eventKind: "message.text", direction: "incoming", threadKey: "258840000099", payload: { text: "Olá" }, rawPayload: "{}", rawBodySha256: "s", status: "processed", attempts: 1, receivedAt: now });
    const knowledgeId = await ctx.db.insert("clinicKnowledgeItems", { tenantId, kind: "faq", title: "Horário", body: "Seg-Sex", status: "active", currentVersion: 1, createdBy: memberId, createdAt: now, updatedAt: now });
    return { tenantId, userId, memberId, channelId, threadId, knowledgeId };
  });
  const asOwner = t.withIdentity({ subject: base.userId });
  await asOwner.mutation(api.aiSettings.update, { provider: "mock" });
  await asOwner.action(api.aiProviders.probe, {});
  const agentId = await asOwner.mutation(api.aiAgents.create, { name: "Recepção", objective: "reception", channelId: base.channelId });
  const detail = await asOwner.query(api.aiAgents.get, { agentId });
  await asOwner.mutation(api.aiAgents.updateDraft, { agentId, config: { ...detail.agent.config, knowledgeItemIds: [base.knowledgeId] } });
  const published = await asOwner.mutation(api.aiAgents.publish, { agentId });
  await asOwner.mutation(api.aiAgents.setMode, { agentId, mode: "autopilot" });
  const runId = await t.run(async (ctx) => {
    const now = Date.now();
    const runId = await ctx.db.insert("aiRuns", { tenantId: base.tenantId, agentId, versionId: published.versionId, channelId: base.channelId, threadId: base.threadId, threadKey: "258840000099", status: "active", turnsCount: 2, costUsdMicros: 1200, lastTurnAt: now, createdAt: now, updatedAt: now });
    await ctx.db.insert("aiTurns", { tenantId: base.tenantId, runId, threadId: base.threadId, businessKey: "event:a", status: "completed", stage: "reply", replyText: "Olá! Posso ajudar?", providerAttempts: [{ provider: "mock", model: "m", stage: "specialist", attempt: 1, ok: true, latencyMs: 300 }], inputTokens: 100, outputTokens: 30, costUsdMicros: 600, toolCallCount: 1, createdAt: now - 1000, updatedAt: now, completedAt: now });
    await ctx.db.insert("aiTurns", { tenantId: base.tenantId, runId, threadId: base.threadId, businessKey: "event:b", status: "queued", providerAttempts: [], inputTokens: 0, outputTokens: 0, costUsdMicros: 0, toolCallCount: 0, createdAt: now, updatedAt: now });
    return runId;
  });
  return { ...base, asOwner, agentId, runId };
}

describe("AI control, presence and telemetry", () => {
  it("pauses on operator pause, refuses resume with an open case, resumes with a handback note", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    let ops = await s.asOwner.query(api.inboxOperations.getThreadOps, { threadId: s.threadId });
    expect(ops.ai).toMatchObject({ agentName: "Recepção", status: "responding", turns: 2 });

    await s.asOwner.mutation(api.inboxOperations.updateThread, { threadId: s.threadId, automationMode: "human" });
    const paused = await t.run(async (ctx) => ({ run: (await ctx.db.get(s.runId)) as Doc<"aiRuns">, turns: await ctx.db.query("aiTurns").collect(), events: (await ctx.db.query("threadSystemEvents").collect()).map((e) => e.kind) }));
    expect(paused.run.status).toBe("paused");
    expect(paused.turns.find((x) => x.businessKey === "event:b")?.status).toBe("skipped");
    expect(paused.events).toContain("ai.paused");
    ops = await s.asOwner.query(api.inboxOperations.getThreadOps, { threadId: s.threadId });
    expect(ops.ai?.status).toBe("paused");

    // Open case blocks the handback.
    const caseId = await s.asOwner.mutation(api.clinic.createHumanCase, { threadId: s.threadId, reason: "Dúvida", urgency: "normal", question: "Precisa de humano" });
    await expect(s.asOwner.mutation(api.aiRuntime.resumeThread, { threadId: s.threadId })).rejects.toThrow(/HUMAN_CASE_OPEN/);
    await s.asOwner.mutation(api.clinic.resolveHumanCase, { caseId, decision: "Resolvido", returnToAi: false });

    const resumed = await s.asOwner.mutation(api.aiRuntime.resumeThread, { threadId: s.threadId });
    expect(resumed.resumed).toBe(true);
    const after = await t.run(async (ctx) => ({ run: (await ctx.db.get(s.runId)) as Doc<"aiRuns">, thread: (await ctx.db.get(s.threadId)) as Doc<"channelThreads">, notes: await ctx.db.query("threadInternalNotes").collect(), events: (await ctx.db.query("threadSystemEvents").collect()).map((e) => e.kind), audit: (await ctx.db.query("auditLog").collect()).map((r) => r.action) }));
    expect(after.run.status).toBe("active");
    expect(after.thread.automationMode).toBe("bot");
    expect(after.notes[0].body).toContain("IA retomada");
    expect(after.notes[0].body).toContain("Última resposta da IA");
    expect(after.events).toContain("ai.resumed");
    expect(after.audit).toContain("ai.run.resumed");
    // Resuming via the generic thread update also works (idempotent when active).
    await s.asOwner.mutation(api.inboxOperations.updateThread, { threadId: s.threadId, automationMode: "human" });
    await s.asOwner.mutation(api.inboxOperations.updateThread, { threadId: s.threadId, automationMode: "bot" });
    expect((await t.run(async (ctx) => (await ctx.db.get(s.runId)) as Doc<"aiRuns">)).status).toBe("active");
  });

  it("lists turns and aggregates stats per agent", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    const turns = await s.asOwner.query(api.aiRuntime.listTurns, { agentId: s.agentId, paginationOpts: { cursor: null, numItems: 10 } });
    expect(turns.page).toHaveLength(2);
    expect(turns.page.find((x) => x.status === "completed")).toMatchObject({ agentName: "Recepção", replyText: "Olá! Posso ajudar?", toolCallCount: 1, latencyMs: 300 });
    const stats = await s.asOwner.query(api.aiRuntime.stats, { agentId: s.agentId, days: 7 });
    expect(stats).toMatchObject({ turns: 2, completed: 1, toolCalls: 1, avgLatencyMs: 300, costUsdMicros: 600, activeRuns: 1, sampled: false });
    const agentRuns = await t.run(async (ctx) => (await ctx.db.query("aiRuns").collect()).length);
    expect(agentRuns).toBe(1);
  });

  it("summarises keyword-flow runs", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    const chatbotId = await t.run(async (ctx) => {
      const now = Date.now();
      const chatbotId = await ctx.db.insert("chatbots", { tenantId: s.tenantId, name: "Boas-vindas", status: "active", channel: "whatsapp", channelId: s.channelId, triggerKind: "keyword", createdBy: s.memberId, createdAt: now, updatedAt: now } as never);
      const mk = async (status: "completed" | "handed_off" | "stopped", endReason: string | undefined, node: string) => {
        await ctx.db.insert("channelAutomationRuns", { tenantId: s.tenantId, chatbotId, channelId: s.channelId, threadId: s.threadId, threadKey: "258840000099", status, currentNodeKey: node, vars: {}, repromptCount: 0, startedAt: now - 60_000, endedAt: now, endReason, lastAdvancedAt: now } as never);
      };
      await mk("completed", "flow_completed", "end");
      await mk("handed_off", "handoff", "ask_time");
      await mk("stopped", "contact_stop_keyword", "ask_time");
      return chatbotId;
    });
    const analytics = await s.asOwner.query(api.channelAutomation.flowAnalytics, { chatbotId });
    expect(analytics).toMatchObject({ runs: 3, completed: 1, handedOff: 1, stopped: 1, avgDurationMs: 60_000 });
    expect(analytics.dropOffNodes[0]).toEqual({ nodeKey: "ask_time", count: 2 });
    expect(analytics.endReasons.map((r) => r.reason)).toContain("handoff");
    void internal;
  });
});
