import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { normalizeWebhook } from "../integrations/leoHub/webhook";

const RECIPIENT = "258840000099";
const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

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

async function seedLabConnection(
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
    outboundAllowlist: [RECIPIENT],
    accessTokenCiphertext: "ciphertext-token",
    accessTokenKeyVersion: 1,
    webhookSecretCiphertext: "ciphertext-webhook",
    webhookSecretKeyVersion: 1,
    encryptedAt: Date.now(),
    healthStatus: "GREEN",
  });
}

/** Claim then accept an outbox row, so it carries a provider message id. */
async function seedAcceptedOutbox(
  t: ReturnType<typeof convexTest>,
  args: {
    tenantId: Id<"tenants">;
    memberId: Id<"members">;
    userId: Id<"users">;
    channelId: Id<"channels">;
    providerMessageId: string;
    nonce?: string;
  },
) {
  await t
    .withIdentity({ subject: args.userId })
    .mutation(api.channels.setSendMode, {
      channelId: args.channelId,
      sendMode: "allowlist",
    });
  const claim = await t.mutation(internal.leoHubLab._claimOutbox, {
    tenantId: args.tenantId,
    memberId: args.memberId,
    channelId: args.channelId,
    businessKey: `lab:text:${args.nonce ?? "nonce-1"}`,
    recipient: RECIPIENT,
    messageKind: "text",
    payload: { body: "Ping do OpenBSP Lab" },
  });
  await t.mutation(internal.leoHubLab._settleOutbox, {
    outboxId: claim.outboxId,
    status: "accepted",
    providerMessageId: args.providerMessageId,
  });
  return claim.outboxId;
}

function statusEvent(args: {
  providerMessageId: string;
  status: string;
  timestamp?: number;
  errors?: unknown[];
}) {
  return {
    eventKey: `status:${args.providerMessageId}:${args.status}`,
    providerEventId: args.providerMessageId,
    eventKind: `status.${args.status}`,
    direction: "outgoing" as const,
    actorProviderScopedId: RECIPIENT,
    actorPhone: RECIPIENT,
    providerTimestamp: args.timestamp ?? Date.now(),
    payload: {
      status: {
        id: args.providerMessageId,
        status: args.status,
        recipient_id: RECIPIENT,
        ...(args.errors ? { errors: args.errors } : {}),
      },
    },
  };
}

async function ingest(
  t: ReturnType<typeof convexTest>,
  channelId: Id<"channels">,
  events: ReturnType<typeof statusEvent>[],
  rawBodySha256 = "sha-1",
) {
  return await t.mutation(internal.leoHubLab.ingestWebhookEvents, {
    channelId,
    rawPayload: JSON.stringify({ events }),
    rawBodySha256,
    events,
  });
}

async function readOutbox(
  t: ReturnType<typeof convexTest>,
  outboxId: Id<"channelOutbox">,
) {
  return await t.run(async (ctx) => await ctx.db.get(outboxId));
}

