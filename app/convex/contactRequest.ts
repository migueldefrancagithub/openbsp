import { v, ConvexError } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  sendContactRequest,
  getParentBsuidAccounts,
} from "./lib/meta/graph";
import type { Id } from "./_generated/dataModel";

/**
 * Send an interactive `contact_request` prompt to a BSUID-only contact to
 * ask them to share their phone number. Useful when a user has enabled
 * WhatsApp usernames and you need their phone for downstream systems.
 *
 * Re-uses the existing tenant-fence + consent guards via the dispatcher
 * path: we resolve the contact's BSUID and Meta token, send the prompt
 * directly via Graph API, and rely on the standard inbound webhook to
 * persist any reply (which will then carry the user's `wa_id`).
 */
export const send = action({
  args: {
    contactId: v.id("contacts"),
    bodyText: v.string(),
  },
  returns: v.object({
    ok: v.boolean(),
    wamid: v.optional(v.string()),
    reason: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: boolean; wamid?: string; reason?: string }> => {
    const text = args.bodyText.trim();
    if (text.length === 0 || text.length > 1024) {
      throw new ConvexError({
        code: "INVALID_BODY",
        message: "Body text must be 1-1024 chars.",
      });
    }

    const ctxData: {
      tenantId: Id<"tenants">;
      phoneNumberId: string;
      whatsappAccountId: Id<"whatsappAccounts">;
      bsuid?: string;
      e164?: string;
    } | null = await ctx.runQuery(internal.contactRequest._loadContext, {
      contactId: args.contactId,
    });
    if (!ctxData) throw new ConvexError({ code: "CONTACT_NOT_FOUND" });

    const token: string | null = await ctx.runAction(
      internal.whatsappAccounts.decryptWabaToken,
      { whatsappAccountId: ctxData.whatsappAccountId },
    );
    if (!token) throw new ConvexError({ code: "NO_TOKEN" });

    const recipient = ctxData.bsuid
      ? ({ kind: "bsuid", bsuid: ctxData.bsuid } as const)
      : ctxData.e164
        ? ({
            kind: "phone",
            e164WithoutPlus: ctxData.e164.replace(/^\+/, ""),
          } as const)
        : null;
    if (!recipient) {
      throw new ConvexError({
        code: "NO_RECIPIENT",
        message: "Contact has neither phone nor BSUID.",
      });
    }

    const r = await sendContactRequest({
      token,
      phoneNumberId: ctxData.phoneNumberId,
      recipient,
      bodyText: text,
    });
    if (r.ok) return { ok: true, wamid: r.wamid };
    return { ok: false, reason: r.reason };
  },
});

import { internalQuery } from "./_generated/server";

/** Resolve contact identifiers + tenant's sending phone for the prompt. */
export const _loadContext = internalQuery({
  args: { contactId: v.id("contacts") },
  returns: v.union(
    v.object({
      tenantId: v.id("tenants"),
      phoneNumberId: v.string(),
      whatsappAccountId: v.id("whatsappAccounts"),
      bsuid: v.optional(v.string()),
      e164: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const c = await ctx.db.get(args.contactId);
    if (!c) return null;
    const phone = await ctx.db
      .query("phoneNumbers")
      .withIndex("by_tenant", (q) => q.eq("tenantId", c.tenantId))
      .first();
    if (!phone) return null;
    return {
      tenantId: c.tenantId,
      phoneNumberId: phone.phoneNumberId,
      whatsappAccountId: phone.whatsappAccountId,
      bsuid: c.bsuid,
      e164: c.e164,
    };
  },
});

/**
 * Owner/admin utility: list the parent BSUID account + every business
 * portfolio enrolled in it. Lets the workspace verify whether the WABA has
 * parent BSUIDs enabled before flipping any feature flag dependent on it.
 */
export const listParentBsuidAccounts = action({
  args: { businessId: v.string() },
  returns: v.object({
    parentBsuidAccountId: v.string(),
    enrolledBusinessPortfolios: v.array(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    parentBsuidAccountId: string;
    enrolledBusinessPortfolios: string[];
  }> => {
    const me: { tenantId: Id<"tenants">; role: string } | null =
      await ctx.runQuery(internal.whatsappAccounts._meTenant, {});
    if (!me) throw new ConvexError({ code: "UNAUTHENTICATED" });
    if (me.role !== "owner" && me.role !== "admin") {
      throw new ConvexError({ code: "FORBIDDEN" });
    }

    // Use any of the tenant's WABA tokens; they're all valid for Graph.
    const account: {
      whatsappAccountId: Id<"whatsappAccounts">;
    } | null = await ctx.runQuery(internal.contactRequest._anyWaba, {
      tenantId: me.tenantId,
    });
    if (!account) throw new ConvexError({ code: "NO_WABA_CONNECTED" });
    const token: string | null = await ctx.runAction(
      internal.whatsappAccounts.decryptWabaToken,
      { whatsappAccountId: account.whatsappAccountId },
    );
    if (!token) throw new ConvexError({ code: "NO_TOKEN" });

    const result = await getParentBsuidAccounts({
      token,
      businessId: args.businessId,
    });
    if (!result.ok) {
      throw new ConvexError({
        code: "META_REQUEST_FAILED",
        message: result.reason,
        statusCode: result.statusCode,
      });
    }
    return result.data;
  },
});

export const _anyWaba = internalQuery({
  args: { tenantId: v.id("tenants") },
  returns: v.union(
    v.object({ whatsappAccountId: v.id("whatsappAccounts") }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const w = await ctx.db
      .query("whatsappAccounts")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .first();
    return w ? { whatsappAccountId: w._id } : null;
  },
});
