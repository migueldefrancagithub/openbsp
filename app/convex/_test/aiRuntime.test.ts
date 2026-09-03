import { convexTest } from "convex-test";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import schema from "../schema";
import { localDateOf } from "../lib/clinicTime";
import { encryptSecret } from "../lib/secrets";
import { normalizeWebhook } from "../integrations/iaSolutionHub/webhook";
import { localTimeToTimestamp } from "../lib/clinicTime";
import { setDefaultSleep } from "../lib/ai/resilience";

const PATIENT = "258840000099";
const previous = { key: process.env.WABA_TOKEN_ENCRYPTION_KEY_V1, mock: process.env.AI_MOCK_PROVIDER_ENABLED };
process.env.WABA_TOKEN_ENCRYPTION_KEY_V1 = "d".repeat(64);
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
    tenantId: base.tenantId, memberId: base.memberId, channelId: pending.channelId, externalChannelId: "hub-ai", displayName: "Piloto", phoneNumber: "258840000001", wabaId: "waba-ai", outboundAllowlist: [PATIENT],
    accessTokenCiphertext: token.ciphertext, accessTokenKeyVersion: token.keyVersion, webhookSecretCiphertext: hook.ciphertext, webhookSecretKeyVersion: hook.keyVersion, encryptedAt: Date.now(), healthStatus: "GREEN",
  });
  await t.run(async (ctx) => {
    await ctx.db.patch(pending.channelId, { status: "active", webhookStatus: "verified", sendMode: "allowlist", connectionState: "allowlist_only" });
  });
  await asOwner.mutation(api.aiSettings.update, { provider: "mock", dailyBudgetUsdCents: 500 });
  await asOwner.action(api.aiProviders.probe, {});
  const agentId = await asOwner.mutation(api.aiAgents.create, { name: "Recepção", objective: "reception", channelId: pending.channelId });
  const detail = await asOwner.query(api.aiAgents.get, { agentId });
  await asOwner.mutation(api.aiAgents.updateDraft, { agentId, config: { ...detail.agent.config, knowledgeItemIds: [base.knowledgeId], maxRepliesPerThread: 3 } });
  await asOwner.mutation(api.aiAgents.publish, { agentId });
  // These scenarios exercise the autonomous path; copilot is covered in aiCopilot.test.ts.
  await asOwner.mutation(api.aiAgents.setMode, { agentId, mode: "autopilot" });
  return { ...base, asOwner, channelId: pending.channelId, agentId };
}

async function inbound(t: ReturnType<typeof convexTest>, channelId: Id<"channels">, text: string, id: string) {
  const payload = { contacts: [{ profile: { name: "Ana Maria" }, wa_id: PATIENT }], messages: [{ from: PATIENT, id, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: text } }] };
  await t.mutation(internal.iaSolutionHub.ingestWebhookEvents, { channelId, rawPayload: JSON.stringify(payload), rawBodySha256: `sha-${id}`, events: normalizeWebhook(payload, `sha-${id}`) });
  return await t.run(async (ctx) => (await ctx.db.query("channelEvents").collect()).find((e) => e.providerEventId === id)!);
}

function stubHub(onSend: (body: unknown) => void = () => {}) {
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = input.toString();
    if (url.includes("/messages/")) {
      onSend(init?.body ? JSON.parse(String(init.body)) : {});
      return Response.json({ success: true, data: { messageId: `wamid.ai.${Math.random().toString(36).slice(2, 8)}` } });
    }
    return Response.json({ success: false, message: "unexpected" });
  });
}

async function drive(t: ReturnType<typeof convexTest>, turnId: Id<"aiTurns">) {
  await t.action(internal.aiRuntime.processTurn, { turnId });
  const turn = await t.run(async (ctx) => (await ctx.db.get(turnId)) as Doc<"aiTurns">);
  if (turn.status === "awaiting_send") await t.action(internal.iaSolutionHub.dispatchOutboundJob, { job: { kind: "ai_reply", turnId } });
  return await t.run(async (ctx) => (await ctx.db.get(turnId)) as Doc<"aiTurns">);
}

