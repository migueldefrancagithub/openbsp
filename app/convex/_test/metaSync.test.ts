import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { parseMetaPayload } from "../lib/meta/parsePayload";

type Seeded = {
  userId: Id<"users">;
  tenantId: Id<"tenants">;
  memberId: Id<"members">;
  whatsappAccountId: Id<"whatsappAccounts">;
  phoneNumberId: Id<"phoneNumbers">;
};

async function seedAccount(t: ReturnType<typeof convexTest>): Promise<Seeded> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { name: "Sync Owner" });
    const tenantId = await ctx.db.insert("tenants", {
      name: "Sync Clinic",
      vertical: "clinic",
      plan: "growth",
      settings: {
        defaultLocale: "pt-PT",
        timezone: "Europe/Lisbon",
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
      wabaId: "WABA_SYNC",
      accessToken: "test-token",
      status: "active",
      tokenStatus: "ok",
      createdAt: now,
    });
    const phoneNumberId = await ctx.db.insert("phoneNumbers", {
      tenantId,
      whatsappAccountId,
      phoneNumberId: "PHONE_SYNC",
      e164: "+351910000001",
      displayName: "Sync Clinic",
      createdAt: now,
    });
    return { userId, tenantId, memberId, whatsappAccountId, phoneNumberId };
  });
}

function wabaLevelPayload(field: string, value: Record<string, unknown>) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_SYNC",
        time: 1_700_000_000,
        changes: [{ field, value }],
      },
    ],
  };
}

describe("parsePayload: WABA-level sync fields", () => {
  it("parses message_template_status_update", () => {
    const items = parseMetaPayload(
      wabaLevelPayload("message_template_status_update", {
        event: "REJECTED",
        message_template_id: "1407680676",
        message_template_name: "promo_oferta",
        message_template_language: "pt_PT",
        reason: "PROMOTIONAL",
      }),
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "template_status_update",
      wabaId: "WABA_SYNC",
      event: "REJECTED",
      metaTemplateId: "1407680676",
      name: "promo_oferta",
      language: "pt_PT",
      reason: "PROMOTIONAL",
    });
    // Same payload re-parse → same eventKey (idempotent dedupe).
    const again = parseMetaPayload(
      wabaLevelPayload("message_template_status_update", {
        event: "REJECTED",
        message_template_id: "1407680676",
        message_template_name: "promo_oferta",
        message_template_language: "pt_PT",
        reason: "PROMOTIONAL",
      }),
    );
    expect(again[0].eventKey).toBe(items[0].eventKey);
  });

  it("parses phone_number_quality_update and account_update", () => {
    const quality = parseMetaPayload(
      wabaLevelPayload("phone_number_quality_update", {
        display_phone_number: "351910000001",
        event: "FLAGGED",
        current_limit: "TIER_1K",
        old_limit: "TIER_10K",
      }),
    );
    expect(quality[0]).toMatchObject({
      kind: "phone_quality_update",
      displayPhoneNumber: "351910000001",
      event: "FLAGGED",
      currentLimit: "TIER_1K",
    });

    const account = parseMetaPayload(
      wabaLevelPayload("account_update", {
        event: "DISABLED_UPDATE",
        ban_info: { waba_ban_state: "DISABLE", waba_ban_date: "June 11, 2026" },
      }),
    );
    expect(account[0]).toMatchObject({
      kind: "account_update",
      event: "DISABLED_UPDATE",
      banState: "DISABLE",
    });
  });

  it("parses coexistence disconnection_info from account_update", () => {
    const account = parseMetaPayload(
      wabaLevelPayload("account_update", {
        event: "PARTNER_REMOVED",
        disconnection_info: {
          reason: "USER_RE_REGISTERED",
          initiated_by: "USER",
        },
      }),
    );
    expect(account[0]).toMatchObject({
      kind: "account_update",
      event: "PARTNER_REMOVED",
      disconnectionInfo: {
        reason: "USER_RE_REGISTERED",
        initiatedBy: "USER",
      },
    });
  });
});

