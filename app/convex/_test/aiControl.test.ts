import { convexTest } from "convex-test";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

async function seedAiControl(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: "AI Operator" });
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
      role: "agent",
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
      createdAt: Date.now(),
    });
    const phoneNumberId = await ctx.db.insert("phoneNumbers", {
      tenantId,
      whatsappAccountId,
      phoneNumberId: "PHONE_AI",
      e164: "+258840000000",
      displayName: "OpenBSP Clinic",
      createdAt: Date.now(),
    });
    const contactId = await ctx.db.insert("contacts", {
      tenantId,
      e164: "+258840000001",
      name: "Ana",
      tags: [],
      createdAt: Date.now(),
    });
    const eventId = await ctx.db.insert("consentEvents", {
      tenantId,
      contactId,
      purpose: "transactional",
      channel: "whatsapp",
      newStatus: "granted",
      source: "inbound_24h",
      capturedAt: Date.now(),
    });
    await ctx.db.insert("currentConsents", {
      tenantId,
      contactId,
      purpose: "transactional",
      channel: "whatsapp",
      status: "granted",
      effectiveAt: Date.now(),
      lastEventId: eventId,
    });
    return { userId, tenantId, memberId, phoneNumberId, contactId };
  });
}

async function makeConversation(
  t: ReturnType<typeof convexTest>,
  args: {
    tenantId: Id<"tenants">;
    phoneNumberId: Id<"phoneNumbers">;
    contactId: Id<"contacts">;
    leadSource?: "ctwa" | "organic" | "campaign_reply" | "unknown";
    aiState?: "eligible" | "paused" | "disabled";
    aiPausedReason?: string;
    opportunityStatus?:
      | "new"
      | "contacted"
      | "replied"
      | "opportunity"
      | "booked"
      | "lost";
  },
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("conversations", {
      tenantId: args.tenantId,
      phoneNumberId: args.phoneNumberId,
      contactId: args.contactId,
      status: "open",
      lastMessageAt: now,
      lastIncomingAt: now,
      serviceWindowExpiresAt: now + 60 * 60 * 1000,
      unreadCount: 0,
      tags: [],
      leadSource: args.leadSource,
      aiState: args.aiState,
      aiPausedReason: args.aiPausedReason,
      opportunityStatus: args.opportunityStatus,
      lastCtwaClickAt: args.leadSource === "ctwa" ? now : undefined,
    });
  });
}

describe("AI control plane", () => {
  it("does not let an agent make AI eligible on organic conversations", async () => {
    const t = convexTest(schema);
    const seeded = await seedAiControl(t);
    const conversationId = await makeConversation(t, {
      ...seeded,
      leadSource: "organic",
      opportunityStatus: "replied",
    });
    const asUser = t.withIdentity({ subject: seeded.userId });

    await expect(
      asUser.mutation(api.conversations.setAiState, {
        conversationId,
        state: "eligible",
        reason: "manual_test",
      }),
    ).rejects.toThrow(/AI_NOT_CTWA_LEAD/);
  });

  it("pauses and audits AI when a CTWA lead becomes an opportunity", async () => {
    const t = convexTest(schema);
    const seeded = await seedAiControl(t);
    const conversationId = await makeConversation(t, {
      ...seeded,
      leadSource: "ctwa",
      aiState: "eligible",
      opportunityStatus: "replied",
    });
    const asUser = t.withIdentity({ subject: seeded.userId });

    await asUser.mutation(api.conversations.setOpportunityStatus, {
      conversationId,
      status: "opportunity",
    });

    const { conversation, auditEvents } = await t.run(async (ctx) => ({
      conversation: await ctx.db.get(conversationId),
      auditEvents: await ctx.db
        .query("aiAuditEvents")
        .withIndex("by_conversation", (q) =>
          q.eq("conversationId", conversationId),
        )
        .collect(),
    }));

    expect(conversation?.aiState).toBe("paused");
    expect(conversation?.aiPausedReason).toBe("opportunity");
    expect(auditEvents).toContainEqual(
      expect.objectContaining({
        kind: "paused",
        reason: "opportunity",
        createdBy: seeded.memberId,
      }),
    );
  });

  it("audits human takeover when an agent replies in an AI-eligible CTWA chat", async () => {
    const t = convexTest(schema);
    const seeded = await seedAiControl(t);
    const conversationId = await makeConversation(t, {
      ...seeded,
      leadSource: "ctwa",
      aiState: "eligible",
      opportunityStatus: "new",
    });
    const asUser = t.withIdentity({ subject: seeded.userId });

    await asUser.mutation(api.messages.sendText, {
      conversationId,
      text: "Ola, sou o Miguel. Vou acompanhar por aqui.",
      clientNonce: "human-handoff",
    });

    const { conversation, auditEvents } = await t.run(async (ctx) => ({
      conversation: await ctx.db.get(conversationId),
      auditEvents: await ctx.db
        .query("aiAuditEvents")
        .withIndex("by_conversation", (q) =>
          q.eq("conversationId", conversationId),
        )
        .collect(),
    }));

    expect(conversation?.aiState).toBe("paused");
    expect(conversation?.aiPausedReason).toBe("human_reply");
    expect(auditEvents).toContainEqual(
      expect.objectContaining({
        kind: "paused",
        reason: "human_reply",
        createdBy: seeded.memberId,
      }),
    );
  });

  it("new CTWA click resets a paused lead and records the reset", async () => {
    const t = convexTest(schema);
    const seeded = await seedAiControl(t);
    const conversationId = await makeConversation(t, {
      ...seeded,
      leadSource: "ctwa",
      aiState: "paused",
      aiPausedReason: "human_reply",
      opportunityStatus: "booked",
    });

    await t.mutation(internal.webhooks.recordCtwaReferral, {
      tenantId: seeded.tenantId,
      conversationId,
      contactId: seeded.contactId,
      phoneNumberId: seeded.phoneNumberId,
      metaMessageId: "wamid.NEW.CTWA",
      clickedAt: 1700000000 * 1000,
      referral: {
        sourceType: "ad",
        sourceId: "ad-fresh",
        headline: "Nova campanha",
      },
    });

    const { conversation, auditEvents } = await t.run(async (ctx) => ({
      conversation: await ctx.db.get(conversationId),
      auditEvents: await ctx.db
        .query("aiAuditEvents")
        .withIndex("by_conversation", (q) =>
          q.eq("conversationId", conversationId),
        )
        .collect(),
    }));

    expect(conversation?.leadSource).toBe("ctwa");
    expect(conversation?.opportunityStatus).toBe("new");
    expect(conversation?.aiState).toBe("eligible");
    expect(conversation?.aiPausedReason).toBeUndefined();
    expect(auditEvents).toContainEqual(
      expect.objectContaining({
        kind: "eligible",
        reason: "new_ctwa_click",
      }),
    );
  });
});