describe("neutral outbox reconciliation", () => {
  it("advances accepted to delivered to read (AC-1)", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "OpenBSP Lab");
    const { channelId } = await seedLabConnection(t, owner);
    const outboxId = await seedAcceptedOutbox(t, {
      ...owner,
      channelId,
      providerMessageId: "wamid.TEST1",
    });

    await ingest(t, channelId, [
      statusEvent({ providerMessageId: "wamid.TEST1", status: "delivered" }),
    ]);
    expect((await readOutbox(t, outboxId))?.status).toBe("delivered");

    await ingest(
      t,
      channelId,
      [statusEvent({ providerMessageId: "wamid.TEST1", status: "read" })],
      "sha-2",
    );
    const final = await readOutbox(t, outboxId);
    expect(final?.status).toBe("read");
    expect(final?.providerMessageId).toBe("wamid.TEST1");
  });

  it("leaves other rows untouched (AC-1)", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "OpenBSP Lab");
    const { channelId } = await seedLabConnection(t, owner);
    const target = await seedAcceptedOutbox(t, {
      ...owner,
      channelId,
      providerMessageId: "wamid.TARGET",
      nonce: "nonce-target",
    });
    const bystander = await seedAcceptedOutbox(t, {
      ...owner,
      channelId,
      providerMessageId: "wamid.BYSTANDER",
      nonce: "nonce-bystander",
    });

    await ingest(t, channelId, [
      statusEvent({ providerMessageId: "wamid.TARGET", status: "delivered" }),
    ]);

    expect((await readOutbox(t, target))?.status).toBe("delivered");
    expect((await readOutbox(t, bystander))?.status).toBe("accepted");
  });

  it("never regresses when a late status arrives (AC-2)", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "OpenBSP Lab");
    const { channelId } = await seedLabConnection(t, owner);
    const outboxId = await seedAcceptedOutbox(t, {
      ...owner,
      channelId,
      providerMessageId: "wamid.TEST2",
    });

    await ingest(t, channelId, [
      statusEvent({ providerMessageId: "wamid.TEST2", status: "read" }),
    ]);
    expect((await readOutbox(t, outboxId))?.status).toBe("read");

    await ingest(
      t,
      channelId,
      [statusEvent({ providerMessageId: "wamid.TEST2", status: "sent" })],
      "sha-2",
    );
    await ingest(
      t,
      channelId,
      [statusEvent({ providerMessageId: "wamid.TEST2", status: "delivered" })],
      "sha-3",
    );

    expect((await readOutbox(t, outboxId))?.status).toBe("read");
    const state = await t.run(async (ctx) => ({
      events: await ctx.db.query("channelEvents").collect(),
      threads: await ctx.db.query("channelThreads").collect(),
    }));
    // The late events are still persisted as evidence.
    expect(state.events.map((e) => e.eventKind)).toEqual(
      expect.arrayContaining(["status.read", "status.sent", "status.delivered"]),
    );
    expect(state.threads).toHaveLength(0);
  });

  it("keeps a proven delivery when a failure arrives later (AC-3)", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "OpenBSP Lab");
    const { channelId } = await seedLabConnection(t, owner);
    const outboxId = await seedAcceptedOutbox(t, {
      ...owner,
      channelId,
      providerMessageId: "wamid.TEST3",
    });

    await ingest(t, channelId, [
      statusEvent({ providerMessageId: "wamid.TEST3", status: "delivered" }),
    ]);
    await ingest(
      t,
      channelId,
      [
        statusEvent({
          providerMessageId: "wamid.TEST3",
          status: "failed",
          errors: [{ code: 131_047, title: "Re-engagement message" }],
        }),
      ],
      "sha-2",
    );

    const row = await readOutbox(t, outboxId);
    expect(row?.status).toBe("delivered");
    expect(row?.failureReason).toContain("131047");
    expect(row?.failureReason).toContain("Re-engagement message");
  });

  it("fails a row that had no proof of delivery yet", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "OpenBSP Lab");
    const { channelId } = await seedLabConnection(t, owner);
    const outboxId = await seedAcceptedOutbox(t, {
      ...owner,
      channelId,
      providerMessageId: "wamid.TEST4",
    });

    await ingest(t, channelId, [
      statusEvent({
        providerMessageId: "wamid.TEST4",
        status: "failed",
        errors: [{ code: 470, title: "Message failed to send" }],
      }),
    ]);

    expect((await readOutbox(t, outboxId))?.status).toBe("failed");
  });

  it("ignores a status for a message it did not send", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "OpenBSP Lab");
    const { channelId } = await seedLabConnection(t, owner);
    const outboxId = await seedAcceptedOutbox(t, {
      ...owner,
      channelId,
      providerMessageId: "wamid.MINE",
    });

    const result = await ingest(t, channelId, [
      statusEvent({ providerMessageId: "wamid.SOMEONE_ELSE", status: "read" }),
    ]);

    expect(result.accepted).toBe(1);
    expect((await readOutbox(t, outboxId))?.status).toBe("accepted");
    const threads = await t.run(async (ctx) =>
      await ctx.db.query("channelThreads").collect(),
    );
    expect(threads).toHaveLength(0);
  });

  it("applies the ladder once when a payload is replayed (AC-4)", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "OpenBSP Lab");
    const { channelId } = await seedLabConnection(t, owner);
    const outboxId = await seedAcceptedOutbox(t, {
      ...owner,
      channelId,
      providerMessageId: "wamid.TEST5",
    });

    const raw = JSON.stringify({
      statuses: [
        {
          id: "wamid.TEST5",
          status: "delivered",
          recipient_id: RECIPIENT,
          timestamp: "1755500000",
        },
      ],
    });
    const events = normalizeWebhook(JSON.parse(raw), "sha-replay");
    expect(events).toHaveLength(1);

    const first = await t.mutation(internal.leoHubLab.ingestWebhookEvents, {
      channelId,
      rawPayload: raw,
      rawBodySha256: "sha-replay",
      events,
    });
    const afterFirst = await readOutbox(t, outboxId);

    const second = await t.mutation(internal.leoHubLab.ingestWebhookEvents, {
      channelId,
      rawPayload: raw,
      rawBodySha256: "sha-replay",
      events,
    });
    const afterSecond = await readOutbox(t, outboxId);

    expect(first).toEqual({ accepted: 1, duplicates: 0 });
    expect(second).toEqual({ accepted: 0, duplicates: 1 });
    expect(afterSecond?.status).toBe("delivered");
    expect(afterSecond?.updatedAt).toBe(afterFirst?.updatedAt);

    const stored = await t.run(async (ctx) =>
      ({
        events: await ctx.db.query("channelEvents").collect(),
        threads: await ctx.db.query("channelThreads").collect(),
      }),
    );
    expect(stored.events).toHaveLength(1);
    expect(stored.threads).toHaveLength(0);
  });
});

