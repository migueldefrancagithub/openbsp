import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

async function seedTenant(
  t: ReturnType<typeof convexTest>,
  name: string,
) {
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
    externalChannelId?: string;
  },
) {
  return await t.mutation(internal.leoHubLab._upsertConnection, {
    tenantId: args.tenantId,
    memberId: args.memberId,
    publicId: "lab_abcdefghijklmnopqrstuvwx",
    externalChannelId: args.externalChannelId ?? "hub-channel-lab-1",
    displayName: "OpenBSP Lab",
    outboundAllowlist: ["258860439352"],
    accessTokenCiphertext: "ciphertext-token",
    accessTokenKeyVersion: 1,
    webhookSecretCiphertext: "ciphertext-webhook",
    webhookSecretKeyVersion: 1,
    encryptedAt: Date.now(),
    healthStatus: "GREEN",
  });
}

describe("Leo Hub isolated laboratory core", () => {
  it("keeps secrets out of tenant channel queries and starts disabled", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "OpenBSP Lab");
    const connection = await seedLabConnection(t, owner);

    const rows = await t
      .withIdentity({ subject: owner.userId })
      .query(api.channels.list, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      _id: connection.channelId,
      provider: "lab_bridge",
      sendMode: "disabled",
      outboundAllowlist: ["258860439352"],
    });
    expect(JSON.stringify(rows[0])).not.toContain("ciphertext-token");
    expect(JSON.stringify(rows[0])).not.toContain("ciphertext-webhook");
  });

  it("enforces the kill switch, allowlist and idempotent business key", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "OpenBSP Lab");
    const { channelId } = await seedLabConnection(t, owner);

    await expect(
      t.mutation(internal.leoHubLab._claimOutbox, {
        tenantId: owner.tenantId,
        memberId: owner.memberId,
        channelId,
        businessKey: "lab:text:nonce-1",
        recipient: "258860439352",
        messageKind: "text",
        payload: { text: "Teste" },
      }),
    ).rejects.toThrow(/LAB_KILL_SWITCH_ACTIVE/);

    await t
      .withIdentity({ subject: owner.userId })
      .mutation(api.channels.setSendMode, {
        channelId,
        sendMode: "allowlist",
      });

    await expect(
      t.mutation(internal.leoHubLab._claimOutbox, {
        tenantId: owner.tenantId,
        memberId: owner.memberId,
        channelId,
        businessKey: "lab:text:blocked",
        recipient: "258861111111",
        messageKind: "text",
        payload: { text: "Bloqueado" },
      }),
    ).rejects.toThrow(/RECIPIENT_NOT_ALLOWLISTED/);

    const first = await t.mutation(internal.leoHubLab._claimOutbox, {
      tenantId: owner.tenantId,
      memberId: owner.memberId,
      channelId,
      businessKey: "lab:text:nonce-1",
      recipient: "258860439352",
      messageKind: "text",
      payload: { text: "Teste" },
    });
    const replay = await t.mutation(internal.leoHubLab._claimOutbox, {
      tenantId: owner.tenantId,
      memberId: owner.memberId,
      channelId,
      businessKey: "lab:text:nonce-1",
      recipient: "258860439352",
      messageKind: "text",
      payload: { text: "Teste" },
    });
    expect(first).toMatchObject({ dispatch: true, status: "dispatching" });
    expect(replay).toMatchObject({
      outboxId: first.outboxId,
      dispatch: false,
      status: "dispatching",
    });

    await t.run(async (ctx) => {
      await ctx.db.patch(first.outboxId, {
        claimedAt: Date.now() - 3 * 60 * 1_000,
      });
    });
    await t.mutation(internal.leoHubLab._markUnknownIfStale, {
      outboxId: first.outboxId,
    });
    const stale = await t.run(async (ctx) => await ctx.db.get(first.outboxId));
    expect(stale).toMatchObject({
      status: "unknown",
      failureReason:
        "Dispatch did not settle before the laboratory safety deadline.",
    });
  });

  it("deduplicates inbound events and upserts a channel identity", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "OpenBSP Lab");
    const { channelId } = await seedLabConnection(t, owner);
    const args = {
      channelId,
      rawPayload: '{"messages":[{"id":"wamid.1"}]}',
      rawBodySha256: "a".repeat(64),
      events: [
        {
          eventKey: "message:wamid.1",
          providerEventId: "wamid.1",
          eventKind: "message.text",
          direction: "incoming" as const,
          actorProviderScopedId: "258860439352",
          actorDisplayName: "Maria",
          actorPhone: "258860439352",
          threadKey: "258860439352",
          providerTimestamp: 1_785_071_400_000,
          payload: { normalizedText: "Oi" },
        },
      ],
    };

    expect(
      await t.mutation(internal.leoHubLab.ingestWebhookEvents, args),
    ).toEqual({ accepted: 1, duplicates: 0 });
    expect(
      await t.mutation(internal.leoHubLab.ingestWebhookEvents, args),
    ).toEqual({ accepted: 0, duplicates: 1 });

    const stored = await t.run(async (ctx) => ({
      events: await ctx.db.query("channelEvents").collect(),
      identities: await ctx.db.query("channelIdentities").collect(),
    }));
    expect(stored.events).toHaveLength(1);
    expect(stored.identities).toHaveLength(1);
    expect(stored.identities[0]).toMatchObject({
      tenantId: owner.tenantId,
      channelId,
      providerScopedId: "258860439352",
      displayName: "Maria",
    });
  });

  it("blocks one tenant from changing another tenant's laboratory", async () => {
    const t = convexTest(schema);
    const tenantA = await seedTenant(t, "Tenant A");
    const tenantB = await seedTenant(t, "Tenant B");
    const { channelId } = await seedLabConnection(t, tenantA);

    await expect(
      t.withIdentity({ subject: tenantB.userId }).mutation(
        api.channels.setSendMode,
        { channelId, sendMode: "allowlist" },
      ),
    ).rejects.toThrow(/CHANNEL_NOT_FOUND/);
    const rows = await t
      .withIdentity({ subject: tenantB.userId })
      .query(api.channels.list, {});
    expect(rows).toEqual([]);
  });
});
