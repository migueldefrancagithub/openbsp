import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { normalizeWebhook } from "../integrations/iaSolutionHub/webhook";
import { projectThreadFromEvent } from "../lib/channels/projection";
import schema from "../schema";

/**
 * Phase A end to end, in one story: a stranger writes in, the bot is blocked
 * by the pilot gate, the team sees why, asks for inclusion, opens a human
 * case, resolves it back to the AI, moves the lead through the kanban, fills
 * a custom field and records consent — every step audited and visible.
 */
const STRANGER = "258841234567";
const ALLOWLISTED = "258840000099";
const inboxApi = (api as any).inboxOperations;

async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const ownerUserId = await ctx.db.insert("users", { name: "Dra. Ana" });
    const agentUserId = await ctx.db.insert("users", { name: "João" });
    const tenantId = await ctx.db.insert("tenants", {
      name: "Clínica Piloto",
      vertical: "clinic",
      plan: "starter",
      healthcareMode: true,
      settings: { defaultLocale: "pt-MZ", timezone: "Africa/Maputo", retentionDays: 730 },
      createdAt: Date.now(),
    });
    const ownerMemberId = await ctx.db.insert("members", { tenantId, userId: ownerUserId, role: "owner", status: "active", createdAt: Date.now() });
    const agentMemberId = await ctx.db.insert("members", { tenantId, userId: agentUserId, role: "agent", status: "active", createdAt: Date.now() });
    await ctx.db.insert("sessions", { userId: ownerUserId, activeTenantId: tenantId, updatedAt: Date.now() });
    await ctx.db.insert("sessions", { userId: agentUserId, activeTenantId: tenantId, updatedAt: Date.now() });
    const channelId = await ctx.db.insert("channels", {
      tenantId,
      publicId: "hub_phaseAxxxxxxxxxxxxxxxxxx".slice(0, 28),
      kind: "whatsapp",
      provider: "iasolution_hub",
      operationalTerritory: "openbsp",
      externalAccountId: "channel-phase-a",
      displayName: "WhatsApp piloto",
      status: "active",
      sendMode: "allowlist",
      outboundAllowlist: [ALLOWLISTED],
      connectionState: "allowlist_only",
      webhookStatus: "verified",
      createdBy: ownerMemberId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.insert("chatbots", {
      tenantId,
      name: "Recepção",
      status: "active",
      triggerKind: "inbound",
      entryNodeKey: "start",
      flowNodes: [
        { key: "start", type: "start", title: "Start", nextKey: "hello" },
        { key: "hello", type: "send_message", title: "Hello", body: "Olá! Em que posso ajudar?", nextKey: "end" },
        { key: "end", type: "end", title: "End" },
      ],
      flowValidationIssues: [],
      channel: "whatsapp",
      channelId,
      createdBy: ownerMemberId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { tenantId, channelId, ownerUserId, ownerMemberId, agentUserId, agentMemberId };
  });
}

async function inbound(
  t: ReturnType<typeof convexTest>,
  channelId: Id<"channels">,
  phone: string,
  body: string,
  wamid: string,
) {
  const payload = {
    contacts: [{ profile: { name: "Paciente Novo" }, wa_id: phone }],
    messages: [{ from: phone, id: wamid, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body } }],
  };
  const sha = `sha-${wamid}`;
  const normalized = normalizeWebhook(payload, sha)[0];
  return await t.run(async (ctx) => {
    const channel = (await ctx.db.get(channelId)) as Doc<"channels">;
    const now = Date.now();
    let identity =
      (await ctx.db.query("channelIdentities").collect()).find(
        (row) => row.channelId === channelId && row.providerScopedId === normalized.actorProviderScopedId,
      ) ?? null;
    if (!identity) {
      const identityId = await ctx.db.insert("channelIdentities", {
        tenantId: channel.tenantId,
        channelId,
        providerScopedId: normalized.actorProviderScopedId!,
        displayName: normalized.actorDisplayName,
        phone: normalized.actorPhone,
        createdAt: now,
        updatedAt: now,
      });
      identity = await ctx.db.get(identityId);
    }
    // Real projection path (lead stage, intent, service window).
    await projectThreadFromEvent(ctx, { channel, event: normalized, identityId: identity?._id, now });
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
    const thread = (await ctx.db.query("channelThreads").collect()).find(
      (row) => row.channelId === channelId && row.threadKey === normalized.threadKey,
    )!;
    return { eventId, threadId: thread._id };
  });
}