describe("neutral thread projection", () => {
  it("collapses two inbound messages into one thread (AC-5)", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "OpenBSP Lab");
    const { channelId } = await seedLabConnection(t, owner);

    const older = 1_755_500_000;
    const newer = 1_755_500_060;
    for (const [index, ts] of [older, newer].entries()) {
      const raw = JSON.stringify({
        contacts: [{ wa_id: RECIPIENT, profile: { name: "Dani" } }],
        messages: [
          {
            id: `wamid.IN${index}`,
            from: RECIPIENT,
            type: "text",
            timestamp: String(ts),
            text: { body: `Mensagem ${index}` },
          },
        ],
      });
      const events = normalizeWebhook(JSON.parse(raw), `sha-in-${index}`);
      await t.mutation(internal.leoHubLab.ingestWebhookEvents, {
        channelId,
        rawPayload: raw,
        rawBodySha256: `sha-in-${index}`,
        events,
      });
    }

    const threads = await t
      .withIdentity({ subject: owner.userId })
      .query(api.channels.listThreads, { channelId });

    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({
      threadKey: RECIPIENT,
      unreadCount: 2,
      lastEventKind: "message.text",
      lastPreview: "Mensagem 1",
      displayName: "Dani",
      phone: RECIPIENT,
    });
    expect(threads[0].lastInboundAt).toBe(newer * 1_000);
    expect(threads[0].serviceWindowExpiresAt).toBe(
      newer * 1_000 + SERVICE_WINDOW_MS,
    );
  });

  it("does not rewind ordering when an older event arrives late", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "OpenBSP Lab");
    const { channelId } = await seedLabConnection(t, owner);

    const newer = 1_755_500_060;
    const older = 1_755_500_000;
    for (const [index, ts] of [newer, older].entries()) {
      const raw = JSON.stringify({
        contacts: [{ wa_id: RECIPIENT, profile: { name: "Dani" } }],
        messages: [
          {
            id: `wamid.LATE${index}`,
            from: RECIPIENT,
            type: "text",
            timestamp: String(ts),
            text: { body: `Late ${index}` },
          },
        ],
      });
      const events = normalizeWebhook(JSON.parse(raw), `sha-late-${index}`);
      await t.mutation(internal.leoHubLab.ingestWebhookEvents, {
        channelId,
        rawPayload: raw,
        rawBodySha256: `sha-late-${index}`,
        events,
      });
    }

    const threads = await t
      .withIdentity({ subject: owner.userId })
      .query(api.channels.listThreads, { channelId });
    expect(threads[0].lastEventAt).toBe(newer * 1_000);
    expect(threads[0].lastPreview).toBe("Late 0");
    expect(threads[0].unreadCount).toBe(2);
  });

  it("keeps status-only evidence out of the inbox projection", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "OpenBSP Lab");
    const { channelId } = await seedLabConnection(t, owner);
    await ingest(t, channelId, [
      statusEvent({ providerMessageId: "wamid.LEAK", status: "delivered" }),
    ]);

    const threads = await t
      .withIdentity({ subject: owner.userId })
      .query(api.channels.listThreads, { channelId });
    expect(threads).toHaveLength(0);
    const serialized = JSON.stringify(threads);
    expect(serialized).not.toContain("rawPayload");
    expect(serialized).not.toContain("rawBodySha256");
    expect(serialized).not.toContain("ciphertext-token");
    expect(serialized).not.toContain("ciphertext-webhook");
  });

  it("does not project status events even when an old adapter includes a threadKey", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "OpenBSP Lab");
    const { channelId } = await seedLabConnection(t, owner);
    const legacyStatus = {
      ...statusEvent({
        providerMessageId: "wamid.LEGACY_STATUS_THREAD",
        status: "sent",
      }),
      threadKey: RECIPIENT,
    };

    await t.mutation(internal.leoHubLab.ingestWebhookEvents, {
      channelId,
      rawPayload: JSON.stringify({ statuses: [legacyStatus.payload.status] }),
      rawBodySha256: "sha-legacy-status-thread",
      events: [legacyStatus],
    });

    const state = await t.run(async (ctx) => ({
      events: await ctx.db.query("channelEvents").collect(),
      threads: await ctx.db.query("channelThreads").collect(),
    }));
    expect(state.events).toHaveLength(1);
    expect(state.events[0].threadKey).toBe(RECIPIENT);
    expect(state.threads).toHaveLength(0);
  });
});

