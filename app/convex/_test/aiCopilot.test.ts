import { convexTest } from "convex-test";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import schema from "../schema";
import { encryptSecret } from "../lib/secrets";
import { normalizeWebhook } from "../integrations/iaSolutionHub/webhook";
import { localTimeToTimestamp } from "../lib/clinicTime";
import { setDefaultSleep } from "../lib/ai/resilience";

const PATIENT = "258840000099";
const previous = { key: process.env.WABA_TOKEN_ENCRYPTION_KEY_V1, mock: process.env.AI_MOCK_PROVIDER_ENABLED };
process.env.WABA_TOKEN_ENCRYPTION_KEY_V1 = "7".repeat(64);
process.env.AI_MOCK_PROVIDER_ENABLED = "1";
beforeEach(() => {
  vi.useFakeTimers();
  setDefaultSleep(async () => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setDefaultSleep(null);
});
afterAll(() => {
  if (previous.key === undefined) delete process.env.WABA_TOKEN_ENCRYPTION_KEY_V1; else process.env.WABA_TOKEN_ENCRYPTION_KEY_V1 = previous.key;
  if (previous.mock === undefined) delete process.env.AI_MOCK_PROVIDER_ENABLED; else process.env.AI_MOCK_PROVIDER_ENABLED = previous.mock;
});

function nextWeekday(target: number): string {
  const d = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  while (d.getUTCDay() !== target) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function seed(t: ReturnType<typeof convexTest>) {
  const base = await t.run(async (ctx) => {
    const tenantId = await ctx.db.insert("tenants", { name: "Clínica Sol", vertical: "clinic", plan: "starter", settings: { defaultLocale: "pt-MZ", timezone: "Africa/Maputo", retentionDays: 730 }, createdAt: Date.now() });
    const userId = await ctx.db.insert("users", { name: "Owner" });
    const memberId = await ctx.db.insert("members", { tenantId, userId, role: "owner", status: "active", createdAt: Date.now() });
    await ctx.db.insert("sessions", { userId, activeTenantId: tenantId, updatedAt: Date.now() });
    const now = Date.now();
    const knowledgeId = await ctx.db.insert("clinicKnowledgeItems", { tenantId, kind: "faq", title: "Horário", body: "Seg-Sex 8h-17h", status: "active", currentVersion: 1, createdBy: memberId, createdAt: now, updatedAt: now });
    const serviceId = await ctx.db.insert("clinicServices", { tenantId, name: "Consulta", durationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, availability: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: "08:00", end: "17:00" })), status: "active", createdBy: memberId, createdAt: now, updatedAt: now });
    return { tenantId, userId, memberId, knowledgeId, serviceId };
  });
  const asOwner = t.withIdentity({ subject: base.userId });
  const pending = await asOwner.mutation(api.iaSolutionHub.createPendingChannel, { displayName: "Piloto" });
  const token = await encryptSecret("hub-token");
  const hook = await encryptSecret("hub-secret");
  await t.mutation(internal.iaSolutionHub._configureConnection, {
    tenantId: base.tenantId, memberId: base.memberId, channelId: pending.channelId, externalChannelId: "hub-cp", displayName: "Piloto", phoneNumber: "258840000001", wabaId: "waba-cp", outboundAllowlist: [PATIENT],
    accessTokenCiphertext: token.ciphertext, accessTokenKeyVersion: token.keyVersion, webhookSecretCiphertext: hook.ciphertext, webhookSecretKeyVersion: hook.keyVersion, encryptedAt: Date.now(), healthStatus: "GREEN",
  });
  await t.run(async (ctx) => {
    await ctx.db.patch(pending.channelId, { status: "active", webhookStatus: "verified", sendMode: "allowlist", connectionState: "allowlist_only" });
  });
  await asOwner.mutation(api.aiSettings.update, { provider: "mock" });
  await asOwner.action(api.aiProviders.probe, {});
  const agentId = await asOwner.mutation(api.aiAgents.create, { name: "Recepção", objective: "reception", channelId: pending.channelId });
  const detail = await asOwner.query(api.aiAgents.get, { agentId });
  await asOwner.mutation(api.aiAgents.updateDraft, { agentId, config: { ...detail.agent.config, knowledgeItemIds: [base.knowledgeId] } });
  await asOwner.mutation(api.aiAgents.publish, { agentId });
  return { ...base, asOwner, channelId: pending.channelId, agentId };
}

