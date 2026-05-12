import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

// ---------- Validators reusable across tables ----------

const verticalValidator = v.union(
  v.literal("clinic"),
  v.literal("services"),
  v.literal("ecommerce"),
  v.literal("other"),
);

const planValidator = v.union(
  v.literal("starter"),
  v.literal("growth"),
  v.literal("enterprise"),
);

const roleValidator = v.union(
  v.literal("owner"),
  v.literal("admin"),
  v.literal("agent"),
  v.literal("marketing"),
);

const purposeValidator = v.union(
  v.literal("transactional"),
  v.literal("marketing"),
  v.literal("authentication"),
);

const channelValidator = v.literal("whatsapp");

const consentStatusValidator = v.union(
  v.literal("granted"),
  v.literal("revoked"),
  v.literal("unknown"),
);

const messageDirectionValidator = v.union(
  v.literal("incoming"),
  v.literal("outgoing"),
);

const messageTypeValidator = v.union(
  v.literal("text"),
  v.literal("image"),
  v.literal("video"),
  v.literal("audio"),
  v.literal("document"),
  v.literal("template"),
  v.literal("interactive"),
  v.literal("location"),
  v.literal("contact"),
  v.literal("reaction"),
  v.literal("system"),
);

// queued < dispatching < unknown < failed; sent < delivered < read (terminal lanes).
const messageStatusValidator = v.union(
  v.literal("queued"),
  v.literal("dispatching"),
  v.literal("unknown"),
  v.literal("sent"),
  v.literal("delivered"),
  v.literal("read"),
  v.literal("failed"),
);

const pricingCategoryValidator = v.union(
  v.literal("marketing"),
  v.literal("utility"),
  v.literal("authentication"),
  v.literal("service"),
);

const wabaStatusValidator = v.union(
  v.literal("active"),
  v.literal("disconnected"),
  v.literal("flagged"),
  v.literal("revoked"),
);

const tokenStatusValidator = v.union(
  v.literal("ok"),
  v.literal("expiring"),
  v.literal("revoked"),
);

const qualityRatingValidator = v.union(
  v.literal("green"),
  v.literal("yellow"),
  v.literal("red"),
);

const conversationStatusValidator = v.union(
  v.literal("open"),
  v.literal("snoozed"),
  v.literal("closed"),
);

const webhookStatusValidator = v.union(
  v.literal("pending"),
  v.literal("processing"),
  v.literal("processed"),
  v.literal("failed"),
);

// ---------- Schema ----------

