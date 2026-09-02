import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { normalizeWebhook } from "../integrations/iaSolutionHub/webhook";
import schema from "../schema";

const PATIENT = "258840000099";
const inboxApi = (api as any).inboxOperations;

type TestConvex = ReturnType<typeof convexTest>;

async function seedTenant(t: TestConvex, name: string) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: `${name} owner` });
    const tenantId = await ctx.db.insert("tenants", {
      name,
      vertical: "clinic",
      plan: "starter",
      settings: { defaultLocale: "pt-MZ", timezone: "Africa/Maputo", retentionDays: 730 },
      createdAt: Date.now(),
    });
    const memberId = await ctx.db.insert("members", {
      tenantId,
      userId,
      role: "owner",
      status: "active",
      createdAt: Date.now(),
    });
    await ctx.db.insert("sessions", { userId, activeTenantId: tenantId, updatedAt: Date.now() });
    const channelId = await ctx.db.insert("channels", {
      tenantId,
      publicId: `hub_${name.padEnd(24, "x").slice(0, 24)}`,
      kind: "whatsapp",
      provider: "iasolution_hub",
      operationalTerritory: "openbsp",
      externalAccountId: `channel-${name}`,
      displayName: name,
      status: "active",
      sendMode: "allowlist",
      outboundAllowlist: [PATIENT],
      connectionState: "allowlist_only",
      webhookStatus: "verified",
      createdBy: memberId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { userId, tenantId, memberId, channelId };
  });
}

async function addMember(
  t: TestConvex,
  tenantId: Id<"tenants">,
  role: "agent" | "marketing",
) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: `${role}` });
    const memberId = await ctx.db.insert("members", { tenantId, userId, role, status: "active", createdAt: Date.now() });
    await ctx.db.insert("sessions", { userId, activeTenantId: tenantId, updatedAt: Date.now() });
    return { userId, memberId };
  });
}