async function inbound(t: ReturnType<typeof convexTest>, channelId: Id<"channels">, text: string, id: string) {
  const payload = { contacts: [{ profile: { name: "Ana Maria" }, wa_id: PATIENT }], messages: [{ from: PATIENT, id, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: text } }] };
  await t.mutation(internal.iaSolutionHub.ingestWebhookEvents, { channelId, rawPayload: JSON.stringify(payload), rawBodySha256: `sha-${id}`, events: normalizeWebhook(payload, `sha-${id}`) });
  return await t.run(async (ctx) => (await ctx.db.query("channelEvents").collect()).find((e) => e.providerEventId === id)!);
}

function stubHub() {
  const sent: unknown[] = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    if (input.toString().includes("/messages/")) {
      sent.push(init?.body ? JSON.parse(String(init.body)) : {});
      return Response.json({ success: true, data: { messageId: `wamid.cp.${sent.length}` } });
    }
    return Response.json({ success: false });
  });
  return sent;
}

describe("agent maturity modes", () => {
  it("defaults to copilot: proposes text + actions, sends only on approval, executes approved actions and learns from edits", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    expect((await s.asOwner.query(api.aiAgents.get, { agentId: s.agentId })).agent.mode).toBe("copilot");
    const startAt = localTimeToTimestamp(nextWeekday(2), "10:00", "Africa/Maputo");
    const event = await inbound(t, s.channelId, `Quero marcar [[tool:reservar_slot {"serviceId":"${s.serviceId}","startAt":${startAt}}]]`, "c1");
    const claim = await t.mutation(internal.aiRuntime.claimTurn, { eventId: event._id });
    expect(claim.claimed).toBe(true);
    const sent = stubHub();
    await t.action(internal.aiRuntime.processTurn, { turnId: claim.turnId! });

    const turn = await t.run(async (ctx) => (await ctx.db.get(claim.turnId!)) as Doc<"aiTurns">);
    expect(turn.status).toBe("awaiting_approval");
    expect(turn.mode).toBe("copilot");
    expect(turn.suggestedText).toContain("📅 Marcado");
    expect((turn.proposedActions as Array<{ name: string }>).map((a) => a.name)).toEqual(["reservar_slot"]);
    const before = await t.run(async (ctx) => ({ appointments: await ctx.db.query("clinicAppointments").collect(), outbox: await ctx.db.query("channelOutbox").collect(), invocations: await ctx.db.query("aiToolInvocations").collect(), thread: (await ctx.db.query("channelThreads").collect())[0] }));
    expect(before.appointments).toHaveLength(0);
    expect(before.outbox).toHaveLength(0);
    expect(before.invocations[0]).toMatchObject({ name: "reservar_slot", status: "dry_run" });
    expect(before.thread.automationMode).not.toBe("bot");
    expect(sent).toHaveLength(0);

    const list = await s.asOwner.query(api.inboxOperations.listThreads, { channelId: s.channelId, filter: "all", paginationOpts: { cursor: null, numItems: 10 } } as never);
    expect(list.page[0].aiSuggestionPending).toBe(true);
    const pending = await s.asOwner.query(api.aiCopilot.pendingForThread, { threadId: before.thread._id });
    expect(pending).toMatchObject({ turnId: claim.turnId, agentName: "Recepção", stage: "reply" });
    expect(pending!.actions[0]).toMatchObject({ index: 0, name: "reservar_slot" });
    const ops = await s.asOwner.query(api.inboxOperations.getThreadOps, { threadId: before.thread._id });
    expect(ops.ai).toMatchObject({ mode: "copilot", overridden: false, pendingSuggestion: true });

    const edited = "Olá Ana! Marquei a sua consulta para terça às 10h. Até lá!";
    const approval = await s.asOwner.mutation(api.aiCopilot.approve, { turnId: claim.turnId!, text: edited, approvedActionIndexes: [0] });
    expect(approval).toMatchObject({ sent: true, actions: [{ name: "reservar_slot", status: "ok" }] });
    await t.action(internal.iaSolutionHub.dispatchOutboundJob, { job: { kind: "ai_reply", turnId: claim.turnId! } });
    const after = await t.run(async (ctx) => ({
      turn: (await ctx.db.get(claim.turnId!)) as Doc<"aiTurns">,
      appointments: await ctx.db.query("clinicAppointments").collect(),
      outbox: await ctx.db.query("channelOutbox").collect(),
      feedback: await ctx.db.query("aiFeedback").collect(),
      events: (await ctx.db.query("threadSystemEvents").collect()).map((e) => e.kind),
      thread: (await ctx.db.query("channelThreads").collect())[0],
    }));
    expect(after.turn).toMatchObject({ status: "completed", stage: "copilot", editedText: edited, replyText: edited });
    expect(after.appointments).toHaveLength(1);
    expect(after.appointments[0]).toMatchObject({ source: "ai", status: "scheduled" });
    expect(after.outbox[0].businessKey).toBe(`hub:text:ai:${claim.turnId}:reply`);
    expect(sent).toHaveLength(1);
    expect(after.feedback[0]).toMatchObject({ outcome: "edited", finalText: edited, approvedActions: ["reservar_slot"], rejectedActions: [] });
    expect(after.feedback[0].patientText).toContain("Quero marcar");
    expect(after.events).toEqual(expect.arrayContaining(["ai.suggested", "ai.approved", "ai.replied"]));
    expect(after.thread.leadStatus).toBe("booked");

    // The approved example calibrates the next turn.
    const next = await inbound(t, s.channelId, "Obrigada!", "c2");
    const claim2 = await t.mutation(internal.aiRuntime.claimTurn, { eventId: next._id });
    await t.mutation(internal.aiRuntime._startTurn, { turnId: claim2.turnId! });
    const context = (await t.query(internal.aiRuntime._loadTurnContext, { turnId: claim2.turnId! })) as { mode: string; agent: { examples: Array<{ reply: string }> } };
    expect(context.mode).toBe("copilot");
    expect(context.agent.examples).toEqual([{ patient: expect.stringContaining("Quero marcar"), reply: edited }]);
    const stats = await s.asOwner.query(api.aiCopilot.feedbackStats, { agentId: s.agentId });
    expect(stats).toMatchObject({ approved: 0, edited: 1, discarded: 0, examples: 1 });
  });

  it("discards, retires stale suggestions on newer messages, and keeps suggesting while a human talks", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    const e1 = await inbound(t, s.channelId, "Olá, têm vagas?", "d1");
    const c1 = await t.mutation(internal.aiRuntime.claimTurn, { eventId: e1._id });
    stubHub();
    await t.action(internal.aiRuntime.processTurn, { turnId: c1.turnId! });
    const threadId = (await t.run(async (ctx) => (await ctx.db.query("channelThreads").collect())[0]))._id;
    await s.asOwner.mutation(api.aiCopilot.discard, { turnId: c1.turnId!, reason: "fora de contexto" });
    expect((await t.run(async (ctx) => (await ctx.db.get(c1.turnId!)) as Doc<"aiTurns">)).failureCode).toBe("DISCARDED");
    expect(await s.asOwner.query(api.aiCopilot.pendingForThread, { threadId })).toBeNull();
    await expect(s.asOwner.mutation(api.aiCopilot.approve, { turnId: c1.turnId!, text: "x", approvedActionIndexes: [] })).rejects.toThrow(/AI_SUGGESTION_NOT_PENDING/);

    // Human in the conversation (automationMode human) still gets suggestions in copilot.
    await t.run(async (ctx) => { await ctx.db.patch(threadId, { automationMode: "human" }); });
    const e2 = await inbound(t, s.channelId, "E amanhã de manhã?", "d2");
    const c2 = await t.mutation(internal.aiRuntime.claimTurn, { eventId: e2._id });
    expect(c2.claimed).toBe(true);
    await t.action(internal.aiRuntime.processTurn, { turnId: c2.turnId! });
    expect((await t.run(async (ctx) => (await ctx.db.get(c2.turnId!)) as Doc<"aiTurns">)).status).toBe("awaiting_approval");
    // A human reply retires the pending suggestion without pausing the run.
    await t.mutation(internal.channelAutomation.pauseForHuman, { tenantId: s.tenantId, channelId: s.channelId, threadKey: PATIENT });
    const state = await t.run(async (ctx) => ({ turn: (await ctx.db.get(c2.turnId!)) as Doc<"aiTurns">, run: (await ctx.db.query("aiRuns").collect())[0] }));
    expect(state.turn.failureCode).toBe("HUMAN_REPLIED");
    expect(state.run.status).toBe("active");
    // A newer patient message retires an older pending suggestion.
    const e3 = await inbound(t, s.channelId, "Terça?", "d3");
    const c3 = await t.mutation(internal.aiRuntime.claimTurn, { eventId: e3._id });
    await t.action(internal.aiRuntime.processTurn, { turnId: c3.turnId! });
    const e4 = await inbound(t, s.channelId, "Ou quarta", "d4");
    const c4 = await t.mutation(internal.aiRuntime.claimTurn, { eventId: e4._id });
    expect(c4.claimed).toBe(true);
    expect((await t.run(async (ctx) => (await ctx.db.get(c3.turnId!)) as Doc<"aiTurns">)).failureCode).toBe("COALESCED");
  });

  it("switches modes: autopilot sends directly, sandbox never touches live conversations, thread override wins", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    await expect(s.asOwner.mutation(api.aiAgents.setMode, { agentId: s.agentId, mode: "sandbox" })).resolves.toBeNull();
    const e0 = await inbound(t, s.channelId, "Olá", "m0");
    expect((await t.mutation(internal.aiRuntime.claimTurn, { eventId: e0._id })).reason).toBe("AGENT_SANDBOX");

    await s.asOwner.mutation(api.aiAgents.setMode, { agentId: s.agentId, mode: "autopilot" });
    const sent = stubHub();
    const e1 = await inbound(t, s.channelId, "Quais os horários?", "m1");
    const c1 = await t.mutation(internal.aiRuntime.claimTurn, { eventId: e1._id });
    expect((await t.run(async (ctx) => (await ctx.db.get(c1.turnId!)) as Doc<"aiTurns">)).mode).toBe("autopilot");
    await t.action(internal.aiRuntime.processTurn, { turnId: c1.turnId! });
    await t.action(internal.iaSolutionHub.dispatchOutboundJob, { job: { kind: "ai_reply", turnId: c1.turnId! } });
    expect((await t.run(async (ctx) => (await ctx.db.get(c1.turnId!)) as Doc<"aiTurns">)).status).toBe("completed");
    expect(sent).toHaveLength(1);
    const threadId = (await t.run(async (ctx) => (await ctx.db.query("channelThreads").collect())[0]))._id;
    expect((await t.run(async (ctx) => (await ctx.db.get(threadId)) as Doc<"channelThreads">)).automationMode).toBe("bot");

    // Inbox override → copilot on this thread only: the team takes the wheel.
    const switched = await s.asOwner.mutation(api.aiCopilot.setThreadMode, { threadId, mode: "copilot" });
    expect(switched.effective).toBe("copilot");
    expect((await t.run(async (ctx) => (await ctx.db.get(threadId)) as Doc<"channelThreads">)).automationMode).toBe("human");
    const e2 = await inbound(t, s.channelId, "E sábado?", "m2");
    const c2 = await t.mutation(internal.aiRuntime.claimTurn, { eventId: e2._id });
    await t.action(internal.aiRuntime.processTurn, { turnId: c2.turnId! });
    expect((await t.run(async (ctx) => (await ctx.db.get(c2.turnId!)) as Doc<"aiTurns">)).status).toBe("awaiting_approval");
    expect(sent).toHaveLength(1);
    const ops = await s.asOwner.query(api.inboxOperations.getThreadOps, { threadId });
    expect(ops.ai).toMatchObject({ mode: "copilot", overridden: true, pendingSuggestion: true });
    // Back to the agent default (autopilot).
    await s.asOwner.mutation(api.aiCopilot.setThreadMode, { threadId, mode: null });
    expect((await s.asOwner.query(api.inboxOperations.getThreadOps, { threadId })).ai?.mode).toBe("autopilot");

    // Mode rules: unpublished agents cannot leave sandbox.
    const draft = await s.asOwner.mutation(api.aiAgents.create, { name: "Rascunho", objective: "support" });
    await expect(s.asOwner.mutation(api.aiAgents.setMode, { agentId: draft, mode: "autopilot" })).rejects.toThrow(/AI_MODE_REQUIRES_PUBLISH/);
    const audit = await t.run(async (ctx) => (await ctx.db.query("auditLog").collect()).map((r) => r.action));
    expect(audit).toEqual(expect.arrayContaining(["ai.agent.mode_changed", "ai.thread_mode_changed"]));
  });
});