describe("Phase A end to end", () => {
  it("takes a stranger from blocked bot reply to a handled, consented, staged lead", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    const asOwner = t.withIdentity({ subject: s.ownerUserId });
    const asAgent = t.withIdentity({ subject: s.agentUserId });

    // 1. Stranger writes in → real projection → bot starts.
    const { eventId, threadId } = await inbound(t, s.channelId, STRANGER, "Olá, quanto custa a consulta?", "wamid.e2e.1");
    const dispatched = await t.mutation(internal.channelAutomation.dispatchInbound, { eventId, deferOutbound: true });
    expect(dispatched).toMatchObject({ consumed: true, status: "active" });
    let thread = (await t.run(async (ctx) => await ctx.db.get(threadId))) as Doc<"channelThreads">;
    expect(thread).toMatchObject({ leadStatus: "asked_price", intent: "price_request", leadSource: "organic" });

    // 2. The pilot gate blocks the reply → visible on the thread, not silent.
    const [dispatch] = await t.run(async (ctx) => await ctx.db.query("channelAutomationDispatches").collect());
    await t.mutation(internal.channelAutomation.settleDispatch, {
      dispatchId: dispatch._id,
      status: "failed",
      failureReason: 'Uncaught ConvexError: {"code":"RECIPIENT_NOT_ALLOWLISTED"}',
    });
    const extras = await asAgent.query(inboxApi.listThreadTimelineExtras, { threadId });
    expect(extras.systemEvents.map((row: any) => row.kind)).toEqual(
      expect.arrayContaining(["automation.started", "automation.failed", "pilot.recipient_not_allowlisted"]),
    );
    const list = await asAgent.query(inboxApi.listThreads, {
      channelId: s.channelId,
      filter: "all",
      now: Date.now(),
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(list.page[0]).toMatchObject({ _id: threadId, pilotBlocked: true, intent: "price_request" });

    // 3. The agent asks for pilot inclusion → reminder for the owner.
    const request = await asAgent.mutation(inboxApi.requestAllowlistInclusion, { threadId });
    expect(request.requested).toBe(true);
    const reminders = await t.run(async (ctx) => await ctx.db.query("threadReminders").collect());
    expect(reminders[0].assignedMemberId).toBe(s.ownerMemberId);

    // 4. Meanwhile the agent hands the question to the team.
    const caseId = await asAgent.mutation(api.clinic.createHumanCase, {
      threadId,
      reason: "Pediu preço",
      urgency: "normal",
      question: "Podemos dizer o preço da consulta inicial por WhatsApp?",
      responsibleMemberId: s.ownerMemberId,
      openedFrom: "inbox",
    });
    const ops = await asAgent.query(inboxApi.getThreadOps, { threadId, now: Date.now() });
    expect(ops.openCase?._id).toBe(caseId);
    await expect(asAgent.mutation(inboxApi.updateThread, { threadId, automationMode: "bot" })).rejects.toThrow(/HUMAN_CASE_OPEN/);

    // 5. The owner decides and returns the conversation to the AI.
    await asOwner.mutation(api.clinic.resolveHumanCase, { caseId, decision: "Sim, tabela pública. Enviar valor e propor horário.", returnToAi: true });
    thread = (await t.run(async (ctx) => await ctx.db.get(threadId))) as Doc<"channelThreads">;
    expect(thread).toMatchObject({ automationMode: "idle", leadStatus: "asked_price" });
    expect(thread.openHumanCaseId).toBeUndefined();

    // 6. Kanban: the agent moves the lead forward; the owner sees it in the column.
    await asAgent.mutation(inboxApi.updateThread, { threadId, leadStatus: "wants_booking", nextStep: "Propor 3 horários", nextStepDueAt: Date.now() + 3_600_000 });
    const column = await asOwner.query(api.leads.listByStatus, { leadStatus: "wants_booking", channelId: s.channelId, now: Date.now(), paginationOpts: { cursor: null, numItems: 10 } });
    expect(column.page.map((row: any) => row._id)).toEqual([threadId]);
    const counts = await asOwner.query(api.leads.counts, { channelId: s.channelId });
    expect(counts.find((row) => row.status === "wants_booking")?.count).toBe(1);
    expect(counts.find((row) => row.status === "asked_price")?.count).toBe(0);

    // 7. Patient card: custom field + consent, both audited.
    await asOwner.mutation(api.customFields.saveDefinition, { label: "Seguro", type: "select", options: ["Nenhum", "Medis"] });
    await asAgent.mutation(inboxApi.updateThread, { threadId, customFields: { seguro: "Medis" } });
    await asAgent.mutation(inboxApi.recordConsent, { threadId, purpose: "transactional", status: "granted", proofText: "Pediu lembretes por WhatsApp" });
    const context = await asAgent.query(inboxApi.getPatientContext, { threadId });
    expect(context.consents).toEqual([expect.objectContaining({ purpose: "transactional", status: "granted" })]);
    const summary = await asAgent.query(api.channels.getThread, { channelId: s.channelId, threadKey: STRANGER });
    expect(summary?.customFields).toEqual({ seguro: "Medis" });

    // 8. Everything is in the history, nothing touched the provider evidence.
    const history = await asOwner.query(inboxApi.listThreadHistory, { threadId, limit: 50 });
    const actions = history.map((row: { action: string }) => row.action);
    expect(actions).toEqual(
      expect.arrayContaining(["inbox.thread.updated", "inbox.pilot.allowlist_requested", "inbox.consent.recorded"]),
    );
    const evidence = await t.run(async (ctx) => ({
      events: (await ctx.db.query("channelEvents").collect()).length,
      outbox: (await ctx.db.query("channelOutbox").collect()).length,
      conversations: (await ctx.db.query("conversations").collect()).length,
    }));
    expect(evidence).toEqual({ events: 1, outbox: 0, conversations: 0 });

    // 9. A second inbound from the same patient is automation-eligible again.
    const second = await inbound(t, s.channelId, STRANGER, "Qual o horário?", "wamid.e2e.2");
    const redispatch = await t.mutation(internal.channelAutomation.dispatchInbound, { eventId: second.eventId, deferOutbound: true });
    expect(redispatch).toMatchObject({ consumed: true, status: "active" });
  });
});
