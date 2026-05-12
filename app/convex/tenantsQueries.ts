import { v, ConvexError } from "convex/values";
import { query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "./_generated/dataModel";
import { tenantQuery } from "./lib/customFunctions";

const ActiveTenantValidator = v.object({
  tenantId: v.id("tenants"),
  name: v.string(),
  vertical: v.string(),
  healthcareMode: v.boolean(),
  role: v.string(),
  dpaSignedAt: v.optional(v.number()),
  dpiaCompletedAt: v.optional(v.number()),
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
      name: tenant.name,
      vertical: tenant.vertical,
      healthcareMode: tenant.healthcareMode,
      role: ctx.role,
      dpaSignedAt: tenant.rgpd.dpaSignedAt,
      dpiaCompletedAt: tenant.rgpd.dpiaCompletedAt,
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
      name: tenant.name,
      vertical: tenant.vertical,
      healthcareMode: tenant.healthcareMode,
      role: member.role,
      dpaSignedAt: tenant.rgpd.dpaSignedAt,
      dpiaCompletedAt: tenant.rgpd.dpiaCompletedAt,
    };
  },
});