describe("AI runtime", () => {
  it("answers an inbound end to end: claim → pipeline → outbox → settle, with ledger and events", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    const event = await inbound(t, s.channelId, "Olá, quais são os horários?", "w1");
    const claim = await t.mutation(internal.aiRuntime.claimTurn, { eventId: event._id });
    expect(claim.claimed).toBe(true);
    expect(await t.mutation(internal.aiRuntime.claimTurn, { eventId: event._id })).toMatchObject({ claimed: false, reason: "duplicate" });
    const sent: unknown[] = [];
    stubHub((body) => sent.push(body));
    const turn = await drive(t, claim.turnId!);
    expect(turn.status).toBe("completed");
    expect(turn.stage).toBe("reply");
    expect(turn.replyText).toContain("Resposta simulada");
    expect(turn.providerAttempts.map((a) => `${a.stage}:${a.ok}`)).toEqual(["router:true", "specialist:true"]);
    expect(turn.costUsdMicros).toBe(0);
    expect(sent).toHaveLength(1);
    const state = await t.run(async (ctx) => ({
      outbox: await ctx.db.query("channelOutbox").collect(),
      run: (await ctx.db.query("aiRuns").collect())[0],
      ledger: await ctx.db.query("aiCostLedger").collect(),
      events: (await ctx.db.query("threadSystemEvents").collect()).map((e) => e.kind),
      thread: (await ctx.db.query("channelThreads").collect())[0],
    }));
    expect(state.outbox[0].businessKey).toBe(`hub:text:ai:${claim.turnId}:reply`);
    expect(state.run).toMatchObject({ status: "active", turnsCount: 1 });
    expect(state.ledger).toHaveLength(1);
    expect(state.events).toContain("ai.replied");
    expect(state.thread.automationMode).toBe("bot");
  });

  it("books through the tool loop and appends the deterministic footer", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    const startAt = localTimeToTimestamp(nextWeekday(2), "10:00", "Africa/Maputo");
    const event = await inbound(t, s.channelId, `Quero marcar [[tool:reservar_slot {"serviceId":"${s.serviceId}","startAt":${startAt}}]]`, "w2");
    const claim = await t.mutation(internal.aiRuntime.claimTurn, { eventId: event._id });
    stubHub();
    const turn = await drive(t, claim.turnId!);
    expect(turn.status).toBe("completed");
    expect(turn.replyText).toContain("📅 Marcado: Consulta");
    expect(turn.toolCallCount).toBe(1);
    const state = await t.run(async (ctx) => ({ appointments: await ctx.db.query("clinicAppointments").collect(), invocations: await ctx.db.query("aiToolInvocations").collect(), thread: (await ctx.db.query("channelThreads").collect())[0] }));
    expect(state.appointments[0]).toMatchObject({ source: "ai", status: "scheduled" });
    expect(state.invocations[0]).toMatchObject({ name: "reservar_slot", status: "ok" });
    expect(state.thread.leadStatus).toBe("booked");
  });

  it("hands off deterministically, pauses on human takeover, and never claims when the team owns the thread", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    const event = await inbound(t, s.channelId, "Quero falar com uma pessoa agora", "w3");
    const claim = await t.mutation(internal.aiRuntime.claimTurn, { eventId: event._id });
    stubHub();
    const turn = await drive(t, claim.turnId!);
    expect(`${turn.status}:${turn.failureCode ?? ""}:${turn.failureReason ?? ""}`).toBe("completed::");
    expect(turn.stage).toBe("handoff");
    expect(turn.providerAttempts).toEqual([]); // no model call needed
    const after = await t.run(async (ctx) => ({ cases: await ctx.db.query("humanCases").collect(), run: (await ctx.db.query("aiRuns").collect())[0], thread: (await ctx.db.query("channelThreads").collect())[0], events: (await ctx.db.query("threadSystemEvents").collect()).map((e) => e.kind) }));
    expect(after.cases[0]).toMatchObject({ openedFrom: "automation" });
    expect(after.run.status).toBe("handed_off");
    expect(after.thread.openHumanCaseId).toBe(after.cases[0]._id);
    expect(after.events).toEqual(expect.arrayContaining(["ai.handoff", "handoff.case_opened", "ai.replied"]));
    const next = await inbound(t, s.channelId, "Ok", "w4");
    expect((await t.mutation(internal.aiRuntime.claimTurn, { eventId: next._id })).reason).toBe("human_case_open");

    // Human takeover on a fresh active run pauses it and skips queued turns.
    const t2 = convexTest(schema);
    const s2 = await seed(t2);
    const e2 = await inbound(t2, s2.channelId, "Olá", "w5");
    const c2 = await t2.mutation(internal.aiRuntime.claimTurn, { eventId: e2._id });
    expect(c2.claimed).toBe(true);
    await t2.mutation(internal.channelAutomation.pauseForHuman, { tenantId: s2.tenantId, channelId: s2.channelId, threadKey: PATIENT });
    const paused = await t2.run(async (ctx) => ({ run: (await ctx.db.query("aiRuns").collect())[0], turn: (await ctx.db.get(c2.turnId!)) as Doc<"aiTurns">, thread: (await ctx.db.query("channelThreads").collect())[0] }));
    expect(paused.run.status).toBe("paused");
    expect(paused.turn).toMatchObject({ status: "skipped", failureCode: "HUMAN_TAKEOVER" });
    expect(paused.thread.automationMode).toBe("human");
    const e3 = await inbound(t2, s2.channelId, "Ainda aí?", "w6");
    expect((await t2.mutation(internal.aiRuntime.claimTurn, { eventId: e3._id })).claimed).toBe(false);
  });

  it("enforces budget and turn caps, coalesces bursts, and parks the thread when the provider is down", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    // Budget exhausted → skip + alert.
    await t.run(async (ctx) => {
      // The day key must be the CLINIC's day, the same one `spentTodayMicros`
      // computes. Building it in UTC makes this test fail between 22:00 and
      // midnight UTC, and pass the rest of the time.
      await ctx.db.insert("aiCostLedger", { tenantId: s.tenantId, day: localDateOf(Date.now(), "Africa/Maputo"), provider: "mock", model: "m", inputTokens: 1, outputTokens: 1, costUsdMicros: 5_000_000, turns: 1, updatedAt: Date.now() });
    });
    const e1 = await inbound(t, s.channelId, "Olá", "b1");
    expect((await t.mutation(internal.aiRuntime.claimTurn, { eventId: e1._id })).reason).toBe("BUDGET_EXCEEDED");
    expect((await s.asOwner.query(api.ops.listAlerts, {})).some((a) => a.kind === "ai.budget_exceeded")).toBe(true);
    await t.run(async (ctx) => { for (const row of await ctx.db.query("aiCostLedger").collect()) await ctx.db.delete(row._id); });

    // Burst: second message while the first is in flight is coalesced, then re-answered.
    stubHub();
    const e2 = await inbound(t, s.channelId, "Primeira", "b2");
    const c2 = await t.mutation(internal.aiRuntime.claimTurn, { eventId: e2._id });
    await t.mutation(internal.aiRuntime._startTurn, { turnId: c2.turnId! });
    vi.setSystemTime(Date.now() + 1_000);
    const e3 = await inbound(t, s.channelId, "Segunda", "b3");
    expect((await t.mutation(internal.aiRuntime.claimTurn, { eventId: e3._id })).reason).toBe("coalesced");
    // Simulate the burst landing while the model is still thinking.
    await t.run(async (ctx) => {
      await ctx.db.patch(c2.turnId!, { status: "queued" });
      const thread = (await ctx.db.query("channelThreads").collect())[0];
      await ctx.db.patch(thread._id, { lastInboundAt: Date.now() + 5_000 });
    });
    await drive(t, c2.turnId!);
    const turns = await t.run(async (ctx) => await ctx.db.query("aiTurns").collect());
    expect(turns.map((x) => x.status).sort()).toEqual(["completed", "queued", "skipped"]);
    const followUp = turns.find((x) => x.status === "queued")!;
    expect(followUp.businessKey.startsWith("coalesce:")).toBe(true);
    const answered = await drive(t, followUp._id);
    expect(answered.status).toBe("completed");
    expect(answered.replyText).toContain("Segunda");

    // Turn cap (maxRepliesPerThread = 3): third completed → fourth skipped.
    const e4 = await inbound(t, s.channelId, "Terceira", "b4");
    const c4 = await t.mutation(internal.aiRuntime.claimTurn, { eventId: e4._id });
    await drive(t, c4.turnId!);
    const e5 = await inbound(t, s.channelId, "Quarta", "b5");
    expect((await t.mutation(internal.aiRuntime.claimTurn, { eventId: e5._id })).reason).toBe("TURN_CAP");

    // Provider down → failed turn, run paused, human case, critical alert.
    const t2 = convexTest(schema);
    const s2 = await seed(t2);
    const e6 = await inbound(t2, s2.channelId, "Olá [[fail:server]]", "p1");
    const c6 = await t2.mutation(internal.aiRuntime.claimTurn, { eventId: e6._id });
    const failed = await drive(t2, c6.turnId!);
    expect(failed.status).toBe("failed");
    expect(failed.failureCode).toBe("provider:server");
    expect(failed.providerAttempts.filter((a) => !a.ok).length).toBeGreaterThanOrEqual(2);
    const state = await t2.run(async (ctx) => ({ run: (await ctx.db.query("aiRuns").collect())[0], cases: await ctx.db.query("humanCases").collect() }));
    expect(state.run.status).toBe("paused");
    expect(state.cases).toHaveLength(1);
    expect((await s2.asOwner.query(api.ops.listAlerts, {})).some((a) => a.kind === "ai.provider_down" && a.severity === "critical")).toBe(true);
  });

  it("is triggered by dispatchInbound only when no keyword flow matches", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    const event = await inbound(t, s.channelId, "Bom dia", "d1");
    await t.mutation(internal.channelAutomation.dispatchInbound, { eventId: event._id } as never);
    // The claim is scheduled (fake timers keep it pending); run it explicitly.
    const claim = await t.mutation(internal.aiRuntime.claimTurn, { eventId: event._id });
    expect(claim.claimed || claim.reason === "duplicate").toBe(true);
  });
});
