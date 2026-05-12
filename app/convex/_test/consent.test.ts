import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { ConvexError } from "convex/values";
import schema from "../schema";
import {
  recordConsentTransition,
  requireConsent,
  cancelPendingForContact,
} from "../lib/consent";
import type { Id } from "../_generated/dataModel";

async function seedTenantAndContact(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const tenantId = await ctx.db.insert("tenants", {
      name: "Test Clinic",
      vertical: "clinic",
      healthcareMode: true,
      plan: "starter",
      settings: {
        defaultLocale: "pt-PT",
        timezone: "Europe/Lisbon",
        retentionDays: 730,
      },
      rgpd: {
        controllerName: "Test",
        controllerEmail: "test@example.pt",
      },
      createdAt: Date.now(),
    });
    const contactId = await ctx.db.insert("contacts", {
      tenantId,
      e164: "+351912345678",
      tags: [],
      createdAt: Date.now(),
    });
    return { tenantId, contactId };
  });
}

describe("consent vector", () => {
  it("requireConsent throws CONSENT_REQUIRED when no row exists", async () => {
    const t = convexTest(schema);
    const { tenantId, contactId } = await seedTenantAndContact(t);

    await expect(
      t.run(async (ctx) => {
        await requireConsent(ctx, {
          tenantId,
          contactId,
          purpose: "marketing",
        });
      }),
    ).rejects.toThrow(/CONSENT_REQUIRED/);
  });

  it("recordConsentTransition writes event + currentConsent atomically", async () => {
    const t = convexTest(schema);
    const { tenantId, contactId } = await seedTenantAndContact(t);

    const { eventId, currentId } = await t.run(async (ctx) =>
      recordConsentTransition(ctx, {
        tenantId,
        contactId,
        purpose: "marketing",
        newStatus: "granted",
        source: "form_web_v1",
        proofText: "Aceito receber promoções via WhatsApp",
        proofVersion: "v1",
      }),
    );

    expect(eventId).toBeTruthy();
    expect(currentId).toBeTruthy();

    // currentConsents has exactly one row for this purpose
    const current = await t.run(async (ctx) =>
      ctx.db
        .query("currentConsents")
        .withIndex("by_tenant_contact_purpose_channel", (q) =>
          q
            .eq("tenantId", tenantId)
            .eq("contactId", contactId)
            .eq("purpose", "marketing")
            .eq("channel", "whatsapp"),
        )
        .unique(),
    );
    expect(current?.status).toBe("granted");

    // requireConsent now passes
    await expect(
      t.run(async (ctx) =>
        requireConsent(ctx, { tenantId, contactId, purpose: "marketing" }),
      ),
    ).resolves.not.toThrow();
  });

  it("revoke flips currentConsents but consentEvents keeps both rows", async () => {
    const t = convexTest(schema);
    const { tenantId, contactId } = await seedTenantAndContact(t);

    await t.run(async (ctx) =>
      recordConsentTransition(ctx, {
        tenantId,
        contactId,
        purpose: "marketing",
        newStatus: "granted",
        source: "form_web_v1",
        proofText: "ok",
      }),
    );
    await t.run(async (ctx) =>
      recordConsentTransition(ctx, {
        tenantId,
        contactId,
        purpose: "marketing",
        newStatus: "revoked",
        source: "stop_keyword",
      }),
    );

    const current = await t.run(async (ctx) =>
      ctx.db
        .query("currentConsents")
        .withIndex("by_tenant_contact_purpose_channel", (q) =>
          q
            .eq("tenantId", tenantId)
            .eq("contactId", contactId)
            .eq("purpose", "marketing")
            .eq("channel", "whatsapp"),
        )
        .unique(),
    );
    expect(current?.status).toBe("revoked");

    const events = await t.run(async (ctx) =>
      ctx.db
        .query("consentEvents")
        .withIndex("by_tenant_contact", (q) =>
          q.eq("tenantId", tenantId).eq("contactId", contactId),
        )
        .collect(),
    );
    expect(events.length).toBe(2);

    await expect(
      t.run(async (ctx) =>
        requireConsent(ctx, { tenantId, contactId, purpose: "marketing" }),
      ),
    ).rejects.toThrow(/CONSENT_REQUIRED/);
  });

  it("transactional and marketing consents are independent", async () => {
    const t = convexTest(schema);
    const { tenantId, contactId } = await seedTenantAndContact(t);

    await t.run(async (ctx) =>
      recordConsentTransition(ctx, {
        tenantId,
        contactId,
        purpose: "transactional",
        newStatus: "granted",
        source: "inbound_24h",
      }),
    );

    // Marketing still required
    await expect(
      t.run(async (ctx) =>
        requireConsent(ctx, { tenantId, contactId, purpose: "marketing" }),
      ),
    ).rejects.toThrow(/CONSENT_REQUIRED/);

    // Transactional passes
    await expect(
      t.run(async (ctx) =>
        requireConsent(ctx, {
          tenantId,
          contactId,
          purpose: "transactional",
        }),
      ),
    ).resolves.not.toThrow();
  });

  it("cancelPendingForContact flips queued outbound to failed", async () => {
    const t = convexTest(schema);
    const { tenantId, contactId } = await seedTenantAndContact(t);

    // Need a phoneNumber + conversation + queued message
    const { messageId } = await t.run(async (ctx) => {
      const wabaAccountId = await ctx.db.insert("whatsappAccounts", {
        tenantId,
        metaAppId: "test-app",
        wabaId: "test-waba",
        status: "active",
        tokenStatus: "ok",
        createdAt: Date.now(),
      });
      const phoneNumberId = await ctx.db.insert("phoneNumbers", {
        tenantId,
        whatsappAccountId: wabaAccountId,
        phoneNumberId: "phone-1",
        e164: "+351912000000",
        displayName: "Test",
        createdAt: Date.now(),
      });
      const conversationId = await ctx.db.insert("conversations", {
        tenantId,
        phoneNumberId,
        contactId,
        status: "open",
        lastMessageAt: Date.now(),
        unreadCount: 0,
        tags: [],
      });
      const messageId = await ctx.db.insert("messages", {
        tenantId,
        conversationId,
        direction: "outgoing",
        businessKey: "test-bk-1",
        type: "text",
        content: { text: "hello" },
        status: "queued",
        dispatchAttempts: 0,
        createdAt: Date.now(),
      });
      return { messageId };
    });

    const result = await t.run(async (ctx) =>
      cancelPendingForContact(ctx, { tenantId, contactId }),
    );
    expect(result.messagesQueued).toBe(1);

    const msg = await t.run(async (ctx) => ctx.db.get(messageId));
    expect(msg?.status).toBe("failed");
    expect(msg?.failureReason).toBe("consent_revoked_pre_dispatch");
  });
});
