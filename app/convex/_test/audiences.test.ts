import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";

async function seedAudienceTenant(t: ReturnType<typeof convexTest>) {
  const now = Date.now();
  const userId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", { name: "Audience Owner" });
  });

  const seeded = await t.run(async (ctx) => {
    const tenantId = await ctx.db.insert("tenants", {
      name: "Audience Clinic",
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
      metaAppId: "meta-app",
      wabaId: "waba",
      accessToken: "token",
      status: "active",
      tokenStatus: "ok",
      createdAt: now,
    });
    const phoneNumberId = await ctx.db.insert("phoneNumbers", {
      tenantId,
      whatsappAccountId,
      phoneNumberId: "1020304050",
      e164: "+258840000000",
      displayName: "Clinic Main",
      createdAt: now,
    });

    const ana = await ctx.db.insert("contacts", {
      tenantId,
      e164: "+258840000001",
      name: "Ana VIP",
      tags: ["vip", "injectables"],
      createdAt: now - 10_000,
    });
    const bruno = await ctx.db.insert("contacts", {
      tenantId,
      e164: "+258840000002",
      name: "Bruno Opt Out",
      tags: ["vip"],
      createdAt: now - 9_000,
    });
    const clara = await ctx.db.insert("contacts", {
      tenantId,
      e164: "+258840000003",
      name: "Clara Blocked Tag",
      tags: ["vip", "do_not_promote"],
      createdAt: now - 8_000,
    });
    const diana = await ctx.db.insert("contacts", {
      tenantId,
      e164: "+258840000004",
      name: "Diana Organic",
      tags: ["followup"],
      createdAt: now - 7_000,
    });

    for (const [contactId, status] of [
      [ana, "granted"],
      [bruno, "revoked"],
      [clara, "granted"],
      [diana, "granted"],
    ] as const) {
      const eventId = await ctx.db.insert("consentEvents", {
        tenantId,
        contactId,
        purpose: "marketing",
        channel: "whatsapp",
        newStatus: status,
        source: "test",
        capturedAt: now,
      });
      await ctx.db.insert("currentConsents", {
        tenantId,
        contactId,
        purpose: "marketing",
        channel: "whatsapp",
        status,
        effectiveAt: now,
        lastEventId: eventId,
      });
    }

    for (const contactId of [ana, bruno, clara]) {
      const conversationId = await ctx.db.insert("conversations", {
        tenantId,
        phoneNumberId,
        contactId,
        status: "open",
        lastMessageAt: now - 1_000,
        lastIncomingAt: now - 1_000,
        serviceWindowExpiresAt: now + 20 * 60 * 60 * 1000,
        unreadCount: 0,
        tags: [],
        leadSource: "ctwa",
        opportunityStatus: "booked",
        lastCtwaClickAt: now - 60_000,
      });
      await ctx.db.insert("ctwaReferrals", {
        tenantId,
        conversationId,
        contactId,
        phoneNumberId,
        metaMessageId: `wamid.${contactId}`,
        clickedAt: now - 60_000,
        freeEntryWindowExpiresAt: now + 2 * 60 * 60 * 1000,
        createdAt: now - 60_000,
      });
    }

    await ctx.db.insert("conversations", {
      tenantId,
      phoneNumberId,
      contactId: diana,
      status: "open",
      lastMessageAt: now - 3_000,
      unreadCount: 0,
      tags: [],
      leadSource: "organic",
      opportunityStatus: "new",
    });

    const campaignId = await ctx.db.insert("campaigns", {
      tenantId,
      name: "Clicked Retargeting Source",
      status: "completed",
      createdBy: memberId,
      createdAt: now,
      updatedAt: now,
    });
    for (const [contactId, status] of [
      [ana, "clicked"],
      [bruno, "clicked"],
      [diana, "replied"],
    ] as const) {
      await ctx.db.insert("campaignRecipients", {
        tenantId,
        campaignId,
        contactId,
        identityKind: "phone",
        identityValue: `+25884${contactId}`,
        status,
        createdAt: now,
        updatedAt: now,
      });
    }

    return { ana, bruno, clara, diana };
  });

  return { owner: t.withIdentity({ subject: userId }), ...seeded };
}

describe("audience builder", () => {
  it("previews opted-in CTWA leads by tags, opportunity status, and free-entry window", async () => {
    const t = convexTest(schema);
    const { owner, ana } = await seedAudienceTenant(t);
    const audiencesApi = (api as any).audiences;

    const preview = await owner.query(audiencesApi.preview, {
      criteria: {
        logic: "all",
        includeTags: ["vip"],
        excludeTags: ["do_not_promote"],
        marketingConsent: "granted",
        leadSources: ["ctwa"],
        opportunityStatuses: ["booked"],
        ctwaWindow: "open",
      },
    });

    expect(preview.count).toBe(1);
    expect(preview.excludedMarketingRevoked).toBe(1);
    expect(preview.sample).toHaveLength(1);
    expect(preview.sample[0].contactId).toBe(ana);
    expect(preview.sample[0].matchReasons).toEqual(
      expect.arrayContaining([
        "tag:vip",
        "marketing:granted",
        "source:ctwa",
        "status:booked",
        "ctwa:open",
      ]),
    );
  });

  it("saves a campaign-outcome audience as a reusable contact list with safety metadata", async () => {
    const t = convexTest(schema);
    const { owner, ana } = await seedAudienceTenant(t);
    const audiencesApi = (api as any).audiences;

    const saved = await owner.mutation(audiencesApi.saveAsList, {
      name: "VIP clicked retargeting",
      criteria: {
        logic: "all",
        includeTags: ["vip"],
        campaignRecipientStatuses: ["clicked"],
      },
    });

    expect(saved).toMatchObject({
      added: 1,
      matched: 1,
      excludedMarketingRevoked: 1,
    });

    const persisted = await t.run(async (ctx) => {
      const list = (await ctx.db.get(saved.listId)) as any;
      const members = await ctx.db
        .query("contactListMembers")
        .withIndex("by_list", (q) => q.eq("listId", saved.listId))
        .collect();
      return { list, members };
    });

    expect(persisted.list.description).toContain("Audience Builder");
    expect(persisted.list.audienceCriteria).toMatchObject({
      includeTags: ["vip"],
      campaignRecipientStatuses: ["clicked"],
    });
    expect(persisted.members).toHaveLength(1);
    expect(persisted.members[0].contactId).toBe(ana);
    expect(persisted.members[0].source).toBe("audience_builder");
  });
});
