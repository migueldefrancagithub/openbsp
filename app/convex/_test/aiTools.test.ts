import { convexTest } from "convex-test";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import schema from "../schema";
import { localTimeToTimestamp } from "../lib/clinicTime";

const previous = { key: process.env.WABA_TOKEN_ENCRYPTION_KEY_V1, mock: process.env.AI_MOCK_PROVIDER_ENABLED };
process.env.WABA_TOKEN_ENCRYPTION_KEY_V1 = "c".repeat(64);
process.env.AI_MOCK_PROVIDER_ENABLED = "1";
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
afterAll(() => {
  if (previous.key === undefined) delete process.env.WABA_TOKEN_ENCRYPTION_KEY_V1; else process.env.WABA_TOKEN_ENCRYPTION_KEY_V1 = previous.key;
  if (previous.mock === undefined) delete process.env.AI_MOCK_PROVIDER_ENABLED; else process.env.AI_MOCK_PROVIDER_ENABLED = previous.mock;
});

function nextWeekday(target: number): string {
  const d = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  while (d.getUTCDay() !== target) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export async function seedAiWorld(t: ReturnType<typeof convexTest>) {
  const base = await t.run(async (ctx) => {
    const tenantId = await ctx.db.insert("tenants", { name: "Clínica Sol", vertical: "clinic", plan: "starter", settings: { defaultLocale: "pt-MZ", timezone: "Africa/Maputo", retentionDays: 730 }, createdAt: Date.now() });
    const userId = await ctx.db.insert("users", { name: "Owner" });
    const memberId = await ctx.db.insert("members", { tenantId, userId, role: "owner", status: "active", createdAt: Date.now() });
    await ctx.db.insert("sessions", { userId, activeTenantId: tenantId, updatedAt: Date.now() });
    const now = Date.now();
    const channelId = await ctx.db.insert("channels", { tenantId, publicId: "hub_toolsxxxxxxxxxxxxxxxxxxx".slice(0, 28), kind: "whatsapp", provider: "iasolution_hub", operationalTerritory: "openbsp", externalAccountId: "c-tools", displayName: "Piloto", status: "active", sendMode: "allowlist", outboundAllowlist: ["258840000099"], connectionState: "allowlist_only", webhookStatus: "verified", createdBy: memberId, createdAt: now, updatedAt: now });
    const identityId = await ctx.db.insert("channelIdentities", { tenantId, channelId, providerScopedId: "258840000099", phone: "258840000099", displayName: "Ana Maria", createdAt: now, updatedAt: now });
    const threadId = await ctx.db.insert("channelThreads", { tenantId, channelId, threadKey: "258840000099", identityId, lastEventAt: now, lastEventKind: "message.text", unreadCount: 0, leadStatus: "interested", serviceWindowExpiresAt: now + 6 * 60 * 60_000, createdAt: now, updatedAt: now });
    await ctx.db.insert("channelEvents", { tenantId, channelId, eventKey: "in:1", eventKind: "message.text", direction: "incoming", threadKey: "258840000099", payload: { text: "Olá" }, rawPayload: "{}", rawBodySha256: "s", status: "processed", attempts: 1, receivedAt: now });
    const knowledgeId = await ctx.db.insert("clinicKnowledgeItems", { tenantId, kind: "faq", title: "Horário", body: "Seg-Sex 8h-17h", status: "active", currentVersion: 1, createdBy: memberId, createdAt: now, updatedAt: now });
    const serviceId = await ctx.db.insert("clinicServices", { tenantId, name: "Consulta", durationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, availability: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: "08:00", end: "17:00" })), status: "active", createdBy: memberId, createdAt: now, updatedAt: now });
    await ctx.db.insert("followUpRules", { tenantId, name: "Sem resposta", trigger: "no_reply", delayMinutes: 60, message: "Ainda posso ajudar?", stopOnReply: true, status: "active", createdBy: memberId, createdAt: now, updatedAt: now });
    return { tenantId, userId, memberId, channelId, threadId, knowledgeId, serviceId };
  });
  const asOwner = t.withIdentity({ subject: base.userId });
  await asOwner.mutation(api.aiSettings.update, { provider: "mock" });
  await asOwner.action(api.aiProviders.probe, {});
  const agentId = await asOwner.mutation(api.aiAgents.create, { name: "Recepção", objective: "reception", channelId: base.channelId });
  const detail = await asOwner.query(api.aiAgents.get, { agentId });
  await asOwner.mutation(api.aiAgents.updateDraft, { agentId, config: { ...detail.agent.config, knowledgeItemIds: [base.knowledgeId], tools: ["consultar_agenda", "reservar_slot", "confirmar_consulta", "atualizar_lead", "criar_lembrete_equipa", "agendar_follow_up", "aplicar_tag", "abrir_caso_humano"] } });
  const published = await asOwner.mutation(api.aiAgents.publish, { agentId });
  return { ...base, asOwner, agentId, versionId: published.versionId };
}

