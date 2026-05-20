import { ConvexError, v } from "convex/values";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { tenantMutation, tenantQuery } from "./lib/customFunctions";
import type { Id } from "./_generated/dataModel";
import {
  exchangeEmbeddedSignupCode,
  subscribeAppToWaba,
  validateMetaToken,
} from "./lib/meta/graph";

type SignupCallbackStatus =
  | "callback_received"
  | "assets_received"
  | "connected"
  | "failed";

export const begin = tenantMutation({
  args: {},
  returns: v.object({
    sessionId: v.id("embeddedSignupSessions"),
    state: v.string(),
    url: v.optional(v.string()),
    configured: v.boolean(),
  }),
  handler: async (ctx) => {
    const state = crypto.randomUUID();
    const sessionId = await ctx.db.insert("embeddedSignupSessions", {
      tenantId: ctx.tenantId,
      createdBy: ctx.memberId,
      state,
      status: "created",
      createdAt: Date.now(),
    });
    const appId = process.env.META_EMBEDDED_SIGNUP_APP_ID;
    const redirectUri = process.env.META_EMBEDDED_SIGNUP_REDIRECT_URI;
    const configId = process.env.META_EMBEDDED_SIGNUP_CONFIG_ID;
    if (!appId || !redirectUri || !configId) {
      return { sessionId, state, configured: false };
    }
    const url = new URL("https://www.facebook.com/dialog/oauth");
    url.searchParams.set("client_id", appId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("config_id", configId);
    url.searchParams.set("response_type", "code");
    return { sessionId, state, url: url.toString(), configured: true };
  },
});

export const listSessions = tenantQuery({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("embeddedSignupSessions"),
      state: v.string(),
      status: v.string(),
      businessId: v.optional(v.string()),
      wabaId: v.optional(v.string()),
      phoneNumberId: v.optional(v.string()),
      phoneE164: v.optional(v.string()),
      phoneDisplayName: v.optional(v.string()),
      error: v.optional(v.string()),
      createdAt: v.number(),
      completedAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("embeddedSignupSessions")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .order("desc")
      .take(10);
    return rows.map((row) => ({
      _id: row._id,
      state: row.state,
      status: row.status,
      businessId: row.businessId,
      wabaId: row.wabaId,
      phoneNumberId: row.phoneNumberId,
      phoneE164: row.phoneE164,
      phoneDisplayName: row.phoneDisplayName,
      error: row.error,
      createdAt: row.createdAt,
      completedAt: row.completedAt,
    }));
  },
});

export const completeCallback = action({
  args: {
    state: v.string(),
    code: v.optional(v.string()),
    error: v.optional(v.string()),
    businessId: v.optional(v.string()),
    business_id: v.optional(v.string()),
    wabaId: v.optional(v.string()),
    waba_id: v.optional(v.string()),
    phoneNumberId: v.optional(v.string()),
    phone_number_id: v.optional(v.string()),
    phoneE164: v.optional(v.string()),
    phone_e164: v.optional(v.string()),
    phoneDisplayName: v.optional(v.string()),
    phone_display_name: v.optional(v.string()),
  },
  returns: v.object({ ok: v.boolean(), status: v.string() }),
  handler: async (ctx, args) => {
    const session: {
      _id: Id<"embeddedSignupSessions">;
      tenantId: Id<"tenants">;
    } | null = await ctx.runQuery(internal.embeddedSignup._findByState, {
      state: args.state,
    });
    if (!session) throw new ConvexError({ code: "SIGNUP_SESSION_NOT_FOUND" });
    const businessId = args.businessId ?? args.business_id;
    const wabaId = args.wabaId ?? args.waba_id;
    const phoneNumberId = args.phoneNumberId ?? args.phone_number_id;
    const phoneE164 = args.phoneE164 ?? args.phone_e164;
    const phoneDisplayName =
      args.phoneDisplayName ?? args.phone_display_name;
    let status: SignupCallbackStatus = args.error
      ? "failed"
      : businessId || wabaId || phoneNumberId
        ? "assets_received"
        : "callback_received";
    let callbackError = args.error;

    const appId = process.env.META_EMBEDDED_SIGNUP_APP_ID;
    const appSecret = process.env.META_EMBEDDED_SIGNUP_APP_SECRET;
    const redirectUri = process.env.META_EMBEDDED_SIGNUP_REDIRECT_URI;
    if (
      !args.error &&
      args.code &&
      businessId &&
      wabaId &&
      phoneNumberId &&
      phoneE164 &&
      appId &&
      appSecret &&
      redirectUri
    ) {
      const exchange = await exchangeEmbeddedSignupCode({
        appId,
        appSecret,
        redirectUri,
        code: args.code,
      });
      if (!exchange.ok) {
        status = "failed";
        callbackError = `token exchange failed: ${exchange.reason}`;
      } else {
        const validation = await validateMetaToken(exchange.accessToken);
        if (!validation.ok) {
          status = "failed";
          callbackError = `token validation failed: ${validation.reason}`;
        } else {
          const subscribe = await subscribeAppToWaba({
            token: exchange.accessToken,
            wabaId,
          });
          if (!subscribe.ok) {
            status = "failed";
            callbackError = `WABA subscribe failed: ${subscribe.reason}`;
          } else {
            await ctx.runMutation(internal.whatsappAccounts.insertConnection, {
              tenantId: session.tenantId,
              metaAppId: appId,
              businessPortfolioId: businessId,
              onboardingSource: "embedded_signup",
              embeddedSignupSessionId: session._id,
              wabaId,
              validatedScopes: validation.scopes,
              accessToken: exchange.accessToken,
              phoneNumberId,
              phoneE164,
              phoneDisplayName: phoneDisplayName ?? phoneNumberId,
            });
            status = "connected";
          }
        }
      }
    }

    await ctx.runMutation(internal.embeddedSignup._markCallback, {
      sessionId: session._id,
      status,
      code: args.code,
      error: callbackError,
      businessId,
      wabaId,
      phoneNumberId,
      phoneE164,
      phoneDisplayName,
    });
    return {
      ok: status !== "failed",
      status,
    };
  },
});

export const _findByState = internalQuery({
  args: { state: v.string() },
  returns: v.union(
    v.object({
      _id: v.id("embeddedSignupSessions"),
      tenantId: v.id("tenants"),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("embeddedSignupSessions")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .unique();
    if (!session) return null;
    return { _id: session._id, tenantId: session.tenantId };
  },
});

export const _markCallback = internalMutation({
  args: {
    sessionId: v.id("embeddedSignupSessions"),
    status: v.union(
      v.literal("callback_received"),
      v.literal("assets_received"),
      v.literal("connected"),
      v.literal("failed"),
    ),
    code: v.optional(v.string()),
    error: v.optional(v.string()),
    businessId: v.optional(v.string()),
    wabaId: v.optional(v.string()),
    phoneNumberId: v.optional(v.string()),
    phoneE164: v.optional(v.string()),
    phoneDisplayName: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, {
      status: args.status,
      callbackCode: args.code,
      businessId: args.businessId,
      wabaId: args.wabaId,
      phoneNumberId: args.phoneNumberId,
      phoneE164: args.phoneE164,
      phoneDisplayName: args.phoneDisplayName,
      error: args.error,
      completedAt: Date.now(),
    });
    return null;
  },
});
