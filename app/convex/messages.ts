import { v, ConvexError } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import {
  loadByIdInTenant,
  requireCapability,
  tenantMutation,
  tenantQuery,
} from "./lib/customFunctions";
import {
  sendWhatsAppText,
  sendWhatsAppTemplate,
  sendWhatsAppMarketingTemplate,
  sendWhatsAppInteractive,
} from "./lib/meta/graph";
import { recordAiAuditEvent } from "./lib/aiControl";
import { classifyMetaFailure } from "./lib/meta/errorClassifier";
import { requireConsent } from "./lib/consent";
import type { Id } from "./_generated/dataModel";

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
  // Inbound types Meta actually delivers (see schema.ts).
  v.literal("button"),
  v.literal("sticker"),
  v.literal("contacts"),
  v.literal("order"),
  v.literal("request_welcome"),
  v.literal("unsupported"),
  v.literal("reaction"),
  v.literal("system"),
);

/**
 * Append an incoming message. Caller (webhook processor) has already
 * resolved tenantId, conversationId, contactId. businessKey for incoming
 * is just the wamid prefixed — we never resend so collision risk is zero.
 */
export const appendIncoming = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    conversationId: v.id("conversations"),
    metaMessageId: v.string(),
    type: messageTypeValidator,
    content: v.any(),
    metaTimestamp: v.number(),
  },
  returns: v.id("messages"),
  handler: async (ctx, args): Promise<Id<"messages">> => {
    // Idempotency: same wamid arriving twice should not create two rows.
    const existing = await ctx.db
      .query("messages")
      .withIndex("by_meta_id", (q) => q.eq("metaMessageId", args.metaMessageId))
      .unique();
    if (existing) return existing._id;

    return await ctx.db.insert("messages", {
      tenantId: args.tenantId,
      conversationId: args.conversationId,
      direction: "incoming",
      businessKey: `inbound:${args.metaMessageId}`,
      metaMessageId: args.metaMessageId,
      type: args.type,
      content: args.content,
      status: "delivered", // inbound from Meta is by definition delivered to us
      dispatchAttempts: 0,
      createdAt: args.metaTimestamp,
    });
  },
});

const STATUS_RANK: Record<string, number> = {
  queued: 0,
  dispatching: 1,
  unknown: 2,
  failed: 3,
  sent: 4,
  delivered: 5,
  read: 6,
  played: 7,
};

/**
 * Update outbound message status from a Meta status webhook.
 * Monotonic guard: never regress (e.g. read → delivered ignored).
 * Also no-op if message not found (status arrived before our send record,
 * or for a message sent outside this system).
 */
export const markStatusFromWebhook = internalMutation({
  args: {
    metaMessageId: v.string(),
    newStatus: v.union(
      v.literal("sent"),
      v.literal("delivered"),
      v.literal("read"),
      v.literal("played"),
      v.literal("failed"),
    ),
    failureCode: v.optional(v.string()),
    failureReason: v.optional(v.string()),
    pricingCategory: v.optional(
      v.union(
        v.literal("marketing"),
        v.literal("utility"),
        v.literal("authentication"),
        v.literal("service"),
      ),
    ),
    pricingBillable: v.optional(v.boolean()),
    pricingType: v.optional(v.string()),
  },
  returns: v.union(v.literal("updated"), v.literal("noop"), v.literal("not_found")),
  handler: async (ctx, args) => {
    const msg = await ctx.db
      .query("messages")
      .withIndex("by_meta_id", (q) => q.eq("metaMessageId", args.metaMessageId))
      .unique();
    if (!msg) return "not_found";

    const currentRank = STATUS_RANK[msg.status] ?? -1;
    const newRank = STATUS_RANK[args.newStatus];
    if (newRank <= currentRank && args.newStatus !== "failed") {
      return "noop";
    }

    await ctx.db.patch(msg._id, {
      status: args.newStatus,
      failureCode: args.failureCode ?? msg.failureCode,
      failureReason: args.failureReason ?? msg.failureReason,
      pricingCategory: args.pricingCategory ?? msg.pricingCategory,
      pricingBillable: args.pricingBillable ?? msg.pricingBillable,
      pricingType: args.pricingType ?? msg.pricingType,
    });
    await syncCampaignRecipientFromMessage(ctx, msg._id, {
      status: args.newStatus === "played" ? "read" : args.newStatus,
      failureCode: args.failureCode,
      failureReason: args.failureReason,
    });
    if (msg.sentByCampaignId && args.newStatus === "failed") {
      await ctx.scheduler.runAfter(1, internal.campaigns._evaluateSafetyPause, {
        campaignId: msg.sentByCampaignId,
      });
    }
    return "updated";
  },
});

