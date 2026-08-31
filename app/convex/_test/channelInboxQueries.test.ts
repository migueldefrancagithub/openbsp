import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { normalizeWebhook } from "../integrations/leoHub/webhook";

const ALLOWED = "258840000099";
const STRANGER = "258999111222";

async function seedTenant(t: ReturnType<typeof convexTest>, name: string) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: `${name} Owner` });
    const tenantId = await ctx.db.insert("tenants", {
      name,
      vertical: "services",
      plan: "starter",
      settings: {
        defaultLocale: "pt-PT",
        timezone: "Africa/Maputo",
        retentionDays: 730,
      },
      rgpd: {
        controllerName: name,
        controllerEmail: `${name.toLowerCase().replace(/\s/g, "-")}@example.test`,
        dpaSignedAt: Date.now(),
        dpiaCompletedAt: Date.now(),
      },
      createdAt: Date.now(),
    });
    const memberId = await ctx.db.insert("members", {
      tenantId,
      userId,
      role: "owner",
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

async function seedChannel(
  t: ReturnType<typeof convexTest>,
  args: {
    tenantId: Id<"tenants">;
    memberId: Id<"members">;
    publicId?: string;
    externalChannelId?: string;
  },
) {
  return await t.mutation(internal.leoHubLab._upsertConnection, {
    tenantId: args.tenantId,
    memberId: args.memberId,
    publicId: args.publicId ?? "lab_abcdefghijklmnopqrstuvwx",
    externalChannelId: args.externalChannelId ?? "hub-channel-lab-1",
    displayName: "OpenBSP Lab",
    outboundAllowlist: [ALLOWED],
    accessTokenCiphertext: "ciphertext-token",
    accessTokenKeyVersion: 1,
    webhookSecretCiphertext: "ciphertext-webhook",
    webhookSecretKeyVersion: 1,
    encryptedAt: Date.now(),
    healthStatus: "GREEN",
  });
}

async function inbound(
  t: ReturnType<typeof convexTest>,
  channelId: Id<"channels">,
  from: string,
  body: string,
  seq: number,
) {
  const raw = JSON.stringify({
    contacts: [{ wa_id: from, profile: { name: "Dani" } }],
    messages: [
      {
        id: `wamid.${from}.${seq}`,
        from,
        type: "text",
        timestamp: String(1_755_500_000 + seq),
        text: { body },
      },
    ],
  });
  await t.mutation(internal.leoHubLab.ingestWebhookEvents, {
    channelId,
    rawPayload: raw,
    rawBodySha256: `sha-${from}-${seq}`,
    events: normalizeWebhook(JSON.parse(raw), `sha-${from}-${seq}`),
  });
}

async function insertLegacyThreadProjection(
  t: ReturnType<typeof convexTest>,
  args: {
    tenantId: Id<"tenants">;
    channelId: Id<"channels">;
    threadKey: string;
    hasMessageEvent: boolean;
    lastEventAt?: number;
  },
) {
  await t.run(async (ctx) => {
    const now = args.lastEventAt ?? Date.now();
    if (args.hasMessageEvent) {
      await ctx.db.insert("channelEvents", {
        tenantId: args.tenantId,
        channelId: args.channelId,
        eventKey: `message:legacy:${args.threadKey}`,
        providerEventId: `wamid.LEGACY.${args.threadKey}`,
        eventKind: "message.text",
        direction: "incoming",
        actorProviderScopedId: args.threadKey,
        threadKey: args.threadKey,
        payload: { normalizedText: "Mensagem antiga" },
        rawPayload: '{"messages":[{"id":"legacy"}]}',
        rawBodySha256: `sha-legacy-message-${args.threadKey}`,
        providerTimestamp: now - 1_000,
        status: "processed",
        attempts: 1,
        receivedAt: now - 1_000,
        processedAt: now - 1_000,
      });
    }
    await ctx.db.insert("channelEvents", {
      tenantId: args.tenantId,
      channelId: args.channelId,
      eventKey: `status:legacy:${args.threadKey}:delivered`,
      providerEventId: `wamid.STATUS.${args.threadKey}`,
      eventKind: "status.delivered",
      direction: "outgoing",
      actorProviderScopedId: args.threadKey,
      threadKey: args.threadKey,
      payload: { status: { id: `wamid.STATUS.${args.threadKey}` } },
      rawPayload: '{"statuses":[{"status":"delivered"}]}',
      rawBodySha256: `sha-legacy-status-${args.threadKey}`,
      providerTimestamp: now,
      status: "processed",
      attempts: 1,
      receivedAt: now,
      processedAt: now,
    });
    await ctx.db.insert("channelThreads", {
      tenantId: args.tenantId,
      channelId: args.channelId,
      threadKey: args.threadKey,
      lastEventAt: now,
      lastEventKind: "status.delivered",
      lastOutboundAt: now,
      unreadCount: 0,
      createdAt: now,
      updatedAt: now,
    });
  });
}

describe("channel inbox queries", () => {
  it("zeroes only the opened thread's unread count (AC-4)", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "OpenBSP Lab");
    const { channelId } = await seedChannel(t, owner);
    await inbound(t, channelId, ALLOWED, "Ola", 1);
    await inbound(t, channelId, ALLOWED, "Segunda", 2);
    await inbound(t, channelId, STRANGER, "Outra thread", 3);

    const as = t.withIdentity({ subject: owner.userId });
    const before = await as.query(api.channels.listThreads, { channelId });
    const target = before.find((x) => x.threadKey === ALLOWED)!;
    const other = before.find((x) => x.threadKey === STRANGER)!;
    expect(target.unreadCount).toBe(2);
    expect(other.unreadCount).toBe(1);

    await as.mutation(api.channels.markThreadRead, { threadId: target._id });

    const after = await as.query(api.channels.listThreads, { channelId });
    expect(after.find((x) => x.threadKey === ALLOWED)!.unreadCount).toBe(0);
    expect(after.find((x) => x.threadKey === STRANGER)!.unreadCount).toBe(1);
  });

  it("reports the allowlist verdict without exposing the list or secrets", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "OpenBSP Lab");
    const { channelId } = await seedChannel(t, owner);
    await inbound(t, channelId, ALLOWED, "Ola", 1);
    await inbound(t, channelId, STRANGER, "Nao permitido", 2);

    const as = t.withIdentity({ subject: owner.userId });
    const allowed = await as.query(api.channels.getThread, {
      channelId,
      threadKey: ALLOWED,
    });
    const stranger = await as.query(api.channels.getThread, {
      channelId,
      threadKey: STRANGER,
    });

    expect(allowed?.recipientAllowlisted).toBe(true);
    expect(stranger?.recipientAllowlisted).toBe(false);
    expect(allowed?.channelSendMode).toBe("disabled");

    const serialized = JSON.stringify({ allowed, stranger });
    expect(serialized).not.toContain("outboundAllowlist");
    expect(serialized).not.toContain("ciphertext-token");
    expect(serialized).not.toContain("ciphertext-webhook");
  });

  it("surfaces safe CRM context for the channel inbox", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "OpenBSP Lab");
    const { channelId } = await seedChannel(t, owner);
    await inbound(t, channelId, ALLOWED, "micro demo", 1);

    await t.run(async (ctx) => {
      const thread = await ctx.db
        .query("channelThreads")
        .withIndex("by_channel_thread", (q) =>
          q.eq("channelId", channelId).eq("threadKey", ALLOWED),
        )
        .unique();
      expect(thread).not.toBeNull();
      await ctx.db.patch(thread!._id, {
        tags: ["campaign_micro", "campaign_intent_demo"],
        automationMode: "human",
        automationChangeReason: "campaign_reply",
      });
    });

    const as = t.withIdentity({ subject: owner.userId });
    const [listRow] = await as.query(api.channels.listThreads, { channelId });
    expect(listRow).toMatchObject({
      threadKey: ALLOWED,
      tags: ["campaign_micro", "campaign_intent_demo"],
      automationMode: "human",
    });

    const detail = await as.query(api.channels.getThread, {
      channelId,
      threadKey: ALLOWED,
    });
    expect(detail).toMatchObject({
      channelDisplayName: "OpenBSP Lab",
      automationChangeReason: "campaign_reply",
      recipientAllowlisted: true,
    });

    const [event] = await as.query(api.channels.listThreadEvents, {
      channelId,
      threadKey: ALLOWED,
    });
    expect(event).toMatchObject({
      actorDisplayName: "Dani",
      actorPhone: ALLOWED,
      status: "processed",
    });
    expect(event.providerTimestamp).toBeDefined();
  });

  it("returns null for a thread that does not exist yet", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "OpenBSP Lab");
    const { channelId } = await seedChannel(t, owner);
    const thread = await t
      .withIdentity({ subject: owner.userId })
      .query(api.channels.getThread, { channelId, threadKey: "258000000000" });
    expect(thread).toBeNull();
  });

  it("hides a legacy status-only projection without deleting audit evidence", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "OpenBSP Lab");
    const { channelId } = await seedChannel(t, owner);
    await insertLegacyThreadProjection(t, {
      tenantId: owner.tenantId,
      channelId,
      threadKey: ALLOWED,
      hasMessageEvent: false,
    });

    const as = t.withIdentity({ subject: owner.userId });
    expect(await as.query(api.channels.listThreads, { channelId })).toEqual([]);
    expect(
      await as.query(api.channels.getThread, { channelId, threadKey: ALLOWED }),
    ).toBeNull();

    const stored = await t.run(async (ctx) => ({
      events: await ctx.db.query("channelEvents").collect(),
      threads: await ctx.db.query("channelThreads").collect(),
      outbox: await ctx.db.query("channelOutbox").collect(),
    }));
    expect(stored.events).toHaveLength(1);
    expect(stored.threads).toHaveLength(1);
    expect(stored.outbox).toHaveLength(0);
  });

  it("keeps a legacy thread visible when any message event exists", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "OpenBSP Lab");
    const { channelId } = await seedChannel(t, owner);
    await insertLegacyThreadProjection(t, {
      tenantId: owner.tenantId,
      channelId,
      threadKey: ALLOWED,
      hasMessageEvent: true,
    });

    const as = t.withIdentity({ subject: owner.userId });
    const threads = await as.query(api.channels.listThreads, { channelId });
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({
      threadKey: ALLOWED,
      lastEventKind: "status.delivered",
    });
    await expect(
      as.query(api.channels.getThread, { channelId, threadKey: ALLOWED }),
    ).resolves.toMatchObject({ threadKey: ALLOWED });
  });

  it("paginates past recent status-only projections to fill the requested limit", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "OpenBSP Lab");
    const { channelId } = await seedChannel(t, owner);
    const base = Date.now();
    await insertLegacyThreadProjection(t, {
      tenantId: owner.tenantId,
      channelId,
      threadKey: ALLOWED,
      hasMessageEvent: true,
      lastEventAt: base,
    });

    for (let i = 0; i < 101; i += 1) {
      await insertLegacyThreadProjection(t, {
        tenantId: owner.tenantId,
        channelId,
        threadKey: `${STRANGER}-${i}`,
        hasMessageEvent: false,
        lastEventAt: base + 1_000 + i,
      });
    }

    const threads = await t
      .withIdentity({ subject: owner.userId })
      .query(api.channels.listThreads, { channelId, limit: 1 });
    expect(threads).toHaveLength(1);
    expect(threads[0].threadKey).toBe(ALLOWED);
  });

  it("refuses cross-tenant access on both new functions (AC-5)", async () => {
    const t = convexTest(schema);
    const a = await seedTenant(t, "Clinica A");
    const b = await seedTenant(t, "Clinica B");
    const { channelId } = await seedChannel(t, a);
    await seedChannel(t, {
      ...b,
      publicId: "lab_bbbbbbbbbbbbbbbbbbbbbbbb",
      externalChannelId: "hub-channel-lab-2",
    });
    await inbound(t, channelId, ALLOWED, "Privado", 1);

    const asA = t.withIdentity({ subject: a.userId });
    const threads = await asA.query(api.channels.listThreads, { channelId });
    const threadId = threads[0]._id;

    const asB = t.withIdentity({ subject: b.userId });
    await expect(
      asB.query(api.channels.getThread, { channelId, threadKey: ALLOWED }),
    ).rejects.toThrow();
    await expect(
      asB.mutation(api.channels.markThreadRead, { threadId }),
    ).rejects.toThrow();

    const after = await asA.query(api.channels.listThreads, { channelId });
    expect(after[0].unreadCount).toBe(1);
  });
});
