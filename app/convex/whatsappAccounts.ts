import { v, ConvexError } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  action,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { tenantQuery } from "./lib/customFunctions";
import { encryptSecret, decryptSecret } from "./lib/meta/secrets";
import { validateMetaToken } from "./lib/meta/graph";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "./_generated/dataModel";
import type { Role } from "./lib/roles";

const SECRET_PREVIEW_LEN = 6;

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
    wabaId: v.string(),
    validatedScopes: v.array(v.string()),
    secretCiphertext: v.string(),
    secretIv: v.string(),
    secretKeyVersion: v.number(),
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
      wabaId: args.wabaId,
      status: "active",
      tokenStatus: "ok",
      validatedAt: Date.now(),
      validatedScopes: args.validatedScopes,
      createdAt: Date.now(),
    });
    await ctx.db.insert("wabaSecrets", {
      whatsappAccountId: wabaAccountId,
      ciphertext: args.secretCiphertext,
      iv: args.secretIv,
      keyVersion: args.secretKeyVersion,
      encryptedAt: Date.now(),
      accessCountSinceLastReset: 0,
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

export const loadSecretForDispatch = internalQuery({
  args: { whatsappAccountId: v.id("whatsappAccounts") },
  returns: v.union(
    v.object({
      ciphertext: v.string(),
      iv: v.string(),
      keyVersion: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const s = await ctx.db
      .query("wabaSecrets")
      .withIndex("by_account", (q) =>
        q.eq("whatsappAccountId", args.whatsappAccountId),
      )
      .unique();
    if (!s) return null;
    return {
      ciphertext: s.ciphertext,
      iv: s.iv,
      keyVersion: s.keyVersion,
    };
  },
});

export const recordSecretAccess = internalMutation({
  args: { whatsappAccountId: v.id("whatsappAccounts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const s = await ctx.db
      .query("wabaSecrets")
      .withIndex("by_account", (q) =>
        q.eq("whatsappAccountId", args.whatsappAccountId),
      )
      .unique();
    if (!s) return null;
    await ctx.db.patch(s._id, {
      lastAccessedAt: Date.now(),
      accessCountSinceLastReset: s.accessCountSinceLastReset + 1,
    });
    return null;
  },
});

// ---------- Public action: connect a WABA ----------

/**
 * Validate a Meta system user token via Graph API, then store an encrypted
 * envelope and create the whatsappAccount + phoneNumber rows. Per PLAN
 * sections 5.2 + 7.1 step 8 + Codex round2 #6.
 *
 * Action (not mutation) because it makes external HTTP calls.
 *
 * Caller must be authenticated; we resolve their active tenant inside.
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
    // Resolve tenant + role inline (action ctx — must use runQuery).
    const me: {
      tenantId: Id<"tenants">;
      role: string;
      healthcareMode: boolean;
      dpaSignedAt?: number;
      dpiaCompletedAt?: number;
    } | null = await ctx.runQuery(
      internal.whatsappAccounts._meTenant,
      {},
    );
    if (!me) throw new ConvexError({ code: "UNAUTHENTICATED" });
    if (me.role !== "owner" && me.role !== "admin") {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only owner or admin can connect a WhatsApp number",
      });
    }

    // RGPD compliance gate (PLAN section 7.1, Codex round2 #6)
    if (!me.dpaSignedAt) {
      throw new ConvexError({
        code: "DPA_REQUIRED",
        message:
          "Sign the Data Processing Agreement before connecting WhatsApp.",
      });
    }
    if (me.healthcareMode && !me.dpiaCompletedAt) {
      throw new ConvexError({
        code: "DPIA_REQUIRED",
        message:
          "Complete the DPIA before connecting WhatsApp in a healthcare workspace.",
      });
    }

    // Validate token
    const validation = await validateMetaToken(args.systemUserToken);
    if (!validation.ok) {
      throw new ConvexError({
        code: "TOKEN_VALIDATION_FAILED",
        reason: validation.reason,
      });
    }

    // Encrypt and persist
    const envelope = await encryptSecret(args.systemUserToken);
    const result: {
      whatsappAccountId: Id<"whatsappAccounts">;
      phoneNumberId: Id<"phoneNumbers">;
    } = await ctx.runMutation(
      internal.whatsappAccounts.insertConnection,
      {
        tenantId: me.tenantId,
        metaAppId: args.metaAppId,
        wabaId: args.wabaId,
        validatedScopes: validation.scopes,
        secretCiphertext: envelope.ciphertext,
        secretIv: envelope.iv,
        secretKeyVersion: envelope.keyVersion,
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
      healthcareMode: v.boolean(),
      dpaSignedAt: v.optional(v.number()),
      dpiaCompletedAt: v.optional(v.number()),
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
    const tenant = await ctx.db.get(session.activeTenantId);
    if (!tenant) return null;
    return {
      tenantId: session.activeTenantId,
      role: member.role as Role,
      healthcareMode: tenant.healthcareMode,
      dpaSignedAt: tenant.rgpd.dpaSignedAt,
      dpiaCompletedAt: tenant.rgpd.dpiaCompletedAt,
    };
  },
});

/**
 * Decrypt a WABA token. Internal action only — never expose to clients.
 * Records access in audit-style counter on wabaSecrets.
 */
export const decryptWabaToken = internalAction({
  args: { whatsappAccountId: v.id("whatsappAccounts") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args): Promise<string | null> => {
    const env = await ctx.runQuery(
      internal.whatsappAccounts.loadSecretForDispatch,
      { whatsappAccountId: args.whatsappAccountId },
    );
    if (!env) return null;
    await ctx.runMutation(internal.whatsappAccounts.recordSecretAccess, {
      whatsappAccountId: args.whatsappAccountId,
    });
    return await decryptSecret(env);
  },
});

void SECRET_PREVIEW_LEN; // reserved for UI preview later