/**
 * Reactive list of messages in a conversation, oldest first.
 */
export const listForConversation = tenantQuery({
  args: {
    conversationId: v.id("conversations"),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("messages"),
      direction: v.string(),
      type: v.string(),
      content: v.any(),
      status: v.string(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    // Tenant fence: load conversation first.
    await loadByIdInTenant(
      ctx as Parameters<typeof loadByIdInTenant>[0],
      "conversations",
      args.conversationId,
    );

    const limit = Math.min(args.limit ?? 100, 500);
    const rows = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .order("desc")
      .take(limit);

    return rows
      .reverse()
      .map((m) => ({
        _id: m._id,
        direction: m.direction,
        type: m.type,
        content: m.content,
        status: m.status,
        createdAt: m.createdAt,
      }));
  },
});

// ---------- Outbound text ----------

/**
 * Send a free-text message in an existing conversation. Performs all
 * pre-dispatch gates atomically:
 *   1. tenant fence on conversation
 *   2. capability check (agent role+)
 *   3. 24h service window check (free-text only allowed within window)
 *   4. requireConsent transactional
 *   5. derive businessKey from (conversationId, agent, content, clientNonce)
 *   6. dedup by businessKey (no duplicate row for the same intent)
 *   7. insert message status=queued
 *   8. schedule dispatchOne action
 */
export const sendText = tenantMutation({
  args: {
    conversationId: v.id("conversations"),
    text: v.string(),
    clientNonce: v.string(),
  },
  returns: v.id("messages"),
  handler: async (ctx, args): Promise<Id<"messages">> => {
    requireCapability(ctx.role, "messages.send");
    const trimmed = args.text.trim();
    if (trimmed.length === 0) {
      throw new ConvexError({ code: "EMPTY_TEXT" });
    }
    if (trimmed.length > 4096) {
      throw new ConvexError({ code: "TEXT_TOO_LONG", limit: 4096 });
    }

    const conv = await loadByIdInTenant(
      ctx as Parameters<typeof loadByIdInTenant>[0],
      "conversations",
      args.conversationId,
    );

    // 24h service window check (free-text outside template requires it).
    const now = Date.now();
    if (
      !conv.serviceWindowExpiresAt ||
      conv.serviceWindowExpiresAt <= now
    ) {
      throw new ConvexError({
        code: "SERVICE_WINDOW_EXPIRED",
        message:
          "24h service window is closed. Use a template message instead.",
      });
    }

    // Consent: free-text within window relies on transactional consent
    // (recorded automatically when contact sent us a message).
    await requireConsent(ctx, {
      tenantId: ctx.tenantId,
      contactId: conv.contactId,
      purpose: "transactional",
    });

    // businessKey derived from stable inputs + client nonce (PLAN section
    // 5.4): if user clicks Send twice with same nonce we don't double-send.
    const businessKey = `text:${args.conversationId}:${ctx.memberId}:${args.clientNonce}`;
    const existing = await ctx.db
      .query("messages")
      .withIndex("by_business_key", (q) => q.eq("businessKey", businessKey))
      .unique();
    if (existing) return existing._id;

    const messageId = await ctx.db.insert("messages", {
      tenantId: ctx.tenantId,
      conversationId: args.conversationId,
      direction: "outgoing",
      businessKey,
      type: "text",
      content: { text: { body: trimmed } },
      status: "queued",
      dispatchAttempts: 0,
      sentByAgentId: ctx.memberId,
      createdAt: now,
    });

    // Bump conversation lastMessageAt so it surfaces in the inbox list.
    await ctx.db.patch(args.conversationId, {
      lastMessageAt: now,
      lastHumanMessageAt: now,
      aiState: conv.aiState === "eligible" ? "paused" : conv.aiState,
      aiPausedReason:
        conv.aiState === "eligible" ? "human_reply" : conv.aiPausedReason,
    });
    if (conv.aiState === "eligible") {
      await recordAiAuditEvent(ctx, {
        tenantId: ctx.tenantId,
        conversation: conv,
        kind: "paused",
        reason: "human_reply",
        payload: { messageId, type: "text" },
        createdBy: ctx.memberId,
        at: now,
      });
    }

    await ctx.scheduler.runAfter(1, internal.messages._dispatchOne, {
      messageId,
    });

    return messageId;
  },
});

/**
 * Atomic claim: queued → dispatching, sets claimedAt. If already claimed
 * (or terminal), returns null and dispatcher aborts.
 */
export const _claimForDispatch = internalMutation({
  args: { messageId: v.id("messages") },
  returns: v.union(
    v.object({
      tenantId: v.id("tenants"),
      conversationId: v.id("conversations"),
      content: v.any(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const msg = await ctx.db.get(args.messageId);
    if (!msg) return null;
    if (msg.status !== "queued") return null;

    // Hard stop: never dispatch against a banned/restricted WABA or a
    // revoked token (account_update webhook / token health set these).
    const conv = await ctx.db.get(msg.conversationId);
    const phone = conv ? await ctx.db.get(conv.phoneNumberId) : null;
    const account = phone
      ? await ctx.db.get(phone.whatsappAccountId)
      : null;
    if (
      !account ||
      account.status !== "active" ||
      account.tokenStatus === "revoked"
    ) {
      await ctx.db.patch(args.messageId, {
        status: "failed",
        failureReason: "waba_not_active",
      });
      await syncCampaignRecipientFromMessage(ctx, args.messageId, {
        status: "failed",
        failureReason: "waba_not_active",
      });
      return null;
    }

    await ctx.db.patch(args.messageId, {
      status: "dispatching",
      claimedAt: Date.now(),
      dispatchAttempts: msg.dispatchAttempts + 1,
    });
    await syncCampaignRecipientFromMessage(ctx, args.messageId, {
      status: "dispatching",
    });
    return {
      tenantId: msg.tenantId,
      conversationId: msg.conversationId,
      content: msg.content,
    };
  },
});

/**
 * After Meta accepts and returns wamid, persist it and flip to "sent".
 */
export const _markSentFromAction = internalMutation({
  args: {
    messageId: v.id("messages"),
    metaMessageId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.messageId, {
      status: "sent",
      metaMessageId: args.metaMessageId,
    });
    await syncCampaignRecipientFromMessage(ctx, args.messageId, {
      status: "sent",
    });
    return null;
  },
});

export const _markFailedFromAction = internalMutation({
  args: {
    messageId: v.id("messages"),
    failureReason: v.string(),
    failureCode: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.messageId, {
      status: "failed",
      failureReason: args.failureReason.slice(0, 500),
      failureCode: args.failureCode,
    });
    await syncCampaignRecipientFromMessage(ctx, args.messageId, {
      status: "failed",
      failureReason: args.failureReason.slice(0, 500),
      failureCode: args.failureCode,
    });
    const msg = await ctx.db.get(args.messageId);
    if (msg?.sentByCampaignId) {
      await ctx.scheduler.runAfter(1, internal.campaigns._evaluateSafetyPause, {
        campaignId: msg.sentByCampaignId,
      });
      await ctx.scheduler.runAfter(
        1,
        internal.whatsappAccounts.openCircuitBreakerForMessageFailure,
        {
          messageId: args.messageId,
          failureReason: args.failureReason.slice(0, 500),
          failureCode: args.failureCode,
        },
      );
    }
    return null;
  },
});

export const _markUnknownFromAction = internalMutation({
  args: {
    messageId: v.id("messages"),
    reason: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.messageId, {
      status: "unknown",
      unknownSince: Date.now(),
      failureReason: args.reason.slice(0, 500),
    });
    await syncCampaignRecipientFromMessage(ctx, args.messageId, {
      status: "failed",
      failureReason: args.reason.slice(0, 500),
    });
    return null;
  },
});

/**
 * Internal query: load everything an action needs to dispatch.
 */
export const _loadDispatchPayload = internalQuery({
  args: { messageId: v.id("messages") },
  returns: v.union(
    v.object({
      tenantId: v.id("tenants"),
      content: v.any(),
      whatsappAccountId: v.id("whatsappAccounts"),
      phoneNumberId: v.string(),
      contactE164: v.optional(v.string()),
      contactBsuid: v.optional(v.string()),
      pricingCategory: v.optional(
        v.union(
          v.literal("marketing"),
          v.literal("utility"),
          v.literal("authentication"),
          v.literal("service"),
        ),
      ),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const msg = await ctx.db.get(args.messageId);
    if (!msg) return null;
    const conv = await ctx.db.get(msg.conversationId);
    if (!conv) return null;
    const phone = await ctx.db.get(conv.phoneNumberId);
    if (!phone) return null;
    const contact = await ctx.db.get(conv.contactId);
    if (!contact) return null;
    return {
      tenantId: msg.tenantId,
      content: msg.content,
      whatsappAccountId: phone.whatsappAccountId,
      phoneNumberId: phone.phoneNumberId,
      contactE164: contact.e164,
      contactBsuid: contact.bsuid,
      pricingCategory: msg.pricingCategory,
    };
  },
});

// ---------- Outbound template ----------

/**
 * Send an approved template message. Bypasses the 24h service-window
 * gate (templates exist precisely to re-open conversations). Requires
 *   - template.status === "approved"
 *   - all template variables provided
 *   - consent matching the template category (marketing/transactional/auth)
 */
export const sendTemplate = tenantMutation({
  args: {
    conversationId: v.id("conversations"),
    templateId: v.id("templates"),
    variables: v.record(v.string(), v.string()),
    clientNonce: v.string(),
  },
  returns: v.id("messages"),
  handler: async (ctx, args): Promise<Id<"messages">> => {
    requireCapability(ctx.role, "messages.send_template");
    const conv = await loadByIdInTenant(
      ctx as Parameters<typeof loadByIdInTenant>[0],
      "conversations",
      args.conversationId,
    );
    const tpl = await loadByIdInTenant(
      ctx as Parameters<typeof loadByIdInTenant>[0],
      "templates",
      args.templateId,
    );
    if (tpl.status !== "approved") {
      throw new ConvexError({
        code: "TEMPLATE_NOT_APPROVED",
        status: tpl.status,
      });
    }
    const ver = await ctx.db
      .query("templateVersions")
      .withIndex("by_template_version", (q) =>
        q.eq("templateId", args.templateId).eq("version", tpl.currentVersion),
      )
      .unique();
    if (!ver) throw new ConvexError({ code: "VERSION_NOT_FOUND" });

    // Consent: marketing template requires marketing consent;
    // utility/auth use transactional.
    const purpose: "marketing" | "transactional" | "authentication" =
      tpl.category === "marketing"
        ? "marketing"
        : tpl.category === "authentication"
          ? "authentication"
          : "transactional";
    await requireConsent(ctx, {
      tenantId: ctx.tenantId,
      contactId: conv.contactId,
      purpose,
    });

    // Validate variables present + ordered
    const orderedParams = [...ver.parameterSchema].sort(
      (a, b) => a.index - b.index,
    );
    const orderedValues: string[] = [];
    for (const p of orderedParams) {
      const key = String(p.index);
      const val = args.variables[key];
      if (!val || val.trim().length === 0) {
        throw new ConvexError({
          code: "MISSING_TEMPLATE_VARIABLE",
          index: p.index,
        });
      }
      orderedValues.push(val);
    }

    const businessKey = `template:${args.conversationId}:${args.templateId}:v${tpl.currentVersion}:${args.clientNonce}`;
    const existing = await ctx.db
      .query("messages")
      .withIndex("by_business_key", (q) => q.eq("businessKey", businessKey))
      .unique();
    if (existing) return existing._id;

    const now = Date.now();
    const messageId = await ctx.db.insert("messages", {
      tenantId: ctx.tenantId,
      conversationId: args.conversationId,
      direction: "outgoing",
      businessKey,
      type: "template",
      content: {
        template: {
          name: tpl.name,
          language: tpl.language,
          version: tpl.currentVersion,
          variables: orderedValues,
        },
      },
      status: "queued",
      dispatchAttempts: 0,
      sentByAgentId: ctx.memberId,
      templateId: args.templateId,
      templateVersion: tpl.currentVersion,
      pricingCategory:
        tpl.category === "marketing"
          ? "marketing"
          : tpl.category === "authentication"
            ? "authentication"
            : "utility",
      createdAt: now,
    });

    await ctx.db.patch(args.conversationId, {
      lastMessageAt: now,
      lastHumanMessageAt: now,
      aiState: conv.aiState === "eligible" ? "paused" : conv.aiState,
      aiPausedReason:
        conv.aiState === "eligible" ? "human_reply" : conv.aiPausedReason,
    });
    if (conv.aiState === "eligible") {
      await recordAiAuditEvent(ctx, {
        tenantId: ctx.tenantId,
        conversation: conv,
        kind: "paused",
        reason: "human_reply",
        payload: {
          messageId,
          type: "template",
          templateId: args.templateId,
        },
        createdBy: ctx.memberId,
        at: now,
      });
    }
    await ctx.scheduler.runAfter(1, internal.messages._dispatchOne, {
      messageId,
    });
    return messageId;
  },
});

/**
 * Outbox dispatcher. Crash-safe model:
 *  - claim atomically (queued → dispatching). Return null if already claimed.
 *  - load payload + decrypt token.
 *  - POST Meta. Outcomes:
 *      ok + wamid          → markSent
 *      4xx pre-accept      → markFailed (no retry)
 *      5xx / network / die → markUnknown (NO auto-retry; reconcile manually)
 */
export const _dispatchOne = internalAction({
  args: { messageId: v.id("messages") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const claim = (await ctx.runMutation(internal.messages._claimForDispatch, {
      messageId: args.messageId,
    })) as { tenantId: Id<"tenants"> } | null;
    if (!claim) return null;

    const payload = (await ctx.runQuery(
      internal.messages._loadDispatchPayload,
      { messageId: args.messageId },
    )) as {
      whatsappAccountId: Id<"whatsappAccounts">;
      phoneNumberId: string;
      contactE164?: string;
      contactBsuid?: string;
      content: { text?: { body?: string } };
      pricingCategory?:
        | "marketing"
        | "utility"
        | "authentication"
        | "service";
    } | null;
    if (!payload) {
      await ctx.runMutation(internal.messages._markFailedFromAction, {
        messageId: args.messageId,
        failureReason: "payload not loadable",
      });
      return null;
    }

    const token = (await ctx.runAction(
      internal.whatsappAccounts.decryptWabaToken,
      { whatsappAccountId: payload.whatsappAccountId },
    )) as string | null;
    if (!token) {
      await ctx.runMutation(internal.messages._markFailedFromAction, {
        messageId: args.messageId,
        failureReason: "no decryptable WABA token",
      });
      return null;
    }

    // Prefer BSUID for marketing/utility because it survives WhatsApp
    // usernames. Authentication templates are the exception: OTP-style
    // flows still need a phone identity, so fail early with a useful reason.
    const recipient: import("./lib/meta/graph").WhatsAppRecipient | null =
      payload.pricingCategory === "authentication"
        ? payload.contactE164
          ? {
              kind: "phone",
              e164WithoutPlus: payload.contactE164.replace(/^\+/, ""),
            }
          : null
        : payload.contactBsuid
        ? { kind: "bsuid", bsuid: payload.contactBsuid }
        : payload.contactE164
          ? {
              kind: "phone",
              e164WithoutPlus: payload.contactE164.replace(/^\+/, ""),
            }
          : null;
    if (!recipient) {
      await ctx.runMutation(internal.messages._markFailedFromAction, {
        messageId: args.messageId,
        failureReason:
          payload.pricingCategory === "authentication"
            ? "authentication template requires phone identity"
            : "contact has neither phone nor bsuid",
      });
      return null;
    }
    const isTemplate = !!(payload.content as { template?: unknown })?.template;
    const interactive = (
      payload.content as {
        interactive?: import("./lib/meta/graph").InteractivePayload;
      }
    )?.interactive;

    let result: Awaited<ReturnType<typeof sendWhatsAppText>>;
    try {
      if (interactive) {
        result = await sendWhatsAppInteractive({
          token,
          phoneNumberId: payload.phoneNumberId,
          recipient,
          interactive,
        });
      } else if (isTemplate) {
        const tpl = (
          payload.content as {
            template: {
              name: string;
              language: string;
              variables: string[];
            };
          }
        ).template;
        // Meta routes marketing-category templates to the dedicated
        // /marketing_messages endpoint for pacing. All other categories
        // (utility/authentication/service) go through /messages.
        const sendFn =
          payload.pricingCategory === "marketing"
            ? sendWhatsAppMarketingTemplate
            : sendWhatsAppTemplate;
        result = await sendFn({
          token,
          phoneNumberId: payload.phoneNumberId,
          recipient,
          templateName: tpl.name,
          languageCode: tpl.language,
          bodyVariables: tpl.variables,
        });
      } else {
        const text =
          (payload.content as { text?: { body?: string } })?.text?.body ?? "";
        if (!text) {
          await ctx.runMutation(internal.messages._markFailedFromAction, {
            messageId: args.messageId,
            failureReason: "empty text content",
          });
          return null;
        }
        result = await sendWhatsAppText({
          token,
          phoneNumberId: payload.phoneNumberId,
          recipient,
          text,
        });
      }
    } catch (err) {
      await ctx.runMutation(internal.messages._markUnknownFromAction, {
        messageId: args.messageId,
        reason: err instanceof Error ? err.message : "network error",
      });
      return null;
    }

    if (result.ok) {
      await ctx.runMutation(internal.messages._markSentFromAction, {
        messageId: args.messageId,
        metaMessageId: result.wamid,
      });
      return null;
    }

    // 5xx or unknown → unknown. 4xx (pre-accept) → failed.
    if (result.statusCode && result.statusCode >= 500) {
      await ctx.runMutation(internal.messages._markUnknownFromAction, {
        messageId: args.messageId,
        reason: `Meta ${result.statusCode}: ${result.reason}`,
      });
    } else {
      await ctx.runMutation(internal.messages._markFailedFromAction, {
        messageId: args.messageId,
        failureReason: result.reason,
        failureCode: result.metaCode ? String(result.metaCode) : undefined,
      });
    }
    return null;
  },
});

async function syncCampaignRecipientFromMessage(
  ctx: {
    db: {
      query: any;
      patch: any;
      insert: any;
    };
  },
  messageId: Id<"messages">,
  patch: {
    status:
      | "queued"
      | "dispatching"
      | "sent"
      | "delivered"
      | "read"
      | "failed";
    failureCode?: string;
    failureReason?: string;
  },
): Promise<void> {
  const recipient = await ctx.db
    .query("campaignRecipients")
    .withIndex("by_message", (q: any) => q.eq("messageId", messageId))
    .unique();
  if (!recipient) return;
  const now = Date.now();
  const metaErrorCategory =
    patch.status === "failed"
      ? classifyMetaFailure({
          code: patch.failureCode ?? recipient.failureCode,
          reason: patch.failureReason ?? recipient.failureReason,
        })
      : recipient.metaErrorCategory;
  const statusTimestamps: Record<string, number> = {};
  if (patch.status === "sent" && !recipient.sentAt) {
    statusTimestamps.sentAt = now;
  }
  if (patch.status === "delivered") {
    if (!recipient.sentAt) statusTimestamps.sentAt = now;
    if (!recipient.deliveredAt) statusTimestamps.deliveredAt = now;
  }
  if (patch.status === "read") {
    if (!recipient.sentAt) statusTimestamps.sentAt = now;
    if (!recipient.deliveredAt) statusTimestamps.deliveredAt = now;
    if (!recipient.readAt) statusTimestamps.readAt = now;
  }
  await ctx.db.patch(recipient._id, {
    status: patch.status,
    failureCode: patch.failureCode ?? recipient.failureCode,
    failureReason: patch.failureReason ?? recipient.failureReason,
    metaErrorCategory,
    ...statusTimestamps,
    updatedAt: now,
  });
  if (recipient.status !== patch.status) {
    await ctx.db.insert("campaignEvents", {
      tenantId: recipient.tenantId,
      campaignId: recipient.campaignId,
      campaignRecipientId: recipient._id,
      type: `campaign.recipient.${patch.status}`,
      messageId,
      payload:
        patch.status === "failed"
          ? {
              previousStatus: recipient.status,
              failureCode: patch.failureCode ?? recipient.failureCode,
              failureReason: patch.failureReason ?? recipient.failureReason,
              metaErrorCategory,
            }
          : { previousStatus: recipient.status },
      createdAt: now,
    });
  }
}
