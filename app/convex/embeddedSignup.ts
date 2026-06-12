import { ConvexError, v } from "convex/values";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { tenantMutation, tenantQuery } from "./lib/customFunctions";
import type { Id } from "./_generated/dataModel";
import {
  META_GRAPH_VERSION,
  debugToken,
  exchangeEmbeddedSignupCode,
  listWabaPhoneNumbers,
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
    const url = new URL(
      `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`,
    );
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
    // Client-supplied asset ids are HINTS only — Meta's OAuth redirect
    // carries just code+state, and URL params are user-editable. The
    // authoritative assets are derived server-side from the token itself:
    // debug_token granular_scopes (WABA ids the token actually grants)
    // + GET /{waba}/phone_numbers (phone id, E.164, verified name).
    const hintedBusinessId = args.businessId ?? args.business_id;
    const hintedWabaId = args.wabaId ?? args.waba_id;
    const hintedPhoneNumberId = args.phoneNumberId ?? args.phone_number_id;
    let status: SignupCallbackStatus = args.error
      ? "failed"
      : "callback_received";
    let callbackError = args.error;
    let resolvedWabaId = hintedWabaId;
    let resolvedPhoneNumberId = hintedPhoneNumberId;
    let resolvedPhoneE164 = args.phoneE164 ?? args.phone_e164;
    let resolvedPhoneDisplayName =
      args.phoneDisplayName ?? args.phone_display_name;

    const appId = process.env.META_EMBEDDED_SIGNUP_APP_ID;
    const appSecret = process.env.META_EMBEDDED_SIGNUP_APP_SECRET;
    const redirectUri = process.env.META_EMBEDDED_SIGNUP_REDIRECT_URI;
    if (!args.error && args.code && appId && appSecret && redirectUri) {
      const compliance = (await ctx.runQuery(
        internal.whatsappAccounts.checkConnectionCompliance,
        { tenantId: session.tenantId },
      )) as
        | { allowed: true }
        | { allowed: false; code: string; message: string };
      if (!compliance.allowed) {
        status = "failed";
        callbackError = `${compliance.code}: ${compliance.message}`;
      } else {
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
          const resolved = await resolveSignupAssets({
            appId,
            appSecret,
            accessToken: exchange.accessToken,
            hintedWabaId,
            hintedPhoneNumberId,
          });
          if (!resolved.ok) {
            status = "failed";
            callbackError = resolved.reason;
          } else {
            resolvedWabaId = resolved.wabaId;
            resolvedPhoneNumberId = resolved.phoneNumberId;
            resolvedPhoneE164 = resolved.phoneE164;
            resolvedPhoneDisplayName =
              resolved.phoneDisplayName ?? resolved.phoneNumberId;
            const subscribe = await subscribeAppToWaba({
              token: exchange.accessToken,
              wabaId: resolved.wabaId,
            });
            if (!subscribe.ok) {
              status = "failed";
              callbackError = `WABA subscribe failed: ${subscribe.reason}`;
            } else {
              const connection = (await ctx.runMutation(
                internal.whatsappAccounts.insertConnection,
                {
                  tenantId: session.tenantId,
                  metaAppId: appId,
                  businessPortfolioId: hintedBusinessId,
                  onboardingSource: "embedded_signup",
                  embeddedSignupSessionId: session._id,
                  wabaId: resolved.wabaId,
                  validatedScopes: resolved.scopes,
                  accessToken: exchange.accessToken,
                  phoneNumberId: resolved.phoneNumberId,
                  phoneE164: resolved.phoneE164,
                  phoneDisplayName:
                    resolved.phoneDisplayName ?? resolved.phoneNumberId,
                },
              )) as { whatsappAccountId: Id<"whatsappAccounts"> };
              // Persist token expiry from introspection (60-day configs
              // silently die otherwise; "never" stores no expiry).
              await ctx.runMutation(
                internal.whatsappAccounts._patchTokenHealth,
                {
                  whatsappAccountId: connection.whatsappAccountId,
                  tokenStatus: "ok",
                  tokenExpiresAt: resolved.tokenExpiresAt,
                  dataAccessExpiresAt: resolved.dataAccessExpiresAt,
                  validatedScopes: resolved.scopes,
                },
              );
              status = "connected";
            }
          }
        }
      }
    }

    await ctx.runMutation(internal.embeddedSignup._markCallback, {
      sessionId: session._id,
      status,
      code: args.code,
      error: callbackError,
      businessId: hintedBusinessId,
      wabaId: resolvedWabaId,
      phoneNumberId: resolvedPhoneNumberId,
      phoneE164: resolvedPhoneE164,
      phoneDisplayName: resolvedPhoneDisplayName,
    });
    return {
      ok: status !== "failed",
      status,
    };
  },
});

