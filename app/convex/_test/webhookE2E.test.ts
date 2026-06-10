import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../schema";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

async function processPendingWebhookEvents(t: ReturnType<typeof convexTest>) {
  const pendingEventIds = await t.run(async (ctx) => {
    const rows = await ctx.db.query("webhookEvents").collect();
    return rows
      .filter((row) => row.status === "pending")
      .map((row) => row._id);
  });
  for (const eventId of pendingEventIds) {
    await t.action(internal.webhooks.processOne, { eventId });
  }
}

async function seedTenantAndPhone(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const tenantId = await ctx.db.insert("tenants", {
      name: "Test Clinic",
      vertical: "clinic",
      plan: "starter",
      settings: {
        defaultLocale: "pt-PT",
        timezone: "Europe/Lisbon",
        retentionDays: 730,
      },
      createdAt: Date.now(),
    });
    const wabaAccountId = await ctx.db.insert("whatsappAccounts", {
      tenantId,
      metaAppId: "TEST_APP",
      wabaId: "TEST_WABA",
      accessToken: "test-token",
      status: "active",
      tokenStatus: "ok",
      createdAt: Date.now(),
    });
    const phoneNumberId = await ctx.db.insert("phoneNumbers", {
      tenantId,
      whatsappAccountId: wabaAccountId,
      phoneNumberId: "PHONE_TEST_1",
      e164: "+351910000000",
      displayName: "Test Clinic",
      createdAt: Date.now(),
    });
    return { tenantId, wabaAccountId, phoneNumberId };
  });
}

