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

async function seedTenantAndPhone(t: ReturnType<typeof convexTest>) {
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
      rgpd: { controllerName: "Test", controllerEmail: "test@example.pt" },
      createdAt: Date.now(),
    });
    const wabaAccountId = await ctx.db.insert("whatsappAccounts", {
      tenantId,
      metaAppId: "TEST_APP",
      wabaId: "TEST_WABA",
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

    // Wait for scheduled actions to run.
    await t.finishAllScheduledFunctions(vi.runAllTimers);

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
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // Meta retries the exact same message
    await t.mutation(internal.webhooks.enqueue, {
      rawPayload: raw,
      rawBodySha256: "sha-A",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

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
    await t.finishAllScheduledFunctions(vi.runAllTimers);

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
});
