import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { tenantQuery, loadByIdInTenant } from "./lib/customFunctions";
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
