import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalQuery } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/**
 * Tenant context for actions (which cannot read the DB directly). Mirrors
 * `resolveActiveTenant` in lib/customFunctions but returns null instead of
 * throwing, so `tenantAction` can raise a single UNAUTHENTICATED.
 */
export const _tenantContext = internalQuery({
  args: {},
  returns: v.union(
    v.object({
      userId: v.id("users"),
      tenantId: v.id("tenants"),
      memberId: v.id("members"),
      role: v.union(
        v.literal("owner"),
        v.literal("admin"),
        v.literal("agent"),
        v.literal("marketing"),
      ),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const userId = (await getAuthUserId(ctx)) as Id<"users"> | null;
    if (!userId) return null;
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!session) return null;
    const member = await ctx.db
      .query("members")
      .withIndex("by_tenant_user", (q) =>
        q.eq("tenantId", session.activeTenantId).eq("userId", userId),
      )
      .unique();
    if (!member || member.status !== "active") return null;
    return {
      userId,
      tenantId: session.activeTenantId,
      memberId: member._id,
      role: member.role,
    };
  },
});
