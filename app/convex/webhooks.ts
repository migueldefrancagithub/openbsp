import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { tryRegisterWebhookEvent } from "./lib/idempotency";
import { parseMetaPayload } from "./lib/meta/parsePayload";
import { recordConsentTransition } from "./lib/consent";
import { recordAiAuditEvent } from "./lib/aiControl";
import type { Id } from "./_generated/dataModel";

/**
 * Enqueue a freshly-received webhook payload.
 *
 * This is called from httpAction. The httpAction has already validated the
 * HMAC and computed rawBodySha256. Per item parsed from the payload, we
 * dedup by eventKey. New events are scheduled for processing.
 *
 * Returns nothing — the httpAction returns 200 to Meta regardless.
 */
export const enqueue = internalMutation({
  args: {
    rawPayload: v.string(),
    rawBodySha256: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    let parsed: ReturnType<typeof parseMetaPayload> = [];
    try {
      const obj = JSON.parse(args.rawPayload);
      parsed = parseMetaPayload(obj);
    } catch {
      // Malformed JSON. Persist as a single failed event for forensics.
      await ctx.db.insert("webhookEvents", {
        eventKey: `malformed:${args.rawBodySha256}`,
        rawPayload: args.rawPayload.slice(0, 8000),
        rawBodySha256: args.rawBodySha256,
        status: "failed",
        attempts: 1,
        lastError: "Malformed JSON",
        receivedAt: Date.now(),
        processedAt: Date.now(),
      });
      return null;
    }

    if (parsed.length === 0) {
      // Valid JSON but nothing to act on (e.g. unsupported field). Record
      // for visibility but mark processed.
      await ctx.db.insert("webhookEvents", {
        eventKey: `noop:${args.rawBodySha256}`,
        rawPayload: args.rawPayload.slice(0, 8000),
        rawBodySha256: args.rawBodySha256,
        status: "processed",
        attempts: 0,
        receivedAt: Date.now(),
        processedAt: Date.now(),
      });
      return null;
    }

    for (const item of parsed) {
      // Never truncate: processOne JSON.parses this payload — a sliced
      // string is invalid JSON and the (HMAC-valid) message is lost.
      // Documented payloads exceed 8KB (orders, multi-vCard contacts,
      // 4096-char texts + referral). The 8000-char slices above are
      // forensic-only rows that are never re-parsed.
      const itemPayload = JSON.stringify(item);
      const result = await tryRegisterWebhookEvent(ctx, {
        eventKey: item.eventKey,
        rawPayload: itemPayload,
        rawBodySha256: args.rawBodySha256,
        metaTimestamp: item.metaTimestamp,
      });
      if (result.inserted && result.eventId) {
        await ctx.scheduler.runAfter(1, internal.webhooks.processOne, {
          eventId: result.eventId as Id<"webhookEvents">,
        });
      }
    }
    return null;
  },
});

export const loadEvent = internalQuery({
  args: { eventId: v.id("webhookEvents") },
  returns: v.union(
    v.object({
      _id: v.id("webhookEvents"),
      eventKey: v.string(),
      rawPayload: v.string(),
      status: v.string(),
      attempts: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const e = await ctx.db.get(args.eventId);
    if (!e) return null;
    return {
      _id: e._id,
      eventKey: e.eventKey,
      rawPayload: e.rawPayload,
      status: e.status,
      attempts: e.attempts,
    };
  },
});

export const markProcessing = internalMutation({
  args: { eventId: v.id("webhookEvents") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const e = await ctx.db.get(args.eventId);
    if (!e) return false;
    if (e.status === "processed") return false;
    await ctx.db.patch(args.eventId, {
      status: "processing",
      attempts: e.attempts + 1,
    });
    return true;
  },
});

export const markProcessed = internalMutation({
  args: { eventId: v.id("webhookEvents") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.eventId, {
      status: "processed",
      processedAt: Date.now(),
    });
    return null;
  },
});

export const markFailed = internalMutation({
  args: { eventId: v.id("webhookEvents"), error: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.eventId, {
      status: "failed",
      lastError: args.error.slice(0, 1000),
      processedAt: Date.now(),
    });
    return null;
  },
});

type MetaWebhookError = {
  code: number;
  title?: string;
  message?: string;
  error_data?: { details?: string };
};

