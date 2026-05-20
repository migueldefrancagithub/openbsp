import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";

async function seedCtwaTenant(t: ReturnType<typeof convexTest>) {
  const userId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", { name: "CTWA Owner" });
  });
  const seeded = await t.run(async (ctx) => {
    const tenantId = await ctx.db.insert("tenants", {
      name: "CTWA Clinic",
      vertical: "clinic",
      plan: "growth",
      settings: {
        defaultLocale: "pt-PT",
        timezone: "Africa/Maputo",
        retentionDays: 730,
      },
      createdAt: Date.now(),
    });
    await ctx.db.insert("members", {
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
      metaAppId: "123",
      wabaId: "456",
      accessToken: "token",
      status: "active",
      tokenStatus: "ok",
      createdAt: Date.now(),
    });
    const phoneNumberId = await ctx.db.insert("phoneNumbers", {
      tenantId,
      whatsappAccountId,
      phoneNumberId: "1020304050",
      e164: "+258840000000",
      displayName: "Clinic Main",
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
      lastMessageAt: 1000,
      unreadCount: 1,
      tags: [],
      leadSource: "ctwa",
      opportunityStatus: "booked",
      aiState: "paused",
      lastCtwaClickAt: 900,
    });
    await ctx.db.insert("ctwaReferrals", {
      tenantId,
      conversationId,
      contactId,
      phoneNumberId,
      metaMessageId: "wamid.CTWA",
      sourceType: "ad",
      sourceId: "ad-123",
      sourceUrl: "https://fb.example/ad-123",
      headline: "Book a consult",
      clickedAt: 900,
      freeEntryWindowExpiresAt: Date.now() + 72 * 60 * 60 * 1000,
      createdAt: 900,
    });
    return { tenantId };
  });
  return { owner: t.withIdentity({ subject: userId }), ...seeded };
}

describe("CTWA dashboard", () => {
  it("summarizes click-to-WhatsApp referrals and opportunity state", async () => {
    const t = convexTest(schema);
    const { owner } = await seedCtwaTenant(t);

    const dashboard = await owner.query((api as any).ctwa.dashboard, {});

    expect(dashboard.totalReferrals).toBe(1);
    expect(dashboard.openConversations).toBe(1);
    expect(dashboard.booked).toBe(1);
    expect(dashboard.freeEntryOpen).toBe(1);
    expect(dashboard.byOpportunityStatus).toContainEqual({
      status: "booked",
      count: 1,
    });
    expect(dashboard.recent[0]).toMatchObject({
      contactName: "Ana",
      sourceType: "ad",
      headline: "Book a consult",
      opportunityStatus: "booked",
      aiState: "paused",
    });
  });
});
