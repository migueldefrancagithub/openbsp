import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/**
 * Find a contact by (tenantId, e164) or create it. Returns the id.
 * Used by webhook processor when receiving a message from a new number.
 */
export const upsertByE164 = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    e164: v.string(),
    name: v.optional(v.string()),
  },
  returns: v.id("contacts"),
  handler: async (ctx, args): Promise<Id<"contacts">> => {
    const existing = await ctx.db
      .query("contacts")
      .withIndex("by_tenant_phone", (q) =>
        q.eq("tenantId", args.tenantId).eq("e164", args.e164),
      )
      .unique();
    if (existing) {
      // Update name if we now have one and it was empty before.
      if (args.name && !existing.name) {
        await ctx.db.patch(existing._id, { name: args.name });
      }
      return existing._id;
    }
    return await ctx.db.insert("contacts", {
      tenantId: args.tenantId,
      e164: args.e164,
      name: args.name,
      tags: [],
      createdAt: Date.now(),
    });
  },
});