function makeMessagePayload(opts?: {
  wamid?: string;
  from?: string;
  text?: string;
  ts?: number;
  referral?: Record<string, unknown>;
}) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "TEST_WABA",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: "PHONE_TEST_1" },
              contacts: [
                { profile: { name: "Maria" }, wa_id: opts?.from ?? "351912345678" },
              ],
              messages: [
                {
                  from: opts?.from ?? "351912345678",
                  id: opts?.wamid ?? "wamid.E2E.1",
                  timestamp: String(opts?.ts ?? 1700000000),
                  type: "text",
                  text: { body: opts?.text ?? "Olá clínica" },
                  referral: opts?.referral,
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

describe("webhook E2E", () => {
  it("processes a single inbound message: contact + conversation + message + consent", async () => {
    const t = convexTest(schema);
    const { tenantId } = await seedTenantAndPhone(t);

    const payload = makeMessagePayload();
    await t.mutation(internal.webhooks.enqueue, {
      rawPayload: JSON.stringify(payload),
      rawBodySha256: "test-sha256",
    });

    await processPendingWebhookEvents(t);

    // Webhook event marked processed
    const events = await t.run(async (ctx) =>
      ctx.db.query("webhookEvents").collect(),
    );
    expect(events.length).toBe(1);
    expect(events[0].status).toBe("processed");
    expect(events[0].eventKey).toBe("msg:PHONE_TEST_1:wamid.E2E.1");

    // Contact upserted
    const contact = await t.run(async (ctx) =>
      ctx.db
        .query("contacts")
        .withIndex("by_tenant_phone", (q) =>
          q.eq("tenantId", tenantId).eq("e164", "+351912345678"),
        )
        .unique(),
    );
    expect(contact).toBeTruthy();
    expect(contact?.name).toBe("Maria");

    // Conversation created
    const convs = await t.run(async (ctx) =>
      ctx.db
        .query("conversations")
        .withIndex("by_tenant_status", (q) =>
          q.eq("tenantId", tenantId).eq("status", "open"),
        )
        .collect(),
    );
    expect(convs.length).toBe(1);
    expect(convs[0].unreadCount).toBe(1);
    expect(convs[0].serviceWindowExpiresAt).toBe(
      1700000000 * 1000 + 24 * 60 * 60 * 1000,
    );

    // Message persisted
    const messages = await t.run(async (ctx) =>
      ctx.db
        .query("messages")
        .withIndex("by_meta_id", (q) => q.eq("metaMessageId", "wamid.E2E.1"))
        .collect(),
    );
    expect(messages.length).toBe(1);
    expect(messages[0].direction).toBe("incoming");
    expect(messages[0].status).toBe("delivered");

    // Transactional consent recorded with source inbound_24h
    const consent = await t.run(async (ctx) =>
      ctx.db
        .query("currentConsents")
        .withIndex("by_tenant_contact_purpose_channel", (q) =>
          q
            .eq("tenantId", tenantId)
            .eq("contactId", contact!._id)
            .eq("purpose", "transactional")
            .eq("channel", "whatsapp"),
        )
        .unique(),
    );
    expect(consent?.status).toBe("granted");

    const events2 = await t.run(async (ctx) =>
      ctx.db
        .query("consentEvents")
        .withIndex("by_tenant_contact", (q) =>
          q.eq("tenantId", tenantId).eq("contactId", contact!._id),
        )
        .collect(),
    );
    expect(events2.some((e) => e.source === "inbound_24h")).toBe(true);
  });

  it("dedups duplicate webhook deliveries (Meta retry)", async () => {
    const t = convexTest(schema);
    await seedTenantAndPhone(t);

    const payload = makeMessagePayload();
    const raw = JSON.stringify(payload);

    // First delivery
    await t.mutation(internal.webhooks.enqueue, {
      rawPayload: raw,
      rawBodySha256: "sha-A",
    });
    await processPendingWebhookEvents(t);

    // Meta retries the exact same message
    await t.mutation(internal.webhooks.enqueue, {
      rawPayload: raw,
      rawBodySha256: "sha-A",
    });
    await processPendingWebhookEvents(t);

    const events = await t.run(async (ctx) =>
      ctx.db.query("webhookEvents").collect(),
    );
    expect(events.length).toBe(1); // dedup worked

    const messages = await t.run(async (ctx) =>
      ctx.db.query("messages").collect(),
    );
    expect(messages.length).toBe(1); // no duplicate row
  });

  it("rejects unknown phone_number_id (no tenant) — marks event as failed", async () => {
    const t = convexTest(schema);
    // No phoneNumber seeded.
    const payload = makeMessagePayload();
    await t.mutation(internal.webhooks.enqueue, {
      rawPayload: JSON.stringify(payload),
      rawBodySha256: "sha-X",
    });
    await processPendingWebhookEvents(t);

    const events = await t.run(async (ctx) =>
      ctx.db.query("webhookEvents").collect(),
    );
    expect(events.length).toBe(1);
    expect(events[0].status).toBe("failed");
    expect(events[0].lastError).toMatch(/unknown phone_number_id/);

    const contacts = await t.run(async (ctx) =>
      ctx.db.query("contacts").collect(),
    );
    expect(contacts.length).toBe(0);
  });

  it("status webhook updates outbound message monotonically (no regression read→delivered)", async () => {
    const t = convexTest(schema);
    const { tenantId, phoneNumberId } = await seedTenantAndPhone(t);

    // Seed outbound message with metaMessageId
    const messageId = await t.run(async (ctx) => {
      const contactId = await ctx.db.insert("contacts", {
        tenantId,
        e164: "+351912345678",
        tags: [],
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
      return await ctx.db.insert("messages", {
        tenantId,
        conversationId,
        direction: "outgoing",
        businessKey: "test-bk-out",
        metaMessageId: "wamid.OUT.1",
        type: "text",
        content: { text: "test" },
        status: "sent",
        dispatchAttempts: 1,
        createdAt: Date.now(),
      });
    });

    // Push status: read
    await t.mutation(internal.messages.markStatusFromWebhook, {
      metaMessageId: "wamid.OUT.1",
      newStatus: "read",
    });
    const after1 = await t.run(async (ctx) => ctx.db.get(messageId));
    expect(after1?.status).toBe("read");

    // Out-of-order delivered should NOT regress
    await t.mutation(internal.messages.markStatusFromWebhook, {
      metaMessageId: "wamid.OUT.1",
      newStatus: "delivered",
    });
    const after2 = await t.run(async (ctx) => ctx.db.get(messageId));
    expect(after2?.status).toBe("read");
  });

  it("persists CTWA referral context and marks the conversation AI eligible", async () => {
    const t = convexTest(schema);
    const { tenantId } = await seedTenantAndPhone(t);

    await t.mutation(internal.webhooks.enqueue, {
      rawPayload: JSON.stringify(
        makeMessagePayload({
          wamid: "wamid.CTWA.1",
          ts: 1700001000,
          referral: {
            source_type: "ad",
            source_id: "238555111",
            source_url: "https://fb.me/example",
            headline: "Promo Botox",
            body: "Clique para WhatsApp",
            media_type: "image",
          },
        }),
      ),
      rawBodySha256: "sha-ctwa",
    });
    await processPendingWebhookEvents(t);

    const referrals = await t.run(async (ctx) =>
      ctx.db.query("ctwaReferrals").collect(),
    );
    expect(referrals).toHaveLength(1);
    expect(referrals[0].tenantId).toBe(tenantId);
    expect(referrals[0].sourceId).toBe("238555111");
    expect(referrals[0].headline).toBe("Promo Botox");
    expect(referrals[0].freeEntryWindowExpiresAt).toBe(
      1700001000 * 1000 + 72 * 60 * 60 * 1000,
    );

    const conversations = await t.run(async (ctx) =>
      ctx.db.query("conversations").collect(),
    );
    expect(conversations[0].leadSource).toBe("ctwa");
    expect(conversations[0].aiState).toBe("eligible");
    expect(conversations[0].opportunityStatus).toBe("new");
  });

  it("dispatches inbound WhatsApp messages into active chatbot flows", async () => {
    const t = convexTest(schema);
    const { tenantId } = await seedTenantAndPhone(t);
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { name: "Flow Owner" });
      const memberId = await ctx.db.insert("members", {
        tenantId,
        userId,
        role: "owner",
        status: "active",
        createdAt: Date.now(),
      });
      await ctx.db.insert("chatbots", {
        tenantId,
        name: "Webhook menu",
        status: "active",
        triggerKind: "keyword",
        triggerKeywords: ["menu"],
        entryNodeKey: "start",
        flowNodes: [
          { key: "start", type: "start", title: "Start", nextKey: "menu" },
          {
            key: "menu",
            type: "send_buttons",
            title: "Menu",
            body: "Como podemos ajudar?",
            buttons: [{ replyId: "book", label: "Marcar", nextKey: "end" }],
          },
          { key: "end", type: "end", title: "End" },
        ],
        flowValidationIssues: [],
        channel: "whatsapp",
        createdBy: memberId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await t.mutation(internal.webhooks.enqueue, {
      rawPayload: JSON.stringify(
        makeMessagePayload({ wamid: "wamid.FLOW.1", text: "menu" }),
      ),
      rawBodySha256: "sha-flow",
    });
    await processPendingWebhookEvents(t);

    const rows = await t.run(async (ctx) => ({
      runs: await ctx.db.query("chatbotFlowRuns").collect(),
      messages: await ctx.db.query("messages").collect(),
    }));
    expect(rows.runs).toHaveLength(1);
    expect(rows.runs[0]).toMatchObject({
      status: "active",
      currentNodeKey: "menu",
    });
    expect(rows.messages.some((message) => message.direction === "outgoing")).toBe(true);
    expect(
      rows.messages.some((message) =>
        message.content.text?.body.includes("Como podemos ajudar"),
      ),
    ).toBe(true);
  });

  it("scopes business username updates to the matching WABA", async () => {
    const t = convexTest(schema);
    const seeded = await t.run(async (ctx) => {
      const tenantA = await ctx.db.insert("tenants", {
        name: "Clinic A",
        vertical: "clinic",
        plan: "starter",
        settings: {
          defaultLocale: "pt-PT",
          timezone: "Europe/Lisbon",
          retentionDays: 730,
        },
        createdAt: Date.now(),
      });
      const tenantB = await ctx.db.insert("tenants", {
        name: "Clinic B",
        vertical: "clinic",
        plan: "starter",
        settings: {
          defaultLocale: "pt-PT",
          timezone: "Europe/Lisbon",
          retentionDays: 730,
        },
        createdAt: Date.now(),
      });
      const accountA = await ctx.db.insert("whatsappAccounts", {
        tenantId: tenantA,
        metaAppId: "APP",
        wabaId: "WABA_A",
        accessToken: "token-a",
        status: "active",
        tokenStatus: "ok",
        createdAt: Date.now(),
      });
      const accountB = await ctx.db.insert("whatsappAccounts", {
        tenantId: tenantB,
        metaAppId: "APP",
        wabaId: "WABA_B",
        accessToken: "token-b",
        status: "active",
        tokenStatus: "ok",
        createdAt: Date.now(),
      });
      const phoneA = await ctx.db.insert("phoneNumbers", {
        tenantId: tenantA,
        whatsappAccountId: accountA,
        phoneNumberId: "PHONE_A",
        e164: "+351910000000",
        displayName: "Shared Display",
        createdAt: Date.now(),
      });
      const phoneB = await ctx.db.insert("phoneNumbers", {
        tenantId: tenantB,
        whatsappAccountId: accountB,
        phoneNumberId: "PHONE_B",
        e164: "+351910000000",
        displayName: "Shared Display",
        createdAt: Date.now(),
      });
      return { phoneA, phoneB };
    });

    await t.mutation(internal.webhooks.applyBusinessUsername, {
      wabaId: "WABA_B",
      displayPhoneNumber: "351910000000",
      username: "clinicb",
      status: "approved",
      updatedAt: 1710000000000,
    });

    const phones = await t.run(async (ctx) => ({
      a: await ctx.db.get(seeded.phoneA),
      b: await ctx.db.get(seeded.phoneB),
    }));
    expect(phones.a?.businessUsername).toBeUndefined();
    expect(phones.b).toMatchObject({
      businessUsername: "clinicb",
      businessUsernameStatus: "approved",
      businessUsernameUpdatedAt: 1710000000000,
    });
  });
});
