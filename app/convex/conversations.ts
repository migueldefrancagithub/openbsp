import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { tenantQuery, loadByIdInTenant } from "./lib/customFunctions";
import type { Id } from "./_generated/dataModel";

const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Find an open conversation for (tenant, phoneNumber, contact) or create.
 * Called by webhook processor on inbound; updates lastIncomingAt and the
 * 24h service window expiry.
 */
export const upsertForInbound = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    phoneNumberId: v.id("phoneNumbers"),
    contactId: v.id("contacts"),
    incomingAt: v.number(),
  },
  returns: v.id("conversations"),
  handler: async (ctx, args): Promise<Id<"conversations">> => {
    const existing = await ctx.db
      .query("conversations")
      .withIndex("by_tenant_phone_contact", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("phoneNumberId", args.phoneNumberId)
          .eq("contactId", args.contactId),
      )
      .filter((q) => q.neq(q.field("status"), "closed"))
      .first();

    const expiresAt = args.incomingAt + SERVICE_WINDOW_MS;

    if (existing) {
      await ctx.db.patch(existing._id, {
        lastMessageAt: args.incomingAt,
        lastIncomingAt: args.incomingAt,
        serviceWindowExpiresAt: expiresAt,
        unreadCount: existing.unreadCount + 1,
        status: existing.status === "snoozed" ? "open" : existing.status,
      });
      return existing._id;
    }

    return await ctx.db.insert("conversations", {
      tenantId: args.tenantId,
      phoneNumberId: args.phoneNumberId,
      contactId: args.contactId,
      status: "open",
      lastMessageAt: args.incomingAt,
      lastIncomingAt: args.incomingAt,
      serviceWindowExpiresAt: expiresAt,
      unreadCount: 1,
      tags: [],
    });
  },
});

/**
 * Reactive list of open conversations in the tenant, ordered by recency.
 */
export const listOpen = tenantQuery({
  args: { limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      _id: v.id("conversations"),
      contactId: v.id("contacts"),
      contactName: v.optional(v.string()),
      contactE164: v.string(),
      lastMessageAt: v.number(),
      lastIncomingAt: v.optional(v.number()),
      serviceWindowExpiresAt: v.optional(v.number()),
      unreadCount: v.number(),
      status: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 50, 200);
    const rows = await ctx.db
      .query("conversations")
      .withIndex("by_tenant_lastmsg", (q) => q.eq("tenantId", ctx.tenantId))
      .order("desc")
      .take(limit);
    const out = [];
    for (const c of rows) {
      if (c.status === "closed") continue;
      const contact = await ctx.db.get(c.contactId);
      out.push({
        _id: c._id,
        contactId: c.contactId,
        contactName: contact?.name,
        contactE164: contact?.e164 ?? "",
        lastMessageAt: c.lastMessageAt,
        lastIncomingAt: c.lastIncomingAt,
        serviceWindowExpiresAt: c.serviceWindowExpiresAt,
        unreadCount: c.unreadCount,
        status: c.status,
      });
    }
    return out;
  },
});

/**
 * Reactive single conversation lookup with tenant fence.
 */
export const getById = tenantQuery({
  args: { conversationId: v.id("conversations") },
  returns: v.union(
    v.object({
      _id: v.id("conversations"),
      contactId: v.id("contacts"),
      contactName: v.optional(v.string()),
      contactE164: v.string(),
      lastMessageAt: v.number(),
      serviceWindowExpiresAt: v.optional(v.number()),
      unreadCount: v.number(),
      status: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const c = await loadByIdInTenant(
      ctx as Parameters<typeof loadByIdInTenant>[0],
      "conversations",
      args.conversationId,
    );
    const contact = await ctx.db.get(c.contactId);
    return {
      _id: c._id,
      contactId: c.contactId,
      contactName: contact?.name,
      contactE164: contact?.e164 ?? "",
      lastMessageAt: c.lastMessageAt,
      serviceWindowExpiresAt: c.serviceWindowExpiresAt,
      unreadCount: c.unreadCount,
      status: c.status,
    };
  },
});
