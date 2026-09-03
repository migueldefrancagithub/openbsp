import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { normalizeWebhook } from "../integrations/iaSolutionHub/webhook";
import { extractErrorCode } from "../lib/channels/systemEvents";
import schema from "../schema";

const ALLOWLISTED_PHONE = "258840000099";
const STRANGER_PHONE = "258841234567";
const inboxApi = (api as any).inboxOperations;

async function seedTenant(
  t: ReturnType<typeof convexTest>,
  name: string,
  role: "owner" | "agent" | "marketing" = "owner",
) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: `${name} ${role}` });
    const tenantId = await ctx.db.insert("tenants", {
      name,
      vertical: "clinic",
      plan: "starter",
      settings: {
        defaultLocale: "pt-MZ",
        timezone: "Africa/Maputo",
        retentionDays: 730,
      },
      createdAt: Date.now(),
    });
    const memberId = await ctx.db.insert("members", {
      tenantId,
      userId,
      role,
      status: "active",
      createdAt: Date.now(),
    });
    await ctx.db.insert("sessions", {
      userId,
      activeTenantId: tenantId,
      updatedAt: Date.now(),
    });
    return { userId, tenantId, memberId };
  });
}

async function addMember(
  t: ReturnType<typeof convexTest>,
  tenantId: Id<"tenants">,
  role: "admin" | "agent" | "marketing",
) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: `${role} user` });
    const memberId = await ctx.db.insert("members", {
      tenantId,
      userId,
      role,
      status: "active",
      createdAt: Date.now(),
    });
    await ctx.db.insert("sessions", {
      userId,
      activeTenantId: tenantId,
      updatedAt: Date.now(),
    });
    return { userId, memberId };
  });
}

