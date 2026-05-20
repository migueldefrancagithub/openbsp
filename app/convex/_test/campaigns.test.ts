import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";

async function seedTenant(t: ReturnType<typeof convexTest>) {
  const userId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", { name: "Campaign Owner" });
  });
  const seeded = await t.run(async (ctx) => {
    const tenantId = await ctx.db.insert("tenants", {
      name: "Live Clinic",
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
      metaAppId: "123",
      wabaId: "456",
      accessToken: "token",
      status: "active",
      tokenStatus: "ok",
      createdAt: Date.now(),
    });
    await ctx.db.insert("phoneNumbers", {
      tenantId,
      whatsappAccountId,
      phoneNumberId: "1020304050",
      e164: "+258840000000",
      displayName: "Clinic Main",
      createdAt: Date.now(),
    });
    const contactA = await ctx.db.insert("contacts", {
      tenantId,
      e164: "+258840000001",
      name: "Ana",
      tags: [],
      createdAt: Date.now(),
    });
    const contactB = await ctx.db.insert("contacts", {
      tenantId,
      bsuid: "MZ.123456789",
      name: "Bruno",
      tags: [],
      createdAt: Date.now(),
    });
    const templateId = await ctx.db.insert("templates", {
      tenantId,
      whatsappAccountId,
      name: "promo_bem_vindo",
      language: "pt_PT",
      category: "marketing",
      currentVersion: 1,
      status: "approved",
      createdAt: Date.now(),
      createdBy: memberId,
    });
    await ctx.db.insert("templateVersions", {
      tenantId,
      templateId,
      version: 1,
      bodyText: "Ola, temos novidades para si.",
      parameterSchema: [],
      isLocked: true,
      createdBy: memberId,
      createdAt: Date.now(),
    });
    const consentEventId = await ctx.db.insert("consentEvents", {
      tenantId,
      contactId: contactA,
      purpose: "marketing",
      channel: "whatsapp",
      newStatus: "granted",
      source: "test",
      capturedAt: Date.now(),
    });
    await ctx.db.insert("currentConsents", {
      tenantId,
      contactId: contactA,
      purpose: "marketing",
      channel: "whatsapp",
      status: "granted",
      effectiveAt: Date.now(),
      lastEventId: consentEventId,
    });
    return { contactA, contactB, templateId };
  });

  return { owner: t.withIdentity({ subject: userId }), ...seeded };
}

