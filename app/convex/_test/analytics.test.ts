import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";

const BASE = Date.UTC(2026, 4, 15, 10, 0, 0);

async function seedAnalytics(t: ReturnType<typeof convexTest>) {
  const userId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", { name: "Analytics Owner" });
  });
  await t.run(async (ctx) => {
    const tenantId = await ctx.db.insert("tenants", {
      name: "CXCast Reports",
      vertical: "services",
      plan: "growth",
      settings: {
        defaultLocale: "pt-PT",
        timezone: "Africa/Maputo",
        retentionDays: 730,
      },
      createdAt: BASE,
    });
    await ctx.db.insert("members", {
      tenantId,
      userId,
      role: "owner",
      status: "active",
      createdAt: BASE,
    });
    await ctx.db.insert("sessions", {
      userId,
      activeTenantId: tenantId,
      updatedAt: BASE,
    });
    const whatsappAccountId = await ctx.db.insert("whatsappAccounts", {
      tenantId,
      metaAppId: "APP",
      wabaId: "WABA",
      accessToken: "token",
      status: "active",
      tokenStatus: "ok",
      createdAt: BASE,
    });
    const phoneNumberId = await ctx.db.insert("phoneNumbers", {
      tenantId,
      whatsappAccountId,
      phoneNumberId: "PHONE_MAIN",
      e164: "+258840000000",
      displayName: "Reports Line",
      qualityRating: "green",
      createdAt: BASE,
    });
    const contactPt = await ctx.db.insert("contacts", {
      tenantId,
      e164: "+351910000001",
      name: "Portugal Lead",
      tags: [],
      createdAt: BASE,
    });
    const contactMz = await ctx.db.insert("contacts", {
      tenantId,
      e164: "+258840000001",
      name: "Mozambique Lead",
      tags: [],
      createdAt: BASE,
    });
    const conversationPt = await ctx.db.insert("conversations", {
      tenantId,
      phoneNumberId,
      contactId: contactPt,
      status: "open",
      lastMessageAt: BASE,
      unreadCount: 0,
      tags: [],
    });
    const conversationMz = await ctx.db.insert("conversations", {
      tenantId,
      phoneNumberId,
      contactId: contactMz,
      status: "open",
      lastMessageAt: BASE,
      unreadCount: 0,
      tags: [],
    });

    await ctx.db.insert("messages", {
      tenantId,
      conversationId: conversationPt,
      direction: "outgoing",
      businessKey: "mkt-pt",
      type: "template",
      content: { body: "Marketing PT" },
      status: "read",
      dispatchAttempts: 1,
      pricingCategory: "marketing",
      costMinor: 31,
      costCurrency: "USD",
      createdAt: BASE,
    });
    await ctx.db.insert("messages", {
      tenantId,
      conversationId: conversationMz,
      direction: "outgoing",
      businessKey: "service-mz",
      type: "text",
      content: { body: "Service MZ" },
      status: "delivered",
      dispatchAttempts: 1,
      pricingCategory: "service",
      costMinor: 0,
      costCurrency: "USD",
      createdAt: BASE + 60 * 60 * 1000,
    });
    await ctx.db.insert("messages", {
      tenantId,
      conversationId: conversationMz,
      direction: "outgoing",
      businessKey: "mkt-mz-fail",
      type: "template",
      content: { body: "Marketing MZ" },
      status: "failed",
      failureReason: "131026 recipient unreachable",
      failureCode: "131026",
      dispatchAttempts: 1,
      pricingCategory: "marketing",
      costMinor: 0,
      costCurrency: "USD",
      createdAt: BASE + 2 * 60 * 60 * 1000,
    });
    await ctx.db.insert("messages", {
      tenantId,
      conversationId: conversationMz,
      direction: "incoming",
      businessKey: "incoming-ignore",
      type: "text",
      content: { body: "Should not count as an outbound report row" },
      status: "read",
      dispatchAttempts: 0,
      createdAt: BASE + 3 * 60 * 60 * 1000,
    });
  });
  return { owner: t.withIdentity({ subject: userId }) };
}

describe("analytics reports", () => {
  it("aggregates outbound messaging by date, category, and country", async () => {
    const t = convexTest(schema);
    const { owner } = await seedAnalytics(t);

    const report = await owner.query((api as any).analytics.reports, {
      dateFrom: BASE - 60 * 1000,
      dateTo: BASE + 24 * 60 * 60 * 1000,
      granularity: "day",
    });

    expect(report.summary).toMatchObject({
      sent: 2,
      delivered: 2,
      failed: 1,
      totalMessages: 3,
      totalCostMinor: 31,
      costCurrency: "USD",
    });
    expect(report.summary.deliveryRate).toBe(1);
    expect(report.summary.failureRate).toBeCloseTo(1 / 3, 5);
    expect(report.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "marketing",
          country: "PT",
          sent: 1,
          delivered: 1,
          failed: 0,
          costMinor: 31,
        }),
        expect.objectContaining({
          category: "marketing",
          country: "MZ",
          sent: 0,
          delivered: 0,
          failed: 1,
          retrySafety: "review",
        }),
        expect.objectContaining({
          category: "service",
          country: "MZ",
          sent: 1,
          delivered: 1,
          failed: 0,
          retrySafety: "safe",
        }),
      ]),
    );
    expect(report.series).toHaveLength(1);
    expect(report.categoryBreakdown.find((row: { category: string }) => row.category === "marketing")).toMatchObject({
      sent: 1,
      delivered: 1,
      failed: 1,
      costMinor: 31,
    });
  });
});