async function seedChannel(
  t: ReturnType<typeof convexTest>,
  owner: { tenantId: Id<"tenants">; memberId: Id<"members"> },
  suffix: string,
) {
  return await t.run(async (ctx) =>
    await ctx.db.insert("channels", {
      tenantId: owner.tenantId,
      publicId: `hub_${suffix.padEnd(24, "x")}`,
      kind: "whatsapp",
      provider: "iasolution_hub",
      operationalTerritory: "openbsp",
      externalAccountId: `channel-${suffix}`,
      displayName: `Channel ${suffix}`,
      status: "active",
      sendMode: "allowlist",
      outboundAllowlist: [ALLOWLISTED_PHONE],
      connectionState: "allowlist_only",
      webhookStatus: "verified",
      createdBy: owner.memberId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
}

async function seedInboundBot(
  t: ReturnType<typeof convexTest>,
  owner: { tenantId: Id<"tenants">; memberId: Id<"members"> },
  channelId: Id<"channels">,
) {
  return await t.run(async (ctx) =>
    await ctx.db.insert("chatbots", {
      tenantId: owner.tenantId,
      name: "Recepção",
      status: "active",
      triggerKind: "inbound",
      entryNodeKey: "start",
      flowNodes: [
        { key: "start", type: "start", title: "Start", nextKey: "hello" },
        { key: "hello", type: "send_message", title: "Hello", body: "Olá!", nextKey: "end" },
        { key: "end", type: "end", title: "End" },
      ],
      flowValidationIssues: [],
      channel: "whatsapp",
      channelId,
      createdBy: owner.memberId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
}

function textPayload(phone: string, wamid: string, body: string) {
  return {
    contacts: [{ profile: { name: "Paciente Teste" }, wa_id: phone }],
    messages: [
      { from: phone, id: wamid, timestamp: "1787300000", type: "text", text: { body } },
    ],
  };
}

async function ingest(
  t: ReturnType<typeof convexTest>,
  channelId: Id<"channels">,
  payload: unknown,
  sha: string,
) {
  const normalized = normalizeWebhook(payload, sha)[0];
  return await t.run(async (ctx) => {
    const channel = await ctx.db.get(channelId);
    if (!channel || !normalized.threadKey) throw new Error("Invalid test event");
    const now = Date.now();
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
      threadKey: normalized.threadKey,
      identityId,
      lastEventAt: now,
      lastEventKind: normalized.eventKind,
      lastInboundAt: now,
      lastPreview: "test",
      unreadCount: 1,
      serviceWindowExpiresAt: now + 24 * 60 * 60 * 1_000,
      createdAt: now,
      updatedAt: now,
    });
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
    return { threadId, eventId };
  });
}

const NOT_ALLOWLISTED_REASON =
  'Uncaught ConvexError: {"code":"RECIPIENT_NOT_ALLOWLISTED"}\n    at handler (../convex/iaSolutionHub.ts:1443:13)';

describe("extractErrorCode", () => {
  it("prefers the ConvexError payload and falls back to bare codes", () => {
    expect(extractErrorCode(NOT_ALLOWLISTED_REASON)).toBe("RECIPIENT_NOT_ALLOWLISTED");
    expect(extractErrorCode("SERVICE_WINDOW_EXPIRED")).toBe("SERVICE_WINDOW_EXPIRED");
    expect(
      extractErrorCode(
        "error sending request for url (https://hub.example/api): client error (Connect): tunnel error",
      ),
    ).toBeUndefined();
    expect(extractErrorCode(undefined)).toBeUndefined();
  });
});

describe("thread system events", () => {
  it("explains a blocked automatic reply on the thread without touching channelEvents", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "Clínica Norte");
    const channelId = await seedChannel(t, owner, "norte");
    const botId = await seedInboundBot(t, owner, channelId);
    const { threadId, eventId } = await ingest(
      t,
      channelId,
      textPayload(STRANGER_PHONE, "wamid.stranger.1", "Olá, quero marcar"),
      "sha-stranger-1",
    );

    const dispatched = await t.mutation(internal.channelAutomation.dispatchInbound, {
      eventId,
      deferOutbound: true,
    });
    expect(dispatched).toMatchObject({ consumed: true, status: "active" });

    const [dispatch] = await t.run(async (ctx) =>
      await ctx.db.query("channelAutomationDispatches").collect(),
    );
    expect(dispatch.status).toBe("queued");

    await t.mutation(internal.channelAutomation.settleDispatch, {
      dispatchId: dispatch._id,
      status: "failed",
      failureReason: NOT_ALLOWLISTED_REASON,
    });
    // Replaying the settle is a no-op (the dispatch is no longer queued).
    await t.mutation(internal.channelAutomation.settleDispatch, {
      dispatchId: dispatch._id,
      status: "failed",
      failureReason: NOT_ALLOWLISTED_REASON,
    });

    const state = await t.run(async (ctx) => ({
      thread: await ctx.db.get(threadId),
      systemEvents: await ctx.db
        .query("threadSystemEvents")
        .withIndex("by_thread", (q) => q.eq("threadId", threadId))
        .collect(),
      channelEvents: await ctx.db.query("channelEvents").collect(),
      runs: await ctx.db.query("channelAutomationRuns").collect(),
    }));
    expect(state.channelEvents).toHaveLength(1);
    expect(state.runs[0]).toMatchObject({ status: "failed", endReason: "outbound_failed" });
    expect(state.thread?.automationMode).toBe("human");
    expect(state.thread?.pilotBlockedAt).toBeTypeOf("number");

    const kinds = state.systemEvents.map((row) => row.kind).sort();
    expect(kinds).toEqual([
      "automation.failed",
      "automation.started",
      "pilot.recipient_not_allowlisted",
    ]);
    const failed = state.systemEvents.find((row) => row.kind === "automation.failed")!;
    expect(failed).toMatchObject({
      severity: "error",
      code: "RECIPIENT_NOT_ALLOWLISTED",
      actorType: "automation",
      chatbotId: botId,
    });
    expect(JSON.stringify(failed.payload)).not.toContain(STRANGER_PHONE);

    const asOwner = t.withIdentity({ subject: owner.userId });
    const extras = await asOwner.query(inboxApi.listThreadTimelineExtras, { threadId });
    expect(extras.systemEvents).toHaveLength(3);
    expect(extras.systemEvents.find((row: any) => row.kind === "automation.started")).toMatchObject({
      botName: "Recepção",
    });
    expect(extras.failedOutbox).toEqual([]);

    const page = await asOwner.query(inboxApi.listThreads, {
      channelId,
      filter: "all",
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(page.page[0]).toMatchObject({ _id: threadId, pilotBlocked: true });

    const summary = await asOwner.query(api.channels.getThread, {
      channelId,
      threadKey: STRANGER_PHONE,
    });
    expect(summary).toMatchObject({ recipientAllowlisted: false });
    expect(summary?.pilotBlockedAt).toBeTypeOf("number");
  });

  it("lists rejected human sends from the outbox as timeline extras", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "Clínica Sul");
    const channelId = await seedChannel(t, owner, "sul");
    const { threadId } = await ingest(
      t,
      channelId,
      textPayload(ALLOWLISTED_PHONE, "wamid.allowed.1", "Bom dia"),
      "sha-allowed-1",
    );
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("channelOutbox", {
        tenantId: owner.tenantId,
        channelId,
        businessKey: "hub:text:test-failed",
        recipient: ALLOWLISTED_PHONE,
        threadKey: ALLOWLISTED_PHONE,
        messageKind: "text",
        payload: { text: "Olá, confirmamos a consulta." },
        status: "failed",
        failureReason:
          "error sending request for url (https://hub.example/api/v1/messages/text): client error (Connect): tunnel error",
        dispatchAttempts: 1,
        createdBy: owner.memberId,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("channelOutbox", {
        tenantId: owner.tenantId,
        channelId,
        businessKey: "hub:text:test-accepted",
        recipient: ALLOWLISTED_PHONE,
        threadKey: ALLOWLISTED_PHONE,
        messageKind: "text",
        payload: { text: "Enviada com sucesso." },
        status: "accepted",
        providerMessageId: "wamid.out.1",
        dispatchAttempts: 1,
        createdBy: owner.memberId,
        createdAt: now,
        updatedAt: now,
      });
    });
    const extras = await t
      .withIdentity({ subject: owner.userId })
      .query(inboxApi.listThreadTimelineExtras, { threadId });
    expect(extras.failedOutbox).toHaveLength(1);
    expect(extras.failedOutbox[0]).toMatchObject({
      status: "failed",
      preview: "Olá, confirmamos a consulta.",
    });
  });

  it("lets agents request pilot inclusion once per day and keeps marketing and other tenants out", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "Clínica Centro");
    const channelId = await seedChannel(t, owner, "centro");
    const agent = await addMember(t, owner.tenantId, "agent");
    const marketing = await addMember(t, owner.tenantId, "marketing");
    const { threadId } = await ingest(
      t,
      channelId,
      textPayload(STRANGER_PHONE, "wamid.stranger.2", "Preço?"),
      "sha-stranger-2",
    );

    const asAgent = t.withIdentity({ subject: agent.userId });
    const first = await asAgent.mutation(inboxApi.requestAllowlistInclusion, { threadId });
    expect(first.requested).toBe(true);
    expect(first.reminderId).toBeDefined();
    const second = await asAgent.mutation(inboxApi.requestAllowlistInclusion, { threadId });
    expect(second.requested).toBe(false);

    const rows = await t.run(async (ctx) => ({
      reminders: await ctx.db.query("threadReminders").collect(),
      systemEvents: await ctx.db
        .query("threadSystemEvents")
        .withIndex("by_thread", (q) => q.eq("threadId", threadId))
        .collect(),
    }));
    expect(rows.reminders).toHaveLength(1);
    expect(rows.reminders[0]).toMatchObject({ assignedMemberId: owner.memberId, status: "scheduled" });
    expect(rows.systemEvents).toHaveLength(1);
    expect(rows.systemEvents[0]).toMatchObject({
      kind: "pilot.allowlist_requested",
      actorMemberId: agent.memberId,
    });
    expect(JSON.stringify(rows.systemEvents[0].payload)).not.toContain(STRANGER_PHONE);

    await expect(
      t
        .withIdentity({ subject: marketing.userId })
        .mutation(inboxApi.requestAllowlistInclusion, { threadId }),
    ).rejects.toThrow(/FORBIDDEN_CAPABILITY/);

    const stranger = await seedTenant(t, "Outra Clínica");
    await expect(
      t
        .withIdentity({ subject: stranger.userId })
        .query(inboxApi.listThreadTimelineExtras, { threadId }),
    ).rejects.toThrow(/CROSS_TENANT_ACCESS/);
  });
});
