import { v, ConvexError } from "convex/values";
import { query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "./_generated/dataModel";
import { tenantQuery } from "./lib/customFunctions";

const ActiveTenantValidator = v.object({
  tenantId: v.id("tenants"),
  memberId: v.id("members"),
  name: v.string(),
  vertical: v.string(),
  role: v.string(),
});

const TenantMembershipValidator = v.object({
  tenantId: v.id("tenants"),
  name: v.string(),
  vertical: v.string(),
  plan: v.string(),
  role: v.string(),
  active: v.boolean(),
});

// Strict: throws if not authenticated or no active tenant. Use inside the app.
export const getActive = tenantQuery({
  args: {},
  returns: ActiveTenantValidator,
  handler: async (ctx) => {
    const tenant = await ctx.db.get(ctx.tenantId);
    if (!tenant) throw new ConvexError({ code: "NOT_FOUND" });
    return {
      tenantId: ctx.tenantId,
      memberId: ctx.memberId,
      name: tenant.name,
      vertical: tenant.vertical,
      role: ctx.role,
    };
  },
});

// Optional: returns null gracefully if no session/tenant. Use during bootstrap
// to decide between /onboarding and /app dashboard.
export const getActiveOptional = query({
  args: {},
  returns: v.union(ActiveTenantValidator, v.null()),
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
    const tenant = await ctx.db.get(session.activeTenantId);
    if (!tenant) return null;
    return {
      tenantId: session.activeTenantId,
      memberId: member._id,
      name: tenant.name,
      vertical: tenant.vertical,
      role: member.role,
    };
  },
});

export const listMine = query({
  args: {},
  returns: v.array(TenantMembershipValidator),
  handler: async (ctx) => {
    const userId = (await getAuthUserId(ctx)) as Id<"users"> | null;
    if (!userId) throw new ConvexError({ code: "UNAUTHENTICATED" });

    const session = await ctx.db
      .query("sessions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    const memberships = await ctx.db
      .query("members")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const rows = [];
    for (const member of memberships) {
      if (member.status !== "active") continue;
      const tenant = await ctx.db.get(member.tenantId);
      if (!tenant) continue;
      rows.push({
        tenantId: member.tenantId,
        name: tenant.name,
        vertical: tenant.vertical,
        plan: tenant.plan,
        role: member.role,
        active: session?.activeTenantId === member.tenantId,
      });
    }

    return rows.sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  },
});
