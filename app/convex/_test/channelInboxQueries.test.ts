import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { normalizeWebhook } from "../integrations/leoHub/webhook";

const ALLOWED = "258860439352";
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

  it("returns null for a thread that does not exist yet", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "OpenBSP Lab");
    const { channelId } = await seedChannel(t, owner);
    const thread = await t
      .withIdentity({ subject: owner.userId })
      .query(api.channels.getThread, { channelId, threadKey: "258000000000" });
    expect(thread).toBeNull();
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