function metaWebhookFailureReason(error?: MetaWebhookError): string | undefined {
  if (!error) return undefined;
  const title = error.title?.trim();
  const message = error.message?.trim();
  const details = error.error_data?.details?.trim();
  const main = details || message || title;
  if (!main) return undefined;
  if (title && title !== main && !main.includes(title)) {
    return `${title}: ${main}`;
  }
  return main;
}

/**
 * Resolve the tenant + phoneNumber row from a Meta phone_number_id.
 * If unknown, returns null (we silently skip — log + don't error).
 */
export const resolvePhoneNumber = internalQuery({
  args: { phoneNumberId: v.string() },
  returns: v.union(
    v.object({
      _id: v.id("phoneNumbers"),
      tenantId: v.id("tenants"),
      whatsappAccountId: v.id("whatsappAccounts"),
      circuitBreakerUntil: v.optional(v.number()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const pn = await ctx.db
      .query("phoneNumbers")
      .withIndex("by_phone_number_id", (q) =>
        q.eq("phoneNumberId", args.phoneNumberId),
      )
      .unique();
    if (!pn) return null;
    return {
      _id: pn._id,
      tenantId: pn.tenantId,
      whatsappAccountId: pn.whatsappAccountId,
      circuitBreakerUntil: pn.circuitBreakerUntil,
    };
  },
});

/**
 * Detect STOP-style opt-out keyword in inbound text.
 * Per Meta policy + RGPD: revoke marketing consent. Transactional stays
 * granted (it has a separate legitimate basis).
 */
const STOP_KEYWORD_REGEX =
  /^\s*(stop|parar|cancelar|sair|unsubscribe|cancel|baja|chega|chega disso)[\s.!?]*$/i;

export function isStopKeyword(text: string): boolean {
  return STOP_KEYWORD_REGEX.test(text);
}

function extractInboundButtonPayload(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const message = raw as {
    button?: { payload?: string; text?: string };
    interactive?: {
      type?: string;
      button_reply?: { id?: string; title?: string };
      list_reply?: { id?: string; title?: string };
    };
  };
  return (
    message.interactive?.button_reply?.id ??
    message.interactive?.list_reply?.id ??
    message.button?.payload ??
    message.button?.text
  );
}

function extractInboundText(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const message = raw as {
    text?: { body?: string };
    button?: { payload?: string; text?: string };
    interactive?: {
      button_reply?: { id?: string; title?: string };
      list_reply?: { id?: string; title?: string };
    };
  };
  return (
    message.text?.body ??
    message.interactive?.button_reply?.title ??
    message.interactive?.list_reply?.title ??
    message.button?.text ??
    message.button?.payload
  );
}

export const handleStopKeyword = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    contactId: v.id("contacts"),
    triggeredByText: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Append immutable consent event for marketing → revoked.
    const eventId = await ctx.db.insert("consentEvents", {
      tenantId: args.tenantId,
      contactId: args.contactId,
      purpose: "marketing",
      channel: "whatsapp",
      newStatus: "revoked",
      source: "stop_keyword",
      proofText: args.triggeredByText.slice(0, 500),
      capturedAt: Date.now(),
    });
    // Upsert currentConsents marketing → revoked
    const existing = await ctx.db
      .query("currentConsents")
      .withIndex("by_tenant_contact_purpose_channel", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("contactId", args.contactId)
          .eq("purpose", "marketing")
          .eq("channel", "whatsapp"),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: "revoked",
        effectiveAt: Date.now(),
        lastEventId: eventId,
      });
    } else {
      await ctx.db.insert("currentConsents", {
        tenantId: args.tenantId,
        contactId: args.contactId,
        purpose: "marketing",
        channel: "whatsapp",
        status: "revoked",
        effectiveAt: Date.now(),
        lastEventId: eventId,
      });
    }
    // Cascade: cancel any queued outbound to this contact (handled inline
    // here since cancelPendingForContact lives in lib/consent.ts).
    const conversations = await ctx.db
      .query("conversations")
      .withIndex("by_tenant_phone_contact", (q) =>
        q.eq("tenantId", args.tenantId),
      )
      .filter((q) => q.eq(q.field("contactId"), args.contactId))
      .collect();
    for (const conv of conversations) {
      const queued = await ctx.db
        .query("messages")
        .withIndex("by_conversation", (q) => q.eq("conversationId", conv._id))
        .filter((q) =>
          q.and(
            q.eq(q.field("direction"), "outgoing"),
            q.eq(q.field("status"), "queued"),
          ),
        )
        .collect();
      for (const m of queued) {
        await ctx.db.patch(m._id, {
          status: "failed",
          failureReason: "consent_revoked_by_stop_keyword",
        });
      }
    }
    // Cascade: stop active chatbot flow runs for this contact. Stopped runs
    // never resume (findActiveRun only matches status "active") and the
    // STOP branch in processOne never starts a new one.
    const now = Date.now();
    const activeRuns = await ctx.db
      .query("chatbotFlowRuns")
      .withIndex("by_contact_status", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("contactId", args.contactId)
          .eq("status", "active"),
      )
      .collect();
    for (const run of activeRuns) {
      await ctx.db.patch(run._id, {
        status: "stopped",
        endedAt: now,
        endReason: "stop_keyword",
        lastAdvancedAt: now,
      });
      await ctx.db.insert("chatbotFlowEvents", {
        tenantId: args.tenantId,
        chatbotId: run.chatbotId,
        flowRunId: run._id,
        conversationId: run.conversationId,
        contactId: run.contactId,
        eventType: "stopped",
        nodeKey: run.currentNodeKey,
        payload: { reason: "stop_keyword" },
        createdAt: now,
      });
    }
    return null;
  },
});