async function seedTurn(t: ReturnType<typeof convexTest>, s: Awaited<ReturnType<typeof seedAiWorld>>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const runId = await ctx.db.insert("aiRuns", { tenantId: s.tenantId, agentId: s.agentId, versionId: s.versionId, channelId: s.channelId, threadId: s.threadId, threadKey: "258840000099", status: "active", turnsCount: 0, costUsdMicros: 0, createdAt: now, updatedAt: now });
    const turnId = await ctx.db.insert("aiTurns", { tenantId: s.tenantId, runId, threadId: s.threadId, businessKey: "event:test", status: "processing", providerAttempts: [], inputTokens: 0, outputTokens: 0, costUsdMicros: 0, toolCallCount: 0, createdAt: now, updatedAt: now });
    return { runId, turnId };
  });
}

describe("AI tools", () => {
  it("books, confirms, updates, reminds, tags and hands off through the Phase B contracts, idempotently", async () => {
    const t = convexTest(schema);
    const s = await seedAiWorld(t);
    const { runId, turnId } = await seedTurn(t, s);
    const date = nextWeekday(3);
    const startAt = localTimeToTimestamp(date, "10:00", "Africa/Maputo");

    const denied = await t.mutation(internal.aiTools.invoke, { turnId, name: "enviar_template", input: { templateName: "x", languageCode: "pt" } });
    expect(denied).toMatchObject({ status: "denied", errorCode: "TOOL_NOT_ALLOWED" });
    const invalid = await t.mutation(internal.aiTools.invoke, { turnId, name: "reservar_slot", input: { serviceId: s.serviceId } });
    expect(invalid).toMatchObject({ status: "error", errorCode: "TOOL_INPUT_INVALID" });

    const agenda = await t.mutation(internal.aiTools.invoke, { turnId, name: "consultar_agenda", input: { serviceId: s.serviceId, date } });
    expect(agenda.status).toBe("ok");
    expect((agenda.output as { free: Array<{ startAt: number }> }).free.some((slot) => slot.startAt === startAt)).toBe(true);

    const booked = await t.mutation(internal.aiTools.invoke, { turnId, name: "reservar_slot", input: { serviceId: s.serviceId, startAt, patientName: "Ana Maria" } });
    expect(booked.status).toBe("ok");
    const appointmentId = (booked.output as { appointmentId: Id<"clinicAppointments"> }).appointmentId;
    expect((booked.effects as { booked: { serviceName: string } }).booked.serviceName).toBe("Consulta");
    const replay = await t.mutation(internal.aiTools.invoke, { turnId, name: "reservar_slot", input: { serviceId: s.serviceId, startAt, patientName: "Ana Maria" } });
    expect(replay).toMatchObject({ replayed: true, status: "ok" });
    expect((replay.output as { appointmentId: string }).appointmentId).toBe(appointmentId);
    const appointments = await t.run(async (ctx) => await ctx.db.query("clinicAppointments").collect());
    expect(appointments).toHaveLength(1);
    expect(appointments[0]).toMatchObject({ source: "ai", threadId: s.threadId, businessKey: `ai:${turnId}:reservar:${s.serviceId}:${startAt}` });
    const thread = await t.run(async (ctx) => (await ctx.db.get(s.threadId)) as Doc<"channelThreads">);
    expect(thread.leadStatus).toBe("booked");

    expect((await t.mutation(internal.aiTools.invoke, { turnId, name: "confirmar_consulta", input: {} })).status).toBe("ok");
    expect((await t.run(async (ctx) => (await ctx.db.get(appointmentId)) as Doc<"clinicAppointments">)).confirmedVia).toBe("ai");

    const lead = await t.mutation(internal.aiTools.invoke, { turnId, name: "atualizar_lead", input: { leadStatus: "interested", intent: "info_request", nextStep: "Enviar preços" } });
    expect((lead.output as { leadStatus: string }).leadStatus).toBe("confirmed"); // never downgraded
    expect((await t.mutation(internal.aiTools.invoke, { turnId, name: "criar_lembrete_equipa", input: { note: "Ligar amanhã", dueInMinutes: 120 } })).status).toBe("ok");
    expect((await t.mutation(internal.aiTools.invoke, { turnId, name: "agendar_follow_up", input: { trigger: "no_reply" } })).status).toBe("ok");
    expect((await t.mutation(internal.aiTools.invoke, { turnId, name: "agendar_follow_up", input: { trigger: "proposal_no_response" } })).errorCode).toBe("FOLLOW_UP_RULE_MISSING");
    expect((await t.mutation(internal.aiTools.invoke, { turnId, name: "aplicar_tag", input: { tag: "Ortodontia" } })).output).toEqual({ tags: ["ortodontia"] });

    const handoff = await t.mutation(internal.aiTools.invoke, { turnId, name: "abrir_caso_humano", input: { reason: "Pede desconto especial", urgency: "high" } });
    expect(handoff.status).toBe("ok");
    expect((handoff.effects as { handedOff: boolean }).handedOff).toBe(true);
    const after = await t.run(async (ctx) => ({
      thread: (await ctx.db.get(s.threadId)) as Doc<"channelThreads">,
      cases: await ctx.db.query("humanCases").collect(),
      invocations: await ctx.db.query("aiToolInvocations").collect(),
      events: (await ctx.db.query("threadSystemEvents").collect()).map((e) => `${e.kind}:${e.actorType}`),
      audit: (await ctx.db.query("auditLog").collect()).filter((r) => r.action === "clinic.human_case.created"),
    }));
    expect(after.thread.openHumanCaseId).toBe(after.cases[0]._id);
    expect(after.cases[0]).toMatchObject({ openedFrom: "automation", urgency: "high" });
    expect(after.events).toContain("handoff.case_opened:automation");
    expect(after.audit[0].actorType).toBe("system");
    expect(after.invocations.map((i) => i.name)).toEqual(["enviar_template", "reservar_slot", "consultar_agenda", "reservar_slot", "confirmar_consulta", "atualizar_lead", "criar_lembrete_equipa", "agendar_follow_up", "agendar_follow_up", "aplicar_tag", "abrir_caso_humano"]);
    const turn = await t.run(async (ctx) => (await ctx.db.get(turnId)) as Doc<"aiTurns">);
    expect(turn.toolCallCount).toBe(11);
    void runId;
  });

  it("dry-runs tools for the sandbox without writing", async () => {
    const t = convexTest(schema);
    const s = await seedAiWorld(t);
    const date = nextWeekday(2);
    const startAt = localTimeToTimestamp(date, "09:00", "Africa/Maputo");
    const dry = await t.mutation(internal.aiTools.dryRun, { tenantId: s.tenantId, memberId: s.memberId, allowedTools: ["reservar_slot", "abrir_caso_humano"], name: "reservar_slot", input: { serviceId: s.serviceId, startAt } });
    expect(dry.status).toBe("dry_run");
    expect((dry.output as { wouldBook: boolean }).wouldBook).toBe(true);
    const handoff = await t.mutation(internal.aiTools.dryRun, { tenantId: s.tenantId, memberId: s.memberId, allowedTools: ["abrir_caso_humano"], name: "abrir_caso_humano", input: { reason: "x", urgency: "low" } });
    expect((handoff.effects as { handedOff: boolean }).handedOff).toBe(true);
    const state = await t.run(async (ctx) => ({ appointments: await ctx.db.query("clinicAppointments").collect(), cases: await ctx.db.query("humanCases").collect(), invocations: await ctx.db.query("aiToolInvocations").collect() }));
    expect(state.appointments).toHaveLength(0);
    expect(state.cases).toHaveLength(0);
    expect(state.invocations).toHaveLength(0);
  });

  it("simulates a scripted conversation with the mock provider and marks the sandbox as used", async () => {
    const t = convexTest(schema);
    const s = await seedAiWorld(t);
    const date = nextWeekday(4);
    const startAt = localTimeToTimestamp(date, "11:00", "Africa/Maputo");
    const result = await s.asOwner.action(api.aiSandbox.simulate, {
      agentId: s.agentId,
      messages: [`Quero marcar [[tool:reservar_slot {"serviceId":"${s.serviceId}","startAt":${startAt}}]]`, "Quero falar com uma pessoa"],
    });
    expect(result.transcript).toHaveLength(2);
    expect(result.transcript[0].toolCalls[0]).toMatchObject({ name: "reservar_slot", status: "dry_run" });
    expect(result.transcript[0].outcome).toBe("reply");
    expect(result.transcript[0].text).toContain("📅 Marcado");
    expect(result.transcript[1].outcome).toBe("handoff");
    expect(result.transcript[1].reason).toBe("human_request");
    const agent = await t.run(async (ctx) => (await ctx.db.get(s.agentId)) as Doc<"aiAgents">);
    expect(agent.lastSandboxAt).toBeDefined();
    expect(await t.run(async (ctx) => (await ctx.db.query("clinicAppointments").collect()).length)).toBe(0);
  });
});