describe("campaign foundation", () => {
  it("materializes a draft campaign from a contact list and approved template", async () => {
    const t = convexTest(schema);
    const { owner, contactA, contactB, templateId } = await seedTenant(t);
    const campaignsApi = (api as any).campaigns;

    const listId = await owner.mutation(campaignsApi.createContactList, {
      name: "Promo Botox",
      description: "Leads from the live class example",
    });
    await owner.mutation(campaignsApi.addContactToList, { listId, contactId: contactA });
    await owner.mutation(campaignsApi.addContactToList, { listId, contactId: contactB });
    await owner.mutation(campaignsApi.addContactToList, { listId, contactId: contactA });

    const campaignId = await owner.mutation(campaignsApi.createDraftCampaign, {
      name: "Campanha Maio",
      listId,
      templateId,
    });

    const detail = await owner.query(campaignsApi.getCampaign, { campaignId });
    expect(detail.name).toBe("Campanha Maio");
    expect(detail.status).toBe("draft");
    expect(detail.stats.total).toBe(2);
    expect(detail.recipients.map((r: { identityKind: string }) => r.identityKind).sort()).toEqual([
      "bsuid",
      "phone",
    ]);

    const lists = await owner.query(campaignsApi.listContactLists, {});
    expect(lists).toHaveLength(1);
    expect(lists[0].memberCount).toBe(2);
  });

  it("launches a campaign through the outbox and skips recipients without consent", async () => {
    const t = convexTest(schema);
    const { owner, contactA, contactB, templateId } = await seedTenant(t);
    const campaignsApi = (api as any).campaigns;

    const listId = await owner.mutation(campaignsApi.createContactList, {
      name: "Promo Premium",
    });
    await owner.mutation(campaignsApi.addContactToList, { listId, contactId: contactA });
    await owner.mutation(campaignsApi.addContactToList, { listId, contactId: contactB });
    const campaignId = await owner.mutation(campaignsApi.createDraftCampaign, {
      name: "Lançamento Premium",
      listId,
      templateId,
    });

    const launch = await owner.mutation(campaignsApi.launchCampaign, { campaignId });

    expect(launch.queued).toBe(1);
    expect(launch.skippedConsent).toBe(1);
    const detail = await owner.query(campaignsApi.getCampaign, { campaignId });
    expect(detail.status).toBe("running");
    expect(detail.stats.queued).toBe(1);
    expect(detail.stats.skipped).toBe(1);
    expect(detail.recipients.find((r: { contactId: string }) => r.contactId === contactA)?.status).toBe("queued");
    expect(detail.recipients.find((r: { contactId: string }) => r.contactId === contactB)?.status).toBe("skipped");

    const messages = await t.run(async (ctx) => {
      return await ctx.db.query("messages").collect();
    });
    expect(messages).toHaveLength(1);
    expect(messages[0].sentByCampaignId).toBe(campaignId);
    expect(messages[0].status).toBe("queued");
  });

  it("launches one manual batch and queues the next pending batch on demand", async () => {
    const t = convexTest(schema);
    const { owner, contactA, contactB, templateId } = await seedTenant(t);
    const campaignsApi = (api as any).campaigns;

    await t.run(async (ctx) => {
      const contact = await ctx.db.get(contactB);
      if (!contact) throw new Error("missing contact");
      const consentEventId = await ctx.db.insert("consentEvents", {
        tenantId: contact.tenantId,
        contactId: contactB,
        purpose: "marketing",
        channel: "whatsapp",
        newStatus: "granted",
        source: "test",
        capturedAt: Date.now(),
      });
      await ctx.db.insert("currentConsents", {
        tenantId: contact.tenantId,
        contactId: contactB,
        purpose: "marketing",
        channel: "whatsapp",
        status: "granted",
        effectiveAt: Date.now(),
        lastEventId: consentEventId,
      });
    });

    const listId = await owner.mutation(campaignsApi.createContactList, {
      name: "Manual Batch",
    });
    await owner.mutation(campaignsApi.addContactToList, { listId, contactId: contactA });
    await owner.mutation(campaignsApi.addContactToList, { listId, contactId: contactB });
    const campaignId = await owner.mutation(campaignsApi.createDraftCampaign, {
      name: "Send In Chunks",
      listId,
      templateId,
    });

    const launch = await owner.mutation(campaignsApi.launchCampaign, {
      campaignId,
      batchSize: 1,
    });

    expect(launch).toMatchObject({
      queued: 1,
      skippedConsent: 0,
      skippedUnsuitable: 0,
    });
    const afterLaunch = await owner.query(campaignsApi.getCampaign, {
      campaignId,
    });
    expect(afterLaunch.stats.queued).toBe(1);
    expect(afterLaunch.stats.pending).toBe(1);
    expect(await t.run(async (ctx) => (await ctx.db.query("messages").collect()).length)).toBe(1);

    const next = await owner.mutation(campaignsApi.sendNextBatch, {
      campaignId,
      batchSize: 1,
    });

    expect(next).toMatchObject({
      queued: 1,
      skippedConsent: 0,
      skippedUnsuitable: 0,
      pendingRemaining: 0,
    });
    const afterNext = await owner.query(campaignsApi.getCampaign, {
      campaignId,
    });
    expect(afterNext.stats.queued).toBe(2);
    expect(afterNext.stats.pending).toBe(0);
    expect(await t.run(async (ctx) => (await ctx.db.query("messages").collect()).length)).toBe(2);
  });

  it("syncs campaign recipient status from the outbound message lifecycle", async () => {
    const t = convexTest(schema);
    const { owner, contactA, templateId } = await seedTenant(t);
    const campaignsApi = (api as any).campaigns;

    const listId = await owner.mutation(campaignsApi.createContactList, {
      name: "Status Sync",
    });
    await owner.mutation(campaignsApi.addContactToList, { listId, contactId: contactA });
    const campaignId = await owner.mutation(campaignsApi.createDraftCampaign, {
      name: "Sync Lifecycle",
      listId,
      templateId,
    });
    await owner.mutation(campaignsApi.launchCampaign, { campaignId });
    const [message] = await t.run(async (ctx) => await ctx.db.query("messages").collect());

    await t.mutation(internal.messages._markSentFromAction, {
      messageId: message._id,
      metaMessageId: "wamid.TEST",
    });

    const afterSent = await owner.query(campaignsApi.getCampaign, { campaignId });
    expect(afterSent.stats.sent).toBe(1);

    await t.mutation(internal.messages.markStatusFromWebhook, {
      metaMessageId: "wamid.TEST",
      newStatus: "read",
    });

    const afterRead = await owner.query(campaignsApi.getCampaign, { campaignId });
    expect(afterRead.stats.read).toBe(1);
  });

  it("marks campaign replies and button clicks from inbound engagement", async () => {
    const t = convexTest(schema);
    const { owner, contactA, templateId } = await seedTenant(t);
    const campaignsApi = (api as any).campaigns;

    const listId = await owner.mutation(campaignsApi.createContactList, {
      name: "Engagement Sync",
    });
    await owner.mutation(campaignsApi.addContactToList, { listId, contactId: contactA });
    const campaignId = await owner.mutation(campaignsApi.createDraftCampaign, {
      name: "Clicks Matter",
      listId,
      templateId,
    });
    await owner.mutation(campaignsApi.launchCampaign, { campaignId });

    const reply = await t.mutation((internal as any).campaigns._markInboundEngagement, {
      tenantId: (await t.run(async (ctx) => (await ctx.db.get(contactA))!.tenantId)),
      contactId: contactA,
      receivedAt: Date.now(),
    });
    expect(reply).toBe("marked_replied");
    const afterReply = await owner.query(campaignsApi.getCampaign, { campaignId });
    expect(afterReply.stats.replied).toBe(1);

    const click = await t.mutation((internal as any).campaigns._markInboundEngagement, {
      tenantId: (await t.run(async (ctx) => (await ctx.db.get(contactA))!.tenantId)),
      contactId: contactA,
      receivedAt: Date.now(),
      buttonPayload: "STOP_MARKETING",
    });
    expect(click).toBe("marked_clicked");
    const afterClick = await owner.query(campaignsApi.getCampaign, { campaignId });
    expect(afterClick.stats.clicked).toBe(1);
    expect(afterClick.recipients[0].status).toBe("clicked");
  });

  it("pauses a running campaign when failure rate crosses the safety threshold", async () => {
    const t = convexTest(schema);
    const { owner, contactA, templateId } = await seedTenant(t);
    const campaignsApi = (api as any).campaigns;

    const listId = await owner.mutation(campaignsApi.createContactList, {
      name: "Safety Pause",
    });
    await owner.mutation(campaignsApi.addContactToList, { listId, contactId: contactA });
    const campaignId = await owner.mutation(campaignsApi.createDraftCampaign, {
      name: "Failure Watch",
      listId,
      templateId,
    });
    await owner.mutation(campaignsApi.launchCampaign, { campaignId });
    const [message] = await t.run(async (ctx) => await ctx.db.query("messages").collect());

    await t.mutation(internal.messages._markFailedFromAction, {
      messageId: message._id,
      failureReason: "Meta 131049: too many marketing messages",
      failureCode: "131049",
    });
    await t.mutation(internal.campaigns._evaluateSafetyPause, {
      campaignId,
      threshold: 0.2,
      minFailed: 1,
    });

    const detail = await owner.query(campaignsApi.getCampaign, { campaignId });
    expect(detail.status).toBe("paused");
    expect(detail.pauseReason).toContain("failure rate");
    expect(detail.failureBreakdown).toEqual([
      expect.objectContaining({
        category: "recipient_over_marketed",
        count: 1,
        retrySafe: false,
      }),
    ]);
    expect(detail.failureBreakdown[0].action).toContain("Suppress");

    const failedExport = await owner.query(campaignsApi.exportFailedContacts, {
      campaignId,
    });
    expect(failedExport).toEqual([
      expect.objectContaining({
        displayName: "Ana",
        phone: "+258840000001",
        failureCode: "131049",
        metaErrorCategory: "recipient_over_marketed",
      }),
    ]);
  });

  it("opens a phone circuit breaker and pauses the campaign on Meta quality or pacing failures", async () => {
    const t = convexTest(schema);
    const { owner, contactA, templateId } = await seedTenant(t);
    const campaignsApi = (api as any).campaigns;

    const listId = await owner.mutation(campaignsApi.createContactList, {
      name: "Quality Watch",
    });
    await owner.mutation(campaignsApi.addContactToList, { listId, contactId: contactA });
    const campaignId = await owner.mutation(campaignsApi.createDraftCampaign, {
      name: "Pacing Protection",
      listId,
      templateId,
    });
    await owner.mutation(campaignsApi.launchCampaign, { campaignId });
    const [message] = await t.run(async (ctx) => await ctx.db.query("messages").collect());

    const breaker = await t.mutation(
      internal.whatsappAccounts.openCircuitBreakerForMessageFailure,
      {
        messageId: message._id,
        failureCode: "131048",
        failureReason: "Rate limit hit due to phone-number quality",
      },
    );

    const detail = await owner.query(campaignsApi.getCampaign, { campaignId });
    const phone = await t.run(async (ctx) => {
      const conversation = await ctx.db.get(message.conversationId);
      return conversation ? await ctx.db.get(conversation.phoneNumberId) : null;
    });

    expect(breaker.opened).toBe(true);
    expect(phone?.circuitBreakerUntil).toBeGreaterThan(Date.now());
    expect(phone?.circuitBreakerReason).toContain("Rate limit");
    expect(detail.status).toBe("paused");
    expect(detail.pauseReason).toContain("quality or pacing");
  });

  it("requeues only retry-safe failed recipients with a new message", async () => {
    const t = convexTest(schema);
    const { owner, contactA, templateId } = await seedTenant(t);
    const campaignsApi = (api as any).campaigns;

    const listId = await owner.mutation(campaignsApi.createContactList, {
      name: "Safe Retry",
    });
    await owner.mutation(campaignsApi.addContactToList, { listId, contactId: contactA });
    const campaignId = await owner.mutation(campaignsApi.createDraftCampaign, {
      name: "Retry Network",
      listId,
      templateId,
    });
    await owner.mutation(campaignsApi.launchCampaign, { campaignId });
    const [message] = await t.run(async (ctx) => await ctx.db.query("messages").collect());

    await t.mutation(internal.messages._markFailedFromAction, {
      messageId: message._id,
      failureReason: "Meta gateway timeout",
    });

    const retry = await owner.mutation(campaignsApi.retrySafeFailures, {
      campaignId,
    });
    const detail = await owner.query(campaignsApi.getCampaign, { campaignId });
    const messages = await t.run(async (ctx) => await ctx.db.query("messages").collect());

    expect(retry).toEqual({ retried: 1, skippedUnsafe: 0, skippedConsent: 0 });
    expect(messages).toHaveLength(2);
    expect(detail.stats.queued).toBe(1);
    expect(detail.failureBreakdown).toHaveLength(0);
  });

  it("does not retry Meta policy or marketing-limit failures", async () => {
    const t = convexTest(schema);
    const { owner, contactA, templateId } = await seedTenant(t);
    const campaignsApi = (api as any).campaigns;

    const listId = await owner.mutation(campaignsApi.createContactList, {
      name: "Unsafe Retry",
    });
    await owner.mutation(campaignsApi.addContactToList, { listId, contactId: contactA });
    const campaignId = await owner.mutation(campaignsApi.createDraftCampaign, {
      name: "Retry Marketing Limit",
      listId,
      templateId,
    });
    await owner.mutation(campaignsApi.launchCampaign, { campaignId });
    const [message] = await t.run(async (ctx) => await ctx.db.query("messages").collect());

    await t.mutation(internal.messages._markFailedFromAction, {
      messageId: message._id,
      failureReason: "Too many marketing messages",
      failureCode: "131049",
    });

    const retry = await owner.mutation(campaignsApi.retrySafeFailures, {
      campaignId,
    });
    const messages = await t.run(async (ctx) => await ctx.db.query("messages").collect());

    expect(retry).toEqual({ retried: 0, skippedUnsafe: 1, skippedConsent: 0 });
    expect(messages).toHaveLength(1);
  });

  it("imports CSV-style rows directly into a reusable campaign contact list", async () => {
    const t = convexTest(schema);
    const { owner } = await seedTenant(t);
    const campaignsApi = (api as any).campaigns;

    const listId = await owner.mutation(campaignsApi.createContactList, {
      name: "CSV Folder",
    });
    const result = await owner.mutation(campaignsApi.importContactsToList, {
      listId,
      rows: [
        {
          phone: "+258840001111",
          name: "Carla",
          marketingConsentProofText: "Opt-in web form",
        },
        {
          phone: "+258840002222",
          name: "Dina",
        },
        {
          phone: "not-a-phone",
          name: "Bad Row",
        },
      ],
      fileName: "promo.csv",
    });

    expect(result.created).toBe(2);
    expect(result.addedToList).toBe(2);
    expect(result.consentsRecorded).toBe(1);
    expect(result.skipped).toEqual([{ phone: "not-a-phone", reason: "invalid_e164" }]);

    const lists = await owner.query(campaignsApi.listContactLists, {});
    expect(lists[0].memberCount).toBe(2);
  });

  it("creates reusable contact lists from campaign result segments", async () => {
    const t = convexTest(schema);
    const { owner, contactA, templateId } = await seedTenant(t);
    const campaignsApi = (api as any).campaigns;

    const listId = await owner.mutation(campaignsApi.createContactList, {
      name: "Source Segment",
    });
    await owner.mutation(campaignsApi.addContactToList, { listId, contactId: contactA });
    const campaignId = await owner.mutation(campaignsApi.createDraftCampaign, {
      name: "Segment Seed",
      listId,
      templateId,
    });
    await owner.mutation(campaignsApi.launchCampaign, { campaignId });
    const [message] = await t.run(async (ctx) => await ctx.db.query("messages").collect());

    await t.mutation(internal.messages._markFailedFromAction, {
      messageId: message._id,
      failureReason: "Gateway timeout",
    });

    const segment = await owner.mutation(campaignsApi.createListFromSegment, {
      name: "Failed Followup",
      source: "campaign_failed",
    });
    const lists = await owner.query(campaignsApi.listContactLists, {});

    expect(segment.added).toBe(1);
    expect(lists.find((list: { name: string }) => list.name === "Failed Followup")?.memberCount).toBe(1);
  });
});