/**
 * Recording transactional consent based on inbound message (Meta service
 * window). Only writes if no granted record already exists for the purpose.
 */
export const recordInboundTransactionalConsent = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    contactId: v.id("contacts"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("currentConsents")
      .withIndex("by_tenant_contact_purpose_channel", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("contactId", args.contactId)
          .eq("purpose", "transactional")
          .eq("channel", "whatsapp"),
      )
      .unique();
    if (existing && existing.status === "granted") return null;

    await recordConsentTransition(ctx, {
      tenantId: args.tenantId,
      contactId: args.contactId,
      purpose: "transactional",
      newStatus: "granted",
      source: "inbound_24h",
    });
    return null;
  },
});

/**
 * Apply a Meta `user_preferences` webhook entry. Today we honour only
 * `category=marketing_messages`: `value=stop` revokes marketing consent
 * (cascade-cancels any queued marketing outbound). All other values keep
 * the current consent state untouched — Meta is the source of truth for
 * "is this user willing to receive marketing right now", and an explicit
 * opt-in from this webhook only matters once we already had a grant.
 *
 * Spec: https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids
 */
export const applyUserPreference = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    waId: v.optional(v.string()),
    bsuid: v.optional(v.string()),
    category: v.string(),
    value: v.string(),
    detail: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.category !== "marketing_messages") return null;
    if (args.value !== "stop") return null;

    const contactId = await ctx.runQuery(internal.contacts._findByIdentifier, {
      tenantId: args.tenantId,
      bsuid: args.bsuid,
      waId: args.waId,
    });
    if (!contactId) return null;

    const current = await ctx.db
      .query("currentConsents")
      .withIndex("by_tenant_contact_purpose_channel", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("contactId", contactId)
          .eq("purpose", "marketing")
          .eq("channel", "whatsapp"),
      )
      .unique();
    if (current?.status === "revoked") return null;

    await recordConsentTransition(ctx, {
      tenantId: args.tenantId,
      contactId,
      purpose: "marketing",
      newStatus: "revoked",
      source: "meta_user_preference",
      proofText: args.detail,
    });
    return null;
  },
});

/**
 * Apply a Meta `business_username_update` webhook. Patches the phoneNumber
 * row that matches the `display_phone_number` so the UI can show the
 * current adopted username + status.
 */
export const applyBusinessUsername = internalMutation({
  args: {
    wabaId: v.string(),
    displayPhoneNumber: v.optional(v.string()),
    username: v.string(),
    status: v.string(),
    updatedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const account = await ctx.db
      .query("whatsappAccounts")
      .withIndex("by_waba", (q) => q.eq("wabaId", args.wabaId))
      .first();
    if (!account) return null;

    const phones = await ctx.db
      .query("phoneNumbers")
      .withIndex("by_account", (q) => q.eq("whatsappAccountId", account._id))
      .collect();

    // Match the phone by display number when Meta sends it. If Meta omits the
    // display number, only update when the WABA has a single phone row.
    const display = args.displayPhoneNumber?.trim();
    const normalized = display
      ? display.startsWith("+")
        ? display
        : `+${display}`
      : undefined;
    const phone = display
      ? phones.find((p) => p.e164 === normalized || p.e164 === display)
      : phones.length === 1
        ? phones[0]
        : undefined;
    if (!phone || phone.tenantId !== account.tenantId) return null;

    await ctx.db.patch(phone._id, {
      businessUsername: args.username,
      businessUsernameStatus: args.status,
      businessUsernameUpdatedAt: args.updatedAt,
    });
    return null;
  },
});

