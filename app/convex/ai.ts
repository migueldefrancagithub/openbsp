import { v } from "convex/values";
import { loadByIdInTenant, tenantMutation, tenantQuery } from "./lib/customFunctions";

const aiAuditKindValidator = v.union(
  v.literal("eligible"),
  v.literal("paused"),
  v.literal("blocked"),
  v.literal("drafted"),
  v.literal("approved"),
);

export const recordAuditEvent = tenantMutation({
  args: {
    conversationId: v.id("conversations"),
    kind: aiAuditKindValidator,
    reason: v.optional(v.string()),
    payload: v.optional(v.any()),
  },
  returns: v.id("aiAuditEvents"),
  handler: async (ctx, args) => {
    const conversation = await loadByIdInTenant(
      ctx as Parameters<typeof loadByIdInTenant>[0],
      "conversations",
      args.conversationId,
    );
    return await ctx.db.insert("aiAuditEvents", {
      tenantId: ctx.tenantId,
      conversationId: args.conversationId,
      contactId: conversation.contactId,
      kind: args.kind,
      reason: args.reason,
      payload: args.payload,
      createdBy: ctx.memberId,
      createdAt: Date.now(),
    });
  },
});

export const listForConversation = tenantQuery({
  args: {
    conversationId: v.id("conversations"),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("aiAuditEvents"),
      kind: v.string(),
      reason: v.optional(v.string()),
      payload: v.optional(v.any()),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    await loadByIdInTenant(
      ctx as Parameters<typeof loadByIdInTenant>[0],
      "conversations",
      args.conversationId,
    );
    const rows = await ctx.db
      .query("aiAuditEvents")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .order("desc")
      .take(Math.min(args.limit ?? 20, 100));
    return rows.map((event) => ({
      _id: event._id,
      kind: event.kind,
      reason: event.reason,
      payload: event.payload,
      createdAt: event.createdAt,
    }));
  },
});
