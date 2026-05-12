import { v, ConvexError } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import {
  tenantMutation,
  tenantQuery,
  loadByIdInTenant,
} from "./lib/customFunctions";
import { sendWhatsAppText, sendWhatsAppTemplate } from "./lib/meta/graph";
import { requireConsent } from "./lib/consent";
import { validateHealthcareContent } from "./lib/dlp/healthcare";
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
    });
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
    /**
     * Optional override when healthcare DLP soft-blocked the content.
     * Required when DLP returns matched categories that aren't hardBlocked.
     * Always audited.
     */
    healthcareOverride: v.optional(
      v.object({
        justification: v.string(),
      }),
    ),
  },
  returns: v.id("messages"),
  handler: async (ctx, args): Promise<Id<"messages">> => {
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

    // Healthcare DLP gate (Codex round2 #5)
    const tenant = await ctx.db.get(ctx.tenantId);
    let dlpResult: ReturnType<typeof validateHealthcareContent> | null = null;
    if (tenant?.healthcareMode) {
      dlpResult = validateHealthcareContent(trimmed);
      if (!dlpResult.passed) {
        if (dlpResult.hardBlocked) {
          throw new ConvexError({
            code: "HEALTHCARE_HARD_BLOCKED",
            categories: dlpResult.matched,
            message:
              "Content includes terms that cannot be sent via WhatsApp in healthcare mode (diagnosis claims or controlled medication names). Use a portal link or in-person communication.",
          });
        }
        if (!args.healthcareOverride) {
          throw new ConvexError({
            code: "HEALTHCARE_OVERRIDE_REQUIRED",
            categories: dlpResult.matched,
            message:
              "Content includes sensitive terms (dose / frequency). Provide a written justification to send.",
          });
        }
        if (args.healthcareOverride.justification.trim().length < 10) {
          throw new ConvexError({
            code: "HEALTHCARE_OVERRIDE_JUSTIFICATION_TOO_SHORT",
            minLength: 10,
          });
        }
      }
    }

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
      contentValidationResult: dlpResult
        ? {
            passed: dlpResult.passed,
            blockedReasons: dlpResult.matched,
            overrideByMemberId: args.healthcareOverride
              ? ctx.memberId
              : undefined,
            overrideJustification: args.healthcareOverride?.justification,
          }
        : undefined,
      createdAt: now,
    });

    // Bump conversation lastMessageAt so it surfaces in the inbox list.
    await ctx.db.patch(args.conversationId, { lastMessageAt: now });

    await ctx.scheduler.runAfter(0, internal.messages._dispatchOne, {
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
    await ctx.db.patch(args.messageId, {
      status: "dispatching",
      claimedAt: Date.now(),
      dispatchAttempts: msg.dispatchAttempts + 1,
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
      contactE164: v.string(),
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

    await ctx.db.patch(args.conversationId, { lastMessageAt: now });
    await ctx.scheduler.runAfter(0, internal.messages._dispatchOne, {
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
      contactE164: string;
      content: { text?: { body?: string } };
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

    const toWithoutPlus = payload.contactE164.replace(/^\+/, "");
    const isTemplate = !!(payload.content as { template?: unknown })?.template;

    let result: Awaited<ReturnType<typeof sendWhatsAppText>>;
    try {
      if (isTemplate) {
        const tpl = (
          payload.content as {
            template: {
              name: string;
              language: string;
              variables: string[];
            };
          }
        ).template;
        result = await sendWhatsAppTemplate({
          token,
          phoneNumberId: payload.phoneNumberId,
          toE164WithoutPlus: toWithoutPlus,
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
          toE164WithoutPlus: toWithoutPlus,
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
