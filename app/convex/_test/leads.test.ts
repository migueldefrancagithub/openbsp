import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { projectThreadFromEvent } from "../lib/channels/projection";
import schema from "../schema";

const PATIENT = "258841234567";

async function seedTenant(t: ReturnType<typeof convexTest>, name: string) {
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

async function seedCampaignSend(
  t: ReturnType<typeof convexTest>,
  owner: { tenantId: Id<"tenants">; memberId: Id<"members">; channelId: Id<"channels"> },
  sentAt: number,
) {
  return await t.run(async (ctx) => {
    const contactId = await ctx.db.insert("contacts", {
      tenantId: owner.tenantId,
      e164: `+${PATIENT}`,
      name: "Paciente",
      tags: [],
      createdAt: sentAt,
    });
    const campaignId = await ctx.db.insert("campaigns", {
      tenantId: owner.tenantId,
      name: "Check-up de setembro",
      kind: "micro_lab",
      channelId: owner.channelId,
      status: "completed",
      createdBy: owner.memberId,
      createdAt: sentAt,
      updatedAt: sentAt,
    });
    await ctx.db.insert("campaignRecipients", {
      tenantId: owner.tenantId,
      campaignId,
      contactId,
      channelId: owner.channelId,
      threadKey: PATIENT,
      identityKind: "phone",
      identityValue: PATIENT,
      status: "delivered",
      sentAt,
      deliveredAt: sentAt + 1000,
      createdAt: sentAt,
      updatedAt: sentAt + 1000,
    });
    return campaignId;
  });
}

function inboundEvent(text: string, at: number) {
  return {
    eventKind: "message.text",
    direction: "incoming" as const,
    providerEventId: `wamid.${at}`,
    threadKey: PATIENT,
    providerTimestamp: at,
    payload: { message: { type: "text", text: { body: text } } },
  };
}

describe("lead consolidation", () => {
  it("infers intent and attributes the thread to the campaign it replied to", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "leads-a");
    const sentAt = Date.now() - 2 * 24 * 60 * 60 * 1000;
    const campaignId = await seedCampaignSend(t, owner, sentAt);

    await t.run(async (ctx) => {
      const channel = (await ctx.db.get(owner.channelId))!;
      await projectThreadFromEvent(ctx, {
        channel,
        event: inboundEvent("Quanto custa o check-up?", Date.now()),
        now: Date.now(),
      });
    });
    const [thread] = await t.run(async (ctx) => await ctx.db.query("channelThreads").collect());
    expect(thread).toMatchObject({
      leadSource: "campaign_reply",
      originCampaignId: campaignId,
      leadStatus: "asked_price",
      intent: "price_request",
      intentSource: "inferred",
    });

    const summary = await t
      .withIdentity({ subject: owner.userId })
      .query(api.channels.getThread, { channelId: owner.channelId, threadKey: PATIENT });
    expect(summary).toMatchObject({ originCampaignName: "Check-up de setembro", intent: "price_request" });
  });

  it("does not attribute replies outside the 7-day window", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "leads-b");
    await seedCampaignSend(t, owner, Date.now() - 10 * 24 * 60 * 60 * 1000);
    await t.run(async (ctx) => {
      const channel = (await ctx.db.get(owner.channelId))!;
      await projectThreadFromEvent(ctx, {
        channel,
        event: inboundEvent("Olá", Date.now()),
        now: Date.now(),
      });
    });
    const [thread] = await t.run(async (ctx) => await ctx.db.query("channelThreads").collect());
    expect(thread.leadSource).toBe("organic");
    expect(thread.originCampaignId).toBeUndefined();
  });

  it("keeps a manual intent for a day and lets inference take over afterwards", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "leads-c");
    const start = Date.now();
    await t.run(async (ctx) => {
      const channel = (await ctx.db.get(owner.channelId))!;
      await projectThreadFromEvent(ctx, { channel, event: inboundEvent("Olá", start), now: start });
    });
    const [thread] = await t.run(async (ctx) => await ctx.db.query("channelThreads").collect());
    const asOwner = t.withIdentity({ subject: owner.userId });
    await asOwner.mutation(api.inboxOperations.updateThread, { threadId: thread._id, intent: "complaint" });

    const soon = start + 60 * 60 * 1000;
    await t.run(async (ctx) => {
      const channel = (await ctx.db.get(owner.channelId))!;
      await projectThreadFromEvent(ctx, { channel, event: inboundEvent("Quero marcar", soon), now: soon });
    });
    let current = (await t.run(async (ctx) => await ctx.db.get(thread._id)))!;
    expect(current.intent).toBe("complaint");
    expect(current.intentSource).toBe("manual");

    const later = start + 2 * 24 * 60 * 60 * 1000;
    await t.run(async (ctx) => {
      const channel = (await ctx.db.get(owner.channelId))!;
      await projectThreadFromEvent(ctx, { channel, event: inboundEvent("Quero marcar", later), now: later });
    });
    current = (await t.run(async (ctx) => await ctx.db.get(thread._id)))!;
    expect(current.intent).toBe("booking_request");
    expect(current.intentSource).toBe("inferred");
  });

  it("backfills lead status and campaign origin idempotently", async () => {
    const t = convexTest(schema);
    const owner = await seedTenant(t, "leads-d");
    const sentAt = Date.now() - 24 * 60 * 60 * 1000;
    const campaignId = await seedCampaignSend(t, owner, sentAt);
    const threadId = await t.run(async (ctx) =>
      await ctx.db.insert("channelThreads", {
        tenantId: owner.tenantId,
        channelId: owner.channelId,
        threadKey: PATIENT,
        lastEventAt: sentAt + 3600_000,
        lastEventKind: "message.text",
        lastInboundAt: sentAt + 3600_000,
        unreadCount: 1,
        leadSource: "organic",
        createdAt: sentAt,
        updatedAt: sentAt,
      }),
    );
    const first = await t.mutation(internal.leads._backfillLeadStatus, {});
    expect(first).toEqual({ patched: 1, isDone: true });
    const second = await t.mutation(internal.leads._backfillLeadStatus, {});
    expect(second.patched).toBe(0);
    const origin = await t.mutation(internal.leads._backfillOrigin, {});
    expect(origin).toEqual({ patched: 1, isDone: true });
    const again = await t.mutation(internal.leads._backfillOrigin, {});
    expect(again.patched).toBe(0);
    const thread = (await t.run(async (ctx) => await ctx.db.get(threadId)))!;
    expect(thread).toMatchObject({
      leadStatus: "new",
      originCampaignId: campaignId,
      leadSource: "campaign_reply",
    });
  });
});
