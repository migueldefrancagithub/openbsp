import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "./_generated/dataModel";

export const createForCurrentUser = mutation({
  args: {
    name: v.string(),
    vertical: v.union(
      v.literal("clinic"),
      v.literal("services"),
      v.literal("ecommerce"),
      v.literal("other"),
    ),
  },
  returns: v.id("tenants"),
  handler: async (ctx, args) => {
    const userId = (await getAuthUserId(ctx)) as Id<"users"> | null;
    if (!userId) throw new ConvexError({ code: "UNAUTHENTICATED" });

    const tenantId = await ctx.db.insert("tenants", {
      name: args.name,
      vertical: args.vertical,
      healthcareMode: args.vertical === "clinic",
      plan: "starter",
      settings: {
        defaultLocale: "pt-PT",
        timezone: "Europe/Lisbon",
        retentionDays: 730,
      },
      rgpd: {
        controllerName: args.name,
        controllerEmail: "",
      },
      createdAt: Date.now(),
    });

    await ctx.db.insert("members", {
      tenantId,
      userId,
      role: "owner",
      status: "active",
      createdAt: Date.now(),
    });

    const existingSession = await ctx.db
      .query("sessions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (existingSession) {
      await ctx.db.patch(existingSession._id, {
        activeTenantId: tenantId,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("sessions", {
        userId,
        activeTenantId: tenantId,
        updatedAt: Date.now(),
      });
    }

    return tenantId;
  },
});

export const switchActive = mutation({
  args: { tenantId: v.id("tenants") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = (await getAuthUserId(ctx)) as Id<"users"> | null;
    if (!userId) throw new ConvexError({ code: "UNAUTHENTICATED" });
    const member = await ctx.db
      .query("members")
      .withIndex("by_tenant_user", (q) =>
        q.eq("tenantId", args.tenantId).eq("userId", userId),
      )
      .unique();
    if (!member || member.status !== "active") {
      throw new ConvexError({ code: "FORBIDDEN" });
    }
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (session) {
      await ctx.db.patch(session._id, {
        activeTenantId: args.tenantId,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("sessions", {
        userId,
        activeTenantId: args.tenantId,
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});
