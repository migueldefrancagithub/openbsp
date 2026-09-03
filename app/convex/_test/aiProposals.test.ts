import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import schema from "../schema";
import { executeAiTool } from "../lib/ai/tools";
import { PROPOSAL_TTL_MS } from "../lib/ai/proposals";

async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: "Owner" });
    const tenantId = await ctx.db.insert("tenants", {
      name: "Clínica",
      vertical: "clinic",
      plan: "starter",
      settings: { defaultLocale: "pt-MZ", timezone: "Africa/Maputo", retentionDays: 730 },
      createdAt: Date.now(),
    });
    const memberId = await ctx.db.insert("members", { tenantId, userId, role: "owner", status: "active", createdAt: Date.now() });
    await ctx.db.insert("sessions", { userId, activeTenantId: tenantId, updatedAt: Date.now() });
    const channelId = await ctx.db.insert("channels", {
      tenantId,
      publicId: "hub_proposalsxxxxxxxxxxxxxxxx".slice(0, 28),
      kind: "whatsapp",
      provider: "iasolution_hub",
      operationalTerritory: "openbsp",
      externalAccountId: "c-prop",
      displayName: "Piloto",
      status: "active",
      sendMode: "allowlist",
      outboundAllowlist: ["258840000030"],
      connectionState: "allowlist_only",
      webhookStatus: "verified",
      createdBy: memberId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const identityId = await ctx.db.insert("channelIdentities", {
      tenantId,
      channelId,
      providerScopedId: "258840000030",
      displayName: "Ana",
      phone: "258840000030",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const threadId = await ctx.db.insert("channelThreads", {
      tenantId,
      channelId,
      threadKey: "258840000030",
      identityId,
      lastEventAt: Date.now(),
      lastEventKind: "message.text",
      unreadCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { userId, tenantId, memberId, channelId, threadId };
  });
}

const TOOLS = ["propor_dado_paciente", "propor_proxima_acao"];

async function runTool(
  t: ReturnType<typeof convexTest>,
  s: Awaited<ReturnType<typeof seed>>,
  name: string,
  input: Record<string, unknown>,
  dryRun = false,
) {
  return await t.run(async (ctx) => {
    const thread = (await ctx.db.get(s.threadId)) as Doc<"channelThreads">;
    return await executeAiTool(
      {
        db: ctx.db,
        tenantId: s.tenantId,
        memberId: s.memberId,
        thread,
        dryRun,
        allowedTools: TOOLS,
        approvedTemplates: [],
        now: Date.now(),
      },
      name,
      input,
    );
  });
}

describe("what the AI heard, waiting for a person", () => {
  it("proposes a contact field with the patient's own words, and never writes it", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    const result = await runTool(t, s, "propor_dado_paciente", {
      field: "email",
      value: "Ana.Silva@Exemplo.CO.MZ",
      excerpt: "o meu email é ana.silva@exemplo.co.mz",
    });
    expect(result.status).toBe("ok");
    const stored = await t.run(async (ctx) => (await ctx.db.query("aiProposals").collect())[0]);
    expect(stored).toMatchObject({ kind: "contact_field", field: "email", status: "pending" });
    // Normalised, with the excerpt that makes confirming more than an act of faith.
    expect(stored.value).toBe("ana.silva@exemplo.co.mz");
    expect(stored.excerpt).toContain("ana.silva@exemplo.co.mz");
    const contacts = await t.run(async (ctx) => await ctx.db.query("contacts").collect());
    expect(contacts.every((c) => !(c.customAttributes as Record<string, unknown> | undefined)?.email)).toBe(true);
  });

  it("refuses early, because a bad proposal costs human attention", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    expect((await runTool(t, s, "propor_dado_paciente", { field: "email", value: "nao-e-email", excerpt: "x" })).errorCode).toBe(
      "PROPOSAL_VALUE_INVALID",
    );
    expect((await runTool(t, s, "propor_dado_paciente", { field: "email", value: "a@b.mz", excerpt: "" })).errorCode).toBe(
      "TOOL_INPUT_INVALID",
    );
    await runTool(t, s, "propor_dado_paciente", { field: "email", value: "a@b.mz", excerpt: "o meu email é a@b.mz" });
    // A patient repeating themselves must not fill the queue twice.
    expect((await runTool(t, s, "propor_dado_paciente", { field: "email", value: "a@b.mz", excerpt: "de novo" })).errorCode).toBe(
      "PROPOSAL_ALREADY_PENDING",
    );
  });

  it("does not ask for a decision that has already been taken", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    await t.run(async (ctx) => {
      const thread = (await ctx.db.get(s.threadId)) as Doc<"channelThreads">;
      await ctx.db.insert("contacts", {
        tenantId: s.tenantId,
        e164: "+258840000030",
        name: "Ana",
        tags: [],
        customAttributes: { email: "ana@exemplo.mz" },
        createdAt: Date.now(),
      });
      return thread;
    });
    const same = await runTool(t, s, "propor_dado_paciente", {
      field: "email",
      value: "ana@exemplo.mz",
      excerpt: "ana@exemplo.mz",
    });
    expect(same.errorCode).toBe("PROPOSAL_VALUE_UNCHANGED");
  });

  it("keeps one next action per conversation: the newest reading replaces the older", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    await runTool(t, s, "propor_proxima_acao", { action: "Ligar à paciente hoje" });
    const second = await runTool(t, s, "propor_proxima_acao", { action: "Enviar orçamento de ortodontia" });
    expect(second.output).toMatchObject({ replaced: true });
    const rows = await t.run(async (ctx) => await ctx.db.query("aiProposals").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("Enviar orçamento de ortodontia");
  });

  it("approving writes the value; ignoring is a decision too, and both are recorded", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    const asOwner = t.withIdentity({ subject: s.userId });
    await runTool(t, s, "propor_dado_paciente", { field: "name", value: "Ana Silva", excerpt: "sou a Ana Silva" });
    await runTool(t, s, "propor_proxima_acao", { action: "Enviar orçamento" });
    const pending = await asOwner.query(api.aiProposals.listPending, {});
    expect(pending).toHaveLength(2);

    const nameProposal = pending.find((row) => row.field === "name")!;
    expect(await asOwner.mutation(api.aiProposals.decide, { proposalId: nameProposal._id, decision: "approve" })).toEqual({
      applied: true,
    });
    const contact = await t.run(async (ctx) => (await ctx.db.query("contacts").collect())[0]);
    expect(contact.name).toBe("Ana Silva");

    const actionProposal = pending.find((row) => row.kind === "next_action")!;
    await asOwner.mutation(api.aiProposals.decide, { proposalId: actionProposal._id, decision: "dismiss" });
    const thread = await t.run(async (ctx) => (await ctx.db.get(s.threadId)) as Doc<"channelThreads">);
    // Dismissed means the next step is NOT written.
    expect(thread.nextStep).toBeUndefined();

    // A decided proposal cannot be decided again.
    await expect(
      asOwner.mutation(api.aiProposals.decide, { proposalId: actionProposal._id, decision: "approve" }),
    ).rejects.toThrow(/PROPOSAL_NOT_PENDING/);

    const audits = await t.run(async (ctx) => await ctx.db.query("clinicAuditEvents").collect());
    const actions = audits.map((row) => row.action);
    expect(actions).toContain("ai.proposal.approved");
    expect(actions).toContain("ai.proposal.dismissed");
    expect(await asOwner.query(api.aiProposals.listPending, {})).toHaveLength(0);
  });

  it("what nobody decides expires, and the expiry has a destination", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    await runTool(t, s, "propor_proxima_acao", { action: "Ligar amanhã" });
    expect(await t.mutation(internal.aiProposals.sweepExpired, {})).toEqual({ expired: 0 });
    await t.run(async (ctx) => {
      const row = (await ctx.db.query("aiProposals").collect())[0];
      await ctx.db.patch(row._id, { expiresAt: Date.now() - 1_000 });
    });
    expect(await t.mutation(internal.aiProposals.sweepExpired, {})).toEqual({ expired: 1 });
    const alerts = await t.withIdentity({ subject: s.userId }).query(api.ops.listAlerts, {});
    expect(alerts.map((row) => row.kind)).toContain("proposal.expired");
    expect(PROPOSAL_TTL_MS).toBe(7 * 24 * 60 * 60_000);
  });
});
