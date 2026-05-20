import { v, ConvexError } from "convex/values";
import {
  tenantMutation,
  tenantQuery,
  loadByIdInTenant,
} from "./lib/customFunctions";

const NAME_REGEX = /^[a-z0-9_-]{1,40}$/;

export const list = tenantQuery({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("quickReplies"),
      name: v.string(),
      content: v.string(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("quickReplies")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .order("desc")
      .collect();
    return rows.map((r) => ({
      _id: r._id,
      name: r.name,
      content: r.content,
      updatedAt: r.updatedAt,
    }));
  },
});

export const create = tenantMutation({
  args: {
    name: v.string(),
    content: v.string(),
  },
  returns: v.id("quickReplies"),
  handler: async (ctx, args) => {
    if (!NAME_REGEX.test(args.name)) {
      throw new ConvexError({
        code: "INVALID_NAME",
        message:
          "Name must be 1-40 chars, lowercase alphanumeric, _ or - only.",
      });
    }
    const content = args.content.trim();
    if (content.length === 0) throw new ConvexError({ code: "EMPTY_CONTENT" });
    if (content.length > 4096) {
      throw new ConvexError({ code: "CONTENT_TOO_LONG", limit: 4096 });
    }

    const existing = await ctx.db
      .query("quickReplies")
      .withIndex("by_tenant_name", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("name", args.name),
      )
      .unique();
    if (existing) {
      throw new ConvexError({
        code: "NAME_TAKEN",
        message: `Quick reply '${args.name}' already exists.`,
      });
    }

    const now = Date.now();
    return await ctx.db.insert("quickReplies", {
      tenantId: ctx.tenantId,
      name: args.name,
      content,
      createdBy: ctx.memberId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = tenantMutation({
  args: {
    quickReplyId: v.id("quickReplies"),
    content: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await loadByIdInTenant(
      ctx as Parameters<typeof loadByIdInTenant>[0],
      "quickReplies",
      args.quickReplyId,
    );
    const content = args.content.trim();
    if (content.length === 0) throw new ConvexError({ code: "EMPTY_CONTENT" });
    if (content.length > 4096) {
      throw new ConvexError({ code: "CONTENT_TOO_LONG", limit: 4096 });
    }
    await ctx.db.patch(args.quickReplyId, {
      content,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const remove = tenantMutation({
  args: { quickReplyId: v.id("quickReplies") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await loadByIdInTenant(
      ctx as Parameters<typeof loadByIdInTenant>[0],
      "quickReplies",
      args.quickReplyId,
    );
    await ctx.db.delete(args.quickReplyId);
    return null;
  },
});
