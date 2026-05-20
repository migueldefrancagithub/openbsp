import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";

async function seedOverview(t: ReturnType<typeof convexTest>) {
  const userId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", { name: "Console Owner" });
  });
  const seeded = await t.run(async (ctx) => {
    const tenantId = await ctx.db.insert("tenants", {
      name: "OpenBSP Clinic",
      vertical: "clinic",
      plan: "growth",
      settings: {
        defaultLocale: "pt-PT",
        timezone: "Africa/Maputo",
        retentionDays: 730,
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
    const whatsappAccountId = await ctx.db.insert("whatsappAccounts", {
      tenantId,
      metaAppId: "APP",
      wabaId: "WABA",
      accessToken: "token",
      status: "active",
      tokenStatus: "ok",
      qualityRating: "green",
      messagingTier: "10,000/day",
      createdAt: Date.now(),
    });
    const phoneNumberId = await ctx.db.insert("phoneNumbers", {
      tenantId,
      whatsappAccountId,
      phoneNumberId: "PHONE_MAIN",
      e164: "+258840000000",
      displayName: "Clinic Main",
      qualityRating: "green",
      createdAt: Date.now(),
    });
    const contactId = await ctx.db.insert("contacts", {
      tenantId,
      e164: "+258840000001",
      name: "Ana",
      tags: [],
      createdAt: Date.now(),
    });
    const conversationId = await ctx.db.insert("conversations", {
      tenantId,
      phoneNumberId,
      contactId,
      status: "open",
      lastMessageAt: 1700000000000,
      unreadCount: 1,
      tags: [],
      leadSource: "ctwa",
      opportunityStatus: "booked",
      opportunityValueMinor: 400300,
      opportunityCurrency: "BRL",
      aiState: "paused",
    });
    await ctx.db.insert("ctwaReferrals", {
      tenantId,
      conversationId,
      contactId,
      phoneNumberId,
      metaMessageId: "wamid.ctwa",
      sourceType: "ad",
      sourceId: "ad-1",
      headline: "Promo",
      clickedAt: Date.now(),
      freeEntryWindowExpiresAt: Date.now() + 72 * 60 * 60 * 1000,
      createdAt: Date.now(),
    });
    const campaignId = await ctx.db.insert("campaigns", {
      tenantId,
      name: "Promo Maio",
      status: "running",
      createdBy: memberId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.insert("campaignRecipients", {
      tenantId,
      campaignId,
      contactId,
      identityKind: "phone",
      identityValue: "+258840000001",
      status: "read",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { tenantId };
  });
  return { owner: t.withIdentity({ subject: userId }), ...seeded };
}

describe("overview dashboard", () => {
  it("summarizes account health, CTWA pipeline, and campaign performance", async () => {
    const t = convexTest(schema);
    const { owner } = await seedOverview(t);

    const dashboard = await owner.query((api as any).overview.dashboard, {});

    expect(dashboard.connection.primaryPhone).toMatchObject({
      e164: "+258840000000",
      displayName: "Clinic Main",
      qualityRating: "green",
    });
    expect(dashboard.connection.messagingLimitLabel).toBe("10,000/day");
    expect(dashboard.leads.totalContacts).toBe(1);
    expect(dashboard.leads.ctwaReferrals).toBe(1);
    expect(dashboard.leads.booked).toBe(1);
    expect(dashboard.revenue.bookedValueMinor).toBe(400300);
    expect(dashboard.campaigns.recent[0]).toMatchObject({
      name: "Promo Maio",
      status: "running",
      stats: { total: 1, read: 1 },
    });
  });
});