describe("webhook handlers: template / quality / account", () => {
  it("listForTenant exposes channel health fields for the operator console", async () => {
    const t = convexTest(schema);
    const seeded = await seedAccount(t);
    const now = Date.now();

    await t.run(async (ctx) => {
      await ctx.db.patch(seeded.whatsappAccountId, {
        businessPortfolioId: "PORTFOLIO_1",
        onboardingSource: "embedded_signup",
        status: "disconnected",
        tokenStatus: "expiring",
        tokenHealthDetail: "expires soon",
        lastTokenHealthCheckAt: now - 1_000,
        dataAccessExpiresAt: now + 10_000,
        validatedScopes: ["whatsapp_business_messaging"],
        lastDisconnectionReason: "USER_RE_REGISTERED",
        lastDisconnectionInitiatedBy: "USER",
        lastDisconnectedAt: now - 2_000,
      });
      await ctx.db.patch(seeded.phoneNumberId, {
        verifiedName: "Sync Clinic Verified",
        messagingTier: "TIER_1K",
        throughputLevel: "STANDARD",
        lastQualityEvent: "FLAGGED",
        lastQualityEventAt: now - 3_000,
        lastMetaSyncAt: now - 4_000,
        qualityRating: "yellow",
        qualityLastErrorCode: "131048",
        circuitBreakerUntil: now + 60_000,
        circuitBreakerReason: "Meta pacing limit",
        businessUsername: "syncclinic",
        businessUsernameStatus: "APPROVED",
        businessUsernameUpdatedAt: now - 5_000,
      });
    });

    const owner = t.withIdentity({ subject: seeded.userId });
    const rows = await owner.query(api.whatsappAccounts.listForTenant, {});

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      businessPortfolioId: "PORTFOLIO_1",
      onboardingSource: "embedded_signup",
      tokenStatus: "expiring",
      tokenHealthDetail: "expires soon",
      lastDisconnectionReason: "USER_RE_REGISTERED",
      lastDisconnectionInitiatedBy: "USER",
      coexRecovery: {
        state: "needs_reconnect",
        tone: "bad",
        blocking: true,
        title: "COEX partner connection lost",
      },
    });
    expect(rows[0].coexRecovery.operatorSteps.join(" ")).toContain(
      "Embedded Signup",
    );
    expect(rows[0].coexRecovery.customerSteps.join(" ")).toContain(
      "WhatsApp Business",
    );
    expect(rows[0].coexRecovery.evidence).toContain(
      "Disconnect reason: USER_RE_REGISTERED",
    );
    expect(rows[0].phoneNumbers[0]).toMatchObject({
      verifiedName: "Sync Clinic Verified",
      messagingTier: "TIER_1K",
      throughputLevel: "STANDARD",
      lastQualityEvent: "FLAGGED",
      qualityRating: "yellow",
      qualityLastErrorCode: "131048",
      circuitBreakerReason: "Meta pacing limit",
      businessUsername: "syncclinic",
      businessUsernameStatus: "APPROVED",
    });
  });

  it("refresh health target rejects cross-tenant phone ids", async () => {
    const t = convexTest(schema);
    const seeded = await seedAccount(t);
    const other = await t.run(async (ctx) => {
      const now = Date.now();
      const tenantId = await ctx.db.insert("tenants", {
        name: "Other Clinic",
        vertical: "clinic",
        plan: "growth",
        settings: {
          defaultLocale: "pt-PT",
          timezone: "Europe/Lisbon",
          retentionDays: 730,
        },
        createdAt: now,
      });
      const whatsappAccountId = await ctx.db.insert("whatsappAccounts", {
        tenantId,
        metaAppId: "META_APP",
        wabaId: "WABA_OTHER",
        accessToken: "test-token",
        status: "active",
        tokenStatus: "ok",
        createdAt: now,
      });
      const phoneNumberId = await ctx.db.insert("phoneNumbers", {
        tenantId,
        whatsappAccountId,
        phoneNumberId: "PHONE_OTHER",
        e164: "+351910000009",
        displayName: "Other Clinic",
        createdAt: now,
      });
      return { phoneNumberId };
    });

    const valid = await t.query(
      internal.whatsappAccounts._getRefreshChannelHealthTarget,
      {
        tenantId: seeded.tenantId,
        whatsappAccountId: seeded.whatsappAccountId,
        phoneNumberId: seeded.phoneNumberId,
      },
    );
    expect(valid?.phoneNumberIds).toEqual([seeded.phoneNumberId]);

    const crossTenant = await t.query(
      internal.whatsappAccounts._getRefreshChannelHealthTarget,
      {
        tenantId: seeded.tenantId,
        whatsappAccountId: seeded.whatsappAccountId,
        phoneNumberId: other.phoneNumberId,
      },
    );
    expect(crossTenant).toBeNull();
  });

  it("template REJECTED maps status, stores reason and pauses running campaigns", async () => {
    const t = convexTest(schema);
    const seeded = await seedAccount(t);
    const { templateId, campaignId } = await t.run(async (ctx) => {
      const now = Date.now();
      const templateId = await ctx.db.insert("templates", {
        tenantId: seeded.tenantId,
        whatsappAccountId: seeded.whatsappAccountId,
        name: "promo_oferta",
        language: "pt_PT",
        category: "marketing",
        currentVersion: 1,
        status: "approved",
        metaTemplateId: "TPL_META_1",
        createdAt: now,
        createdBy: seeded.memberId,
      });
      await ctx.db.insert("templateVersions", {
        templateId,
        tenantId: seeded.tenantId,
        version: 1,
        bodyText: "Olá {{1}}",
        parameterSchema: [{ index: 1, name: "param1", example: "Maria" }],
        isLocked: true,
        createdBy: seeded.memberId,
        createdAt: now,
      });
      const campaignId = await ctx.db.insert("campaigns", {
        tenantId: seeded.tenantId,
        name: "Recall Junho",
        templateId,
        templateVersion: 1,
        status: "running",
        createdAt: now,
      });
      return { templateId, campaignId };
    });

    await t.mutation(internal.templates.applyMetaStatusUpdate, {
      wabaId: "WABA_SYNC",
      metaTemplateId: "TPL_META_1",
      name: "promo_oferta",
      language: "pt_PT",
      event: "REJECTED",
      reason: "PROMOTIONAL",
      updatedAt: Date.now(),
    });

    const rows = await t.run(async (ctx) => ({
      template: await ctx.db.get(templateId),
      campaign: await ctx.db.get(campaignId),
      events: await ctx.db.query("campaignEvents").collect(),
    }));
    expect(rows.template?.status).toBe("rejected");
    expect(rows.template?.rejectionReason).toBe("PROMOTIONAL");
    expect(rows.campaign?.status).toBe("paused");
    expect(rows.campaign?.pauseReason).toBe("template_status:REJECTED");
    expect(
      rows.events.some(
        (e) => e.type === "campaign.auto_paused.template_status",
      ),
    ).toBe(true);
  });

  it("quality FLAGGED opens the circuit breaker; UNFLAGGED clears it", async () => {
    const t = convexTest(schema);
    const seeded = await seedAccount(t);

    await t.mutation(internal.whatsappAccounts.applyPhoneQualityUpdate, {
      wabaId: "WABA_SYNC",
      displayPhoneNumber: "351910000001",
      event: "FLAGGED",
      currentLimit: "TIER_1K",
      updatedAt: Date.now(),
    });
    let phone = await t.run(async (ctx) => ctx.db.get(seeded.phoneNumberId));
    expect(phone?.qualityRating).toBe("red");
    expect(phone?.circuitBreakerUntil).toBeGreaterThan(Date.now());
    expect(phone?.messagingTier).toBe("TIER_1K");

    await t.mutation(internal.whatsappAccounts.applyPhoneQualityUpdate, {
      wabaId: "WABA_SYNC",
      displayPhoneNumber: "351910000001",
      event: "UNFLAGGED",
      currentLimit: "TIER_10K",
      updatedAt: Date.now(),
    });
    phone = await t.run(async (ctx) => ctx.db.get(seeded.phoneNumberId));
    expect(phone?.qualityRating).toBe("green");
    expect(phone?.circuitBreakerUntil).toBeUndefined();
    expect(phone?.messagingTier).toBe("TIER_10K");
  });

  it("account DISABLE revokes the account and the dispatch gate blocks sends", async () => {
    const t = convexTest(schema);
    const seeded = await seedAccount(t);
    const messageId = await t.run(async (ctx) => {
      const now = Date.now();
      const contactId = await ctx.db.insert("contacts", {
        tenantId: seeded.tenantId,
        e164: "+351912345678",
        tags: [],
        createdAt: now,
      });
      const conversationId = await ctx.db.insert("conversations", {
        tenantId: seeded.tenantId,
        phoneNumberId: seeded.phoneNumberId,
        contactId,
        status: "open",
        lastMessageAt: now,
        unreadCount: 0,
        tags: [],
      });
      return await ctx.db.insert("messages", {
        tenantId: seeded.tenantId,
        conversationId,
        direction: "outgoing",
        businessKey: "gate-test-1",
        type: "text",
        content: { text: { body: "olá" } },
        status: "queued",
        dispatchAttempts: 0,
        createdAt: now,
      });
    });

    await t.mutation(internal.whatsappAccounts.applyAccountUpdate, {
      wabaId: "WABA_SYNC",
      event: "DISABLED_UPDATE",
      banState: "DISABLE",
      updatedAt: Date.now(),
    });

    const account = await t.run(async (ctx) =>
      ctx.db.get(seeded.whatsappAccountId),
    );
    expect(account?.status).toBe("revoked");

    const claim = await t.mutation(internal.messages._claimForDispatch, {
      messageId,
    });
    expect(claim).toBeNull();
    const message = await t.run(async (ctx) => ctx.db.get(messageId));
    expect(message?.status).toBe("failed");
    expect(message?.failureReason).toBe("waba_not_active");
  });

  it("account REINSTATE returns the account to active", async () => {
    const t = convexTest(schema);
    const seeded = await seedAccount(t);
    await t.mutation(internal.whatsappAccounts.applyAccountUpdate, {
      wabaId: "WABA_SYNC",
      event: "DISABLED_UPDATE",
      banState: "DISABLE",
      updatedAt: Date.now(),
    });
    await t.mutation(internal.whatsappAccounts.applyAccountUpdate, {
      wabaId: "WABA_SYNC",
      event: "DISABLED_UPDATE",
      banState: "REINSTATE",
      updatedAt: Date.now(),
    });
    const account = await t.run(async (ctx) =>
      ctx.db.get(seeded.whatsappAccountId),
    );
    expect(account?.status).toBe("active");
  });

  it("PARTNER_REMOVED disconnects coexistence and ACCOUNT_RECONNECTED clears the breaker", async () => {
    const t = convexTest(schema);
    const seeded = await seedAccount(t);
    const disconnectedAt = Date.now();

    await t.mutation(internal.whatsappAccounts.applyAccountUpdate, {
      wabaId: "WABA_SYNC",
      event: "PARTNER_REMOVED",
      disconnectionInfo: {
        reason: "USER_RE_REGISTERED",
        initiatedBy: "USER",
      },
      updatedAt: disconnectedAt,
    });

    let rows = await t.run(async (ctx) => ({
      account: await ctx.db.get(seeded.whatsappAccountId),
      phone: await ctx.db.get(seeded.phoneNumberId),
    }));
    expect(rows.account?.status).toBe("disconnected");
    expect(rows.account?.lastDisconnectionReason).toBe("USER_RE_REGISTERED");
    expect(rows.account?.lastDisconnectionInitiatedBy).toBe("USER");
    expect(rows.account?.lastDisconnectedAt).toBe(disconnectedAt);
    expect(rows.phone?.circuitBreakerUntil).toBeGreaterThan(Date.now());
    expect(rows.phone?.circuitBreakerReason).toContain("USER_RE_REGISTERED");

    const reconnectedAt = disconnectedAt + 60_000;
    await t.mutation(internal.whatsappAccounts.applyAccountUpdate, {
      wabaId: "WABA_SYNC",
      event: "ACCOUNT_RECONNECTED",
      updatedAt: reconnectedAt,
    });

    rows = await t.run(async (ctx) => ({
      account: await ctx.db.get(seeded.whatsappAccountId),
      phone: await ctx.db.get(seeded.phoneNumberId),
    }));
    expect(rows.account?.status).toBe("active");
    expect(rows.account?.lastDisconnectionReason).toBeUndefined();
    expect(rows.account?.lastDisconnectionInitiatedBy).toBeUndefined();
    expect(rows.account?.lastReconnectedAt).toBe(reconnectedAt);
    expect(rows.phone?.circuitBreakerUntil).toBeUndefined();
    expect(rows.phone?.circuitBreakerReason).toBeUndefined();
  });
});