export const recordCtwaReferral = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    conversationId: v.id("conversations"),
    contactId: v.id("contacts"),
    phoneNumberId: v.id("phoneNumbers"),
    metaMessageId: v.string(),
    clickedAt: v.number(),
    referral: v.object({
      sourceType: v.optional(v.string()),
      sourceId: v.optional(v.string()),
      sourceUrl: v.optional(v.string()),
      headline: v.optional(v.string()),
      body: v.optional(v.string()),
      mediaType: v.optional(v.string()),
      imageUrl: v.optional(v.string()),
      videoUrl: v.optional(v.string()),
      thumbnailUrl: v.optional(v.string()),
      ctwaClid: v.optional(v.string()),
    }),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("ctwaReferrals")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .filter((q) => q.eq(q.field("metaMessageId"), args.metaMessageId))
      .unique();
    if (existing) return null;
    const freeEntryWindowExpiresAt = args.clickedAt + 72 * 60 * 60 * 1000;
    await ctx.db.insert("ctwaReferrals", {
      tenantId: args.tenantId,
      conversationId: args.conversationId,
      contactId: args.contactId,
      phoneNumberId: args.phoneNumberId,
      metaMessageId: args.metaMessageId,
      sourceType: args.referral.sourceType,
      sourceId: args.referral.sourceId,
      sourceUrl: args.referral.sourceUrl,
      headline: args.referral.headline,
      body: args.referral.body,
      mediaType: args.referral.mediaType,
      imageUrl: args.referral.imageUrl,
      videoUrl: args.referral.videoUrl,
      thumbnailUrl: args.referral.thumbnailUrl,
      ctwaClid: args.referral.ctwaClid,
      clickedAt: args.clickedAt,
      freeEntryWindowExpiresAt,
      createdAt: Date.now(),
    });
    const conversation = await ctx.db.get(args.conversationId);
    await ctx.db.patch(args.conversationId, {
      leadSource: "ctwa",
      opportunityStatus: "new",
      aiState: "eligible",
      aiPausedReason: undefined,
      lastCtwaClickAt: args.clickedAt,
    });
    if (conversation) {
      await recordAiAuditEvent(ctx, {
        tenantId: args.tenantId,
        conversation: {
          ...conversation,
          leadSource: "ctwa",
          opportunityStatus: "new",
          aiState: "eligible",
          aiPausedReason: undefined,
        },
        kind: "eligible",
        reason: "new_ctwa_click",
        payload: {
          metaMessageId: args.metaMessageId,
          sourceId: args.referral.sourceId,
          freeEntryWindowExpiresAt,
        },
        at: args.clickedAt,
      });
    }
    return null;
  },
});

/**
 * Process one webhook event:
 *  - load + claim (status=processing)
 *  - parse the per-item JSON payload
 *  - resolve tenant
 *  - upsert contact + conversation, append message OR update outbound status
 *  - mark processed (or failed)
 * Actions cannot use ctx.db, so this orchestrates via ctx.runMutation/Query.
 */
