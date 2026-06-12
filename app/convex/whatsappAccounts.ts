import { v, ConvexError } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  action,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { tenantQuery } from "./lib/customFunctions";
import {
  validateMetaToken,
  debugToken,
  getPhoneNumberDetails,
  REQUIRED_SCOPES,
} from "./lib/meta/graph";
import { classifyMetaFailure } from "./lib/meta/errorClassifier";
import {
  allowPlaintextSecretStorageForTests,
  decryptSecret,
  encryptSecret,
  getSecretEncryptionStatus,
} from "./lib/secrets";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { Role } from "./lib/roles";

type ConnectionComplianceResult =
  | { allowed: true }
  | {
      allowed: false;
      code: "TENANT_NOT_FOUND" | "DPA_REQUIRED" | "DPIA_REQUIRED";
      message: string;
    };

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
      tokenStorage: v.union(
        v.literal("encrypted"),
        v.literal("legacy_plaintext"),
        v.literal("missing"),
      ),
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
        tokenStorage: tokenStorageForAccount(a),
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

function tokenStorageForAccount(
  account: Doc<"whatsappAccounts">,
): "encrypted" | "legacy_plaintext" | "missing" {
  if (account.accessTokenCiphertext) return "encrypted";
  if (account.accessToken) return "legacy_plaintext";
  return "missing";
}

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
    assertConnectionCompliance(
      await getConnectionCompliance(ctx, args.tenantId),
    );

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

    const accessTokenFields = await buildAccessTokenFields(args.accessToken);

    const wabaAccountId = await ctx.db.insert("whatsappAccounts", {
      tenantId: args.tenantId,
      metaAppId: args.metaAppId,
      businessPortfolioId: args.businessPortfolioId,
      wabaId: args.wabaId,
      ...accessTokenFields,
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

async function getConnectionCompliance(
  ctx: { db: { get: (id: Id<"tenants">) => Promise<Doc<"tenants"> | null> } },
  tenantId: Id<"tenants">,
): Promise<ConnectionComplianceResult> {
  const tenant = await ctx.db.get(tenantId);
  if (!tenant) {
    return {
      allowed: false,
      code: "TENANT_NOT_FOUND",
      message: "Tenant not found.",
    };
  }
  if (!tenant.rgpd?.dpaSignedAt) {
    return {
      allowed: false,
      code: "DPA_REQUIRED",
      message:
        "Sign the Data Processing Agreement before connecting WhatsApp.",
    };
  }
  if (!tenant.rgpd?.dpiaCompletedAt) {
    return {
      allowed: false,
      code: "DPIA_REQUIRED",
      message:
        "Complete the DPIA before connecting WhatsApp to this workspace.",
    };
  }
  return { allowed: true };
}

function assertConnectionCompliance(result: ConnectionComplianceResult): void {
  if (result.allowed) return;
  throw new ConvexError({ code: result.code, message: result.message });
}

export const checkConnectionCompliance = internalQuery({
  args: { tenantId: v.id("tenants") },
  returns: v.union(
    v.object({ allowed: v.literal(true) }),
    v.object({
      allowed: v.literal(false),
      code: v.union(
        v.literal("TENANT_NOT_FOUND"),
        v.literal("DPA_REQUIRED"),
        v.literal("DPIA_REQUIRED"),
      ),
      message: v.string(),
    }),
  ),
  handler: async (ctx, args): Promise<ConnectionComplianceResult> => {
    return await getConnectionCompliance(ctx, args.tenantId);
  },
});

async function buildAccessTokenFields(accessToken: string): Promise<{
  accessToken?: string;
  accessTokenCiphertext?: string;
  accessTokenKeyVersion?: number;
  accessTokenEncryptedAt?: number;
  accessTokenEncryption?: "aes-256-gcm";
}> {
  const encryption = getSecretEncryptionStatus();
  if (encryption.configured) {
    const encrypted = await encryptSecret(accessToken);
    return {
      accessTokenCiphertext: encrypted.ciphertext,
      accessTokenKeyVersion: encrypted.keyVersion,
      accessTokenEncryptedAt: encrypted.encryptedAt,
      accessTokenEncryption: "aes-256-gcm",
    };
  }

  if (allowPlaintextSecretStorageForTests()) {
    return { accessToken };
  }

  throw new ConvexError({
    code:
      encryption.reason === "invalid"
        ? "SECRET_ENCRYPTION_KEY_INVALID"
        : "SECRET_ENCRYPTION_KEY_MISSING",
    message: encryption.message,
  });
}

export const loadTokenSecretForDispatch = internalQuery({
  args: { whatsappAccountId: v.id("whatsappAccounts") },
  returns: v.union(
    v.object({
      accessToken: v.optional(v.string()),
      accessTokenCiphertext: v.optional(v.string()),
      accessTokenKeyVersion: v.optional(v.number()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const acc = await ctx.db.get(args.whatsappAccountId);
    if (!acc) return null;
    return {
      accessToken: acc.accessToken,
      accessTokenCiphertext: acc.accessTokenCiphertext,
      accessTokenKeyVersion: acc.accessTokenKeyVersion,
    };
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

    const compliance = (await ctx.runQuery(
      internal.whatsappAccounts.checkConnectionCompliance,
      { tenantId: me.tenantId },
    )) as ConnectionComplianceResult;
    assertConnectionCompliance(compliance);

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
    const secret: {
      accessToken?: string;
      accessTokenCiphertext?: string;
      accessTokenKeyVersion?: number;
    } | null = await ctx.runQuery(
      internal.whatsappAccounts.loadTokenSecretForDispatch,
      { whatsappAccountId: args.whatsappAccountId },
    );
    if (!secret) return null;
    if (secret.accessTokenCiphertext) {
      try {
        return await decryptSecret(
          secret.accessTokenCiphertext,
          secret.accessTokenKeyVersion,
        );
      } catch (error) {
        throw new ConvexError({
          code: "TOKEN_DECRYPTION_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "Could not decrypt WABA token.",
        });
      }
    }
    return secret.accessToken ?? null;
  },
});

// ---------- Meta sync webhooks: phone quality / account updates ----------

function normalizeDisplayPhone(display?: string): string | undefined {
  const d = display?.trim();
  if (!d) return undefined;
  return d.startsWith("+") ? d : `+${d.replace(/[^\d]/g, "")}`;
}

function tierFromLimit(limit?: string): string | undefined {
  return limit ? limit.toUpperCase() : undefined;
}

/**
 * Apply a `phone_number_quality_update` webhook. FLAGGED opens the circuit
 * breaker (red); UNFLAGGED clears it (green); UPGRADE/DOWNGRADE adjust the
 * messaging tier. Webhooks are the real-time signal — the quality sweep
 * cron is the safety net.
 */
export const applyPhoneQualityUpdate = internalMutation({
  args: {
    wabaId: v.string(),
    displayPhoneNumber: v.string(),
    event: v.string(),
    currentLimit: v.optional(v.string()),
    oldLimit: v.optional(v.string()),
    updatedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const account = await ctx.db
      .query("whatsappAccounts")
      .withIndex("by_waba", (q) => q.eq("wabaId", args.wabaId))
      .first();
    if (!account) return null;

    const phones = await ctx.db
      .query("phoneNumbers")
      .withIndex("by_account", (q) => q.eq("whatsappAccountId", account._id))
      .collect();
    const normalized = normalizeDisplayPhone(args.displayPhoneNumber);
    const phone =
      phones.find(
        (p) => p.e164 === normalized || p.e164 === args.displayPhoneNumber,
      ) ?? (phones.length === 1 ? phones[0] : undefined);
    if (!phone || phone.tenantId !== account.tenantId) return null;

    const event = args.event.toUpperCase();
    const now = Date.now();
    const patch: Record<string, unknown> = {
      lastQualityEvent: event,
      lastQualityEventAt: args.updatedAt,
      messagingTier: tierFromLimit(args.currentLimit) ?? phone.messagingTier,
    };
    if (event === "FLAGGED") {
      patch.qualityRating = "red";
      patch.circuitBreakerUntil = now + 3 * 60 * 60 * 1000;
      patch.circuitBreakerReason = "Meta flagged phone quality";
      patch.circuitBreakerOpenedAt = now;
    } else if (event === "UNFLAGGED") {
      patch.qualityRating = "green";
      patch.circuitBreakerUntil = undefined;
      patch.circuitBreakerReason = undefined;
    } else if (event === "DOWNGRADE") {
      patch.qualityRating = "yellow";
    } else if (event === "UPGRADE" || event === "ONBOARDING") {
      patch.qualityRating = phone.qualityRating ?? "green";
    }
    await ctx.db.patch(phone._id, patch);
    await ctx.db.patch(account._id, {
      messagingTier: tierFromLimit(args.currentLimit) ?? account.messagingTier,
      lastQualityCheckAt: args.updatedAt,
    });
    return null;
  },
});

/**
 * Apply an `account_update` webhook (bans, restrictions, violations,
 * reinstatement). When the account leaves "active", outbound is paused:
 * every phone gets a circuit breaker and running campaigns are paused.
 * The hard stop lives in messages._claimForDispatch (waba_not_active).
 */
export const applyAccountUpdate = internalMutation({
  args: {
    wabaId: v.string(),
    event: v.string(),
    banState: v.optional(v.string()),
    restrictions: v.optional(
      v.array(
        v.object({ type: v.string(), expiration: v.optional(v.number()) }),
      ),
    ),
    violationType: v.optional(v.string()),
    updatedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const account = await ctx.db
      .query("whatsappAccounts")
      .withIndex("by_waba", (q) => q.eq("wabaId", args.wabaId))
      .first();
    if (!account) return null;

    const event = args.event.toUpperCase();
    const ban = args.banState?.toUpperCase();
    let status = account.status;
    if (event === "DISABLED_UPDATE" || event === "ACCOUNT_DELETED") {
      status = ban === "REINSTATE" ? "active" : "revoked";
    } else if (ban === "DISABLE") {
      status = "revoked";
    } else if (ban === "SCHEDULE_FOR_DISABLE") {
      status = "flagged";
    } else if (event === "ACCOUNT_RESTRICTION" || event === "ACCOUNT_VIOLATION") {
      status = "flagged";
    } else if (ban === "REINSTATE" || event === "VERIFIED_ACCOUNT") {
      status = "active";
    }

    await ctx.db.patch(account._id, {
      status,
      accountUpdateEvent: event,
      banState: ban,
      accountRestrictions:
        status === "active" ? undefined : (args.restrictions ?? account.accountRestrictions),
    });

    const phones = await ctx.db
      .query("phoneNumbers")
      .withIndex("by_account", (q) => q.eq("whatsappAccountId", account._id))
      .collect();
    const now = Date.now();
    if (status !== "active") {
      const expiration = args.restrictions?.find((r) => r.expiration)?.expiration;
      const until = expiration ? expiration * 1000 : now + 24 * 60 * 60 * 1000;
      const reason =
        args.violationType ??
        ban ??
        `Meta account_update ${event}`;
      for (const phone of phones) {
        await ctx.db.patch(phone._id, {
          circuitBreakerUntil: until,
          circuitBreakerReason: reason,
          circuitBreakerOpenedAt: now,
        });
      }
      // Pause running campaigns of this tenant.
      const running = await ctx.db
        .query("campaigns")
        .withIndex("by_tenant_status", (q) =>
          q.eq("tenantId", account.tenantId).eq("status", "running"),
        )
        .collect();
      for (const campaign of running) {
        await ctx.db.patch(campaign._id, {
          status: "paused",
          pausedAt: now,
          pauseReason: `account_update:${event}`,
          updatedAt: now,
        });
        await ctx.db.insert("campaignEvents", {
          tenantId: account.tenantId,
          campaignId: campaign._id,
          type: "campaign.auto_paused.account_update",
          payload: { event, banState: ban },
          createdAt: now,
        });
      }
    } else {
      // Reinstated: clear account-level circuit breakers.
      for (const phone of phones) {
        if (phone.circuitBreakerReason?.startsWith("Meta account_update") ||
            phone.circuitBreakerReason === ban) {
          await ctx.db.patch(phone._id, {
            circuitBreakerUntil: undefined,
            circuitBreakerReason: undefined,
          });
        }
      }
    }
    return null;
  },
});

// ---------- Token health (debug_token introspection + cron sweep) ----------

const TOKEN_EXPIRY_WARNING_MS = 14 * 24 * 60 * 60 * 1000;

function appSecretForMetaApp(metaAppId: string): string | undefined {
  if (
    process.env.META_EMBEDDED_SIGNUP_APP_ID &&
    metaAppId === process.env.META_EMBEDDED_SIGNUP_APP_ID
  ) {
    return process.env.META_EMBEDDED_SIGNUP_APP_SECRET;
  }
  return process.env.PLATFORM_META_APP_SECRET;
}

export const _patchTokenHealth = internalMutation({
  args: {
    whatsappAccountId: v.id("whatsappAccounts"),
    tokenStatus: v.union(
      v.literal("ok"),
      v.literal("expiring"),
      v.literal("revoked"),
    ),
    tokenExpiresAt: v.optional(v.number()),
    dataAccessExpiresAt: v.optional(v.number()),
    tokenHealthDetail: v.optional(v.string()),
    validatedScopes: v.optional(v.array(v.string())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.whatsappAccountId);
    if (!account) return null;
    await ctx.db.patch(args.whatsappAccountId, {
      tokenStatus: args.tokenStatus,
      tokenExpiresAt: args.tokenExpiresAt,
      dataAccessExpiresAt: args.dataAccessExpiresAt,
      tokenHealthDetail: args.tokenHealthDetail,
      validatedScopes: args.validatedScopes ?? account.validatedScopes,
      lastTokenHealthCheckAt: Date.now(),
    });
    return null;
  },
});

/**
 * Introspect one account's token via debug_token. Transitions:
 *   ok       — is_valid and (never expires or >14d away)
 *   expiring — is_valid but expires within 14d
 *   revoked  — is_valid=false, Graph code 190, or missing required scopes
 * Transient network errors never flip the status (only a definitive
 * debug_token verdict does).
 */
export const runTokenHealthCheck = internalAction({
  args: { whatsappAccountId: v.id("whatsappAccounts") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const account: { metaAppId: string } | null = await ctx.runQuery(
      internal.whatsappAccounts._getAccountBasics,
      { whatsappAccountId: args.whatsappAccountId },
    );
    if (!account) return null;
    const appSecret = appSecretForMetaApp(account.metaAppId);
    if (!appSecret) return null; // cannot introspect without app credentials

    const token: string | null = await ctx.runAction(
      internal.whatsappAccounts.decryptWabaToken,
      { whatsappAccountId: args.whatsappAccountId },
    );
    if (!token) return null;

    const res = await debugToken({
      appId: account.metaAppId,
      appSecret,
      inputToken: token,
    });
    if (!res.ok) {
      // Graph error code 190 = invalid/expired token — definitive verdict.
      if (res.code === 190) {
        await ctx.runMutation(internal.whatsappAccounts._patchTokenHealth, {
          whatsappAccountId: args.whatsappAccountId,
          tokenStatus: "revoked",
          tokenHealthDetail: res.message,
        });
      }
      return null; // transient errors: leave status untouched
    }

    const now = Date.now();
    const expiresAtMs = res.expiresAt > 0 ? res.expiresAt * 1000 : undefined;
    const missingScopes = REQUIRED_SCOPES.filter(
      (s) => !res.scopes.includes(s),
    );
    let tokenStatus: "ok" | "expiring" | "revoked";
    let detail: string | undefined;
    if (!res.isValid) {
      tokenStatus = "revoked";
      detail = res.errorMessage ?? "token invalid per debug_token";
    } else if (missingScopes.length > 0) {
      tokenStatus = "revoked";
      detail = `missing_scopes:${missingScopes.join(",")}`;
    } else if (expiresAtMs && expiresAtMs <= now + TOKEN_EXPIRY_WARNING_MS) {
      tokenStatus = "expiring";
      detail = `expires ${new Date(expiresAtMs).toISOString()}`;
    } else {
      tokenStatus = "ok";
      detail = undefined;
    }
    await ctx.runMutation(internal.whatsappAccounts._patchTokenHealth, {
      whatsappAccountId: args.whatsappAccountId,
      tokenStatus,
      tokenExpiresAt: expiresAtMs,
      dataAccessExpiresAt: res.dataAccessExpiresAt
        ? res.dataAccessExpiresAt * 1000
        : undefined,
      tokenHealthDetail: detail,
      validatedScopes: res.scopes,
    });
    return null;
  },
});

export const _getAccountBasics = internalQuery({
  args: { whatsappAccountId: v.id("whatsappAccounts") },
  returns: v.union(
    v.object({ metaAppId: v.string(), wabaId: v.string() }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.whatsappAccountId);
    if (!account) return null;
    return { metaAppId: account.metaAppId, wabaId: account.wabaId };
  },
});

export const _listAccountIdsForSweep = internalQuery({
  args: {},
  returns: v.array(v.id("whatsappAccounts")),
  handler: async (ctx) => {
    const accounts = await ctx.db.query("whatsappAccounts").collect();
    return accounts.map((a) => a._id);
  },
});

/** Cron entry: stagger one health check per account (webhooks are the
 * real-time signal; this is the safety net). */
export const sweepTokenHealth = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx): Promise<null> => {
    const ids: Id<"whatsappAccounts">[] = await ctx.runQuery(
      internal.whatsappAccounts._listAccountIdsForSweep,
      {},
    );
    for (let i = 0; i < ids.length; i += 1) {
      await ctx.scheduler.runAfter(
        i * 2000,
        internal.whatsappAccounts.runTokenHealthCheck,
        { whatsappAccountId: ids[i] },
      );
    }
    return null;
  },
});

// ---------- Phone quality / tier pull sync ----------

export const _patchPhoneMetaSync = internalMutation({
  args: {
    phoneNumberId: v.id("phoneNumbers"),
    qualityRating: v.optional(
      v.union(v.literal("green"), v.literal("yellow"), v.literal("red")),
    ),
    messagingTier: v.optional(v.string()),
    verifiedName: v.optional(v.string()),
    throughputLevel: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const phone = await ctx.db.get(args.phoneNumberId);
    if (!phone) return null;
    const now = Date.now();
    await ctx.db.patch(args.phoneNumberId, {
      qualityRating: args.qualityRating ?? phone.qualityRating,
      messagingTier: args.messagingTier ?? phone.messagingTier,
      verifiedName: args.verifiedName ?? phone.verifiedName,
      throughputLevel: args.throughputLevel ?? phone.throughputLevel,
      lastMetaSyncAt: now,
    });
    const account = await ctx.db.get(phone.whatsappAccountId);
    if (account) {
      await ctx.db.patch(account._id, {
        messagingTier: args.messagingTier ?? account.messagingTier,
        lastQualityCheckAt: now,
      });
    }
    return null;
  },
});

export const syncPhoneQuality = internalAction({
  args: { phoneNumberId: v.id("phoneNumbers") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const phone: {
      metaPhoneNumberId: string;
      whatsappAccountId: Id<"whatsappAccounts">;
    } | null = await ctx.runQuery(
      internal.whatsappAccounts._getPhoneBasics,
      { phoneNumberId: args.phoneNumberId },
    );
    if (!phone) return null;
    const token: string | null = await ctx.runAction(
      internal.whatsappAccounts.decryptWabaToken,
      { whatsappAccountId: phone.whatsappAccountId },
    );
    if (!token) return null;
    const res = await getPhoneNumberDetails({
      token,
      phoneNumberId: phone.metaPhoneNumberId,
    });
    if (!res.ok) return null;
    const q = res.data.qualityRating?.toUpperCase();
    await ctx.runMutation(internal.whatsappAccounts._patchPhoneMetaSync, {
      phoneNumberId: args.phoneNumberId,
      qualityRating:
        q === "GREEN" ? "green" : q === "YELLOW" ? "yellow" : q === "RED" ? "red" : undefined,
      messagingTier: res.data.messagingLimitTier,
      verifiedName: res.data.verifiedName,
      throughputLevel: res.data.throughputLevel,
    });
    return null;
  },
});

export const _getPhoneBasics = internalQuery({
  args: { phoneNumberId: v.id("phoneNumbers") },
  returns: v.union(
    v.object({
      metaPhoneNumberId: v.string(),
      whatsappAccountId: v.id("whatsappAccounts"),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const phone = await ctx.db.get(args.phoneNumberId);
    if (!phone) return null;
    return {
      metaPhoneNumberId: phone.phoneNumberId,
      whatsappAccountId: phone.whatsappAccountId,
    };
  },
});

export const _listPhoneIdsForSweep = internalQuery({
  args: {},
  returns: v.array(v.id("phoneNumbers")),
  handler: async (ctx) => {
    const phones = await ctx.db.query("phoneNumbers").collect();
    return phones.map((p) => p._id);
  },
});

export const sweepPhoneQuality = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx): Promise<null> => {
    const ids: Id<"phoneNumbers">[] = await ctx.runQuery(
      internal.whatsappAccounts._listPhoneIdsForSweep,
      {},
    );
    for (let i = 0; i < ids.length; i += 1) {
      await ctx.scheduler.runAfter(
        i * 2000,
        internal.whatsappAccounts.syncPhoneQuality,
        { phoneNumberId: ids[i] },
      );
    }
    return null;
  },
});
