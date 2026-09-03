import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { presenceStatus } from "./lib/assignment";
import { requireCapability, tenantMutation, tenantQuery } from "./lib/customFunctions";

/** Called by the app shell every 30 s while the tab is visible. */
export const heartbeat = tenantMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("presence")
      .withIndex("by_tenant_member", (q) => q.eq("tenantId", ctx.tenantId).eq("memberId", ctx.memberId))
      .unique();
    if (existing) {
      // Skip the write when nothing changes materially (cheap heartbeat).
      if (now - existing.lastSeenAt < 15_000) return null;
      await ctx.db.patch(existing._id, { lastSeenAt: now, updatedAt: now });
    } else {
      await ctx.db.insert("presence", { tenantId: ctx.tenantId, memberId: ctx.memberId, lastSeenAt: now, updatedAt: now });
    }
    return null;
  },
});

export const setManualStatus = tenantMutation({
  args: { status: v.union(v.literal("available"), v.literal("away")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("presence")
      .withIndex("by_tenant_member", (q) => q.eq("tenantId", ctx.tenantId).eq("memberId", ctx.memberId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { manualStatus: args.status, lastSeenAt: now, updatedAt: now });
    } else {
      await ctx.db.insert("presence", { tenantId: ctx.tenantId, memberId: ctx.memberId, lastSeenAt: now, manualStatus: args.status, updatedAt: now });
    }
    return null;
  },
});

export const listTeam = tenantQuery({
  args: {},
  returns: v.array(
    v.object({
      memberId: v.id("members"),
      name: v.optional(v.string()),
      email: v.optional(v.string()),
      role: v.string(),
      status: v.union(v.literal("online"), v.literal("away"), v.literal("offline")),
      lastSeenAt: v.optional(v.number()),
      manualStatus: v.optional(v.string()),
      openThreads: v.number(),
    }),
  ),
  handler: async (ctx) => {
    requireCapability(ctx.role, "presence.view");
    const now = Date.now();
    const members = (await ctx.db
      .query("members")
      .withIndex("by_tenant_user", (q) => q.eq("tenantId", ctx.tenantId))
      .take(100)) as Doc<"members">[];
    const out = [];
    for (const member of members) {
      if (member.status !== "active") continue;
      const user = await ctx.db.get(member.userId);
      const presence = await ctx.db
        .query("presence")
        .withIndex("by_tenant_member", (q) => q.eq("tenantId", ctx.tenantId).eq("memberId", member._id))
        .unique();
      const open = await ctx.db
        .query("channelThreads")
        .withIndex("by_tenant_responsible", (q) => q.eq("tenantId", ctx.tenantId).eq("responsibleMemberId", member._id))
        .order("desc")
        .take(25);
      out.push({
        memberId: member._id,
        name: user?.name,
        email: user?.email,
        role: member.role,
        status: presenceStatus(presence, now),
        lastSeenAt: presence?.lastSeenAt,
        manualStatus: presence?.manualStatus,
        openThreads: open.filter((row) => !row.closedAt).length,
      });
    }
    const rank = { online: 0, away: 1, offline: 2 } as const;
    return out.sort((a, b) => rank[a.status] - rank[b.status] || (a.name ?? "").localeCompare(b.name ?? ""));
  },
});
