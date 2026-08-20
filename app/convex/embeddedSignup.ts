import { ConvexError, v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
} from "./_generated/server";
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

const LAUNCH_TOKEN_DEFAULT_TTL_HOURS = 72;
const LAUNCH_TOKEN_MAX_TTL_HOURS = 24 * 30;

export const begin = tenantMutation({
  args: {},
  returns: v.object({
    sessionId: v.id("embeddedSignupSessions"),
    state: v.string(),
    url: v.optional(v.string()),
    appId: v.optional(v.string()),
    configId: v.optional(v.string()),
    graphVersion: v.optional(v.string()),
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
    const appSecret = process.env.META_EMBEDDED_SIGNUP_APP_SECRET;
    if (!appId || !configId || !appSecret) {
      return { sessionId, state, configured: false };
    }
    let url: string | undefined;
    if (redirectUri) {
      const fallbackUrl = new URL(
        `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`,
      );
      fallbackUrl.searchParams.set("client_id", appId);
      fallbackUrl.searchParams.set("redirect_uri", redirectUri);
      fallbackUrl.searchParams.set("state", state);
      fallbackUrl.searchParams.set("config_id", configId);
      fallbackUrl.searchParams.set("response_type", "code");
      url = fallbackUrl.toString();
    }
    return {
      sessionId,
      state,
      url,
      appId,
      configId,
      graphVersion: META_GRAPH_VERSION,
      configured: true,
    };
  },
});

export const createLaunchLink = tenantMutation({
  args: {
    label: v.optional(v.string()),
    expiresInHours: v.optional(v.number()),
  },
  returns: v.object({
    launcherId: v.id("embeddedSignupLaunchTokens"),
    token: v.string(),
    path: v.string(),
    expiresAt: v.number(),
  }),
  handler: async (ctx, args) => {
    if (ctx.role !== "owner" && ctx.role !== "admin") {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only owner or admin can create client signup links.",
      });
    }

    const ttlHours = Math.min(
      Math.max(args.expiresInHours ?? LAUNCH_TOKEN_DEFAULT_TTL_HOURS, 1),
      LAUNCH_TOKEN_MAX_TTL_HOURS,
    );
    const token = randomLaunchToken();
    const tokenHash = await sha256Hex(token);
    const expiresAt = Date.now() + ttlHours * 60 * 60 * 1000;
    const launcherId = await ctx.db.insert("embeddedSignupLaunchTokens", {
      tenantId: ctx.tenantId,
      createdBy: ctx.memberId,
      label: args.label?.trim() || undefined,
      tokenHash,
      status: "active",
      createdAt: Date.now(),
      expiresAt,
      starts: 0,
    });

    return {
      launcherId,
      token,
      path: `/connect/whatsapp/${token}`,
      expiresAt,
    };
  },
});

export const beginFromLaunchToken = mutation({
  args: {
    token: v.string(),
  },
  returns: v.object({
    sessionId: v.id("embeddedSignupSessions"),
    state: v.string(),
    url: v.optional(v.string()),
    appId: v.optional(v.string()),
    configId: v.optional(v.string()),
    graphVersion: v.optional(v.string()),
    configured: v.boolean(),
    tenantName: v.string(),
    expiresAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const tokenHash = await sha256Hex(args.token.trim());
    const launcher = await ctx.db
      .query("embeddedSignupLaunchTokens")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (!launcher || launcher.status !== "active") {
      throw new ConvexError({
        code: "SIGNUP_LINK_NOT_FOUND",
        message: "This signup link is not active.",
      });
    }
    if (launcher.expiresAt <= Date.now()) {
      throw new ConvexError({
        code: "SIGNUP_LINK_EXPIRED",
        message: "This signup link has expired.",
      });
    }

    const tenant = await ctx.db.get(launcher.tenantId);
    if (!tenant) {
      throw new ConvexError({
        code: "TENANT_NOT_FOUND",
        message: "Workspace no longer exists.",
      });
    }

    const compliance = getTenantConnectionCompliance(tenant);
    if (!compliance.allowed) {
      throw new ConvexError({
        code: compliance.code,
        message: compliance.message,
      });
    }

    const state = crypto.randomUUID();
    const sessionId = await ctx.db.insert("embeddedSignupSessions", {
      tenantId: launcher.tenantId,
      createdBy: launcher.createdBy,
      launchTokenId: launcher._id,
      state,
      status: "created",
      createdAt: Date.now(),
    });
    await ctx.db.patch(launcher._id, {
      starts: launcher.starts + 1,
      lastStartedAt: Date.now(),
      lastSessionId: sessionId,
    });

    const appId = process.env.META_EMBEDDED_SIGNUP_APP_ID;
    const redirectUri = process.env.META_EMBEDDED_SIGNUP_REDIRECT_URI;
    const configId = process.env.META_EMBEDDED_SIGNUP_CONFIG_ID;
    const appSecret = process.env.META_EMBEDDED_SIGNUP_APP_SECRET;
    if (!appId || !configId || !appSecret) {
      return {
        sessionId,
        state,
        configured: false,
        tenantName: tenant.name,
        expiresAt: launcher.expiresAt,
      };
    }

    let url: string | undefined;
    if (redirectUri) {
      const fallbackUrl = new URL(
        `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`,
      );
      fallbackUrl.searchParams.set("client_id", appId);
      fallbackUrl.searchParams.set("redirect_uri", redirectUri);
      fallbackUrl.searchParams.set("state", state);
      fallbackUrl.searchParams.set("config_id", configId);
      fallbackUrl.searchParams.set("response_type", "code");
      url = fallbackUrl.toString();
    }

    return {
      sessionId,
      state,
      url,
      appId,
      configId,
      graphVersion: META_GRAPH_VERSION,
      configured: true,
      tenantName: tenant.name,
      expiresAt: launcher.expiresAt,
    };
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

function randomLaunchToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function getTenantConnectionCompliance(tenant: { rgpd?: {
  dpaSignedAt?: number;
  dpiaCompletedAt?: number;
} }) {
  if (!tenant.rgpd?.dpaSignedAt) {
    return {
      allowed: false as const,
      code: "DPA_REQUIRED",
      message:
        "Sign the Data Processing Agreement before connecting WhatsApp.",
    };
  }
  if (!tenant.rgpd?.dpiaCompletedAt) {
    return {
      allowed: false as const,
      code: "DPIA_REQUIRED",
      message:
        "Complete the DPIA before connecting WhatsApp to this workspace.",
    };
  }
  return { allowed: true as const };
}

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
    flowVersion: v.optional(
      v.union(v.literal("v4_sdk"), v.literal("oauth_redirect")),
    ),
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
    if (!args.error && args.code && appId && appSecret) {
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
          redirectUri:
            args.flowVersion === "v4_sdk" ? undefined : redirectUri,
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
