import { v, ConvexError } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  action,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { tenantQuery } from "./lib/customFunctions";
import { validateMetaToken } from "./lib/meta/graph";
import { classifyMetaFailure } from "./lib/meta/errorClassifier";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { Role } from "./lib/roles";

/**
 * tenantQuery list of WhatsApp accounts for the active tenant. Used in
 * /app/settings to render the connection state.
 */
export const listForTenant = tenantQuery({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("whatsappAccounts"),
      wabaId: v.string(),
      status: v.string(),
      qualityRating: v.optional(v.string()),
      tokenStatus: v.string(),
      validatedAt: v.optional(v.number()),
      tokenExpiresAt: v.optional(v.number()),
      phoneNumbers: v.array(
        v.object({
          _id: v.id("phoneNumbers"),
          phoneNumberId: v.string(),
          e164: v.string(),
          displayName: v.string(),
          qualityRating: v.optional(v.string()),
          circuitBreakerUntil: v.optional(v.number()),
          circuitBreakerReason: v.optional(v.string()),
        }),
      ),
    }),
  ),
  handler: async (ctx) => {
    const accounts = await ctx.db
      .query("whatsappAccounts")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .collect();
    const out = [];
    for (const a of accounts) {
      const phones = await ctx.db
        .query("phoneNumbers")
        .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
        .filter((q) => q.eq(q.field("whatsappAccountId"), a._id))
        .collect();
      out.push({
        _id: a._id,
        wabaId: a.wabaId,
        status: a.status,
        qualityRating: a.qualityRating,
        tokenStatus: a.tokenStatus,
        validatedAt: a.validatedAt,
        tokenExpiresAt: a.tokenExpiresAt,
        phoneNumbers: phones.map((p) => ({
          _id: p._id,
          phoneNumberId: p.phoneNumberId,
          e164: p.e164,
          displayName: p.displayName,
          qualityRating: p.qualityRating,
          circuitBreakerUntil: p.circuitBreakerUntil,
          circuitBreakerReason: p.circuitBreakerReason,
        })),
      });
    }
    return out;
  },
});

// ---------- Internal helpers used by connectManual + dispatcher ----------

export const insertConnection = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    metaAppId: v.string(),
    businessPortfolioId: v.optional(v.string()),
    wabaId: v.string(),
    onboardingSource: v.optional(
      v.union(
        v.literal("manual"),
        v.literal("embedded_signup"),
        v.literal("api"),
      ),
    ),
    embeddedSignupSessionId: v.optional(v.id("embeddedSignupSessions")),
    validatedScopes: v.array(v.string()),
    accessToken: v.string(),
    phoneNumberId: v.string(),
    phoneE164: v.string(),
    phoneDisplayName: v.string(),
  },
  returns: v.object({
    whatsappAccountId: v.id("whatsappAccounts"),
    phoneNumberId: v.id("phoneNumbers"),
  }),
  handler: async (ctx, args) => {
    // Reject if a phoneNumber row already exists for this Meta phone_number_id
    // (would cause cross-tenant leak through webhook dispatch).
    const existingPhone = await ctx.db
      .query("phoneNumbers")
      .withIndex("by_phone_number_id", (q) =>
        q.eq("phoneNumberId", args.phoneNumberId),
      )
      .unique();
    if (existingPhone) {
      throw new ConvexError({
        code: "PHONE_NUMBER_ALREADY_CONNECTED",
        owningTenantId: existingPhone.tenantId,
      });
    }

    const wabaAccountId = await ctx.db.insert("whatsappAccounts", {
      tenantId: args.tenantId,
      metaAppId: args.metaAppId,
      businessPortfolioId: args.businessPortfolioId,
      wabaId: args.wabaId,
      accessToken: args.accessToken,
      onboardingSource: args.onboardingSource ?? "manual",
      embeddedSignupSessionId: args.embeddedSignupSessionId,
      status: "active",
      tokenStatus: "ok",
      validatedAt: Date.now(),
      validatedScopes: args.validatedScopes,
      createdAt: Date.now(),
    });
    const pnId = await ctx.db.insert("phoneNumbers", {
      tenantId: args.tenantId,
      whatsappAccountId: wabaAccountId,
      phoneNumberId: args.phoneNumberId,
      e164: args.phoneE164,
      displayName: args.phoneDisplayName,
      createdAt: Date.now(),
    });
    return { whatsappAccountId: wabaAccountId, phoneNumberId: pnId };
  },
});

export const loadTokenForDispatch = internalQuery({
  args: { whatsappAccountId: v.id("whatsappAccounts") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const acc = await ctx.db.get(args.whatsappAccountId);
    return acc?.accessToken ?? null;
  },
});

