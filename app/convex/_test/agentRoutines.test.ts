import { convexTest } from "convex-test";
import { afterAll, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

const BASE_NOW = 1_800_000_000_000;
const previousEncryptionKey = process.env.WABA_TOKEN_ENCRYPTION_KEY_V1;
process.env.WABA_TOKEN_ENCRYPTION_KEY_V1 = "a".repeat(64);

afterAll(() => {
  vi.unstubAllGlobals();
  if (previousEncryptionKey === undefined) delete process.env.WABA_TOKEN_ENCRYPTION_KEY_V1;
  else process.env.WABA_TOKEN_ENCRYPTION_KEY_V1 = previousEncryptionKey;
});

async function seed(t: ReturnType<typeof convexTest>) {
  const ids = await t.run(async (ctx) => {
    const tenantId = await ctx.db.insert("tenants", {
      name: "Negócio Demo",
      vertical: "clinic",
      plan: "growth",
      settings: {
        defaultLocale: "pt-MZ",
        timezone: "Africa/Maputo",
        retentionDays: 730,
      },
      createdAt: BASE_NOW,
    });
    const ownerUserId = await ctx.db.insert("users", { name: "Owner" });
    const ownerMemberId = await ctx.db.insert("members", {
      tenantId,
      userId: ownerUserId,
      role: "owner",
      status: "active",
      createdAt: BASE_NOW,
    });
    await ctx.db.insert("sessions", {
      userId: ownerUserId,
      activeTenantId: tenantId,
      updatedAt: BASE_NOW,
    });
    const agentUserId = await ctx.db.insert("users", { name: "Edna" });
    const agentMemberId = await ctx.db.insert("members", {
      tenantId,
      userId: agentUserId,
      role: "agent",
      status: "active",
      createdAt: BASE_NOW,
    });
    await ctx.db.insert("sessions", {
      userId: agentUserId,
      activeTenantId: tenantId,
      updatedAt: BASE_NOW,
    });
    await ctx.db.insert("memberOperationalProfiles", {
      tenantId,
      memberId: agentMemberId,
      phoneE164: "+258840000099",
      responsibilities: ["sales_calls", "follow_up_calls"],
      receivesWhatsappBriefings: true,
      priority: 1,
      active: true,
      updatedBy: ownerMemberId,
      createdAt: BASE_NOW,
      updatedAt: BASE_NOW,
    });
    const channelId = await ctx.db.insert("channels", {
      tenantId,
      publicId: "agentic-business-test-channel",
      kind: "whatsapp",
      provider: "iasolution_hub",
      operationalTerritory: "openbsp",
      externalAccountId: "agentic-business-test",
      displayName: "WhatsApp Demo",
      status: "active",
      sendMode: "disabled",
      outboundAllowlist: [],
      createdBy: ownerMemberId,
      createdAt: BASE_NOW,
      updatedAt: BASE_NOW,
    });
    const identityId = await ctx.db.insert("channelIdentities", {
      tenantId,
      channelId,
      providerScopedId: "258840000001",
      displayName: "Lead Quente",
      phone: "+258840000001",
      createdAt: BASE_NOW,
      updatedAt: BASE_NOW,
    });
    const sourceLastEventAt = BASE_NOW - 8 * 60 * 60_000;
    const threadId = await ctx.db.insert("channelThreads", {
      tenantId,
      channelId,
      threadKey: "258840000001",
      identityId,
      lastEventAt: sourceLastEventAt,
      lastEventKind: "message.text",
      lastInboundAt: sourceLastEventAt,
      lastPreview: "Gostei da proposta, mas preciso esclarecer uma dúvida.",
      unreadCount: 0,
      leadStatus: "asked_price",
      intent: "price_request",
      intentSource: "inferred",
      intentUpdatedAt: sourceLastEventAt,
      inboxStatus: "open",
      automationMode: "bot",
      createdAt: sourceLastEventAt,
      updatedAt: sourceLastEventAt,
    });
    return {
      tenantId,
      ownerUserId,
      ownerMemberId,
      agentUserId,
      agentMemberId,
      channelId,
      threadId,
      sourceLastEventAt,
    };
  });
  return {
    ...ids,
    asOwner: t.withIdentity({ subject: ids.ownerUserId }),
    asAgent: t.withIdentity({ subject: ids.agentUserId }),
  };
}

async function createRoutine(
  s: Awaited<ReturnType<typeof seed>>,
  decisionMode: "suggest" | "approval" | "automatic" = "approval",
) {
  return await s.asOwner.mutation(api.agentRoutines.create, {
    name: "Ligar para oportunidades quentes",
    objective: "hot_lead_call",
    triggerMode: "both",
    decisionMode,
    staleAfterHours: 2,
    intervalMinutes: 60,
    maxItemsPerRun: 10,
    maxAttemptsPerContact: 3,
    workingHoursOnly: false,
  });
}

async function runRoutine(
  t: ReturnType<typeof convexTest>,
  routineId: Id<"agentRoutines">,
  now = BASE_NOW,
) {
  return await t.mutation(internal.agentRoutines.runOne, { routineId, now });
}

describe("agent routines", () => {
  it("turns one inbound event into one event-driven decision", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    await createRoutine(s);
    const eventId = await t.run(async (ctx) =>
      await ctx.db.insert("channelEvents", {
        tenantId: s.tenantId,
        channelId: s.channelId,
        eventKey: "inbound:hot-lead:1",
        providerEventId: "wamid.hot-lead.1",
        eventKind: "message.text",
        direction: "incoming",
        actorProviderScopedId: "258840000001",
        actorDisplayName: "Lead Quente",
        actorPhone: "+258840000001",
        threadKey: "258840000001",
        payload: { text: { body: "Quero avançar. Podem ligar-me?" } },
        rawPayload: "{}",
        rawBodySha256: "b".repeat(64),
        status: "processed",
        attempts: 1,
        receivedAt: BASE_NOW,
        processedAt: BASE_NOW,
      }),
    );

    expect(await t.mutation(internal.agentRoutines.onInbound, {
      eventId,
      threadId: s.threadId,
    })).toEqual({ proposed: 1, executed: 0 });
    expect(await t.mutation(internal.agentRoutines.onInbound, {
      eventId,
      threadId: s.threadId,
    })).toEqual({ proposed: 0, executed: 0 });

    const state = await t.run(async (ctx) => {
      const decisions = await ctx.db.query("agentDecisions").collect();
      const runs = await ctx.db.query("agentRoutineRuns").collect();
      return { decisions, runs };
    });
    expect(state.decisions).toHaveLength(1);
    expect(state.runs).toHaveLength(1);
    expect(state.decisions[0]).toMatchObject({ assignedMemberId: s.agentMemberId, runId: state.runs[0]._id });
    expect(state.runs[0].businessKey).toContain(String(eventId));
  });

  it("finds a hot opportunity, assigns the right caller and never duplicates the same decision", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    const routineId = await createRoutine(s);

    expect(await runRoutine(t, routineId)).toEqual({ scanned: 1, proposed: 1, executed: 0 });
    expect(await runRoutine(t, routineId)).toEqual({ scanned: 1, proposed: 1, executed: 0 });

    const decisions = await s.asOwner.query(api.agentRoutines.listDecisions, { status: "pending" });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      assignedMemberId: s.agentMemberId,
      assignedMemberName: "Edna",
      kind: "call_required",
      status: "pending",
    });
    expect(decisions[0].evidence.join(" ")).toContain("asked_price");
  });

  it("approves once, creates the human work and does not write to the customer outbox", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    const routineId = await createRoutine(s);
    await runRoutine(t, routineId);
    const [decision] = await s.asOwner.query(api.agentRoutines.listDecisions, { status: "pending" });

    expect(await s.asOwner.mutation(api.agentRoutines.decide, {
      decisionId: decision._id,
      decision: "approve",
    })).toEqual({ status: "completed" });

    const state = await t.run(async (ctx) => ({
      thread: await ctx.db.get(s.threadId),
      reminders: await ctx.db.query("threadReminders").collect(),
      cases: await ctx.db.query("humanCases").collect(),
      outbox: await ctx.db.query("channelOutbox").collect(),
      deliveries: await ctx.db.query("staffNotificationDeliveries").collect(),
    }));
    expect(state.thread).toMatchObject({ responsibleMemberId: s.agentMemberId, automationMode: "human" });
    expect(state.reminders).toHaveLength(1);
    expect(state.cases).toHaveLength(1);
    expect(state.outbox).toHaveLength(0);
    expect(state.deliveries).toHaveLength(0);
  });

  it("cancels stale advice when the customer replies before approval", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    const routineId = await createRoutine(s);
    await runRoutine(t, routineId);
    const [decision] = await s.asOwner.query(api.agentRoutines.listDecisions, { status: "pending" });
    await t.run(async (ctx) => {
      await ctx.db.patch(s.threadId, {
        lastInboundAt: s.sourceLastEventAt + 1,
        lastEventAt: s.sourceLastEventAt + 1,
        updatedAt: BASE_NOW,
      });
    });

    expect(await s.asOwner.mutation(api.agentRoutines.decide, {
      decisionId: decision._id,
      decision: "approve",
    })).toEqual({ status: "cancelled" });

    const state = await t.run(async (ctx) => ({
      reminders: await ctx.db.query("threadReminders").collect(),
      cases: await ctx.db.query("humanCases").collect(),
    }));
    expect(state.reminders).toHaveLength(0);
    expect(state.cases).toHaveLength(0);
  });

  it("lets an agent approve once but reserves recurring authorization for managers", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    const routineId = await createRoutine(s);
    await runRoutine(t, routineId);
    const [decision] = await s.asAgent.query(api.agentRoutines.listDecisions, { status: "pending" });

    await expect(s.asAgent.mutation(api.agentRoutines.decide, {
      decisionId: decision._id,
      decision: "authorize_routine",
    })).rejects.toThrow(/FORBIDDEN_CAPABILITY/);

    expect(await s.asAgent.mutation(api.agentRoutines.decide, {
      decisionId: decision._id,
      decision: "approve",
    })).toEqual({ status: "completed" });
  });

  it("delivers the approved briefing through UAZAPI without touching customer messages", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    await s.asOwner.mutation(api.staffNotifications.saveConnection, {
      baseUrl: "https://staff-briefing.example.com",
      token: "uaz-test-token",
      active: true,
    });
    const routineId = await createRoutine(s);
    await runRoutine(t, routineId);
    const [decision] = await s.asOwner.query(api.agentRoutines.listDecisions, { status: "pending" });
    await s.asOwner.mutation(api.agentRoutines.decide, {
      decisionId: decision._id,
      decision: "approve",
    });

    const [delivery] = await t.run(async (ctx) => await ctx.db.query("staffNotificationDeliveries").collect());
    expect(delivery).toMatchObject({ memberId: s.agentMemberId, status: "pending", attempts: 0 });

    let request: { url: string; headers: Headers; body: Record<string, unknown> } | undefined;
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      request = {
        url: input.toString(),
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      };
      return Response.json({ messageId: "staff-message-1" });
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(delivery._id, {
        status: "claimed",
        attempts: 1,
        updatedAt: BASE_NOW,
      });
    });
    await t.action(internal.staffNotifications.deliverOne, { deliveryId: delivery._id });

    expect(request?.url).toBe("https://staff-briefing.example.com/send/text");
    expect(request?.headers.get("token")).toBe("uaz-test-token");
    expect(request?.body).toMatchObject({
      number: "258840000099",
      linkPreview: false,
      readchat: false,
    });
    expect(String(request?.body.text)).toContain("chamada recomendada");
    const finalState = await t.run(async (ctx) => ({
      delivery: await ctx.db.get(delivery._id),
      outbox: await ctx.db.query("channelOutbox").collect(),
    }));
    expect(finalState.delivery).toMatchObject({ status: "delivered", providerMessageId: "staff-message-1" });
    expect(finalState.outbox).toHaveLength(0);
  });

  it("refuses a staff delivery whose connection belongs to another business", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    await s.asOwner.mutation(api.staffNotifications.saveConnection, {
      baseUrl: "https://staff-briefing.example.com",
      token: "uaz-test-token",
      active: true,
    });
    const routineId = await createRoutine(s);
    await runRoutine(t, routineId);
    const [decision] = await s.asOwner.query(api.agentRoutines.listDecisions, {
      status: "pending",
    });
    await s.asOwner.mutation(api.agentRoutines.decide, {
      decisionId: decision._id,
      decision: "approve",
    });

    const deliveryId = await t.run(async (ctx) => {
      const delivery = await ctx.db
        .query("staffNotificationDeliveries")
        .withIndex("by_decision", (q) => q.eq("decisionId", decision._id))
        .first();
      if (!delivery) throw new Error("expected staff delivery");
      const foreignTenantId = await ctx.db.insert("tenants", {
        name: "Outro negócio",
        vertical: "other",
        plan: "starter",
        settings: {
          defaultLocale: "pt-MZ",
          timezone: "Africa/Maputo",
          retentionDays: 730,
        },
        createdAt: BASE_NOW,
      });
      await ctx.db.patch(delivery.connectionId, { tenantId: foreignTenantId });
      await ctx.db.patch(delivery._id, {
        status: "claimed",
        attempts: 1,
        updatedAt: BASE_NOW,
      });
      return delivery._id;
    });

    expect(
      await t.query(internal.staffNotifications._loadDelivery, { deliveryId }),
    ).toBeNull();
  });
});