export default defineSchema({
  ...authTables,

  // ===== Tenancy =====
  tenants: defineTable({
    name: v.string(),
    vertical: verticalValidator,
    healthcareMode: v.boolean(),
    plan: planValidator,
    settings: v.object({
      defaultLocale: v.string(),
      timezone: v.string(),
      retentionDays: v.number(),
    }),
    rgpd: v.object({
      controllerName: v.string(),
      controllerEmail: v.string(),
      dpaSignedAt: v.optional(v.number()),
      dpiaCompletedAt: v.optional(v.number()),
    }),
    createdAt: v.number(),
  }),

  members: defineTable({
    tenantId: v.id("tenants"),
    userId: v.id("users"),
    role: roleValidator,
    healthcareProfessional: v.optional(v.boolean()),
    status: v.union(v.literal("active"), v.literal("suspended")),
    createdAt: v.number(),
  })
    .index("by_tenant_user", ["tenantId", "userId"])
    .index("by_user", ["userId"]),

  sessions: defineTable({
    userId: v.id("users"),
    activeTenantId: v.id("tenants"),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  // ===== Meta App (platform-controlled, single row in MVP) =====
  metaApps: defineTable({
    metaAppId: v.string(),
    appSecretCiphertext: v.string(),
    appSecretIv: v.string(),
    appSecretKeyVersion: v.number(),
    webhookVerifyToken: v.string(),
    status: v.union(v.literal("active"), v.literal("disabled")),
    rotatedAt: v.optional(v.number()),
  }).index("by_app_id", ["metaAppId"]),

  // ===== WhatsApp connections =====
  whatsappAccounts: defineTable({
    tenantId: v.id("tenants"),
    metaAppId: v.string(),
    wabaId: v.string(),
    status: wabaStatusValidator,
    qualityRating: v.optional(qualityRatingValidator),
    messagingTier: v.optional(v.string()),
    lastQualityCheckAt: v.optional(v.number()),
    lastTokenHealthCheckAt: v.optional(v.number()),
    tokenStatus: tokenStatusValidator,
    validatedAt: v.optional(v.number()),
    validatedScopes: v.optional(v.array(v.string())),
    tokenExpiresAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_waba", ["wabaId"])
    .index("by_tenant", ["tenantId"])
    .index("by_app_waba", ["metaAppId", "wabaId"]),

  wabaSecrets: defineTable({
    whatsappAccountId: v.id("whatsappAccounts"),
    ciphertext: v.string(),
    iv: v.string(),
    keyVersion: v.number(),
    encryptedAt: v.number(),
    rotatedAt: v.optional(v.number()),
    lastAccessedAt: v.optional(v.number()),
    accessCountSinceLastReset: v.number(),
  }).index("by_account", ["whatsappAccountId"]),

  phoneNumbers: defineTable({
    tenantId: v.id("tenants"),
    whatsappAccountId: v.id("whatsappAccounts"),
    phoneNumberId: v.string(),
    e164: v.string(),
    displayName: v.string(),
    qualityRating: v.optional(qualityRatingValidator),
    qualityLastErrorAt: v.optional(v.number()),
    qualityLastErrorCode: v.optional(v.string()),
    circuitBreakerUntil: v.optional(v.number()),
    circuitBreakerReason: v.optional(v.string()),
    circuitBreakerOpenedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_phone_number_id", ["phoneNumberId"])
    .index("by_tenant", ["tenantId"]),

  // ===== Contacts =====
  contacts: defineTable({
    tenantId: v.id("tenants"),
    e164: v.string(),
    name: v.optional(v.string()),
    locale: v.optional(v.string()),
    tags: v.array(v.string()),
    customAttributes: v.optional(v.any()),
    isMinor: v.optional(v.boolean()),
    createdAt: v.number(),
    erasedAt: v.optional(v.number()),
  })
    .index("by_tenant_phone", ["tenantId", "e164"])
    .index("by_tenant", ["tenantId"]),

  // Current consent state — single row per (tenant, contact, purpose, channel).
  // Source of truth for send gates.
  currentConsents: defineTable({
    tenantId: v.id("tenants"),
    contactId: v.id("contacts"),
    purpose: purposeValidator,
    channel: channelValidator,
    status: consentStatusValidator,
    effectiveAt: v.number(),
    lastEventId: v.id("consentEvents"),
  }).index("by_tenant_contact_purpose_channel", [
    "tenantId",
    "contactId",
    "purpose",
    "channel",
  ]),

  // Append-only audit trail of consent transitions. Never updated/deleted.
  consentEvents: defineTable({
    tenantId: v.id("tenants"),
    contactId: v.id("contacts"),
    purpose: purposeValidator,
    channel: channelValidator,
    newStatus: consentStatusValidator,
    source: v.string(),
    proofText: v.optional(v.string()),
    proofVersion: v.optional(v.string()),
    proofUrl: v.optional(v.string()),
    capturedAt: v.number(),
    capturedByMemberId: v.optional(v.id("members")),
    ipAddress: v.optional(v.string()),
    userAgent: v.optional(v.string()),
  })
    .index("by_tenant_contact", ["tenantId", "contactId"])
    .index("by_tenant_capturedAt", ["tenantId", "capturedAt"]),

  // ===== Conversations + messages =====
  conversations: defineTable({
    tenantId: v.id("tenants"),
    phoneNumberId: v.id("phoneNumbers"),
    contactId: v.id("contacts"),
    status: conversationStatusValidator,
    assignedAgentId: v.optional(v.id("members")),
    lastMessageAt: v.number(),
    lastIncomingAt: v.optional(v.number()),
    serviceWindowExpiresAt: v.optional(v.number()),
    unreadCount: v.number(),
    tags: v.array(v.string()),
  })
    .index("by_tenant_status", ["tenantId", "status"])
    .index("by_tenant_phone_contact", [
      "tenantId",
      "phoneNumberId",
      "contactId",
    ])
    .index("by_tenant_lastmsg", ["tenantId", "lastMessageAt"]),

  messages: defineTable({
    tenantId: v.id("tenants"),
    conversationId: v.id("conversations"),
    direction: messageDirectionValidator,
    businessKey: v.string(),
    metaMessageId: v.optional(v.string()),
    type: messageTypeValidator,
    content: v.any(),
    status: messageStatusValidator,
    failureReason: v.optional(v.string()),
    failureCode: v.optional(v.string()),
    dispatchAttempts: v.number(),
    claimedAt: v.optional(v.number()),
    nextRetryAt: v.optional(v.number()),
    unknownSince: v.optional(v.number()),
    sentByAgentId: v.optional(v.id("members")),
    sentByCampaignId: v.optional(v.id("campaigns")),
    sentByScheduledMessageId: v.optional(v.id("scheduledMessages")),
    templateId: v.optional(v.id("templates")),
    templateVersion: v.optional(v.number()),
    pricingCategory: v.optional(pricingCategoryValidator),
    costMinor: v.optional(v.number()),
    costCurrency: v.optional(v.string()),
    contentValidationResult: v.optional(
      v.object({
        passed: v.boolean(),
        blockedReasons: v.optional(v.array(v.string())),
        overrideByMemberId: v.optional(v.id("members")),
        overrideJustification: v.optional(v.string()),
      }),
    ),
    createdAt: v.number(),
  })
    .index("by_meta_id", ["metaMessageId"])
    .index("by_business_key", ["businessKey"])
    .index("by_conversation", ["conversationId", "createdAt"])
    .index("by_status_retry", ["status", "nextRetryAt"])
    .index("by_status_unknown", ["status", "unknownSince"])
    .index("by_tenant_created", ["tenantId", "createdAt"]),

  // Forward-declared empty tables (filled in later chunks).
  campaigns: defineTable({
    tenantId: v.id("tenants"),
    name: v.string(),
    createdAt: v.number(),
  }).index("by_tenant", ["tenantId"]),

  scheduledMessages: defineTable({
    tenantId: v.id("tenants"),
    sendAt: v.number(),
    status: v.string(),
  }).index("by_tenant_status_sendat", ["tenantId", "status", "sendAt"]),

  templates: defineTable({
    tenantId: v.id("tenants"),
    name: v.string(),
    language: v.string(),
    status: v.string(),
    createdAt: v.number(),
  }).index("by_tenant_name_lang", ["tenantId", "name", "language"]),

  // ===== Webhook idempotency =====
  webhookEvents: defineTable({
    eventKey: v.string(),
    rawPayload: v.string(),
    rawPayloadStorageId: v.optional(v.id("_storage")),
    rawBodySha256: v.string(),
    metaTimestamp: v.optional(v.number()),
    status: webhookStatusValidator,
    attempts: v.number(),
    lastError: v.optional(v.string()),
    receivedAt: v.number(),
    processedAt: v.optional(v.number()),
    nextRetryAt: v.optional(v.number()),
  })
    .index("by_key", ["eventKey"])
    .index("by_status_retry", ["status", "nextRetryAt"]),

  // ===== Audit log (append-only, hash-chained) =====
  auditLog: defineTable({
    tenantId: v.id("tenants"),
    actorType: v.union(
      v.literal("member"),
      v.literal("system"),
      v.literal("scheduler"),
      v.literal("api_key"),
    ),
    actorId: v.string(),
    actorRoleSnapshot: v.optional(v.string()),
    action: v.string(),
    targetType: v.optional(v.string()),
    targetId: v.optional(v.string()),
    before: v.optional(v.any()),
    after: v.optional(v.any()),
    metadata: v.optional(v.any()),
    ipAddress: v.optional(v.string()),
    prevHash: v.string(),
    selfHash: v.string(),
    createdAt: v.number(),
  })
    .index("by_tenant_created", ["tenantId", "createdAt"])
    .index("by_target", ["targetType", "targetId"])
    .index("by_actor", ["actorType", "actorId"]),
});
