import { v, ConvexError } from "convex/values";
import {
  loadByIdInTenant,
  requireCapability,
  tenantMutation,
  tenantQuery,
} from "./lib/customFunctions";

const NAME_REGEX = /^[a-z0-9_-]{1,40}$/;

/**
 * Shortcuts are typed by humans ("Bom dia!", "/Marcação"). Normalize the
 * same way the UI does so API callers and imports never hit INVALID_NAME for
 * spaces, accents or a leading slash.
 */
export function normalizeQuickReplyName(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/^\/+/, "")
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

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
    requireCapability(ctx.role, "quick_replies.manage");
    const name = normalizeQuickReplyName(args.name);
    if (!NAME_REGEX.test(name)) {
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
        q.eq("tenantId", ctx.tenantId).eq("name", name),
      )
      .unique();
    if (existing) {
      throw new ConvexError({
        code: "NAME_TAKEN",
        message: `Quick reply '${name}' already exists.`,
      });
    }

    const now = Date.now();
    return await ctx.db.insert("quickReplies", {
      tenantId: ctx.tenantId,
      name,
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
    requireCapability(ctx.role, "quick_replies.manage");
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
    requireCapability(ctx.role, "quick_replies.manage");
    await loadByIdInTenant(
      ctx as Parameters<typeof loadByIdInTenant>[0],
      "quickReplies",
      args.quickReplyId,
    );
    await ctx.db.delete(args.quickReplyId);
    return null;
  },
});