export const openCircuitBreakerForMessageFailure = internalMutation({
  args: {
    messageId: v.id("messages"),
    failureCode: v.optional(v.string()),
    failureReason: v.optional(v.string()),
  },
  returns: v.object({ opened: v.boolean(), reason: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const category = classifyMetaFailure({
      code: args.failureCode,
      reason: args.failureReason,
    });
    if (category !== "quality_limit_or_pacing") {
      return { opened: false };
    }
    const msg = await ctx.db.get(args.messageId);
    if (!msg) return { opened: false };
    return await openPhoneCircuitBreaker(ctx, {
      conversationId: msg.conversationId,
      campaignId: msg.sentByCampaignId,
      failureCode: args.failureCode,
      failureReason: args.failureReason,
    });
  },
});

export const openCircuitBreakerForMetaMessageFailure = internalMutation({
  args: {
    metaMessageId: v.string(),
    failureCode: v.optional(v.string()),
    failureReason: v.optional(v.string()),
  },
  returns: v.object({ opened: v.boolean(), reason: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const msg = await ctx.db
      .query("messages")
      .withIndex("by_meta_id", (q) => q.eq("metaMessageId", args.metaMessageId))
      .unique();
    if (!msg) return { opened: false };
    const category = classifyMetaFailure({
      code: args.failureCode,
      reason: args.failureReason,
    });
    if (category !== "quality_limit_or_pacing") {
      return { opened: false };
    }
    return await openPhoneCircuitBreaker(ctx, {
      conversationId: msg.conversationId,
      campaignId: msg.sentByCampaignId,
      failureCode: args.failureCode,
      failureReason: args.failureReason,
    });
  },
});

async function openPhoneCircuitBreaker(
  ctx: { db: any },
  args: {
    conversationId: Id<"conversations">;
    campaignId?: Id<"campaigns">;
    failureCode?: string;
    failureReason?: string;
  },
): Promise<{ opened: boolean; reason?: string }> {
  const conversation = await ctx.db.get(args.conversationId);
  if (!conversation) return { opened: false };
  const phone = (await ctx.db.get(
    conversation.phoneNumberId,
  )) as Doc<"phoneNumbers"> | null;
  if (!phone) return { opened: false };

  const now = Date.now();
  const until = now + 3 * 60 * 60 * 1000;
  const reason =
    args.failureReason ??
    (args.failureCode
      ? `Meta quality/pacing failure ${args.failureCode}`
      : "Meta quality or pacing failure");

  await ctx.db.patch(phone._id, {
    qualityRating: "yellow",
    qualityLastErrorAt: now,
    qualityLastErrorCode: args.failureCode,
    circuitBreakerUntil: until,
    circuitBreakerReason: reason,
    circuitBreakerOpenedAt: now,
  });

  if (args.campaignId) {
    const campaign = (await ctx.db.get(
      args.campaignId,
    )) as Doc<"campaigns"> | null;
    if (
      campaign &&
      campaign.tenantId === phone.tenantId &&
      campaign.status === "running"
    ) {
      await ctx.db.patch(campaign._id, {
        status: "paused",
        pausedAt: now,
        pauseReason: `Paused because ${phone.displayName} hit a Meta quality or pacing limit. Circuit breaker active until ${new Date(
          until,
        ).toISOString()}.`,
        updatedAt: now,
      });
      await ctx.db.insert("campaignEvents", {
        tenantId: phone.tenantId,
        campaignId: campaign._id,
        type: "campaign.auto_paused.phone_quality",
        payload: {
          phoneNumberId: phone._id,
          failureCode: args.failureCode,
          failureReason: args.failureReason,
          circuitBreakerUntil: until,
        },
        createdAt: now,
      });
    }
  }

  return { opened: true, reason };
}

// ---------- Public action: connect a WABA ----------

/**
 * Validate a Meta system user token via Graph API, then store the token and
 * create the whatsappAccount + phoneNumber rows. Action (not mutation)
 * because it makes external HTTP calls. Caller must be authenticated; we
 * resolve their active tenant inside.
 */
export const connectManual = action({
  args: {
    metaAppId: v.string(),
    wabaId: v.string(),
    phoneNumberId: v.string(),
    phoneE164: v.string(),
    phoneDisplayName: v.string(),
    systemUserToken: v.string(),
  },
  returns: v.object({
    whatsappAccountId: v.id("whatsappAccounts"),
    phoneNumberId: v.id("phoneNumbers"),
    validatedScopes: v.array(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    whatsappAccountId: Id<"whatsappAccounts">;
    phoneNumberId: Id<"phoneNumbers">;
    validatedScopes: string[];
  }> => {
    const me: {
      tenantId: Id<"tenants">;
      role: string;
    } | null = await ctx.runQuery(internal.whatsappAccounts._meTenant, {});
    if (!me) throw new ConvexError({ code: "UNAUTHENTICATED" });
    if (me.role !== "owner" && me.role !== "admin") {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only owner or admin can connect a WhatsApp number",
      });
    }

    const validation = await validateMetaToken(args.systemUserToken);
    if (!validation.ok) {
      throw new ConvexError({
        code: "TOKEN_VALIDATION_FAILED",
        reason: validation.reason,
      });
    }

    const result: {
      whatsappAccountId: Id<"whatsappAccounts">;
      phoneNumberId: Id<"phoneNumbers">;
    } = await ctx.runMutation(
      internal.whatsappAccounts.insertConnection,
      {
        tenantId: me.tenantId,
        metaAppId: args.metaAppId,
        onboardingSource: "manual",
        wabaId: args.wabaId,
        validatedScopes: validation.scopes,
        accessToken: args.systemUserToken,
        phoneNumberId: args.phoneNumberId,
        phoneE164: args.phoneE164,
        phoneDisplayName: args.phoneDisplayName,
      },
    );

    return {
      whatsappAccountId: result.whatsappAccountId,
      phoneNumberId: result.phoneNumberId,
      validatedScopes: validation.scopes,
    };
  },
});

/**
 * Internal query: returns active tenant + role for the calling user.
 * Used by connectManual action.
 */
export const _meTenant = internalQuery({
  args: {},
  returns: v.union(
    v.object({
      tenantId: v.id("tenants"),
      role: v.string(),
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
      tenantId: session.activeTenantId,
      role: member.role as Role,
    };
  },
});

/**
 * Fetch the stored WABA access token. Internal only — never expose to
 * clients. Kept as an internalAction to preserve existing callsites.
 */
export const decryptWabaToken = internalAction({
  args: { whatsappAccountId: v.id("whatsappAccounts") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args): Promise<string | null> => {
    return await ctx.runQuery(
      internal.whatsappAccounts.loadTokenForDispatch,
      { whatsappAccountId: args.whatsappAccountId },
    );
  },
});
