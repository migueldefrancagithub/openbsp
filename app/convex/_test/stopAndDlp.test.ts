import { convexTest } from "convex-test";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import schema from "../schema";
import { internal, api } from "../_generated/api";
import { isStopKeyword } from "../webhooks";
import { validateHealthcareContent } from "../lib/dlp/healthcare";
import type { Id } from "../_generated/dataModel";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

// ---------- STOP keyword unit ----------

describe("isStopKeyword", () => {
  it("matches all canonical forms case-insensitive", () => {
    for (const w of [
      "STOP",
      "stop",
      "  stop  ",
      "Parar",
      "cancelar",
      "Sair",
      "UNSUBSCRIBE",
      "cancel",
      "baja",
      "stop.",
      "stop!",
    ]) {
      expect(isStopKeyword(w), `expected "${w}" to match`).toBe(true);
    }
  });
  it("does not match free-form text containing the word", () => {
    for (const w of [
      "stop sending me ads please",
      "I want to cancel my appointment",
      "Should I stop the medication?",
      "",
      "olá",
    ]) {
      expect(isStopKeyword(w), `expected "${w}" to NOT match`).toBe(false);
    }
  });
});

// ---------- DLP healthcare unit ----------

describe("validateHealthcareContent", () => {
  it("passes benign appointment messages", () => {
    expect(
      validateHealthcareContent("Olá Maria, lembrete da sua consulta amanhã às 10h.")
        .passed,
    ).toBe(true);
  });
  it("hard-blocks diagnosis claims", () => {
    const r = validateHealthcareContent("O seu diagnóstico é hipertensão.");
    expect(r.passed).toBe(false);
    expect(r.hardBlocked).toBe(true);
    expect(r.matched).toContain("diagnosis_claim");
  });
  it("hard-blocks controlled medications by name", () => {
    const r = validateHealthcareContent("Tome 1 comprimido de alprazolam à noite.");
    expect(r.passed).toBe(false);
    expect(r.hardBlocked).toBe(true);
    expect(r.matched).toContain("controlled_medication");
  });
  it("soft-blocks dose mentions (overridable)", () => {
    const r = validateHealthcareContent("Trazer comprovativo de 500mg ingerido.");
    expect(r.passed).toBe(false);
    expect(r.hardBlocked).toBe(false);
    expect(r.matched).toContain("dose_mention");
  });
  it("soft-blocks frequency mentions", () => {
    const r = validateHealthcareContent("3x ao dia conforme combinado.");
    expect(r.passed).toBe(false);
    expect(r.hardBlocked).toBe(false);
    expect(r.matched).toContain("frequency_mention");
  });
});

// ---------- E2E STOP keyword via webhook ----------

async function seedClinicalTenantPhone(t: ReturnType<typeof convexTest>) {
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
      rgpd: { controllerName: "T", controllerEmail: "t@e.pt" },
      createdAt: Date.now(),
    });
    const wabaAccountId = await ctx.db.insert("whatsappAccounts", {
      tenantId,
      metaAppId: "APP",
      wabaId: "WABA",
      status: "active",
      tokenStatus: "ok",
      createdAt: Date.now(),
    });
    await ctx.db.insert("phoneNumbers", {
      tenantId,
      whatsappAccountId: wabaAccountId,
      phoneNumberId: "PH",
      e164: "+351910000000",
      displayName: "Test",
      createdAt: Date.now(),
    });
    return { tenantId };
  });
}