async function seedBotAndInbound(
  t: TestConvex,
  owner: { tenantId: Id<"tenants">; memberId: Id<"members">; channelId: Id<"channels"> },
  body: string,
  wamid: string,
) {
  await t.run(async (ctx) =>
    await ctx.db.insert("chatbots", {
      tenantId: owner.tenantId,
      name: "Recepção",
      status: "active",
      triggerKind: "inbound",
      entryNodeKey: "start",
      flowNodes: [
        { key: "start", type: "start", title: "Start", nextKey: "ask" },
        { key: "ask", type: "collect_input", title: "Ask", body: "Nome?", variableKey: "name", nextKey: "end" },
        { key: "end", type: "end", title: "End" },
      ],
      flowValidationIssues: [],
      channel: "whatsapp",
      channelId: owner.channelId,
      createdBy: owner.memberId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
  return await ingest(t, owner.channelId, body, wamid);
}

async function ingest(t: TestConvex, channelId: Id<"channels">, body: string, wamid: string) {
  const payload = {
    contacts: [{ profile: { name: "Paciente" }, wa_id: PATIENT }],
    messages: [{ from: PATIENT, id: wamid, timestamp: "1787300000", type: "text", text: { body } }],
  };
  const sha = `sha-${wamid}`;
  const normalized = normalizeWebhook(payload, sha)[0];
  return await t.run(async (ctx) => {
    const channel = (await ctx.db.get(channelId))!;
    const now = Date.now();
    // Test helper: the generic `t` loses schema index typing, so scan.
    let thread =
      (await ctx.db.query("channelThreads").collect()).find(
        (row) => row.channelId === channelId && row.threadKey === normalized.threadKey,
      ) ?? null;
    if (!thread) {
      const identityId = await ctx.db.insert("channelIdentities", {
        tenantId: channel.tenantId,
        channelId,
        providerScopedId: normalized.actorProviderScopedId!,
        displayName: normalized.actorDisplayName,
        phone: normalized.actorPhone,
        createdAt: now,
        updatedAt: now,
      });
      const threadId = await ctx.db.insert("channelThreads", {
        tenantId: channel.tenantId,
        channelId,
        threadKey: normalized.threadKey!,
        identityId,
        lastEventAt: now,
        lastEventKind: normalized.eventKind,
        lastInboundAt: now,
        lastPreview: body,
        unreadCount: 1,
        leadStatus: "wants_booking",
        serviceWindowExpiresAt: now + 24 * 60 * 60_000,
        createdAt: now,
        updatedAt: now,
      });
      thread = ((await ctx.db.get(threadId)) as Doc<"channelThreads">);
    }
    const eventId = await ctx.db.insert("channelEvents", {
      tenantId: channel.tenantId,
      channelId,
      eventKey: normalized.eventKey,
      providerEventId: normalized.providerEventId,
      eventKind: normalized.eventKind,
      direction: normalized.direction,
      actorProviderScopedId: normalized.actorProviderScopedId,
      actorDisplayName: normalized.actorDisplayName,
      actorPhone: normalized.actorPhone,
      threadKey: normalized.threadKey,
      payload: normalized.payload,
      rawPayload: JSON.stringify(payload),
      rawBodySha256: sha,
      providerTimestamp: normalized.providerTimestamp,
      status: "processed",
      attempts: 1,
      receivedAt: now,
      processedAt: now,
    });
    return { threadId: thread._id, eventId };
  });
}

describe("human handoff", () => {
  it("opens a case from the inbox, stops the running bot and returns the thread to the AI on resolve", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "handoff-a");
    const { threadId, eventId } = await seedBotAndInbound(t, owner, "Quero marcar", "wamid.h1");
    const started = await t.mutation(internal.channelAutomation.dispatchInbound, { eventId, deferOutbound: true });
    expect(started).toMatchObject({ consumed: true, status: "active" });

    const asOwner = t.withIdentity({ subject: owner.userId });
    const caseId = await asOwner.mutation(api.clinic.createHumanCase, {
      threadId,
      reason: "Pergunta clínica",
      urgency: "high",
      question: "Paciente pergunta se pode tomar o medicamento antes da consulta.",
      openedFrom: "inbox",
    });
    // Idempotent per thread while the case is open.
    const again = await asOwner.mutation(api.clinic.createHumanCase, {
      threadId,
      reason: "Outro",
      urgency: "low",
      question: "Repetido",
    });
    expect(again).toBe(caseId);

    const afterOpen = await t.run(async (ctx) => ({
      thread: ((await ctx.db.get(threadId)) as Doc<"channelThreads">),
      runs: await ctx.db.query("channelAutomationRuns").collect(),
      humanCase: (await ctx.db.get(caseId))!,
    }));
    expect(afterOpen.thread).toMatchObject({
      automationMode: "human",
      inboxStatus: "awaiting_team",
      leadStatus: "awaiting_human",
      openHumanCaseId: caseId,
    });
    expect(afterOpen.runs[0]).toMatchObject({ status: "stopped", endReason: "human_case_created" });
    expect(afterOpen.humanCase.previousLeadStatus).toBe("wants_booking");
    expect(afterOpen.humanCase.slaDueAt - afterOpen.humanCase.createdAt).toBe(120 * 60_000);

    const ops = await asOwner.query(inboxApi.getThreadOps, { threadId });
    expect(ops.openCase).toMatchObject({ _id: caseId, urgency: "high", status: "open" });
    const rows = await asOwner.query(inboxApi.listThreads, {
      channelId: owner.channelId,
      filter: "awaiting_team",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(rows.page[0]).toMatchObject({ _id: threadId, openCaseUrgency: "high" });

    // Returning to the AI while the case is open is refused.
    await expect(
      asOwner.mutation(inboxApi.updateThread, { threadId, automationMode: "bot" }),
    ).rejects.toThrow(/HUMAN_CASE_OPEN/);

    await asOwner.mutation(api.clinic.assignHumanCase, { caseId, responsibleMemberId: owner.memberId });
    const resolved = await asOwner.mutation(api.clinic.resolveHumanCase, {
      caseId,
      decision: "Pode tomar; confirmámos com a médica.",
      returnToAi: true,
    });
    expect(resolved).toEqual({ resolved: true });

    const afterResolve = await t.run(async (ctx) => ({
      thread: ((await ctx.db.get(threadId)) as Doc<"channelThreads">),
      events: await ctx.db.query("threadSystemEvents").withIndex("by_thread", (q) => q.eq("threadId", threadId)).collect(),
    }));
    expect(afterResolve.thread).toMatchObject({
      automationMode: "idle",
      inboxStatus: "open",
      leadStatus: "wants_booking",
      responsibleMemberId: owner.memberId,
    });
    expect(afterResolve.thread.openHumanCaseId).toBeUndefined();
    const kinds = afterResolve.events.map((row) => row.kind);
    expect(kinds).toEqual(expect.arrayContaining([
      "automation.started",
      "handoff.case_opened",
      "handoff.case_assigned",
      "handoff.case_resolved",
      "handoff.returned_to_ai",
    ]));

    // The next inbound is eligible for automation again.
    const { eventId: nextEvent } = await ingest(t, owner.channelId, "Olá de novo", "wamid.h2");
    const next = await t.mutation(internal.channelAutomation.dispatchInbound, { eventId: nextEvent, deferOutbound: true });
    expect(next).toMatchObject({ consumed: true, status: "active" });
  });

  it("keeps the team in charge when resolved without returning to the AI, and enforces roles", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "handoff-b");
    const agent = await addMember(t, owner.tenantId, "agent");
    const marketing = await addMember(t, owner.tenantId, "marketing");
    const { threadId } = await ingest(t, owner.channelId, "Preciso de ajuda", "wamid.h3");

    await expect(
      t.withIdentity({ subject: marketing.userId }).mutation(api.clinic.createHumanCase, {
        threadId,
        reason: "x",
        urgency: "normal",
        question: "yyy",
      }),
    ).rejects.toThrow(/FORBIDDEN_CAPABILITY/);

    const asAgent = t.withIdentity({ subject: agent.userId });
    const caseId = await asAgent.mutation(api.clinic.createHumanCase, {
      threadId,
      reason: "Reclamação",
      urgency: "normal",
      question: "Paciente insatisfeito com a espera.",
      responsibleMemberId: agent.memberId,
      slaMinutes: 45,
    });
    const humanCase = (await t.run(async (ctx) => await ctx.db.get(caseId)))!;
    expect(humanCase.status).toBe("assigned");
    expect(humanCase.slaDueAt - humanCase.createdAt).toBe(45 * 60_000);

    await asAgent.mutation(api.clinic.resolveHumanCase, { caseId, decision: "Pedido de desculpa enviado.", returnToAi: false });
    const thread = ((await t.run(async (ctx) => await ctx.db.get(threadId))) as Doc<"channelThreads">);
    expect(thread).toMatchObject({ automationMode: "human", inboxStatus: "active" });
    expect(thread.openHumanCaseId).toBeUndefined();

    const idempotent = await asAgent.mutation(api.clinic.resolveHumanCase, { caseId, decision: "de novo" });
    expect(idempotent).toEqual({ resolved: false, idempotent: true });
  });

  it("backfills the open-case cache on threads", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "handoff-c");
    const { threadId } = await ingest(t, owner.channelId, "Olá", "wamid.h4");
    const caseId = await t.run(async (ctx) =>
      await ctx.db.insert("humanCases", {
        tenantId: owner.tenantId,
        threadId,
        reason: "Antigo",
        urgency: "normal",
        question: "Caso criado antes do cache existir.",
        status: "open",
        slaDueAt: Date.now() + 60_000,
        createdBy: owner.memberId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    const first = await t.mutation(internal.clinic._backfillOpenHumanCases, {});
    expect(first).toEqual({ patched: 1, isDone: true });
    const second = await t.mutation(internal.clinic._backfillOpenHumanCases, {});
    expect(second.patched).toBe(0);
    const thread = ((await t.run(async (ctx) => await ctx.db.get(threadId))) as Doc<"channelThreads">);
    expect(thread.openHumanCaseId).toBe(caseId);
  });
});
