import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { tenantMutation } from "./lib/customFunctions";
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
    controllerName: v.string(),
    controllerEmail: v.string(),
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
        controllerName: args.controllerName,
        controllerEmail: args.controllerEmail,
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

/**
 * Accept the standard DPA template digitally. Owner only. Per PLAN
 * section 7.1: required before connecting WhatsApp in healthcare mode.
 */
export const acceptDpa = tenantMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    if (ctx.role !== "owner") {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only the workspace owner can sign the DPA.",
      });
    }
    const tenant = await ctx.db.get(ctx.tenantId);
    if (!tenant) throw new ConvexError({ code: "NOT_FOUND" });
    if (tenant.rgpd.dpaSignedAt) return null;
    await ctx.db.patch(ctx.tenantId, {
      rgpd: { ...tenant.rgpd, dpaSignedAt: Date.now() },
    });
    return null;
  },
});

/**
 * Mark the DPIA as completed. Owner only. Required for healthcare mode
 * before connecting WhatsApp.
 */
export const completeDpia = tenantMutation({
  args: {
    answers: v.object({
      legalBasis: v.string(),
      dataCategories: v.array(v.string()),
      retentionMonths: v.number(),
      thirdParties: v.optional(v.array(v.string())),
      risks: v.optional(v.string()),
      mitigations: v.optional(v.string()),
    }),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (ctx.role !== "owner") {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only the workspace owner can complete the DPIA.",
      });
    }
    const tenant = await ctx.db.get(ctx.tenantId);
    if (!tenant) throw new ConvexError({ code: "NOT_FOUND" });
    // Sanity checks
    if (
      !args.answers.legalBasis ||
      args.answers.dataCategories.length === 0 ||
      args.answers.retentionMonths < 1
    ) {
      throw new ConvexError({
        code: "DPIA_INCOMPLETE",
        message: "Legal basis, at least one data category, and retention months are required.",
      });
    }
    await ctx.db.patch(ctx.tenantId, {
      rgpd: {
        ...tenant.rgpd,
        dpiaCompletedAt: Date.now(),
      },
    });
    return null;
  },
});
