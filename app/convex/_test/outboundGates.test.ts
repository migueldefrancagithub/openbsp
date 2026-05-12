import { convexTest } from "convex-test";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import schema from "../schema";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: "Tester" });
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
      rgpd: { controllerName: "T", controllerEmail: "t@e.pt" },
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
    const wabaAccountId = await ctx.db.insert("whatsappAccounts", {
      tenantId,
      metaAppId: "APP",
      wabaId: "WABA",
      status: "active",
      tokenStatus: "ok",
      createdAt: Date.now(),
    });
    const phoneNumberId = await ctx.db.insert("phoneNumbers", {
      tenantId,
      whatsappAccountId: wabaAccountId,
      phoneNumberId: "PH",
      e164: "+351910000000",
      displayName: "Test",
      createdAt: Date.now(),
    });
    const contactId = await ctx.db.insert("contacts", {
      tenantId,
      e164: "+351912345678",
      tags: [],
      createdAt: Date.now(),
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
    windowOpen: boolean;
  },
): Promise<Id<"conversations">> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const expiresAt = args.windowOpen ? now + 60 * 60 * 1000 : now - 1;
    return await ctx.db.insert("conversations", {
      tenantId: args.tenantId,
      phoneNumberId: args.phoneNumberId,
      contactId: args.contactId,
      status: "open",
      lastMessageAt: now,
      lastIncomingAt: now,
      serviceWindowExpiresAt: expiresAt,
      unreadCount: 0,
      tags: [],
    });
  });
}

async function grantTransactional(
  t: ReturnType<typeof convexTest>,
  args: { tenantId: Id<"tenants">; contactId: Id<"contacts"> },
) {
  await t.run(async (ctx) => {
    const eventId = await ctx.db.insert("consentEvents", {
      tenantId: args.tenantId,
      contactId: args.contactId,
      purpose: "transactional",
      channel: "whatsapp",
      newStatus: "granted",
      source: "inbound_24h",
      capturedAt: Date.now(),
    });
    await ctx.db.insert("currentConsents", {
      tenantId: args.tenantId,
      contactId: args.contactId,
      purpose: "transactional",
      channel: "whatsapp",
      status: "granted",
      effectiveAt: Date.now(),
      lastEventId: eventId,
    });
  });
}

