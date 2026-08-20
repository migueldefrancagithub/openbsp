import { ConvexError, v } from "convex/values";
import { tenantMutation, tenantQuery } from "./lib/customFunctions";

/**
 * Data-protection acceptance for a workspace.
 *
 * `checkConnectionCompliance` refuses to connect any channel until the tenant
 * carries `rgpd.dpaSignedAt` and `rgpd.dpiaCompletedAt`. That gate exists so a
 * named human takes responsibility before message data starts flowing, so the
 * only correct way through it is for that human to accept — never for the
 * timestamps to be written on their behalf.
 *
 * This records who accepted, under what controller identity, and when.
 */

export const status = tenantQuery({
  args: {},
  returns: v.object({
    controllerName: v.string(),
    controllerEmail: v.string(),
    dpaSignedAt: v.optional(v.number()),
    dpiaCompletedAt: v.optional(v.number()),
    ready: v.boolean(),
    canAccept: v.boolean(),
  }),
  handler: async (ctx) => {
    const tenant = await ctx.db.get(ctx.tenantId);
    if (!tenant) throw new ConvexError({ code: "TENANT_NOT_FOUND" });
    const rgpd = tenant.rgpd;
    return {
      controllerName: rgpd?.controllerName ?? tenant.name,
      controllerEmail: rgpd?.controllerEmail ?? "",
      dpaSignedAt: rgpd?.dpaSignedAt,
      dpiaCompletedAt: rgpd?.dpiaCompletedAt,
      ready: Boolean(rgpd?.dpaSignedAt && rgpd?.dpiaCompletedAt),
      canAccept: ctx.role === "owner",
    };
  },
});

export const acceptDataProcessingTerms = tenantMutation({
  args: {
    controllerName: v.string(),
    controllerEmail: v.string(),
    /** Must be true. Present so acceptance cannot be a side effect. */
    acceptDpa: v.boolean(),
    /** Must be true. The DPIA is work done outside the product. */
    confirmDpiaCompleted: v.boolean(),
  },
  returns: v.object({
    dpaSignedAt: v.number(),
    dpiaCompletedAt: v.number(),
  }),
  handler: async (ctx, args) => {
    // Only the owner. An admin can operate the workspace but cannot bind the
    // organisation to a processing agreement.
    if (ctx.role !== "owner") {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only the workspace owner can accept the data terms.",
      });
    }
    if (!args.acceptDpa || !args.confirmDpiaCompleted) {
      throw new ConvexError({
        code: "ACCEPTANCE_INCOMPLETE",
        message: "Both the agreement and the impact assessment must be confirmed.",
      });
    }

    const controllerName = args.controllerName.trim();
    const controllerEmail = args.controllerEmail.trim().toLowerCase();
    if (controllerName.length < 2 || controllerName.length > 200) {
      throw new ConvexError({ code: "INVALID_CONTROLLER_NAME" });
    }
    if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(controllerEmail)) {
      throw new ConvexError({ code: "INVALID_CONTROLLER_EMAIL" });
    }

    const tenant = await ctx.db.get(ctx.tenantId);
    if (!tenant) throw new ConvexError({ code: "TENANT_NOT_FOUND" });

    const now = Date.now();
    // An earlier acceptance is never overwritten: the audit trail should show
    // when responsibility was first taken, not when the page was last opened.
    const dpaSignedAt = tenant.rgpd?.dpaSignedAt ?? now;
    const dpiaCompletedAt = tenant.rgpd?.dpiaCompletedAt ?? now;

    await ctx.db.patch(tenant._id, {
      rgpd: {
        controllerName,
        controllerEmail,
        dpaSignedAt,
        dpiaCompletedAt,
      },
    });

    return { dpaSignedAt, dpiaCompletedAt };
  },
});
