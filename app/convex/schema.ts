import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";
import {
  intentSourceValidator,
  threadIntentValidator,
} from "./lib/channels/intents";

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
  // Inbound types Meta actually delivers; rejecting them loses the message
  // permanently (event marked failed, no retry). "button" = template
  // quick-reply responses.
  v.literal("button"),
  v.literal("sticker"),
  v.literal("contacts"),
  v.literal("order"),
  v.literal("request_welcome"),
  v.literal("unsupported"),
  v.literal("reaction"),
  v.literal("system"),
);

// queued < dispatching < unknown < failed; sent < delivered < read < played
// (played is Meta's voice-message playback status).
const messageStatusValidator = v.union(
  v.literal("queued"),
  v.literal("dispatching"),
  v.literal("unknown"),
  v.literal("sent"),
  v.literal("delivered"),
  v.literal("read"),
  v.literal("played"),
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

const metaAdmissionStatusValidator = v.union(
  v.literal("todo"),
  v.literal("in_progress"),
  v.literal("done"),
  v.literal("blocked"),
  v.literal("waived"),
);

const templateButtonValidator = v.union(
  v.object({
    type: v.literal("quick_reply"),
    text: v.string(),
  }),
  v.object({
    type: v.literal("url"),
    text: v.string(),
    url: v.string(),
  }),
  v.object({
    type: v.literal("phone_number"),
    text: v.string(),
    phoneNumber: v.string(),
  }),
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

const leadSourceValidator = v.union(
  v.literal("ctwa"),
  v.literal("organic"),
  v.literal("campaign_reply"),
  v.literal("unknown"),
);

const opportunityStatusValidator = v.union(
  v.literal("new"),
  v.literal("contacted"),
  v.literal("replied"),
  v.literal("opportunity"),
  v.literal("booked"),
  v.literal("lost"),
);

const channelLeadStatusValidator = v.union(
  v.literal("new"),
  v.literal("interested"),
  v.literal("asked_price"),
  v.literal("wants_booking"),
  v.literal("awaiting_human"),
  v.literal("booked"),
  v.literal("confirmed"),
  v.literal("attended"),
  v.literal("no_show"),
  v.literal("lost"),
);

const channelInboxStatusValidator = v.union(
  v.literal("open"),
  v.literal("active"),
  v.literal("awaiting_team"),
  v.literal("awaiting_patient"),
  v.literal("snoozed"),
  v.literal("closed"),
);

const threadReminderStatusValidator = v.union(
  v.literal("scheduled"),
  v.literal("due"),
  v.literal("completed"),
  v.literal("cancelled"),
);

const channelAttachmentStatusValidator = v.union(
  v.literal("uploaded"),
  v.literal("sent"),
  v.literal("failed"),
);

const clinicServiceStatusValidator = v.union(
  v.literal("active"),
  v.literal("paused"),
  v.literal("archived"),
);

const clinicAppointmentStatusValidator = v.union(
  v.literal("scheduled"),
  v.literal("confirmed"),
  v.literal("cancelled"),
  v.literal("completed"),
  v.literal("no_show"),
);

const clinicKnowledgeKindValidator = v.union(
  v.literal("faq"),
  v.literal("service"),
  v.literal("policy"),
  v.literal("hours"),
  v.literal("document"),
  v.literal("instruction"),
);

const clinicKnowledgeStatusValidator = v.union(
  v.literal("draft"),
  v.literal("active"),
  v.literal("archived"),
);

const humanCaseStatusValidator = v.union(
  v.literal("open"),
  v.literal("assigned"),
  v.literal("resolved"),
);

const humanCaseUrgencyValidator = v.union(
  v.literal("low"),
  v.literal("normal"),
  v.literal("high"),
  v.literal("urgent"),
);

const followUpTriggerValidator = v.union(
  v.literal("no_reply"),
  v.literal("appointment_unconfirmed"),
  v.literal("proposal_no_response"),
  v.literal("no_show"),
  v.literal("human_case_pending"),
);

const followUpRuleStatusValidator = v.union(
  v.literal("active"),
  v.literal("paused"),
);

const followUpTaskStatusValidator = v.union(
  v.literal("scheduled"),
  v.literal("sent"),
  v.literal("stopped"),
  v.literal("failed"),
);

const campaignStatusValidator = v.union(
  v.literal("draft"),
  v.literal("scheduled"),
  v.literal("running"),
  v.literal("paused"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled"),
);

const campaignRecipientStatusValidator = v.union(
  v.literal("pending"),
  v.literal("queued"),
  v.literal("dispatching"),
  v.literal("sent"),
  v.literal("delivered"),
  v.literal("read"),
  v.literal("replied"),
  v.literal("clicked"),
  v.literal("failed"),
  v.literal("skipped"),
);

const chatbotStatusValidator = v.union(
  v.literal("draft"),
  v.literal("active"),
  v.literal("paused"),
);

const chatbotTriggerValidator = v.union(
  v.literal("inbound"),
  v.literal("keyword"),
  v.literal("ctwa"),
  v.literal("handoff"),
);

const chatbotFlowNodeTypeValidator = v.union(
  v.literal("start"),
  v.literal("send_message"),
  v.literal("send_template"),
  v.literal("send_buttons"),
  v.literal("send_list"),
  v.literal("collect_input"),
  v.literal("condition"),
  v.literal("set_tag"),
  v.literal("handoff"),
  v.literal("end"),
);

const chatbotFlowRunStatusValidator = v.union(
  v.literal("active"),
  v.literal("completed"),
  v.literal("handed_off"),
  v.literal("timed_out"),
  v.literal("stopped"),
  v.literal("failed"),
);

const chatbotFlowEventTypeValidator = v.union(
  v.literal("started"),
  v.literal("node_entered"),
  v.literal("message_sent"),
  v.literal("message_skipped"),
  v.literal("reply_received"),
  v.literal("fallback_fired"),
  v.literal("tag_set"),
  v.literal("handoff"),
  v.literal("completed"),
  v.literal("timeout"),
  v.literal("stopped"),
  v.literal("error"),
);

const chatbotFlowIssueValidator = v.object({
  severity: v.union(v.literal("error"), v.literal("warning")),
  scope: v.union(v.literal("flow"), v.literal("trigger"), v.literal("node")),
  nodeKey: v.optional(v.string()),
  field: v.optional(v.string()),
  message: v.string(),
});

const chatbotFlowNodeValidator = v.object({
  key: v.string(),
  type: chatbotFlowNodeTypeValidator,
  title: v.string(),
  body: v.optional(v.string()),
  nextKey: v.optional(v.string()),
  position: v.optional(
    v.object({
      x: v.number(),
      y: v.number(),
    }),
  ),
  variableKey: v.optional(v.string()),
  tag: v.optional(v.string()),
  template: v.optional(
    v.object({
      templateId: v.id("templates"),
      // key = String(parameterSchema.index), value = literal or "{{vars.x}}"
      variables: v.record(v.string(), v.string()),
    }),
  ),
  /** Provider-neutral template binding for an explicitly selected channel. */
  channelTemplate: v.optional(
    v.object({
      templateId: v.id("channelTemplates"),
      variables: v.record(v.string(), v.string()),
    }),
  ),
  condition: v.optional(
    v.object({
      variableKey: v.string(),
      operator: v.union(
        v.literal("equals"),
        v.literal("contains"),
        v.literal("starts_with"),
        v.literal("ends_with"),
        v.literal("present"),
        v.literal("absent"),
      ),
      value: v.optional(v.string()),
      trueNextKey: v.string(),
      falseNextKey: v.string(),
    }),
  ),
  buttons: v.optional(
    v.array(
      v.object({
        replyId: v.string(),
        label: v.string(),
        nextKey: v.string(),
      }),
    ),
  ),
});

const neutralChannelKindValidator = v.union(
  v.literal("whatsapp"),
  v.literal("instagram"),
  v.literal("messenger"),
);

const neutralChannelProviderValidator = v.union(
  v.literal("meta_graph"),
  v.literal("lab_bridge"),
  v.literal("iasolution_hub"),
);

const neutralChannelConnectionStateValidator = v.union(
  v.literal("pending_number"),
  v.literal("pending_credentials"),
  v.literal("ready"),
  v.literal("allowlist_only"),
  v.literal("live"),
  v.literal("disabled"),
);

const neutralChannelWebhookStatusValidator = v.union(
  v.literal("disabled"),
  v.literal("pending"),
  v.literal("verified"),
  v.literal("failed"),
);

const neutralChannelStatusValidator = v.union(
  v.literal("pending"),
  v.literal("active"),
  v.literal("degraded"),
  v.literal("revoked"),
  v.literal("disconnected"),
);

const neutralEventStatusValidator = v.union(
  v.literal("pending"),
  v.literal("processed"),
  v.literal("failed"),
);

const neutralOutboxStatusValidator = v.union(
  v.literal("queued"),
  v.literal("dispatching"),
  v.literal("accepted"),
  v.literal("delivered"),
  v.literal("read"),
  v.literal("failed"),
  v.literal("unknown"),
);

// ---------- Schema ----------

export default defineSchema({
  ...authTables,

  // ===== Tenancy =====
  tenants: defineTable({
    name: v.string(),
    vertical: verticalValidator,
    healthcareMode: v.optional(v.boolean()),
    plan: planValidator,
    settings: v.object({
      defaultLocale: v.string(),
      timezone: v.string(),
      retentionDays: v.number(),
    }),
    rgpd: v.optional(
      v.object({
        controllerName: v.string(),
        controllerEmail: v.string(),
        dpaSignedAt: v.optional(v.number()),
        dpiaCompletedAt: v.optional(v.number()),
      }),
    ),
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

  teams: defineTable({
    tenantId: v.id("tenants"),
    name: v.string(),
    createdBy: v.id("members"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_name", ["tenantId", "name"]),

  teamMembers: defineTable({
    tenantId: v.id("tenants"),
    teamId: v.id("teams"),
    memberId: v.id("members"),
    teamRole: v.union(v.literal("lead"), v.literal("member")),
    createdAt: v.number(),
  })
    .index("by_team", ["teamId"])
    .index("by_member", ["tenantId", "memberId"])
    .index("by_team_member", ["teamId", "memberId"]),

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

  // ===== Channel-neutral core =====
  // Provider-specific code lives in adapters. These records own tenant,
  // lifecycle, allowlist and idempotency contracts only.
  channels: defineTable({
    tenantId: v.id("tenants"),
    publicId: v.string(),
    kind: neutralChannelKindValidator,
    provider: neutralChannelProviderValidator,
    /**
     * Server-assigned operational territory. iaSolution Hub code only accepts
     * `openbsp`; missing or reserved territories fail closed.
     */
    operationalTerritory: v.optional(
      v.union(
        v.literal("openbsp"),
        v.literal("ayamed"),
        v.literal("cindy"),
      ),
    ),
    externalAccountId: v.string(),
    displayName: v.string(),
    status: neutralChannelStatusValidator,
    sendMode: v.union(
      v.literal("disabled"),
      v.literal("allowlist"),
      v.literal("live"),
    ),
    outboundAllowlist: v.array(v.string()),
    connectionState: v.optional(neutralChannelConnectionStateValidator),
    phoneNumber: v.optional(v.string()),
    wabaId: v.optional(v.string()),
    webhookStatus: v.optional(neutralChannelWebhookStatusValidator),
    credentialsConfiguredAt: v.optional(v.number()),
    lastWebhookAt: v.optional(v.number()),
    lastWebhookEventKind: v.optional(v.string()),
    liveApprovedAt: v.optional(v.number()),
    liveApprovedBy: v.optional(v.id("members")),
    lastHealthStatus: v.optional(v.string()),
    lastHealthDetail: v.optional(v.string()),
    lastHealthCheckAt: v.optional(v.number()),
    createdBy: v.id("members"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_public_id", ["publicId"])
    .index("by_tenant", ["tenantId"])
    .index("by_provider_identity", [
      "provider",
      "kind",
      "externalAccountId",
    ])
    .index("by_provider_phone", ["provider", "kind", "phoneNumber"])
    .index("by_tenant_identity", [
      "tenantId",
      "kind",
      "externalAccountId",
    ]),

  channelSecrets: defineTable({
    tenantId: v.id("tenants"),
    channelId: v.id("channels"),
    accessTokenCiphertext: v.string(),
    accessTokenKeyVersion: v.number(),
    webhookSecretCiphertext: v.string(),
    webhookSecretKeyVersion: v.number(),
    encryptedAt: v.number(),
  })
    .index("by_channel", ["channelId"])
    .index("by_tenant", ["tenantId"]),

  channelIdentities: defineTable({
    tenantId: v.id("tenants"),
    channelId: v.id("channels"),
    providerScopedId: v.string(),
    displayName: v.optional(v.string()),
    username: v.optional(v.string()),
    phone: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_channel_identity", ["channelId", "providerScopedId"])
    .index("by_tenant", ["tenantId"]),

  channelEvents: defineTable({
    tenantId: v.id("tenants"),
    channelId: v.id("channels"),
    eventKey: v.string(),
    providerEventId: v.optional(v.string()),
    eventKind: v.string(),
    direction: v.union(v.literal("incoming"), v.literal("outgoing")),
    actorProviderScopedId: v.optional(v.string()),
    actorDisplayName: v.optional(v.string()),
    actorPhone: v.optional(v.string()),
    threadKey: v.optional(v.string()),
    replyToProviderMessageId: v.optional(v.string()),
    flowToken: v.optional(v.string()),
    payload: v.any(),
    rawPayload: v.string(),
    rawBodySha256: v.string(),
    providerTimestamp: v.optional(v.number()),
    status: neutralEventStatusValidator,
    attempts: v.number(),
    lastError: v.optional(v.string()),
    receivedAt: v.number(),
    processedAt: v.optional(v.number()),
  })
    .index("by_channel_key", ["channelId", "eventKey"])
    .index("by_channel_provider_event", ["channelId", "providerEventId"])
    .index("by_channel_received", ["channelId", "receivedAt"])
    .index("by_channel_thread", ["channelId", "threadKey", "receivedAt"])
    .index("by_channel_thread_kind", ["channelId", "threadKey", "eventKind"])
    .index("by_tenant_received", ["tenantId", "receivedAt"]),

  channelOutbox: defineTable({
    tenantId: v.id("tenants"),
    channelId: v.id("channels"),
    businessKey: v.string(),
    recipient: v.string(),
    threadKey: v.optional(v.string()),
    replyToProviderMessageId: v.optional(v.string()),
    messageKind: v.union(
      v.literal("text"),
      v.literal("template"),
      v.literal("interactive"),
      v.literal("document"),
    ),
    payload: v.any(),
    status: neutralOutboxStatusValidator,
    providerMessageId: v.optional(v.string()),
    failureReason: v.optional(v.string()),
    dispatchAttempts: v.number(),
    claimedAt: v.optional(v.number()),
    unknownSince: v.optional(v.number()),
    createdBy: v.id("members"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_channel_business_key", ["channelId", "businessKey"])
    .index("by_channel_created", ["channelId", "createdAt"])
    .index("by_channel_provider_message", ["channelId", "providerMessageId"])
    .index("by_channel_thread_status", [
      "channelId",
      "threadKey",
      "status",
      "createdAt",
    ])
    .index("by_tenant_created", ["tenantId", "createdAt"]),

  channelTemplates: defineTable({
    tenantId: v.id("tenants"),
    channelId: v.id("channels"),
    name: v.string(),
    languageCode: v.string(),
    category: v.optional(v.string()),
    status: v.string(),
    components: v.optional(v.any()),
    providerTemplateId: v.optional(v.string()),
    syncedAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_channel", ["channelId"])
    .index("by_channel_name_language", [
      "channelId",
      "name",
      "languageCode",
    ])
    .index("by_tenant", ["tenantId"]),

  channelFlowDrafts: defineTable({
    tenantId: v.id("tenants"),
    channelId: v.id("channels"),
    name: v.string(),
    categories: v.array(v.string()),
    flowJson: v.any(),
    status: v.union(
      v.literal("draft"),
      v.literal("validated"),
      v.literal("published"),
      v.literal("failed"),
    ),
    providerFlowId: v.optional(v.string()),
    lastError: v.optional(v.string()),
    createdBy: v.id("members"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_channel", ["channelId", "updatedAt"])
    .index("by_channel_name", ["channelId", "name"])
    .index("by_tenant", ["tenantId", "updatedAt"]),

  channelFlowContexts: defineTable({
    tenantId: v.id("tenants"),
    channelId: v.id("channels"),
    threadKey: v.string(),
    recipient: v.string(),
    externalMessageId: v.string(),
    flowId: v.string(),
    flowToken: v.string(),
    createdAt: v.number(),
    expiresAt: v.optional(v.number()),
  })
    .index("by_channel_external_message", [
      "channelId",
      "externalMessageId",
    ])
    .index("by_channel_flow_token", ["channelId", "flowToken"])
    .index("by_tenant_created", ["tenantId", "createdAt"]),

  channelRateLimitBuckets: defineTable({
    tenantId: v.id("tenants"),
    channelId: v.id("channels"),
    scope: v.union(
      v.literal("outbound"),
      v.literal("health"),
      v.literal("template_sync"),
      v.literal("flow_publish"),
    ),
    bucketStart: v.number(),
    count: v.number(),
    updatedAt: v.number(),
  })
    .index("by_channel_scope_bucket", [
      "channelId",
      "scope",
      "bucketStart",
    ])
    .index("by_tenant_updated", ["tenantId", "updatedAt"]),

  /**
   * Channel-neutral thread projection derived from channelEvents. This is the
   * read surface for the multichannel inbox. It is deliberately separate from
   * the legacy conversations table, which is bound to phoneNumbers and cannot
   * represent a non-WhatsApp channel.
   */
  channelThreads: defineTable({
    tenantId: v.id("tenants"),
    channelId: v.id("channels"),
    threadKey: v.string(),
    identityId: v.optional(v.id("channelIdentities")),
    lastEventAt: v.number(),
    lastEventKind: v.string(),
    lastInboundAt: v.optional(v.number()),
    lastOutboundAt: v.optional(v.number()),
    lastPreview: v.optional(v.string()),
    unreadCount: v.number(),
    serviceWindowExpiresAt: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
    leadSource: v.optional(leadSourceValidator),
    leadStatus: v.optional(channelLeadStatusValidator),
    /** What the patient asked for last (see lib/channels/intents.ts). */
    intent: v.optional(threadIntentValidator),
    intentSource: v.optional(intentSourceValidator),
    intentUpdatedAt: v.optional(v.number()),
    /** Campaign whose send this thread replied to (attribution window 7 days). */
    originCampaignId: v.optional(v.id("campaigns")),
    originCampaignAt: v.optional(v.number()),
    nextStep: v.optional(v.string()),
    nextStepDueAt: v.optional(v.number()),
    responsibleMemberId: v.optional(v.id("members")),
    assignedTeamId: v.optional(v.id("teams")),
    inboxStatus: v.optional(channelInboxStatusValidator),
    starredAt: v.optional(v.number()),
    snoozedUntil: v.optional(v.number()),
    closedAt: v.optional(v.number()),
    closedReasonId: v.optional(v.id("threadCloseReasons")),
    dnd: v.optional(v.boolean()),
    /** Set when an automatic reply was blocked by the pilot allowlist gate. */
    pilotBlockedAt: v.optional(v.number()),
    automationMode: v.optional(
      v.union(
        v.literal("idle"),
        v.literal("bot"),
        v.literal("human"),
        v.literal("stopped"),
      ),
    ),
    automationChangedAt: v.optional(v.number()),
    automationChangeReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_channel_thread", ["channelId", "threadKey"])
    .index("by_channel_last_event", ["channelId", "lastEventAt"])
    .index("by_tenant_last_event", ["tenantId", "lastEventAt"])
    .index("by_tenant_lead_status", ["tenantId", "leadStatus", "lastEventAt"])
    .index("by_channel_lead_status", ["channelId", "leadStatus", "lastEventAt"])
    .index("by_tenant_inbox_status", ["tenantId", "inboxStatus", "lastEventAt"])
    .index("by_tenant_responsible", ["tenantId", "responsibleMemberId", "lastEventAt"])
    .index("by_tenant_team", ["tenantId", "assignedTeamId", "lastEventAt"]),

  threadInternalNotes: defineTable({
    tenantId: v.id("tenants"),
    threadId: v.id("channelThreads"),
    body: v.string(),
    mentionedMemberIds: v.array(v.id("members")),
    createdBy: v.id("members"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_thread", ["threadId", "createdAt"])
    .index("by_tenant", ["tenantId", "createdAt"]),

  threadReminders: defineTable({
    tenantId: v.id("tenants"),
    threadId: v.id("channelThreads"),
    note: v.string(),
    dueAt: v.number(),
    status: threadReminderStatusValidator,
    assignedMemberId: v.id("members"),
    createdBy: v.id("members"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_thread", ["threadId", "dueAt"])
    .index("by_tenant_status_due", ["tenantId", "status", "dueAt"]),

  channelAttachments: defineTable({
    tenantId: v.id("tenants"),
    threadId: v.id("channelThreads"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    contentType: v.string(),
    size: v.number(),
    caption: v.optional(v.string()),
    status: channelAttachmentStatusValidator,
    outboxId: v.optional(v.id("channelOutbox")),
    failureReason: v.optional(v.string()),
    createdBy: v.id("members"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_thread", ["threadId", "createdAt"])
    .index("by_tenant", ["tenantId", "createdAt"]),

  threadCloseReasons: defineTable({
    tenantId: v.id("tenants"),
    name: v.string(),
    active: v.boolean(),
    createdBy: v.id("members"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tenant", ["tenantId", "active"])
    .index("by_tenant_name", ["tenantId", "name"]),

  /**
   * Operator-facing system timeline per thread: automation outcomes, pilot
   * gate blocks, handoffs and lead changes. Deliberately separate from
   * channelEvents (provider evidence + projection source: inserting synthetic
   * rows there would move lastEventAt/serviceWindowExpiresAt) and from
   * channelAutomationEvents (run-scoped, requires a chatbot).
   */
  threadSystemEvents: defineTable({
    tenantId: v.id("tenants"),
    channelId: v.id("channels"),
    threadId: v.id("channelThreads"),
    threadKey: v.string(),
    kind: v.string(),
    severity: v.union(
      v.literal("info"),
      v.literal("warning"),
      v.literal("error"),
    ),
    /** ConvexError code or runtime reason when applicable. */
    code: v.optional(v.string()),
    actorType: v.union(
      v.literal("member"),
      v.literal("automation"),
      v.literal("system"),
    ),
    actorMemberId: v.optional(v.id("members")),
    chatbotId: v.optional(v.id("chatbots")),
    runId: v.optional(v.id("channelAutomationRuns")),
    humanCaseId: v.optional(v.id("humanCases")),
    /** Normalized, safe fields only — never raw provider payloads. */
    payload: v.optional(v.any()),
    /** Idempotency key, e.g. `run:<id>:failed`. */
    dedupeKey: v.string(),
    createdAt: v.number(),
  })
    .index("by_thread", ["threadId", "createdAt"])
    .index("by_thread_dedupe", ["threadId", "dedupeKey"])
    .index("by_tenant_kind", ["tenantId", "kind", "createdAt"]),

  // ===== Clinic operating system =====
  clinicServices: defineTable({
    tenantId: v.id("tenants"),
    name: v.string(),
    durationMinutes: v.number(),
    professionalName: v.optional(v.string()),
    bufferBeforeMinutes: v.number(),
    bufferAfterMinutes: v.number(),
    availability: v.array(
      v.object({
        weekday: v.number(),
        start: v.string(),
        end: v.string(),
      }),
    ),
    status: clinicServiceStatusValidator,
    createdBy: v.id("members"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_status", ["tenantId", "status"]),

  clinicAppointments: defineTable({
    tenantId: v.id("tenants"),
    serviceId: v.id("clinicServices"),
    threadId: v.optional(v.id("channelThreads")),
    patientName: v.optional(v.string()),
    patientHandle: v.optional(v.string()),
    startAt: v.number(),
    endAt: v.number(),
    status: clinicAppointmentStatusValidator,
    confirmationReadAt: v.optional(v.number()),
    createdBy: v.id("members"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tenant_start", ["tenantId", "startAt"])
    .index("by_service_start", ["serviceId", "startAt"])
    .index("by_thread", ["tenantId", "threadId", "startAt"]),

  clinicKnowledgeItems: defineTable({
    tenantId: v.id("tenants"),
    kind: clinicKnowledgeKindValidator,
    title: v.string(),
    body: v.string(),
    status: clinicKnowledgeStatusValidator,
    currentVersion: v.number(),
    createdBy: v.id("members"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tenant", ["tenantId", "updatedAt"])
    .index("by_tenant_kind", ["tenantId", "kind", "updatedAt"]),

  clinicKnowledgeRevisions: defineTable({
    tenantId: v.id("tenants"),
    itemId: v.id("clinicKnowledgeItems"),
    version: v.number(),
    title: v.string(),
    body: v.string(),
    changedBy: v.id("members"),
    createdAt: v.number(),
  })
    .index("by_item_version", ["itemId", "version"])
    .index("by_tenant", ["tenantId", "createdAt"]),

  humanCases: defineTable({
    tenantId: v.id("tenants"),
    threadId: v.optional(v.id("channelThreads")),
    reason: v.string(),
    urgency: humanCaseUrgencyValidator,
    question: v.string(),
    status: humanCaseStatusValidator,
    responsibleMemberId: v.optional(v.id("members")),
    slaDueAt: v.number(),
    decision: v.optional(v.string()),
    resolvedAt: v.optional(v.number()),
    createdBy: v.id("members"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tenant_status_sla", ["tenantId", "status", "slaDueAt"])
    .index("by_thread", ["tenantId", "threadId", "createdAt"])
    .index("by_responsible", ["tenantId", "responsibleMemberId", "status"]),

  followUpRules: defineTable({
    tenantId: v.id("tenants"),
    name: v.string(),
    trigger: followUpTriggerValidator,
    delayMinutes: v.number(),
    message: v.string(),
    stopOnReply: v.boolean(),
    status: followUpRuleStatusValidator,
    createdBy: v.id("members"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_status", ["tenantId", "status"]),

  followUpTasks: defineTable({
    tenantId: v.id("tenants"),
    ruleId: v.id("followUpRules"),
    threadId: v.optional(v.id("channelThreads")),
    humanCaseId: v.optional(v.id("humanCases")),
    businessKey: v.string(),
    dueAt: v.number(),
    status: followUpTaskStatusValidator,
    attempts: v.number(),
    lastAttemptAt: v.optional(v.number()),
    stoppedReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_business_key", ["tenantId", "businessKey"])
    .index("by_status_due", ["status", "dueAt"])
    .index("by_thread_status", ["tenantId", "threadId", "status"])
    .index("by_rule_thread", ["ruleId", "threadId", "status"]),

  clinicAuditEvents: defineTable({
    tenantId: v.id("tenants"),
    actorMemberId: v.id("members"),
    actorKind: v.optional(
      v.union(v.literal("member"), v.literal("ai"), v.literal("system")),
    ),
    action: v.string(),
    targetType: v.string(),
    targetId: v.string(),
    payload: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_tenant", ["tenantId", "createdAt"])
    .index("by_target", ["tenantId", "targetType", "targetId"]),

  // ===== WhatsApp connections =====
  whatsappAccounts: defineTable({
    tenantId: v.id("tenants"),
    metaAppId: v.string(),
    businessPortfolioId: v.optional(v.string()),
    wabaId: v.string(),
    /** Legacy fallback only. New connections use encrypted token fields. */
    accessToken: v.optional(v.string()),
    accessTokenCiphertext: v.optional(v.string()),
    accessTokenKeyVersion: v.optional(v.number()),
    accessTokenEncryptedAt: v.optional(v.number()),
    accessTokenEncryption: v.optional(v.literal("aes-256-gcm")),
    onboardingSource: v.optional(
      v.union(
        v.literal("manual"),
        v.literal("embedded_signup"),
        v.literal("api"),
      ),
    ),
    embeddedSignupSessionId: v.optional(v.id("embeddedSignupSessions")),
    status: wabaStatusValidator,
    qualityRating: v.optional(qualityRatingValidator),
    messagingTier: v.optional(v.string()),
    lastQualityCheckAt: v.optional(v.number()),
    lastTokenHealthCheckAt: v.optional(v.number()),
    tokenStatus: tokenStatusValidator,
    /** Human-readable detail for the last token health verdict. */
    tokenHealthDetail: v.optional(v.string()),
    dataAccessExpiresAt: v.optional(v.number()),
    validatedAt: v.optional(v.number()),
    validatedScopes: v.optional(v.array(v.string())),
    tokenExpiresAt: v.optional(v.number()),
    /** Last account_update webhook event + ban/restriction state from Meta. */
    accountUpdateEvent: v.optional(v.string()),
    banState: v.optional(v.string()),
    accountRestrictions: v.optional(v.any()),
    lastDisconnectionReason: v.optional(v.string()),
    lastDisconnectionInitiatedBy: v.optional(v.string()),
    lastDisconnectedAt: v.optional(v.number()),
    lastReconnectedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_waba", ["wabaId"])
    .index("by_tenant", ["tenantId"])
    .index("by_app_waba", ["metaAppId", "wabaId"]),

  phoneNumbers: defineTable({
    tenantId: v.id("tenants"),
    whatsappAccountId: v.id("whatsappAccounts"),
    phoneNumberId: v.string(),
    e164: v.string(),
    displayName: v.string(),
    /** Synced from Meta (GET /{phone-number-id}); never overwrites displayName. */
    verifiedName: v.optional(v.string()),
    messagingTier: v.optional(v.string()),
    throughputLevel: v.optional(v.string()),
    lastQualityEvent: v.optional(v.string()),
    lastQualityEventAt: v.optional(v.number()),
    lastMetaSyncAt: v.optional(v.number()),
    qualityRating: v.optional(qualityRatingValidator),
    qualityLastErrorAt: v.optional(v.number()),
    qualityLastErrorCode: v.optional(v.string()),
    circuitBreakerUntil: v.optional(v.number()),
    circuitBreakerReason: v.optional(v.string()),
    circuitBreakerOpenedAt: v.optional(v.number()),
    /** Public WhatsApp business username adopted for this number (Meta GA
     *  June 2026). Updated via the `business_username_update` webhook. */
    businessUsername: v.optional(v.string()),
    businessUsernameStatus: v.optional(v.string()),
    businessUsernameUpdatedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_phone_number_id", ["phoneNumberId"])
    .index("by_account", ["whatsappAccountId"])
    .index("by_tenant", ["tenantId"])
    .index("by_business_username", ["businessUsername"]),

  // ===== Contacts =====
  // A contact MUST have at least one of (e164, bsuid). Username is a public
  // display alias the user can set on their side; it can change.
  // BSUID = Meta's stable per-business-account identity for this WhatsApp
  // user. Mandatory in webhooks from 2026-03-31; phone number becomes opt-in
  // when the user enables WhatsApp usernames (June 2026 rollout).
  contacts: defineTable({
    tenantId: v.id("tenants"),
    e164: v.optional(v.string()),
    /** Business-Scoped User ID (Meta). Stable per WABA; survives username
     *  enrollment. Format: `<COUNTRY>.<digits>` (e.g. `US.13491208655302741918`).
     *  Required by Meta from 2026-03-31 onward in inbound webhooks. */
    bsuid: v.optional(v.string()),
    /** Parent BSUID — only present when the business has enabled parent
     *  BSUIDs (lets the same end-user share identity across multiple
     *  Business Portfolios). Format: `<COUNTRY>.ENT.<digits>`. */
    parentBsuid: v.optional(v.string()),
    /** Public WhatsApp username chosen by the user (e.g. `@pablomorales`). */
    whatsappUsername: v.optional(v.string()),
    name: v.optional(v.string()),
    locale: v.optional(v.string()),
    tags: v.array(v.string()),
    customAttributes: v.optional(v.any()),
    isMinor: v.optional(v.boolean()),
    createdAt: v.number(),
    erasedAt: v.optional(v.number()),
  })
    .index("by_tenant_phone", ["tenantId", "e164"])
    .index("by_tenant_bsuid", ["tenantId", "bsuid"])
    .index("by_tenant_username", ["tenantId", "whatsappUsername"])
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
    assignedTeamId: v.optional(v.id("teams")),
    assignedAgentId: v.optional(v.id("members")),
    lastMessageAt: v.number(),
    lastIncomingAt: v.optional(v.number()),
    serviceWindowExpiresAt: v.optional(v.number()),
    unreadCount: v.number(),
    tags: v.array(v.string()),
    leadSource: v.optional(leadSourceValidator),
    opportunityStatus: v.optional(opportunityStatusValidator),
    aiState: v.optional(
      v.union(
        v.literal("eligible"),
        v.literal("paused"),
        v.literal("disabled"),
      ),
    ),
    aiPausedReason: v.optional(v.string()),
    lastHumanMessageAt: v.optional(v.number()),
    lastCtwaClickAt: v.optional(v.number()),
    opportunityValueMinor: v.optional(v.number()),
    opportunityCurrency: v.optional(v.string()),
  })
    .index("by_tenant_status", ["tenantId", "status"])
    .index("by_tenant_phone_contact", [
      "tenantId",
      "phoneNumberId",
      "contactId",
    ])
    .index("by_tenant_contact_lastmsg", [
      "tenantId",
      "contactId",
      "lastMessageAt",
    ])
    .index("by_tenant_lastmsg", ["tenantId", "lastMessageAt"]),

  ctwaReferrals: defineTable({
    tenantId: v.id("tenants"),
    conversationId: v.id("conversations"),
    contactId: v.id("contacts"),
    phoneNumberId: v.id("phoneNumbers"),
    metaMessageId: v.string(),
    sourceType: v.optional(v.string()),
    sourceId: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    headline: v.optional(v.string()),
    body: v.optional(v.string()),
    mediaType: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    videoUrl: v.optional(v.string()),
    thumbnailUrl: v.optional(v.string()),
    // Click ID for Conversions API attribution — cannot be backfilled.
    ctwaClid: v.optional(v.string()),
    clickedAt: v.number(),
    freeEntryWindowExpiresAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_conversation", ["conversationId", "clickedAt"])
    .index("by_contact", ["tenantId", "contactId", "clickedAt"])
    .index("by_source", ["tenantId", "sourceId"]),

  aiAuditEvents: defineTable({
    tenantId: v.id("tenants"),
    conversationId: v.id("conversations"),
    contactId: v.id("contacts"),
    kind: v.union(
      v.literal("eligible"),
      v.literal("paused"),
      v.literal("blocked"),
      v.literal("drafted"),
      v.literal("approved"),
    ),
    reason: v.optional(v.string()),
    payload: v.optional(v.any()),
    createdBy: v.optional(v.id("members")),
    createdAt: v.number(),
  })
    .index("by_conversation", ["conversationId", "createdAt"])
    .index("by_tenant", ["tenantId", "createdAt"]),

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
    sentByChatbotId: v.optional(v.id("chatbots")),
    sentByFlowRunId: v.optional(v.id("chatbotFlowRuns")),
    templateId: v.optional(v.id("templates")),
    templateVersion: v.optional(v.number()),
    pricingCategory: v.optional(pricingCategoryValidator),
    // Per-message pricing (PMP): whether Meta bills this message and the
    // pricing type (regular | free_customer_service | free_entry_point).
    pricingBillable: v.optional(v.boolean()),
    pricingType: v.optional(v.string()),
    costMinor: v.optional(v.number()),
    costCurrency: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_meta_id", ["metaMessageId"])
    .index("by_business_key", ["businessKey"])
    .index("by_conversation", ["conversationId", "createdAt"])
    .index("by_status_retry", ["status", "nextRetryAt"])
    .index("by_status_unknown", ["status", "unknownSince"])
    .index("by_tenant_created", ["tenantId", "createdAt"]),

  contactLists: defineTable({
    tenantId: v.id("tenants"),
    name: v.string(),
    description: v.optional(v.string()),
    audienceCriteria: v.optional(v.any()),
    audienceSnapshotAt: v.optional(v.number()),
    audienceMatchedCount: v.optional(v.number()),
    audienceExcludedMarketingRevoked: v.optional(v.number()),
    createdBy: v.id("members"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_name", ["tenantId", "name"]),

  contactListMembers: defineTable({
    tenantId: v.id("tenants"),
    listId: v.id("contactLists"),
    contactId: v.id("contacts"),
    source: v.union(
      v.literal("manual"),
      v.literal("csv_import"),
      v.literal("segment"),
      v.literal("audience_builder"),
    ),
    addedBy: v.id("members"),
    addedAt: v.number(),
  })
    .index("by_list", ["listId"])
    .index("by_list_contact", ["listId", "contactId"])
    .index("by_contact", ["tenantId", "contactId"]),

  csvImportJobs: defineTable({
    tenantId: v.id("tenants"),
    listId: v.optional(v.id("contactLists")),
    fileName: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    totalRows: v.number(),
    createdRows: v.number(),
    updatedRows: v.number(),
    skippedRows: v.number(),
    errorSummary: v.optional(v.any()),
    createdBy: v.id("members"),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_list", ["listId"]),

  campaigns: defineTable({
    tenantId: v.id("tenants"),
    name: v.string(),
    kind: v.optional(v.union(v.literal("template_broadcast"), v.literal("micro_lab"))),
    businessKey: v.optional(v.string()),
    listId: v.optional(v.id("contactLists")),
    templateId: v.optional(v.id("templates")),
    templateVersion: v.optional(v.number()),
    channelId: v.optional(v.id("channels")),
    contentPreview: v.optional(v.string()),
    status: v.optional(campaignStatusValidator),
    createdBy: v.optional(v.id("members")),
    scheduledAt: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    pausedAt: v.optional(v.number()),
    pauseReason: v.optional(v.string()),
    batchSize: v.optional(v.number()),
    failureRatePausedAt: v.optional(v.number()),
    failureRateThreshold: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_status", ["tenantId", "status"])
    .index("by_tenant_business_key", ["tenantId", "businessKey"]),

  campaignRecipients: defineTable({
    tenantId: v.id("tenants"),
    campaignId: v.id("campaigns"),
    contactId: v.id("contacts"),
    messageId: v.optional(v.id("messages")),
    channelId: v.optional(v.id("channels")),
    channelOutboxId: v.optional(v.id("channelOutbox")),
    threadKey: v.optional(v.string()),
    identityKind: v.union(v.literal("phone"), v.literal("bsuid")),
    identityValue: v.string(),
    status: campaignRecipientStatusValidator,
    failureCode: v.optional(v.string()),
    failureReason: v.optional(v.string()),
    metaErrorCategory: v.optional(v.string()),
    providerMessageId: v.optional(v.string()),
    clickedButtonPayload: v.optional(v.string()),
    sentAt: v.optional(v.number()),
    deliveredAt: v.optional(v.number()),
    readAt: v.optional(v.number()),
    clickedAt: v.optional(v.number()),
    repliedAt: v.optional(v.number()),
    convertedAt: v.optional(v.number()),
    conversionLabel: v.optional(v.string()),
    conversionValueMinor: v.optional(v.number()),
    conversionCurrency: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_campaign", ["campaignId"])
    .index("by_campaign_status", ["campaignId", "status"])
    .index("by_message", ["messageId"])
    .index("by_contact", ["tenantId", "contactId"])
    .index("by_channel_outbox", ["channelOutboxId"])
    .index("by_tenant_channel_thread", [
      "tenantId",
      "channelId",
      "threadKey",
      "updatedAt",
    ]),

  campaignEvents: defineTable({
    tenantId: v.id("tenants"),
    campaignId: v.id("campaigns"),
    campaignRecipientId: v.optional(v.id("campaignRecipients")),
    type: v.string(),
    messageId: v.optional(v.id("messages")),
    payload: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_campaign", ["campaignId", "createdAt"])
    .index("by_recipient", ["campaignRecipientId", "createdAt"]),

  // ===== Quick replies (canned messages) — wakit-api parity =====
  quickReplies: defineTable({
    tenantId: v.id("tenants"),
    name: v.string(),
    content: v.string(),
    createdBy: v.id("members"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_name", ["tenantId", "name"]),

  // ===== Chatbots — automation studio folders and bot definitions =====
  chatbotFolders: defineTable({
    tenantId: v.id("tenants"),
    name: v.string(),
    createdBy: v.id("members"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_name", ["tenantId", "name"]),

  chatbots: defineTable({
    tenantId: v.id("tenants"),
    folderId: v.optional(v.id("chatbotFolders")),
    name: v.string(),
    description: v.optional(v.string()),
    status: chatbotStatusValidator,
    triggerKind: chatbotTriggerValidator,
    triggerKeywords: v.optional(v.array(v.string())),
    model: v.optional(v.string()),
    entryNodeKey: v.optional(v.string()),
    flowNodes: v.optional(v.array(chatbotFlowNodeValidator)),
    flowValidationIssues: v.optional(v.array(chatbotFlowIssueValidator)),
    channel: v.literal("whatsapp"),
    /** Required for the channel-neutral runtime. Unbound legacy rows never run there. */
    channelId: v.optional(v.id("channels")),
    createdBy: v.id("members"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_status", ["tenantId", "status"])
    .index("by_tenant_folder", ["tenantId", "folderId"])
    .index("by_channel_status", ["channelId", "status"]),

  chatbotFlowRuns: defineTable({
    tenantId: v.id("tenants"),
    chatbotId: v.id("chatbots"),
    conversationId: v.id("conversations"),
    contactId: v.id("contacts"),
    status: chatbotFlowRunStatusValidator,
    currentNodeKey: v.optional(v.string()),
    vars: v.optional(v.record(v.string(), v.string())),
    repromptCount: v.number(),
    startedAt: v.number(),
    lastAdvancedAt: v.number(),
    endedAt: v.optional(v.number()),
    endReason: v.optional(v.string()),
    lastInboundMessageId: v.optional(v.id("messages")),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_contact_status", ["tenantId", "contactId", "status"])
    .index("by_conversation_status", ["tenantId", "conversationId", "status"])
    .index("by_chatbot_started", ["chatbotId", "startedAt"])
    .index("by_status_last_advanced", ["status", "lastAdvancedAt"]),

  chatbotFlowEvents: defineTable({
    tenantId: v.id("tenants"),
    chatbotId: v.id("chatbots"),
    flowRunId: v.id("chatbotFlowRuns"),
    conversationId: v.id("conversations"),
    contactId: v.id("contacts"),
    eventType: chatbotFlowEventTypeValidator,
    nodeKey: v.optional(v.string()),
    metaMessageId: v.optional(v.string()),
    payload: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_run", ["flowRunId", "createdAt"])
    .index("by_tenant_meta_message", ["tenantId", "metaMessageId"])
    .index("by_chatbot_time", ["chatbotId", "createdAt"]),

  /**
   * Provider-neutral automation runtime. These tables deliberately do not
   * reference legacy conversations, contacts, phoneNumbers, or Meta IDs.
   */
  channelAutomationRuns: defineTable({
    tenantId: v.id("tenants"),
    chatbotId: v.id("chatbots"),
    channelId: v.id("channels"),
    threadId: v.id("channelThreads"),
    threadKey: v.string(),
    status: chatbotFlowRunStatusValidator,
    currentNodeKey: v.optional(v.string()),
    vars: v.optional(v.record(v.string(), v.string())),
    repromptCount: v.number(),
    pendingDispatchId: v.optional(v.id("channelAutomationDispatches")),
    startedAt: v.number(),
    lastAdvancedAt: v.number(),
    endedAt: v.optional(v.number()),
    endReason: v.optional(v.string()),
    lastInboundEventId: v.optional(v.id("channelEvents")),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_last_advanced", ["tenantId", "lastAdvancedAt"])
    .index("by_thread_status", ["channelId", "threadId", "status"])
    .index("by_chatbot_started", ["chatbotId", "startedAt"])
    .index("by_status_last_advanced", ["status", "lastAdvancedAt"]),

  channelAutomationEvents: defineTable({
    tenantId: v.id("tenants"),
    chatbotId: v.id("chatbots"),
    runId: v.id("channelAutomationRuns"),
    channelId: v.id("channels"),
    threadId: v.id("channelThreads"),
    sourceEventId: v.optional(v.id("channelEvents")),
    eventType: chatbotFlowEventTypeValidator,
    nodeKey: v.optional(v.string()),
    payload: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_run", ["runId", "createdAt"])
    .index("by_channel_source_event", ["channelId", "sourceEventId"])
    .index("by_chatbot_time", ["chatbotId", "createdAt"]),

  channelAutomationDispatches: defineTable({
    tenantId: v.id("tenants"),
    chatbotId: v.id("chatbots"),
    runId: v.id("channelAutomationRuns"),
    channelId: v.id("channels"),
    threadId: v.id("channelThreads"),
    threadKey: v.string(),
    sourceEventId: v.id("channelEvents"),
    nodeKey: v.string(),
    businessKey: v.string(),
    messageKind: v.union(
      v.literal("text"),
      v.literal("template"),
      v.literal("interactive"),
    ),
    payload: v.any(),
    replyToProviderMessageId: v.optional(v.string()),
    resumeMode: v.union(
      v.literal("continue"),
      v.literal("wait_input"),
      v.literal("terminal"),
    ),
    autoDispatch: v.boolean(),
    nextNodeKey: v.optional(v.string()),
    waitNodeKey: v.optional(v.string()),
    status: v.union(
      v.literal("queued"),
      v.literal("accepted"),
      v.literal("failed"),
      v.literal("unknown"),
    ),
    outboxId: v.optional(v.id("channelOutbox")),
    providerMessageId: v.optional(v.string()),
    failureReason: v.optional(v.string()),
    createdBy: v.id("members"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_channel_business_key", ["channelId", "businessKey"])
    .index("by_run", ["runId", "createdAt"])
    .index("by_status_created", ["status", "createdAt"]),

  // ===== API keys — external API auth, wakit-api parity =====
  apiKeys: defineTable({
    tenantId: v.id("tenants"),
    name: v.string(),
    keyHash: v.string(),
    keyPreview: v.string(),
    role: v.union(
      v.literal("owner"),
      v.literal("admin"),
      v.literal("agent"),
      v.literal("marketing"),
    ),
    createdBy: v.id("members"),
    createdAt: v.number(),
    revokedAt: v.optional(v.number()),
    lastUsedAt: v.optional(v.number()),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_hash", ["keyHash"]),

  // ===== Member invites — wakit-api onboarding_tokens parity =====
  memberInvites: defineTable({
    tenantId: v.id("tenants"),
    email: v.string(),
    role: v.union(
      v.literal("admin"),
      v.literal("agent"),
      v.literal("marketing"),
    ),
    tokenHash: v.string(),
    invitedBy: v.id("members"),
    status: v.union(
      v.literal("active"),
      v.literal("used"),
      v.literal("revoked"),
      v.literal("expired"),
    ),
    createdAt: v.number(),
    expiresAt: v.number(),
    usedAt: v.optional(v.number()),
    usedByUserId: v.optional(v.id("users")),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_token_hash", ["tokenHash"])
    .index("by_tenant_email", ["tenantId", "email"]),

  embeddedSignupSessions: defineTable({
    tenantId: v.id("tenants"),
    createdBy: v.id("members"),
    launchTokenId: v.optional(v.id("embeddedSignupLaunchTokens")),
    state: v.string(),
    status: v.union(
      v.literal("created"),
      v.literal("callback_received"),
      v.literal("assets_received"),
      v.literal("connected"),
      v.literal("failed"),
    ),
    callbackCode: v.optional(v.string()),
    businessId: v.optional(v.string()),
    wabaId: v.optional(v.string()),
    phoneNumberId: v.optional(v.string()),
    phoneE164: v.optional(v.string()),
    phoneDisplayName: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_state", ["state"]),

  embeddedSignupLaunchTokens: defineTable({
    tenantId: v.id("tenants"),
    createdBy: v.id("members"),
    label: v.optional(v.string()),
    tokenHash: v.string(),
    status: v.union(v.literal("active"), v.literal("revoked")),
    createdAt: v.number(),
    expiresAt: v.number(),
    starts: v.number(),
    lastStartedAt: v.optional(v.number()),
    lastSessionId: v.optional(v.id("embeddedSignupSessions")),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_token_hash", ["tokenHash"]),

  metaAdmissionChecks: defineTable({
    tenantId: v.id("tenants"),
    key: v.string(),
    status: metaAdmissionStatusValidator,
    notes: v.optional(v.string()),
    updatedAt: v.number(),
    updatedBy: v.id("members"),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_key", ["tenantId", "key"]),

  templates: defineTable({
    tenantId: v.id("tenants"),
    whatsappAccountId: v.id("whatsappAccounts"),
    name: v.string(),
    language: v.string(),
    category: v.union(
      v.literal("marketing"),
      v.literal("utility"),
      v.literal("authentication"),
    ),
    currentVersion: v.number(),
    status: v.union(
      v.literal("draft"),
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("paused"),
      v.literal("disabled"),
    ),
    metaTemplateId: v.optional(v.string()),
    qualityScore: v.optional(v.string()),
    rejectionReason: v.optional(v.string()),
    syncedAt: v.optional(v.number()),
    /** "imported" = pulled from the WABA via importFromMeta. */
    source: v.optional(v.union(v.literal("local"), v.literal("imported"))),
    /** NAMED templates need parameter_name on send; we only support POSITIONAL. */
    parameterFormat: v.optional(
      v.union(v.literal("positional"), v.literal("named")),
    ),
    createdAt: v.number(),
    createdBy: v.id("members"),
  })
    .index("by_tenant_name_lang", ["tenantId", "name", "language"])
    .index("by_tenant", ["tenantId"])
    .index("by_meta_template_id", ["metaTemplateId"]),

  templateVersions: defineTable({
    templateId: v.id("templates"),
    tenantId: v.id("tenants"),
    version: v.number(),
    bodyText: v.string(),
    buttons: v.optional(v.array(templateButtonValidator)),
    parameterSchema: v.array(
      v.object({
        index: v.number(),
        name: v.string(),
        example: v.string(),
      }),
    ),
    submittedAt: v.optional(v.number()),
    approvedAt: v.optional(v.number()),
    rejectedAt: v.optional(v.number()),
    rejectionReason: v.optional(v.string()),
    /** Full-fidelity copy of Meta components for imported templates. */
    metaComponents: v.optional(v.any()),
    isLocked: v.boolean(),
    createdBy: v.id("members"),
    createdAt: v.number(),
  }).index("by_template_version", ["templateId", "version"]),

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