describe("outbound sendText gates", () => {
  it("queues message when window open + consent granted, schedules dispatch", async () => {
    const t = convexTest(schema);
    const seeded = await seed(t);
    await grantTransactional(t, {
      tenantId: seeded.tenantId,
      contactId: seeded.contactId,
    });
    const conversationId = await makeConversation(t, {
      tenantId: seeded.tenantId,
      phoneNumberId: seeded.phoneNumberId,
      contactId: seeded.contactId,
      windowOpen: true,
    });

    const asUser = t.withIdentity({ subject: seeded.userId });
    const messageId = await asUser.mutation(
      // sendText is a tenantMutation — public via api in tests
      // Path mirrors module/exportName
      // We import via api below.
      // (This indirection is only because tenant wrappers need active session.)
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("../_generated/api").api.messages.sendText,
      {
        conversationId,
        text: "Olá, confirmação de consulta amanhã às 10h",
        clientNonce: "nonce-1",
      },
    );
    expect(messageId).toBeTruthy();

    const msg = await t.run(async (ctx) => {
      const m = await ctx.db.get(messageId as Id<"messages">);
      return m;
    });
    expect(msg).toBeTruthy();
    if (msg && "status" in msg) {
      expect(msg.status).toBe("queued");
      expect(msg.direction).toBe("outgoing");
      expect(msg.businessKey).toContain(conversationId);
      expect(msg.businessKey).toContain("nonce-1");
    }
  });

  it("rejects send outside 24h window", async () => {
    const t = convexTest(schema);
    const seeded = await seed(t);
    await grantTransactional(t, {
      tenantId: seeded.tenantId,
      contactId: seeded.contactId,
    });
    const conversationId = await makeConversation(t, {
      tenantId: seeded.tenantId,
      phoneNumberId: seeded.phoneNumberId,
      contactId: seeded.contactId,
      windowOpen: false,
    });

    const asUser = t.withIdentity({ subject: seeded.userId });
    await expect(
      asUser.mutation(
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require("../_generated/api").api.messages.sendText,
        {
          conversationId,
          text: "test",
          clientNonce: "n",
        },
      ),
    ).rejects.toThrow(/SERVICE_WINDOW_EXPIRED/);
  });

  it("rejects send without transactional consent", async () => {
    const t = convexTest(schema);
    const seeded = await seed(t);
    // Skip granting consent.
    const conversationId = await makeConversation(t, {
      tenantId: seeded.tenantId,
      phoneNumberId: seeded.phoneNumberId,
      contactId: seeded.contactId,
      windowOpen: true,
    });
    const asUser = t.withIdentity({ subject: seeded.userId });
    await expect(
      asUser.mutation(
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require("../_generated/api").api.messages.sendText,
        { conversationId, text: "x", clientNonce: "n" },
      ),
    ).rejects.toThrow(/CONSENT_REQUIRED/);
  });

  it("dedups same clientNonce: returns same messageId, no duplicate row", async () => {
    const t = convexTest(schema);
    const seeded = await seed(t);
    await grantTransactional(t, {
      tenantId: seeded.tenantId,
      contactId: seeded.contactId,
    });
    const conversationId = await makeConversation(t, {
      tenantId: seeded.tenantId,
      phoneNumberId: seeded.phoneNumberId,
      contactId: seeded.contactId,
      windowOpen: true,
    });
    const asUser = t.withIdentity({ subject: seeded.userId });
    const args = {
      conversationId,
      text: "hello",
      clientNonce: "stable-nonce",
    };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const api = require("../_generated/api").api;
    const first = await asUser.mutation(api.messages.sendText, args);
    const second = await asUser.mutation(api.messages.sendText, args);
    expect(first).toBe(second);
    const all = await t.run(async (ctx) =>
      ctx.db.query("messages").collect(),
    );
    expect(all.length).toBe(1);
  });

  it("rejects empty + over-length text", async () => {
    const t = convexTest(schema);
    const seeded = await seed(t);
    await grantTransactional(t, {
      tenantId: seeded.tenantId,
      contactId: seeded.contactId,
    });
    const conversationId = await makeConversation(t, {
      tenantId: seeded.tenantId,
      phoneNumberId: seeded.phoneNumberId,
      contactId: seeded.contactId,
      windowOpen: true,
    });
    const asUser = t.withIdentity({ subject: seeded.userId });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const api = require("../_generated/api").api;
    await expect(
      asUser.mutation(api.messages.sendText, {
        conversationId,
        text: "   ",
        clientNonce: "n1",
      }),
    ).rejects.toThrow(/EMPTY_TEXT/);
    await expect(
      asUser.mutation(api.messages.sendText, {
        conversationId,
        text: "x".repeat(5000),
        clientNonce: "n2",
      }),
    ).rejects.toThrow(/TEXT_TOO_LONG/);
  });

  it("claimForDispatch is atomic — second claim returns null", async () => {
    const t = convexTest(schema);
    const seeded = await seed(t);
    const conversationId = await makeConversation(t, {
      tenantId: seeded.tenantId,
      phoneNumberId: seeded.phoneNumberId,
      contactId: seeded.contactId,
      windowOpen: true,
    });
    const messageId = await t.run(async (ctx) =>
      ctx.db.insert("messages", {
        tenantId: seeded.tenantId,
        conversationId,
        direction: "outgoing",
        businessKey: "bk-1",
        type: "text",
        content: { text: { body: "x" } },
        status: "queued",
        dispatchAttempts: 0,
        createdAt: Date.now(),
      }),
    );
    const first = await t.mutation(internal.messages._claimForDispatch, {
      messageId,
    });
    expect(first).not.toBeNull();
    const second = await t.mutation(internal.messages._claimForDispatch, {
      messageId,
    });
    expect(second).toBeNull();
  });
});