type ResolvedSignupAssets =
  | {
      ok: true;
      wabaId: string;
      phoneNumberId: string;
      phoneE164: string;
      phoneDisplayName?: string;
      scopes: string[];
      tokenExpiresAt?: number;
      dataAccessExpiresAt?: number;
    }
  | { ok: false; reason: string };

/**
 * Derive the connected assets from the token itself:
 *  1. debug_token — assert validity + app match; collect granted WABA ids
 *     from granular_scopes (rejects tampered waba hints).
 *  2. /{waba}/phone_numbers — authoritative phone id / E.164 / name
 *     (rejects tampered phone hints).
 *  3. /me/permissions via validateMetaToken — required scopes present.
 */
async function resolveSignupAssets(args: {
  appId: string;
  appSecret: string;
  accessToken: string;
  hintedWabaId?: string;
  hintedPhoneNumberId?: string;
}): Promise<ResolvedSignupAssets> {
  const introspection = await debugToken({
    appId: args.appId,
    appSecret: args.appSecret,
    inputToken: args.accessToken,
  });
  if (!introspection.ok) {
    return { ok: false, reason: `debug_token failed: ${introspection.message}` };
  }
  if (!introspection.isValid) {
    return {
      ok: false,
      reason: `token invalid: ${introspection.errorMessage ?? "is_valid=false"}`,
    };
  }
  if (introspection.appId && introspection.appId !== args.appId) {
    return { ok: false, reason: "token belongs to a different Meta app" };
  }

  const validation = await validateMetaToken(args.accessToken);
  if (!validation.ok) {
    return { ok: false, reason: `token validation failed: ${validation.reason}` };
  }

  const grantedWabaIds = new Set<string>();
  for (const gs of introspection.granularScopes ?? []) {
    if (
      gs.scope === "whatsapp_business_management" ||
      gs.scope === "whatsapp_business_messaging"
    ) {
      for (const id of gs.target_ids ?? []) grantedWabaIds.add(id);
    }
  }
  let wabaId: string | undefined;
  if (args.hintedWabaId) {
    if (grantedWabaIds.size > 0 && !grantedWabaIds.has(args.hintedWabaId)) {
      return {
        ok: false,
        reason: "waba_id hint not granted to this token (possible tampering)",
      };
    }
    wabaId = args.hintedWabaId;
  } else if (grantedWabaIds.size === 1) {
    wabaId = Array.from(grantedWabaIds)[0];
  } else if (grantedWabaIds.size > 1) {
    return {
      ok: false,
      reason: "token grants multiple WABAs — waba hint required",
    };
  }
  if (!wabaId) {
    return { ok: false, reason: "no WABA derivable from token" };
  }

  const phones = await listWabaPhoneNumbers({
    token: args.accessToken,
    wabaId,
  });
  if (!phones.ok) {
    return { ok: false, reason: `phone_numbers failed: ${phones.message}` };
  }
  const phone = args.hintedPhoneNumberId
    ? phones.data.find((p) => p.id === args.hintedPhoneNumberId)
    : phones.data.length === 1
      ? phones.data[0]
      : phones.data[0];
  if (!phone) {
    return {
      ok: false,
      reason: args.hintedPhoneNumberId
        ? "phone_number_id hint not found on the WABA (possible tampering)"
        : "WABA has no phone numbers",
    };
  }
  const digits = (phone.displayPhoneNumber ?? "").replace(/[^\d]/g, "");
  if (!digits) {
    return { ok: false, reason: "phone has no display number on Meta" };
  }
  return {
    ok: true,
    wabaId,
    phoneNumberId: phone.id,
    phoneE164: `+${digits}`,
    phoneDisplayName: phone.verifiedName,
    scopes: validation.scopes,
    tokenExpiresAt:
      introspection.expiresAt > 0 ? introspection.expiresAt * 1000 : undefined,
    dataAccessExpiresAt: introspection.dataAccessExpiresAt
      ? introspection.dataAccessExpiresAt * 1000
      : undefined,
  };
}

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
