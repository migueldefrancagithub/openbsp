import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";

async function seedContactsWorkspace(t: ReturnType<typeof convexTest>) {
  const userId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", { name: "Contacts Owner" });
  });
  const seeded = await t.run(async (ctx) => {
    const now = Date.now();
    const tenantId = await ctx.db.insert("tenants", {
      name: "Contacts Clinic",
      vertical: "clinic",
      plan: "growth",
      settings: {
        defaultLocale: "pt-PT",
        timezone: "Africa/Maputo",
        retentionDays: 730,
      },
      createdAt: now,
    });
    const memberId = await ctx.db.insert("members", {
      tenantId,
      userId,
      role: "owner",
      status: "active",
      createdAt: now,
    });
    await ctx.db.insert("sessions", {
      userId,
      activeTenantId: tenantId,
      updatedAt: now,
    });
    const whatsappAccountId = await ctx.db.insert("whatsappAccounts", {
      tenantId,
      metaAppId: "META_APP",
      wabaId: "WABA_CONTACTS",
      accessToken: "test-token",
      status: "active",
      tokenStatus: "ok",
      createdAt: now,
    });
    const phoneNumberId = await ctx.db.insert("phoneNumbers", {
      tenantId,
      whatsappAccountId,
      phoneNumberId: "PHONE_CONTACTS",
      e164: "+258840000000",
      displayName: "Clinic Main",
      createdAt: now,
    });
    const contactId = await ctx.db.insert("contacts", {
      tenantId,
      bsuid: "MZ.123456789",
      parentBsuid: "MZ.PARENT123",
      whatsappUsername: "maria.maputo",
      name: "Maria",
      tags: ["vip"],
      createdAt: now - 10_000,
    });
    const consentEventId = await ctx.db.insert("consentEvents", {
      tenantId,
      contactId,
      purpose: "marketing",
      channel: "whatsapp",
      newStatus: "granted",
      source: "test",
      capturedAt: now - 8_000,
      capturedByMemberId: memberId,
    });
    await ctx.db.insert("currentConsents", {
      tenantId,
      contactId,
      purpose: "marketing",
      channel: "whatsapp",
      status: "granted",
      effectiveAt: now - 8_000,
      lastEventId: consentEventId,
    });
    await ctx.db.insert("conversations", {
      tenantId,
      phoneNumberId,
      contactId,
      status: "open",
      lastMessageAt: now - 1_000,
      serviceWindowExpiresAt: now + 60_000,
      unreadCount: 0,
      tags: [],
      leadSource: "ctwa",
      opportunityStatus: "opportunity",
    });
    return { contactId };
  });
  return { owner: t.withIdentity({ subject: userId }), ...seeded };
}

describe("contacts list", () => {
  it("exposes Meta identity, consent timestamps, and latest conversation context", async () => {
    const t = convexTest(schema);
    const { owner } = await seedContactsWorkspace(t);
    const rows = await owner.query(api.contacts.list, {});

    expect(rows[0]).toMatchObject({
      name: "Maria",
      bsuid: "MZ.123456789",
      parentBsuid: "MZ.PARENT123",
      whatsappUsername: "maria.maputo",
      marketingConsent: "granted",
      lastLeadSource: "ctwa",
      opportunityStatus: "opportunity",
    });
    expect(rows[0].marketingConsentAt).toBeTypeOf("number");
    expect(rows[0].lastConversationAt).toBeTypeOf("number");
    expect(rows[0].serviceWindowExpiresAt).toBeTypeOf("number");
  });
});