function makeStopPayload() {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA",
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: "PH" },
              contacts: [{ wa_id: "351912345678", profile: { name: "Maria" } }],
              messages: [
                {
                  from: "351912345678",
                  id: "wamid.STOP.1",
                  timestamp: "1700000000",
                  type: "text",
                  text: { body: "STOP" },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

describe("STOP keyword E2E via webhook", () => {
  it("inbound STOP revokes marketing consent and cancels queued outbound", async () => {
    const t = convexTest(schema);
    const { tenantId } = await seedClinicalTenantPhone(t);

    // First: pretend marketing consent was granted at some point.
    const contactId = await t.run(async (ctx) => {
      const cid = await ctx.db.insert("contacts", {
        tenantId,
        e164: "+351912345678",
        tags: [],
        createdAt: Date.now(),
      });
      const evId = await ctx.db.insert("consentEvents", {
        tenantId,
        contactId: cid,
        purpose: "marketing",
        channel: "whatsapp",
        newStatus: "granted",
        source: "form_web_v1",
        capturedAt: Date.now(),
      });
      await ctx.db.insert("currentConsents", {
        tenantId,
        contactId: cid,
        purpose: "marketing",
        channel: "whatsapp",
        status: "granted",
        effectiveAt: Date.now(),
        lastEventId: evId,
      });
      // Also a queued outbound that should be cancelled
      const phoneRow = await ctx.db
        .query("phoneNumbers")
        .withIndex("by_phone_number_id", (q) => q.eq("phoneNumberId", "PH"))
        .unique();
      const conversationId = await ctx.db.insert("conversations", {
        tenantId,
        phoneNumberId: phoneRow!._id,
        contactId: cid,
        status: "open",
        lastMessageAt: Date.now(),
        unreadCount: 0,
        tags: [],
      });
      await ctx.db.insert("messages", {
        tenantId,
        conversationId,
        direction: "outgoing",
        businessKey: "bk-marketing-1",
        type: "text",
        content: { text: { body: "Promo" } },
        status: "queued",
        dispatchAttempts: 0,
        createdAt: Date.now(),
      });
      return cid;
    });

    await t.mutation(internal.webhooks.enqueue, {
      rawPayload: JSON.stringify(makeStopPayload()),
      rawBodySha256: "sha-stop",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // Marketing consent now revoked
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

    // Audit event with source="stop_keyword"
    const events = await t.run(async (ctx) =>
      ctx.db
        .query("consentEvents")
        .withIndex("by_tenant_contact", (q) =>
          q.eq("tenantId", tenantId).eq("contactId", contactId),
        )
        .collect(),
    );
    expect(events.some((e) => e.source === "stop_keyword")).toBe(true);

    // Queued outbound cancelled
    const queued = await t.run(async (ctx) =>
      ctx.db.query("messages").collect(),
    );
    const cancelled = queued.find(
      (m) => m.failureReason === "consent_revoked_by_stop_keyword",
    );
    expect(cancelled).toBeTruthy();
    expect(cancelled?.status).toBe("failed");
  });

  it("transactional consent stays granted after STOP", async () => {
    const t = convexTest(schema);
    const { tenantId } = await seedClinicalTenantPhone(t);

    await t.mutation(internal.webhooks.enqueue, {
      rawPayload: JSON.stringify(makeStopPayload()),
      rawBodySha256: "sha-stop2",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const contact = await t.run(async (ctx) =>
      ctx.db
        .query("contacts")
        .withIndex("by_tenant_phone", (q) =>
          q.eq("tenantId", tenantId).eq("e164", "+351912345678"),
        )
        .unique(),
    );
    expect(contact).toBeTruthy();

    const transactional = await t.run(async (ctx) =>
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
    expect(transactional?.status).toBe("granted");
  });
});

// ---------- E2E DLP composer guard via sendText ----------

describe("Healthcare DLP at sendText", () => {
  it("hard-blocks diagnosis text in healthcare workspace, no override possible", async () => {
    const t = convexTest(schema);
    const { tenantId, userId, conversationId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { name: "Doc" });
      const tenantId = await ctx.db.insert("tenants", {
        name: "Clinic",
        vertical: "clinic",
        healthcareMode: true,
        plan: "starter",
        settings: { defaultLocale: "pt-PT", timezone: "Europe/Lisbon", retentionDays: 730 },
        rgpd: { controllerName: "C", controllerEmail: "c@e.pt" },
        createdAt: Date.now(),
      });
      await ctx.db.insert("members", {
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
      const wabaAccountId = await ctx.db.insert("whatsappAccounts", {
        tenantId,
        metaAppId: "A",
        wabaId: "W",
        status: "active",
        tokenStatus: "ok",
        createdAt: Date.now(),
      });
      const phoneNumberId = await ctx.db.insert("phoneNumbers", {
        tenantId,
        whatsappAccountId: wabaAccountId,
        phoneNumberId: "P",
        e164: "+351900000000",
        displayName: "T",
        createdAt: Date.now(),
      });
      const contactId = await ctx.db.insert("contacts", {
        tenantId,
        e164: "+351911000000",
        tags: [],
        createdAt: Date.now(),
      });
      const evId = await ctx.db.insert("consentEvents", {
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
        lastEventId: evId,
      });
      const conversationId = await ctx.db.insert("conversations", {
        tenantId,
        phoneNumberId,
        contactId,
        status: "open",
        lastMessageAt: Date.now(),
        lastIncomingAt: Date.now(),
        serviceWindowExpiresAt: Date.now() + 60 * 60 * 1000,
        unreadCount: 0,
        tags: [],
      });
      return { tenantId, userId, conversationId };
    });

    const asUser = t.withIdentity({ subject: userId });

    // Diagnosis attempt → hard block
    await expect(
      asUser.mutation(api.messages.sendText, {
        conversationId,
        text: "O diagnóstico final é hipertensão.",
        clientNonce: "n1",
      }),
    ).rejects.toThrow(/HEALTHCARE_HARD_BLOCKED/);

    // Even with override, hard block stands
    await expect(
      asUser.mutation(api.messages.sendText, {
        conversationId,
        text: "Tome alprazolam.",
        clientNonce: "n2",
        healthcareOverride: { justification: "I really want to" },
      }),
    ).rejects.toThrow(/HEALTHCARE_HARD_BLOCKED/);

    // Soft block (dose) requires override
    await expect(
      asUser.mutation(api.messages.sendText, {
        conversationId,
        text: "Comprovativo dos 500mg de chá ingeridos.",
        clientNonce: "n3",
      }),
    ).rejects.toThrow(/HEALTHCARE_OVERRIDE_REQUIRED/);

    // Soft block with too-short justification
    await expect(
      asUser.mutation(api.messages.sendText, {
        conversationId,
        text: "Comprovativo dos 500mg de chá ingeridos.",
        clientNonce: "n4",
        healthcareOverride: { justification: "ok" },
      }),
    ).rejects.toThrow(/JUSTIFICATION_TOO_SHORT/);

    // Soft block with proper override → succeeds
    const messageId = await asUser.mutation(api.messages.sendText, {
      conversationId,
      text: "Comprovativo dos 500mg de chá ingeridos hoje.",
      clientNonce: "n5",
      healthcareOverride: {
        justification: "Quantity refers to herbal tea, not medication, per patient note.",
      },
    });
    expect(messageId).toBeTruthy();
    const m = await t.run(async (ctx) =>
      ctx.db.get(messageId as Id<"messages">),
    );
    expect(m && "contentValidationResult" in m && m.contentValidationResult)
      .toBeTruthy();
    if (m && "contentValidationResult" in m && m.contentValidationResult) {
      expect(m.contentValidationResult.passed).toBe(false);
      expect(m.contentValidationResult.overrideJustification).toContain("herbal");
    }
    void tenantId;
  });

  it("non-healthcare workspace bypasses DLP entirely", async () => {
    const t = convexTest(schema);
    const { userId, conversationId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { name: "U" });
      const tenantId = await ctx.db.insert("tenants", {
        name: "Shop",
        vertical: "ecommerce",
        healthcareMode: false,
        plan: "starter",
        settings: { defaultLocale: "pt-PT", timezone: "Europe/Lisbon", retentionDays: 730 },
        rgpd: { controllerName: "C", controllerEmail: "c@e.pt" },
        createdAt: Date.now(),
      });
      await ctx.db.insert("members", {
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
      const wabaAccountId = await ctx.db.insert("whatsappAccounts", {
        tenantId,
        metaAppId: "A",
        wabaId: "W",
        status: "active",
        tokenStatus: "ok",
        createdAt: Date.now(),
      });
      const phoneNumberId = await ctx.db.insert("phoneNumbers", {
        tenantId,
        whatsappAccountId: wabaAccountId,
        phoneNumberId: "P",
        e164: "+351900000000",
        displayName: "T",
        createdAt: Date.now(),
      });
      const contactId = await ctx.db.insert("contacts", {
        tenantId,
        e164: "+351911000000",
        tags: [],
        createdAt: Date.now(),
      });
      const evId = await ctx.db.insert("consentEvents", {
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
        lastEventId: evId,
      });
      const conversationId = await ctx.db.insert("conversations", {
        tenantId,
        phoneNumberId,
        contactId,
        status: "open",
        lastMessageAt: Date.now(),
        serviceWindowExpiresAt: Date.now() + 60 * 60 * 1000,
        unreadCount: 0,
        tags: [],
      });
      return { userId, conversationId };
    });

    const asUser = t.withIdentity({ subject: userId });
    // Same string would have hard-blocked under healthcare; here it goes through.
    const id = await asUser.mutation(api.messages.sendText, {
      conversationId,
      text: "diagnosis claim text test",
      clientNonce: "n",
    });
    expect(id).toBeTruthy();
  });
});

// ---------- E2 DPA/DPIA gating ----------

describe("DPA/DPIA gating on connectManual", () => {
  it("acceptDpa marks tenant.rgpd.dpaSignedAt", async () => {
    const t = convexTest(schema);
    const { userId, tenantId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { name: "Owner" });
      const tenantId = await ctx.db.insert("tenants", {
        name: "T",
        vertical: "clinic",
        healthcareMode: true,
        plan: "starter",
        settings: { defaultLocale: "pt-PT", timezone: "Europe/Lisbon", retentionDays: 730 },
        rgpd: { controllerName: "O", controllerEmail: "o@e.pt" },
        createdAt: Date.now(),
      });
      await ctx.db.insert("members", {
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
      return { userId, tenantId };
    });

    const asUser = t.withIdentity({ subject: userId });
    await asUser.mutation(api.tenants.acceptDpa, {});
    const tenant = await t.run(async (ctx) => ctx.db.get(tenantId));
    expect(tenant?.rgpd.dpaSignedAt).toBeTruthy();
  });

  it("non-owner cannot acceptDpa", async () => {
    const t = convexTest(schema);
    const { agentUserId } = await t.run(async (ctx) => {
      const ownerId = await ctx.db.insert("users", { name: "O" });
      const agentUserId = await ctx.db.insert("users", { name: "A" });
      const tenantId = await ctx.db.insert("tenants", {
        name: "T",
        vertical: "clinic",
        healthcareMode: true,
        plan: "starter",
        settings: { defaultLocale: "pt-PT", timezone: "Europe/Lisbon", retentionDays: 730 },
        rgpd: { controllerName: "O", controllerEmail: "o@e.pt" },
        createdAt: Date.now(),
      });
      await ctx.db.insert("members", {
        tenantId,
        userId: ownerId,
        role: "owner",
        status: "active",
        createdAt: Date.now(),
      });
      await ctx.db.insert("members", {
        tenantId,
        userId: agentUserId,
        role: "agent",
        status: "active",
        createdAt: Date.now(),
      });
      await ctx.db.insert("sessions", {
        userId: agentUserId,
        activeTenantId: tenantId,
        updatedAt: Date.now(),
      });
      return { agentUserId };
    });

    const asAgent = t.withIdentity({ subject: agentUserId });
    await expect(asAgent.mutation(api.tenants.acceptDpa, {})).rejects.toThrow(
      /FORBIDDEN/,
    );
  });

  it("completeDpia validates required answers", async () => {
    const t = convexTest(schema);
    const { userId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { name: "O" });
      const tenantId = await ctx.db.insert("tenants", {
        name: "T",
        vertical: "clinic",
        healthcareMode: true,
        plan: "starter",
        settings: { defaultLocale: "pt-PT", timezone: "Europe/Lisbon", retentionDays: 730 },
        rgpd: { controllerName: "O", controllerEmail: "o@e.pt" },
        createdAt: Date.now(),
      });
      await ctx.db.insert("members", {
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
      return { userId };
    });

    const asUser = t.withIdentity({ subject: userId });
    await expect(
      asUser.mutation(api.tenants.completeDpia, {
        answers: {
          legalBasis: "",
          dataCategories: [],
          retentionMonths: 0,
        },
      }),
    ).rejects.toThrow(/DPIA_INCOMPLETE/);

    await asUser.mutation(api.tenants.completeDpia, {
      answers: {
        legalBasis: "art 6.1.f legitimate interest",
        dataCategories: ["patient_phone", "appointment_metadata"],
        retentionMonths: 24,
      },
    });
  });
});