describe("tenant fences on the inbox queries", () => {
  it("refuses cross-tenant reads (AC-6)", async () => {
    const t = convexTest(schema);
    const tenantA = await seedTenant(t, "Clinica A");
    const tenantB = await seedTenant(t, "Clinica B");
    const { channelId } = await seedLabConnection(t, tenantA);
    await seedLabConnection(t, {
      ...tenantB,
      publicId: "lab_bbbbbbbbbbbbbbbbbbbbbbbb",
      externalChannelId: "hub-channel-lab-2",
    });

    await ingest(t, channelId, [
      statusEvent({ providerMessageId: "wamid.PRIVATE", status: "delivered" }),
    ]);

    const asB = t.withIdentity({ subject: tenantB.userId });
    await expect(
      asB.query(api.channels.listThreads, { channelId }),
    ).rejects.toThrow();
    await expect(
      asB.query(api.channels.listThreadEvents, {
        channelId,
        threadKey: RECIPIENT,
      }),
    ).rejects.toThrow();

    // Tenant B sees only its own (empty) channel.
    const ownChannels = await asB.query(api.channels.list, {});
    expect(ownChannels).toHaveLength(1);
    const ownThreads = await asB.query(api.channels.listThreads, {
      channelId: ownChannels[0]._id,
    });
    expect(ownThreads).toHaveLength(0);
  });
});

describe("legacy WhatsApp domain isolation", () => {
  it("writes nothing into conversations, messages or phoneNumbers (AC-7)", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "OpenBSP Lab");
    const { channelId } = await seedLabConnection(t, owner);
    const outboxId = await seedAcceptedOutbox(t, {
      ...owner,
      channelId,
      providerMessageId: "wamid.ISO",
    });

    const raw = JSON.stringify({
      contacts: [{ wa_id: RECIPIENT, profile: { name: "Dani" } }],
      messages: [
        {
          id: "wamid.ISO_IN",
          from: RECIPIENT,
          type: "text",
          timestamp: "1755500000",
          text: { body: "Olá" },
        },
      ],
    });
    await t.mutation(internal.leoHubLab.ingestWebhookEvents, {
      channelId,
      rawPayload: raw,
      rawBodySha256: "sha-iso",
      events: normalizeWebhook(JSON.parse(raw), "sha-iso"),
    });
    await ingest(
      t,
      channelId,
      [statusEvent({ providerMessageId: "wamid.ISO", status: "delivered" })],
      "sha-iso-2",
    );

    expect((await readOutbox(t, outboxId))?.status).toBe("delivered");

    const legacy = await t.run(async (ctx) => ({
      conversations: await ctx.db.query("conversations").collect(),
      messages: await ctx.db.query("messages").collect(),
      phoneNumbers: await ctx.db.query("phoneNumbers").collect(),
      contacts: await ctx.db.query("contacts").collect(),
    }));
    expect(legacy.conversations).toHaveLength(0);
    expect(legacy.messages).toHaveLength(0);
    expect(legacy.phoneNumbers).toHaveLength(0);
    expect(legacy.contacts).toHaveLength(0);
  });
});