export const processOne = internalAction({
  args: { eventId: v.id("webhookEvents") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const claimed = await ctx.runMutation(internal.webhooks.markProcessing, {
      eventId: args.eventId,
    });
    if (!claimed) return null;

    const event = await ctx.runQuery(internal.webhooks.loadEvent, {
      eventId: args.eventId,
    });
    if (!event) return null;

    try {
      const item = JSON.parse(event.rawPayload) as
        | { kind: "message"; [k: string]: unknown }
        | { kind: "status"; [k: string]: unknown }
        | { kind: "user_id_update"; [k: string]: unknown }
        | { kind: "user_preference"; [k: string]: unknown }
        | { kind: "business_username_update"; [k: string]: unknown }
        | { kind: "template_status_update"; [k: string]: unknown }
        | { kind: "phone_quality_update"; [k: string]: unknown }
        | { kind: "account_update"; [k: string]: unknown };

      if (item.kind === "message") {
        const phone = await ctx.runQuery(
          internal.webhooks.resolvePhoneNumber,
          { phoneNumberId: String(item.phoneNumberId) },
        );
        if (!phone) {
          await ctx.runMutation(internal.webhooks.markFailed, {
            eventId: args.eventId,
            error: `unknown phone_number_id: ${item.phoneNumberId}`,
          });
          return null;
        }

        const fromE164 = item.fromE164 ? String(item.fromE164) : "";
        const fromBsuid = item.fromBsuid ? String(item.fromBsuid) : undefined;
        const fromParentBsuid = item.fromParentBsuid
          ? String(item.fromParentBsuid)
          : undefined;
        const fromUsername = item.fromUsername
          ? String(item.fromUsername)
          : undefined;
        const contactId = await ctx.runMutation(
          internal.contacts.upsertFromInbound,
          {
            tenantId: phone.tenantId,
            e164: fromE164 || undefined,
            bsuid: fromBsuid,
            parentBsuid: fromParentBsuid,
            username: fromUsername,
            name: item.contactName ? String(item.contactName) : undefined,
          },
        );

        const conversationId = await ctx.runMutation(
          internal.conversations.upsertForInbound,
          {
            tenantId: phone.tenantId,
            phoneNumberId: phone._id,
            contactId,
            incomingAt: Number(item.metaTimestamp),
          },
        );

        const messageType = String(item.type) as
          | "text"
          | "image"
          | "video"
          | "audio"
          | "document"
          | "template"
          | "interactive"
          | "location"
          | "contact"
          | "button"
          | "sticker"
          | "contacts"
          | "order"
          | "request_welcome"
          | "unsupported"
          | "reaction"
          | "system";

        const inboundMessageId = await ctx.runMutation(internal.messages.appendIncoming, {
          tenantId: phone.tenantId,
          conversationId,
          metaMessageId: String(item.wamid),
          type: messageType,
          content: item.raw,
          metaTimestamp: Number(item.metaTimestamp),
        });
        const buttonPayload = extractInboundButtonPayload(item.raw);
        const inboundText = extractInboundText(item.raw);

        await ctx.runMutation(internal.campaigns._markInboundEngagement, {
          tenantId: phone.tenantId,
          contactId,
          receivedAt: Number(item.metaTimestamp),
          buttonPayload,
        });

        const referral = item.referral as
          | {
              source?: string;
              sourceType?: string;
              sourceId?: string;
              sourceUrl?: string;
              headline?: string;
              body?: string;
              mediaType?: string;
              imageUrl?: string;
              videoUrl?: string;
              thumbnailUrl?: string;
              ctwaClid?: string;
            }
          | undefined;
        if (referral?.source === "ctwa") {
          await ctx.runMutation(internal.webhooks.recordCtwaReferral, {
            tenantId: phone.tenantId,
            conversationId,
            contactId,
            phoneNumberId: phone._id,
            metaMessageId: String(item.wamid),
            clickedAt: Number(item.metaTimestamp),
            referral: {
              sourceType: referral.sourceType,
              sourceId: referral.sourceId,
              sourceUrl: referral.sourceUrl,
              headline: referral.headline,
              body: referral.body,
              mediaType: referral.mediaType,
              imageUrl: referral.imageUrl,
              videoUrl: referral.videoUrl,
              thumbnailUrl: referral.thumbnailUrl,
              ctwaClid: referral.ctwaClid,
            },
          });
        }

        await ctx.runMutation(
          internal.webhooks.recordInboundTransactionalConsent,
          {
            tenantId: phone.tenantId,
            contactId,
          },
        );

        // STOP keyword auto-revoke (Meta policy + RGPD). Only for text msgs.
        const isStop =
          messageType === "text" && inboundText ? isStopKeyword(inboundText) : false;
        if (isStop && inboundText) {
          await ctx.runMutation(internal.webhooks.handleStopKeyword, {
            tenantId: phone.tenantId,
            contactId,
            triggeredByText: inboundText,
          });
        } else {
          await ctx.runMutation(internal.chatbotFlows.dispatchInbound, {
            tenantId: phone.tenantId,
            conversationId,
            contactId,
            phoneNumberId: phone._id,
            inboundMessageId,
            metaMessageId: String(item.wamid),
            text: inboundText,
            replyId: buttonPayload,
            receivedAt: Number(item.metaTimestamp),
          });
        }
      } else if (item.kind === "user_id_update") {
        const phone = await ctx.runQuery(
          internal.webhooks.resolvePhoneNumber,
          { phoneNumberId: String(item.phoneNumberId) },
        );
        if (phone) {
          await ctx.runMutation(internal.contacts.rotateBsuid, {
            tenantId: phone.tenantId,
            previousBsuid: String(item.previousBsuid),
            currentBsuid: String(item.currentBsuid),
            previousParentBsuid: item.previousParentBsuid
              ? String(item.previousParentBsuid)
              : undefined,
            currentParentBsuid: item.currentParentBsuid
              ? String(item.currentParentBsuid)
              : undefined,
            waId: item.waId ? String(item.waId) : undefined,
          });
        }
      } else if (item.kind === "user_preference") {
        const phone = await ctx.runQuery(
          internal.webhooks.resolvePhoneNumber,
          { phoneNumberId: String(item.phoneNumberId) },
        );
        if (phone) {
          await ctx.runMutation(internal.webhooks.applyUserPreference, {
            tenantId: phone.tenantId,
            waId: item.waId ? String(item.waId) : undefined,
            bsuid: item.bsuid ? String(item.bsuid) : undefined,
            category: String(item.category),
            value: String(item.value),
            detail: item.detail ? String(item.detail) : undefined,
          });
        }
      } else if (item.kind === "business_username_update") {
        await ctx.runMutation(internal.webhooks.applyBusinessUsername, {
          wabaId: String(item.wabaId),
          displayPhoneNumber: item.displayPhoneNumber
            ? String(item.displayPhoneNumber)
            : undefined,
          username: String(item.username),
          status: String(item.status),
          updatedAt: Number(item.metaTimestamp),
        });
      } else if (item.kind === "template_status_update") {
        await ctx.runMutation(internal.templates.applyMetaStatusUpdate, {
          wabaId: String(item.wabaId),
          metaTemplateId: String(item.metaTemplateId),
          name: String(item.name),
          language: String(item.language),
          event: String(item.event),
          reason: item.reason ? String(item.reason) : undefined,
          updatedAt: Number(item.metaTimestamp),
        });
      } else if (item.kind === "phone_quality_update") {
        await ctx.runMutation(
          internal.whatsappAccounts.applyPhoneQualityUpdate,
          {
            wabaId: String(item.wabaId),
            displayPhoneNumber: String(item.displayPhoneNumber),
            event: String(item.event),
            currentLimit: item.currentLimit
              ? String(item.currentLimit)
              : undefined,
            oldLimit: item.oldLimit ? String(item.oldLimit) : undefined,
            updatedAt: Number(item.metaTimestamp),
          },
        );
      } else if (item.kind === "account_update") {
        await ctx.runMutation(internal.whatsappAccounts.applyAccountUpdate, {
          wabaId: String(item.wabaId),
          event: String(item.event),
          banState: item.banState ? String(item.banState) : undefined,
          restrictions: item.restrictions as
            | Array<{ type: string; expiration?: number; remediation?: string }>
            | undefined,
          violationType: item.violationType
            ? String(item.violationType)
            : undefined,
          disconnectionInfo: item.disconnectionInfo as
            | { reason?: string; initiatedBy?: string }
            | undefined,
          updatedAt: Number(item.metaTimestamp),
        });
      } else if (item.kind === "status") {
        const pricing = item.pricing as
          | {
              category?: string;
              pricing_model?: string;
              billable?: boolean;
              type?: string;
            }
          | undefined;
        const pricingCategory =
          pricing?.category === "marketing" ||
          pricing?.category === "utility" ||
          pricing?.category === "authentication" ||
          pricing?.category === "service"
            ? pricing.category
            : undefined;
        const errors = item.errors as
          | Array<MetaWebhookError>
          | undefined;
        const firstError = errors?.[0];
        const failureReason = metaWebhookFailureReason(firstError);

        await ctx.runMutation(internal.messages.markStatusFromWebhook, {
          metaMessageId: String(item.wamid),
          newStatus: item.status as
            | "sent"
            | "delivered"
            | "read"
            | "played"
            | "failed",
          failureCode: firstError ? String(firstError.code) : undefined,
          failureReason,
          pricingCategory,
          pricingBillable:
            typeof pricing?.billable === "boolean" ? pricing.billable : undefined,
          pricingType: pricing?.type ? String(pricing.type) : undefined,
        });
        if (item.status === "failed") {
          await ctx.runMutation(
            internal.whatsappAccounts.openCircuitBreakerForMetaMessageFailure,
            {
              metaMessageId: String(item.wamid),
              failureCode: firstError ? String(firstError.code) : undefined,
              failureReason,
            },
          );
        }
      }

      await ctx.runMutation(internal.webhooks.markProcessed, {
        eventId: args.eventId,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.runMutation(internal.webhooks.markFailed, {
        eventId: args.eventId,
        error: msg,
      });
    }
    return null;
  },
});
