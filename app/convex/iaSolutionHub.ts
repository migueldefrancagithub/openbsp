import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { tenantMutation, tenantQuery } from "./lib/customFunctions";
import {
  projectThreadFromEvent,
  reconcileOutboxFromStatus,
} from "./lib/channels/projection";
import {
  decryptSecret,
  encryptSecret,
  getSecretEncryptionStatus,
} from "./lib/secrets";
import {
  getPhoneHealth,
  getPhoneInfo,
  createFlow as createFlowViaHub,
  listTemplates,
  normalizePhone,
  providerMessageId,
  sendDocument as sendDocumentViaHub,
  sendInteractive as sendInteractiveViaHub,
  sendTemplate as sendTemplateViaHub,
  sendText as sendTextViaHub,
  publishFlow as publishFlowViaHub,
  updateFlow as updateFlowViaHub,
  uploadFlowAsset as uploadFlowAssetViaHub,
  type HubMessageResult,
  type HubResult,
} from "./integrations/iaSolutionHub/client";

const PROVIDER = "iasolution_hub" as const;
const PUBLIC_ID_PATTERN = /^hub_[A-Za-z0-9_-]{24}$/;
const STALE_DISPATCH_MS = 2 * 60 * 1_000;
const MAX_SECRET_ERROR = 500;
const RATE_LIMITS = {
  outbound: 20,
  health: 10,
  template_sync: 3,
  flow_publish: 2,
} as const;
const RATE_LIMIT_WINDOW_MS = 60_000;

const messageKindValidator = v.union(
  v.literal("text"),
  v.literal("template"),
  v.literal("interactive"),
  v.literal("document"),
);

const normalizedEventValidator = v.object({
  eventKey: v.string(),
  providerEventId: v.optional(v.string()),
  eventKind: v.string(),
  direction: v.union(v.literal("incoming"), v.literal("outgoing")),
  actorProviderScopedId: v.optional(v.string()),
  actorDisplayName: v.optional(v.string()),
  actorPhone: v.optional(v.string()),
  threadKey: v.optional(v.string()),
  replyToProviderMessageId: v.optional(v.string()),
  flowToken: v.optional(v.string()),
  providerTimestamp: v.optional(v.number()),
  payload: v.any(),
});

type NormalizedEvent = {
  eventKey: string;
  providerEventId?: string;
  eventKind: string;
  direction: "incoming" | "outgoing";
  actorProviderScopedId?: string;
  actorDisplayName?: string;
  actorPhone?: string;
  threadKey?: string;
  replyToProviderMessageId?: string;
  flowToken?: string;
  providerTimestamp?: number;
  payload: Record<string, unknown>;
};

type Caller = {
  tenantId: Id<"tenants">;
  memberId: Id<"members">;
  role: string;
};

type StoredChannelSecret = {
  channelId: Id<"channels">;
  tenantId: Id<"tenants">;
  accessTokenCiphertext: string;
  accessTokenKeyVersion: number;
  webhookSecretCiphertext: string;
  webhookSecretKeyVersion: number;
};

type DispatchResult = {
  outboxId: Id<"channelOutbox">;
  status: string;
  providerMessageId?: string;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : undefined;
}

function requireAdmin(caller: Caller | null): asserts caller is Caller {
  if (!caller) throw new ConvexError({ code: "UNAUTHENTICATED" });
  if (caller.role !== "owner" && caller.role !== "admin") {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "Only an owner or admin can configure an iaSolution Hub channel.",
    });
  }
}

function requireOperator(caller: Caller | null): asserts caller is Caller {
  if (!caller) throw new ConvexError({ code: "UNAUTHENTICATED" });
  if (!['owner', 'admin', 'agent'].includes(caller.role)) {
    throw new ConvexError({ code: "FORBIDDEN" });
  }
}

function randomPublicId(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `hub_${btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")}`;
}

function randomFlowToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function validateFlowJson(flowJson: unknown): Record<string, unknown> {
  const root = asObject(flowJson);
  const screens = root?.screens;
  const serialized = JSON.stringify(flowJson);
  if (
    !root ||
    root.version !== "7.3" ||
    !Array.isArray(screens) ||
    screens.length === 0 ||
    serialized.length > 256_000
  ) {
    throw new ConvexError({ code: "INVALID_FLOW_JSON_7_3" });
  }
  const forbiddenMarkers = [
    "clicpay",
    "patient",
    "paciente",
    "prontuario",
    "seguro",
    "clinicbook",
    "ayamed",
    "openbsp_lab_",
  ];
  const normalized = serialized.toLowerCase();
  if (forbiddenMarkers.some((marker) => normalized.includes(marker))) {
    throw new ConvexError({ code: "FORBIDDEN_FLOW_DOMAIN_MARKER" });
  }
  return root;
}

function normalizeAllowlist(values: string[]): string[] {
  const normalized = [...new Set(values.map(normalizePhone).filter(Boolean))];
  for (const phone of normalized) {
    if (!/^\d{8,18}$/.test(phone)) {
      throw new ConvexError({ code: "INVALID_ALLOWLIST_PHONE" });
    }
  }
  return normalized;
}

function validateConfiguredInput(args: {
  externalChannelId: string;
  displayName: string;
  phoneNumber: string;
  wabaId: string;
  channelToken: string;
  webhookSecret: string;
  outboundAllowlist: string[];
}) {
  const externalChannelId = args.externalChannelId.trim();
  const displayName = args.displayName.trim();
  const phoneNumber = normalizePhone(args.phoneNumber);
  const wabaId = args.wabaId.trim();
  const channelToken = args.channelToken.trim();
  const webhookSecret = args.webhookSecret.trim();
  if (!externalChannelId || externalChannelId.length > 160) {
    throw new ConvexError({ code: "INVALID_EXTERNAL_CHANNEL_ID" });
  }
  if (!displayName || displayName.length > 100) {
    throw new ConvexError({ code: "INVALID_DISPLAY_NAME" });
  }
  if (!/^\d{8,18}$/.test(phoneNumber)) {
    throw new ConvexError({ code: "INVALID_PHONE_NUMBER" });
  }
  if (!wabaId || wabaId.length > 160) {
    throw new ConvexError({ code: "INVALID_WABA_ID" });
  }
  if (channelToken.length < 20) {
    throw new ConvexError({ code: "INVALID_CHANNEL_TOKEN" });
  }
  if (webhookSecret.length < 24) {
    throw new ConvexError({ code: "WEAK_WEBHOOK_SECRET" });
  }
  const outboundAllowlist = normalizeAllowlist(args.outboundAllowlist);
  if (outboundAllowlist.length === 0) {
    throw new ConvexError({ code: "ALLOWLIST_REQUIRED" });
  }
  return {
    externalChannelId,
    displayName,
    phoneNumber,
    wabaId,
    channelToken,
    webhookSecret,
    outboundAllowlist,
  };
}

function hubPhone(info: unknown): string | undefined {
  const row = asObject(info);
  return nonEmptyString(row?.display_phone_number) ?? nonEmptyString(row?.phone);
}

function hubWabaId(info: unknown): string | undefined {
  const row = asObject(info);
  return nonEmptyString(row?.waba_id) ?? nonEmptyString(row?.wabaId);
}

export const _meTenant = internalQuery({
  args: {},
  returns: v.union(
    v.object({
      tenantId: v.id("tenants"),
      memberId: v.id("members"),
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
      memberId: member._id,
      role: member.role,
    };
  },
});

export const createPendingChannel = tenantMutation({
  args: { displayName: v.string() },
  returns: v.object({
    channelId: v.id("channels"),
    publicId: v.string(),
    connectionState: v.literal("pending_number"),
  }),
  handler: async (ctx, args) => {
    if (ctx.role !== "owner" && ctx.role !== "admin") {
      throw new ConvexError({ code: "FORBIDDEN" });
    }
    const displayName = args.displayName.trim();
    if (!displayName || displayName.length > 100) {
      throw new ConvexError({ code: "INVALID_DISPLAY_NAME" });
    }
    const existing = await ctx.db
      .query("channels")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .order("desc")
      .take(100);
    const pending = existing.find(
      (channel) =>
        channel.provider === PROVIDER &&
        channel.connectionState === "pending_number" &&
        channel.status !== "disconnected",
    );
    if (pending) {
      return {
        channelId: pending._id,
        publicId: pending.publicId,
        connectionState: "pending_number" as const,
      };
    }
    const publicId = randomPublicId();
    const now = Date.now();
    const channelId = await ctx.db.insert("channels", {
      tenantId: ctx.tenantId,
      publicId,
      kind: "whatsapp",
      provider: PROVIDER,
      externalAccountId: `pending:${publicId}`,
      displayName,
      status: "pending",
      sendMode: "disabled",
      outboundAllowlist: [],
      connectionState: "pending_number",
      webhookStatus: "disabled",
      createdBy: ctx.memberId,
      createdAt: now,
      updatedAt: now,
    });
    return { channelId, publicId, connectionState: "pending_number" as const };
  },
});

export const _configureConnection = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    memberId: v.id("members"),
    channelId: v.id("channels"),
    externalChannelId: v.string(),
    displayName: v.string(),
    phoneNumber: v.string(),
    wabaId: v.string(),
    outboundAllowlist: v.array(v.string()),
    accessTokenCiphertext: v.string(),
    accessTokenKeyVersion: v.number(),
    webhookSecretCiphertext: v.string(),
    webhookSecretKeyVersion: v.number(),
    encryptedAt: v.number(),
    healthStatus: v.optional(v.string()),
  },
  returns: v.object({ channelId: v.id("channels"), publicId: v.string() }),
  handler: async (ctx, args) => {
    const channel = await ctx.db.get(args.channelId);
    if (
      !channel ||
      channel.tenantId !== args.tenantId ||
      channel.provider !== PROVIDER
    ) {
      throw new ConvexError({ code: "HUB_CHANNEL_NOT_FOUND" });
    }
    const sameProviderIdentity = await ctx.db
      .query("channels")
      .withIndex("by_provider_identity", (q) =>
        q
          .eq("provider", PROVIDER)
          .eq("kind", "whatsapp")
          .eq("externalAccountId", args.externalChannelId),
      )
      .unique();
    if (sameProviderIdentity && sameProviderIdentity._id !== channel._id) {
      throw new ConvexError({ code: "CHANNEL_ALREADY_CONNECTED" });
    }
    const samePhone = await ctx.db
      .query("channels")
      .withIndex("by_provider_phone", (q) =>
        q
          .eq("provider", PROVIDER)
          .eq("kind", "whatsapp")
          .eq("phoneNumber", args.phoneNumber),
      )
      .first();
    if (samePhone && samePhone._id !== channel._id) {
      throw new ConvexError({ code: "PHONE_ALREADY_CONNECTED" });
    }
    const now = Date.now();
    await ctx.db.patch(channel._id, {
      externalAccountId: args.externalChannelId,
      displayName: args.displayName,
      phoneNumber: args.phoneNumber,
      wabaId: args.wabaId,
      status: "active",
      connectionState: "ready",
      webhookStatus: "pending",
      sendMode: "disabled",
      outboundAllowlist: args.outboundAllowlist,
      credentialsConfiguredAt: now,
      lastHealthStatus: args.healthStatus,
      lastHealthCheckAt: now,
      updatedAt: now,
    });
    const priorSecret = await ctx.db
      .query("channelSecrets")
      .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
      .unique();
    const secretFields = {
      tenantId: args.tenantId,
      channelId: channel._id,
      accessTokenCiphertext: args.accessTokenCiphertext,
      accessTokenKeyVersion: args.accessTokenKeyVersion,
      webhookSecretCiphertext: args.webhookSecretCiphertext,
      webhookSecretKeyVersion: args.webhookSecretKeyVersion,
      encryptedAt: args.encryptedAt,
    };
    if (priorSecret) await ctx.db.replace(priorSecret._id, secretFields);
    else await ctx.db.insert("channelSecrets", secretFields);
    return { channelId: channel._id, publicId: channel.publicId };
  },
});

export const configureChannel = action({
  args: {
    channelId: v.id("channels"),
    externalChannelId: v.string(),
    displayName: v.string(),
    phoneNumber: v.string(),
    wabaId: v.string(),
    channelToken: v.string(),
    webhookSecret: v.string(),
    outboundAllowlist: v.array(v.string()),
  },
  returns: v.object({
    channelId: v.id("channels"),
    publicId: v.string(),
    webhookPath: v.string(),
    sendMode: v.literal("disabled"),
    connectionState: v.literal("ready"),
  }),
  handler: async (ctx, rawArgs) => {
    const caller = (await ctx.runQuery(
      internal.iaSolutionHub._meTenant,
      {},
    )) as Caller | null;
    requireAdmin(caller);
    const encryption = getSecretEncryptionStatus();
    if (!encryption.configured) {
      throw new ConvexError({
        code:
          encryption.reason === "invalid"
            ? "SECRET_ENCRYPTION_KEY_INVALID"
            : "SECRET_ENCRYPTION_KEY_MISSING",
        message: encryption.message,
      });
    }
    const args = validateConfiguredInput(rawArgs);
    const [info, health] = await Promise.all([
      getPhoneInfo({ token: args.channelToken }),
      getPhoneHealth({ token: args.channelToken }),
    ]);
    if (!info.ok || !health.ok) {
      throw new ConvexError({
        code: "HUB_HEALTH_VALIDATION_FAILED",
        message: [info.ok ? null : info.reason, health.ok ? null : health.reason]
          .filter(Boolean)
          .join("; "),
      });
    }
    const reportedPhone = hubPhone(info.data);
    if (!reportedPhone) {
      throw new ConvexError({ code: "HUB_PHONE_NOT_CONNECTED" });
    }
    if (normalizePhone(reportedPhone) !== args.phoneNumber) {
      throw new ConvexError({ code: "HUB_PHONE_MISMATCH" });
    }
    const reportedWabaId = hubWabaId(info.data);
    if (reportedWabaId && reportedWabaId !== args.wabaId) {
      throw new ConvexError({ code: "HUB_WABA_MISMATCH" });
    }
    const [tokenSecret, hookSecret] = await Promise.all([
      encryptSecret(args.channelToken),
      encryptSecret(args.webhookSecret),
    ]);
    const healthData = asObject(health.data);
    const result = (await ctx.runMutation(
      internal.iaSolutionHub._configureConnection,
      {
        tenantId: caller.tenantId,
        memberId: caller.memberId,
        channelId: rawArgs.channelId,
        externalChannelId: args.externalChannelId,
        displayName: args.displayName,
        phoneNumber: args.phoneNumber,
        wabaId: args.wabaId,
        outboundAllowlist: args.outboundAllowlist,
        accessTokenCiphertext: tokenSecret.ciphertext,
        accessTokenKeyVersion: tokenSecret.keyVersion,
        webhookSecretCiphertext: hookSecret.ciphertext,
        webhookSecretKeyVersion: hookSecret.keyVersion,
        encryptedAt: Math.max(tokenSecret.encryptedAt, hookSecret.encryptedAt),
        healthStatus: nonEmptyString(healthData?.health_status),
      },
    )) as { channelId: Id<"channels">; publicId: string };
    return {
      ...result,
      webhookPath: `/provider-webhook/iasolution-hub/${result.publicId}`,
      sendMode: "disabled" as const,
      connectionState: "ready" as const,
    };
  },
});

export const updateAllowlist = tenantMutation({
  args: {
    channelId: v.id("channels"),
    outboundAllowlist: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (ctx.role !== "owner" && ctx.role !== "admin") {
      throw new ConvexError({ code: "FORBIDDEN" });
    }
    const channel = await ctx.db.get(args.channelId);
    if (
      !channel ||
      channel.tenantId !== ctx.tenantId ||
      channel.provider !== PROVIDER
    ) {
      throw new ConvexError({ code: "HUB_CHANNEL_NOT_FOUND" });
    }
    const outboundAllowlist = normalizeAllowlist(args.outboundAllowlist);
    if (outboundAllowlist.length === 0) {
      throw new ConvexError({ code: "ALLOWLIST_REQUIRED" });
    }
    await ctx.db.patch(channel._id, {
      outboundAllowlist,
      sendMode: "disabled",
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const setPilotMode = tenantMutation({
  args: { channelId: v.id("channels"), enabled: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (ctx.role !== "owner" && ctx.role !== "admin") {
      throw new ConvexError({ code: "FORBIDDEN" });
    }
    const channel = await ctx.db.get(args.channelId);
    if (
      !channel ||
      channel.tenantId !== ctx.tenantId ||
      channel.provider !== PROVIDER
    ) {
      throw new ConvexError({ code: "HUB_CHANNEL_NOT_FOUND" });
    }
    if (args.enabled) {
      if (
        channel.status !== "active" ||
        channel.webhookStatus !== "verified" ||
        !channel.phoneNumber ||
        channel.outboundAllowlist.length === 0
      ) {
        throw new ConvexError({ code: "PILOT_NOT_READY" });
      }
    }
    await ctx.db.patch(channel._id, {
      sendMode: args.enabled ? "allowlist" : "disabled",
      connectionState: args.enabled ? "allowlist_only" : "ready",
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const _loadSecret = internalQuery({
  args: { channelId: v.id("channels"), tenantId: v.id("tenants") },
  returns: v.union(
    v.object({
      channelId: v.id("channels"),
      tenantId: v.id("tenants"),
      accessTokenCiphertext: v.string(),
      accessTokenKeyVersion: v.number(),
      webhookSecretCiphertext: v.string(),
      webhookSecretKeyVersion: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const channel = await ctx.db.get(args.channelId);
    if (
      !channel ||
      channel.tenantId !== args.tenantId ||
      channel.provider !== PROVIDER
    ) {
      return null;
    }
    const secret = await ctx.db
      .query("channelSecrets")
      .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
      .unique();
    if (!secret || secret.tenantId !== channel.tenantId) return null;
    return {
      channelId: channel._id,
      tenantId: channel.tenantId,
      accessTokenCiphertext: secret.accessTokenCiphertext,
      accessTokenKeyVersion: secret.accessTokenKeyVersion,
      webhookSecretCiphertext: secret.webhookSecretCiphertext,
      webhookSecretKeyVersion: secret.webhookSecretKeyVersion,
    };
  },
});

export const _decryptAccessToken = internalAction({
  args: { channelId: v.id("channels"), tenantId: v.id("tenants") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const secret = (await ctx.runQuery(
      internal.iaSolutionHub._loadSecret,
      args,
    )) as StoredChannelSecret | null;
    if (!secret) return null;
    return await decryptSecret(
      secret.accessTokenCiphertext,
      secret.accessTokenKeyVersion,
    );
  },
});

export const _loadWebhookTarget = internalQuery({
  args: { publicId: v.string() },
  returns: v.union(
    v.object({
      channelId: v.id("channels"),
      status: v.string(),
      webhookStatus: v.optional(v.string()),
      webhookSecretCiphertext: v.string(),
      webhookSecretKeyVersion: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    if (!PUBLIC_ID_PATTERN.test(args.publicId)) return null;
    const channel = await ctx.db
      .query("channels")
      .withIndex("by_public_id", (q) => q.eq("publicId", args.publicId))
      .unique();
    if (!channel || channel.provider !== PROVIDER) return null;
    const secret = await ctx.db
      .query("channelSecrets")
      .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
      .unique();
    if (!secret || secret.tenantId !== channel.tenantId) return null;
    return {
      channelId: channel._id,
      status: channel.status,
      webhookStatus: channel.webhookStatus,
      webhookSecretCiphertext: secret.webhookSecretCiphertext,
      webhookSecretKeyVersion: secret.webhookSecretKeyVersion,
    };
  },
});

export const loadWebhookContext = internalAction({
  args: { publicId: v.string() },
  returns: v.union(
    v.object({
      channelId: v.id("channels"),
      status: v.string(),
      webhookStatus: v.optional(v.string()),
      webhookSecret: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const target = (await ctx.runQuery(
      internal.iaSolutionHub._loadWebhookTarget,
      args,
    )) as {
      channelId: Id<"channels">;
      status: string;
      webhookStatus?: string;
      webhookSecretCiphertext: string;
      webhookSecretKeyVersion: number;
    } | null;
    if (!target) return null;
    return {
      channelId: target.channelId,
      status: target.status,
      webhookStatus: target.webhookStatus,
      webhookSecret: await decryptSecret(
        target.webhookSecretCiphertext,
        target.webhookSecretKeyVersion,
      ),
    };
  },
});

export const _patchHealth = internalMutation({
  args: {
    channelId: v.id("channels"),
    tenantId: v.id("tenants"),
    ok: v.boolean(),
    healthStatus: v.optional(v.string()),
    detail: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const channel = await ctx.db.get(args.channelId);
    if (
      !channel ||
      channel.tenantId !== args.tenantId ||
      channel.provider !== PROVIDER
    ) {
      return null;
    }
    await ctx.db.patch(channel._id, {
      status: args.ok ? "active" : "degraded",
      lastHealthStatus: args.healthStatus,
      lastHealthDetail: args.detail?.slice(0, MAX_SECRET_ERROR),
      lastHealthCheckAt: Date.now(),
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const _consumeRateLimit = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    channelId: v.id("channels"),
    scope: v.union(
      v.literal("outbound"),
      v.literal("health"),
      v.literal("template_sync"),
      v.literal("flow_publish"),
    ),
  },
  returns: v.object({ remaining: v.number(), bucketStart: v.number() }),
  handler: async (ctx, args) => {
    const channel = await ctx.db.get(args.channelId);
    if (
      !channel ||
      channel.tenantId !== args.tenantId ||
      channel.provider !== PROVIDER
    ) {
      throw new ConvexError({ code: "HUB_CHANNEL_NOT_FOUND" });
    }
    const now = Date.now();
    const bucketStart =
      Math.floor(now / RATE_LIMIT_WINDOW_MS) * RATE_LIMIT_WINDOW_MS;
    const existing = await ctx.db
      .query("channelRateLimitBuckets")
      .withIndex("by_channel_scope_bucket", (q) =>
        q
          .eq("channelId", channel._id)
          .eq("scope", args.scope)
          .eq("bucketStart", bucketStart),
      )
      .unique();
    const limit = RATE_LIMITS[args.scope];
    if (existing && existing.count >= limit) {
      throw new ConvexError({
        code: "CHANNEL_RATE_LIMITED",
        scope: args.scope,
        retryAfterMs: bucketStart + RATE_LIMIT_WINDOW_MS - now,
      });
    }
    const count = (existing?.count ?? 0) + 1;
    if (existing) {
      await ctx.db.patch(existing._id, { count, updatedAt: now });
    } else {
      await ctx.db.insert("channelRateLimitBuckets", {
        tenantId: channel.tenantId,
        channelId: channel._id,
        scope: args.scope,
        bucketStart,
        count,
        updatedAt: now,
      });
    }
    return { remaining: limit - count, bucketStart };
  },
});

export const checkHealth = action({
  args: { channelId: v.id("channels") },
  returns: v.object({ ok: v.boolean(), phoneInfo: v.any(), phoneHealth: v.any() }),
  handler: async (ctx, args) => {
    const caller = (await ctx.runQuery(
      internal.iaSolutionHub._meTenant,
      {},
    )) as Caller | null;
    requireAdmin(caller);
    await ctx.runMutation(internal.iaSolutionHub._consumeRateLimit, {
      tenantId: caller.tenantId,
      channelId: args.channelId,
      scope: "health",
    });
    const token = (await ctx.runAction(
      internal.iaSolutionHub._decryptAccessToken,
      { channelId: args.channelId, tenantId: caller.tenantId },
    )) as string | null;
    if (!token) throw new ConvexError({ code: "HUB_CHANNEL_NOT_FOUND" });
    const [info, health] = await Promise.all([
      getPhoneInfo({ token }),
      getPhoneHealth({ token }),
    ]);
    const ok = info.ok && health.ok;
    const healthData = health.ok ? asObject(health.data) : null;
    await ctx.runMutation(internal.iaSolutionHub._patchHealth, {
      channelId: args.channelId,
      tenantId: caller.tenantId,
      ok,
      healthStatus: nonEmptyString(healthData?.health_status),
      detail: ok
        ? undefined
        : [info.ok ? null : info.reason, health.ok ? null : health.reason]
            .filter(Boolean)
            .join("; "),
    });
    return {
      ok,
      phoneInfo: info.ok ? info.data : { error: info.reason },
      phoneHealth: health.ok ? health.data : { error: health.reason },
    };
  },
});

export const _replaceTemplates = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    channelId: v.id("channels"),
    templates: v.array(
      v.object({
        name: v.string(),
        languageCode: v.string(),
        category: v.optional(v.string()),
        status: v.string(),
        components: v.optional(v.any()),
        providerTemplateId: v.optional(v.string()),
      }),
    ),
  },
  returns: v.object({ upserted: v.number() }),
  handler: async (ctx, args) => {
    const channel = await ctx.db.get(args.channelId);
    if (
      !channel ||
      channel.tenantId !== args.tenantId ||
      channel.provider !== PROVIDER
    ) {
      throw new ConvexError({ code: "HUB_CHANNEL_NOT_FOUND" });
    }
    const now = Date.now();
    for (const template of args.templates) {
      const existing = await ctx.db
        .query("channelTemplates")
        .withIndex("by_channel_name_language", (q) =>
          q
            .eq("channelId", channel._id)
            .eq("name", template.name)
            .eq("languageCode", template.languageCode),
        )
        .unique();
      const fields = {
        tenantId: channel.tenantId,
        channelId: channel._id,
        ...template,
        syncedAt: now,
        updatedAt: now,
      };
      if (existing) await ctx.db.replace(existing._id, fields);
      else await ctx.db.insert("channelTemplates", fields);
    }
    return { upserted: args.templates.length };
  },
});

export const syncTemplates = action({
  args: { channelId: v.id("channels") },
  returns: v.object({ upserted: v.number() }),
  handler: async (ctx, args): Promise<{ upserted: number }> => {
    const caller = (await ctx.runQuery(
      internal.iaSolutionHub._meTenant,
      {},
    )) as Caller | null;
    requireAdmin(caller);
    await ctx.runMutation(internal.iaSolutionHub._consumeRateLimit, {
      tenantId: caller.tenantId,
      channelId: args.channelId,
      scope: "template_sync",
    });
    const token = (await ctx.runAction(
      internal.iaSolutionHub._decryptAccessToken,
      { channelId: args.channelId, tenantId: caller.tenantId },
    )) as string | null;
    if (!token) throw new ConvexError({ code: "HUB_CHANNEL_NOT_FOUND" });
    const result = await listTemplates({ token, sync: true });
    if (!result.ok) {
      throw new ConvexError({ code: "HUB_TEMPLATE_SYNC_FAILED", message: result.reason });
    }
    const rawRows = Array.isArray(result.data) ? result.data : [];
    const templates = rawRows.flatMap((candidate) => {
      const row = asObject(candidate);
      const name = nonEmptyString(row?.name);
      const language = asObject(row?.language);
      const languageCode =
        nonEmptyString(row?.language_code) ??
        nonEmptyString(row?.language) ??
        nonEmptyString(language?.code);
      const status = nonEmptyString(row?.status);
      if (!name || !languageCode || !status) return [];
      return [{
        name,
        languageCode,
        category: nonEmptyString(row?.category),
        status,
        components: row?.components,
        providerTemplateId: nonEmptyString(row?.id),
      }];
    });
    return (await ctx.runMutation(internal.iaSolutionHub._replaceTemplates, {
      tenantId: caller.tenantId,
      channelId: args.channelId,
      templates,
    })) as { upserted: number };
  },
});

export const listFlowDrafts = tenantQuery({
  args: { channelId: v.id("channels") },
  returns: v.array(
    v.object({
      _id: v.id("channelFlowDrafts"),
      name: v.string(),
      categories: v.array(v.string()),
      status: v.string(),
      providerFlowId: v.optional(v.string()),
      lastError: v.optional(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const channel = await ctx.db.get(args.channelId);
    if (
      !channel ||
      channel.tenantId !== ctx.tenantId ||
      channel.provider !== PROVIDER
    ) {
      throw new ConvexError({ code: "HUB_CHANNEL_NOT_FOUND" });
    }
    const rows = await ctx.db
      .query("channelFlowDrafts")
      .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
      .order("desc")
      .take(100);
    return rows.map((row) => ({
      _id: row._id,
      name: row.name,
      categories: row.categories,
      status: row.status,
      providerFlowId: row.providerFlowId,
      lastError: row.lastError,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  },
});

export const saveFlowDraft = tenantMutation({
  args: {
    channelId: v.id("channels"),
    draftId: v.optional(v.id("channelFlowDrafts")),
    name: v.string(),
    categories: v.array(v.string()),
    flowJson: v.any(),
  },
  returns: v.id("channelFlowDrafts"),
  handler: async (ctx, args) => {
    if (ctx.role !== "owner" && ctx.role !== "admin") {
      throw new ConvexError({ code: "FORBIDDEN" });
    }
    const channel = await ctx.db.get(args.channelId);
    if (
      !channel ||
      channel.tenantId !== ctx.tenantId ||
      channel.provider !== PROVIDER
    ) {
      throw new ConvexError({ code: "HUB_CHANNEL_NOT_FOUND" });
    }
    const name = args.name.trim();
    if (!/^openbsp_[a-z0-9_]{3,64}$/.test(name)) {
      throw new ConvexError({ code: "OPENBSP_FLOW_NAME_REQUIRED" });
    }
    if (args.categories.length === 0 || args.categories.length > 5) {
      throw new ConvexError({ code: "INVALID_FLOW_CATEGORIES" });
    }
    validateFlowJson(args.flowJson);
    const now = Date.now();
    if (args.draftId) {
      const existing = await ctx.db.get(args.draftId);
      if (
        !existing ||
        existing.tenantId !== ctx.tenantId ||
        existing.channelId !== channel._id
      ) {
        throw new ConvexError({ code: "FLOW_DRAFT_NOT_FOUND" });
      }
      if (existing.status === "published") {
        throw new ConvexError({ code: "PUBLISHED_FLOW_IMMUTABLE" });
      }
      await ctx.db.patch(existing._id, {
        name,
        categories: args.categories,
        flowJson: args.flowJson,
        status: "draft",
        lastError: undefined,
        updatedAt: now,
      });
      return existing._id;
    }
    const duplicate = await ctx.db
      .query("channelFlowDrafts")
      .withIndex("by_channel_name", (q) =>
        q.eq("channelId", channel._id).eq("name", name),
      )
      .first();
    if (duplicate) throw new ConvexError({ code: "FLOW_NAME_EXISTS" });
    return await ctx.db.insert("channelFlowDrafts", {
      tenantId: ctx.tenantId,
      channelId: channel._id,
      name,
      categories: args.categories,
      flowJson: args.flowJson,
      status: "draft",
      createdBy: ctx.memberId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const _loadFlowDraft = internalQuery({
  args: {
    tenantId: v.id("tenants"),
    channelId: v.id("channels"),
    draftId: v.id("channelFlowDrafts"),
  },
  returns: v.union(
    v.object({
      _id: v.id("channelFlowDrafts"),
      name: v.string(),
      categories: v.array(v.string()),
      flowJson: v.any(),
      status: v.string(),
      providerFlowId: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const [channel, draft] = await Promise.all([
      ctx.db.get(args.channelId),
      ctx.db.get(args.draftId),
    ]);
    if (
      !channel ||
      channel.tenantId !== args.tenantId ||
      channel.provider !== PROVIDER ||
      !draft ||
      draft.tenantId !== args.tenantId ||
      draft.channelId !== channel._id
    ) {
      return null;
    }
    return {
      _id: draft._id,
      name: draft.name,
      categories: draft.categories,
      flowJson: draft.flowJson,
      status: draft.status,
      providerFlowId: draft.providerFlowId,
    };
  },
});

export const _markFlowDraft = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    channelId: v.id("channels"),
    draftId: v.id("channelFlowDrafts"),
    status: v.union(
      v.literal("validated"),
      v.literal("published"),
      v.literal("failed"),
    ),
    providerFlowId: v.optional(v.string()),
    lastError: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const draft = await ctx.db.get(args.draftId);
    if (
      !draft ||
      draft.tenantId !== args.tenantId ||
      draft.channelId !== args.channelId
    ) {
      return null;
    }
    await ctx.db.patch(draft._id, {
      status: args.status,
      providerFlowId: args.providerFlowId ?? draft.providerFlowId,
      lastError: args.lastError?.slice(0, MAX_SECRET_ERROR),
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const publishFlowDraft = action({
  args: {
    channelId: v.id("channels"),
    draftId: v.id("channelFlowDrafts"),
  },
  returns: v.object({ providerFlowId: v.string(), status: v.literal("published") }),
  handler: async (ctx, args): Promise<{ providerFlowId: string; status: "published" }> => {
    const caller = (await ctx.runQuery(
      internal.iaSolutionHub._meTenant,
      {},
    )) as Caller | null;
    requireAdmin(caller);
    await ctx.runMutation(internal.iaSolutionHub._consumeRateLimit, {
      tenantId: caller.tenantId,
      channelId: args.channelId,
      scope: "flow_publish",
    });
    const draft = (await ctx.runQuery(
      internal.iaSolutionHub._loadFlowDraft,
      {
        tenantId: caller.tenantId,
        channelId: args.channelId,
        draftId: args.draftId,
      },
    )) as {
      _id: Id<"channelFlowDrafts">;
      name: string;
      categories: string[];
      flowJson: unknown;
      status: string;
      providerFlowId?: string;
    } | null;
    if (!draft) throw new ConvexError({ code: "FLOW_DRAFT_NOT_FOUND" });
    validateFlowJson(draft.flowJson);
    const token = (await ctx.runAction(
      internal.iaSolutionHub._decryptAccessToken,
      { channelId: args.channelId, tenantId: caller.tenantId },
    )) as string | null;
    if (!token) throw new ConvexError({ code: "HUB_CHANNEL_NOT_FOUND" });
    let flowId = draft.providerFlowId;
    try {
      if (flowId) {
        const updated = await updateFlowViaHub({
          token,
          flowId,
          name: draft.name,
          categories: draft.categories,
        });
        if (!updated.ok) throw new Error(updated.reason);
      } else {
        const created = await createFlowViaHub({
          token,
          name: draft.name,
          categories: draft.categories,
        });
        if (!created.ok) throw new Error(created.reason);
        flowId = nonEmptyString(created.data.flow_id) ?? nonEmptyString(created.data.id);
        if (!flowId) throw new Error("Hub created a Flow without an ID.");
        await ctx.runMutation(internal.iaSolutionHub._markFlowDraft, {
          tenantId: caller.tenantId,
          channelId: args.channelId,
          draftId: args.draftId,
          status: "validated",
          providerFlowId: flowId,
        });
      }
      const uploaded = await uploadFlowAssetViaHub({
        token,
        flowId,
        flowJson: draft.flowJson,
      });
      if (!uploaded.ok) throw new Error(uploaded.reason);
      if (uploaded.data.validation_errors?.length) {
        throw new Error("Hub rejected flow.json validation.");
      }
      const published = await publishFlowViaHub({ token, flowId });
      if (!published.ok) throw new Error(published.reason);
      await ctx.runMutation(internal.iaSolutionHub._markFlowDraft, {
        tenantId: caller.tenantId,
        channelId: args.channelId,
        draftId: args.draftId,
        status: "published",
        providerFlowId: flowId,
      });
      return { providerFlowId: flowId, status: "published" as const };
    } catch (error) {
      await ctx.runMutation(internal.iaSolutionHub._markFlowDraft, {
        tenantId: caller.tenantId,
        channelId: args.channelId,
        draftId: args.draftId,
        status: "failed",
        providerFlowId: flowId,
        lastError: error instanceof Error ? error.message : "Flow publication failed.",
      });
      throw new ConvexError({
        code: "HUB_FLOW_PUBLISH_FAILED",
        message: error instanceof Error ? error.message : "Flow publication failed.",
      });
    }
  },
});

async function validateInboundReplyReference(
  ctx: any,
  args: {
    channelId: Id<"channels">;
    threadKey: string;
    replyToProviderMessageId?: string;
  },
) {
  if (!args.replyToProviderMessageId) return;
  const candidates = await ctx.db
    .query("channelEvents")
    .withIndex("by_channel_provider_event", (q: any) =>
      q
        .eq("channelId", args.channelId)
        .eq("providerEventId", args.replyToProviderMessageId),
    )
    .take(10);
  if (
    !candidates.some(
      (event: Doc<"channelEvents">) =>
        event.direction === "incoming" && event.threadKey === args.threadKey,
    )
  ) {
    throw new ConvexError({ code: "INVALID_REPLY_CONTEXT" });
  }
}

export const _claimOutbox = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    memberId: v.id("members"),
    channelId: v.id("channels"),
    threadKey: v.string(),
    businessKey: v.string(),
    messageKind: messageKindValidator,
    payload: v.any(),
    replyToProviderMessageId: v.optional(v.string()),
  },
  returns: v.object({
    outboxId: v.id("channelOutbox"),
    dispatch: v.boolean(),
    status: v.string(),
    recipient: v.string(),
    providerMessageId: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const channel = await ctx.db.get(args.channelId);
    if (
      !channel ||
      channel.tenantId !== args.tenantId ||
      channel.provider !== PROVIDER
    ) {
      throw new ConvexError({ code: "HUB_CHANNEL_NOT_FOUND" });
    }
    if (
      channel.status !== "active" ||
      channel.webhookStatus !== "verified" ||
      channel.sendMode !== "allowlist" ||
      channel.connectionState !== "allowlist_only"
    ) {
      throw new ConvexError({ code: "HUB_PILOT_KILL_SWITCH_ACTIVE" });
    }
    const thread = await ctx.db
      .query("channelThreads")
      .withIndex("by_channel_thread", (q) =>
        q.eq("channelId", channel._id).eq("threadKey", args.threadKey),
      )
      .unique();
    if (!thread || thread.tenantId !== channel.tenantId) {
      throw new ConvexError({ code: "THREAD_NOT_FOUND" });
    }
    const identity = thread.identityId ? await ctx.db.get(thread.identityId) : null;
    const recipient = normalizePhone(identity?.phone ?? thread.threadKey);
    if (!/^\d{8,18}$/.test(recipient)) {
      throw new ConvexError({ code: "INVALID_RECIPIENT" });
    }
    if (!channel.outboundAllowlist.includes(recipient)) {
      throw new ConvexError({ code: "RECIPIENT_NOT_ALLOWLISTED" });
    }
    if (
      args.messageKind !== "template" &&
      (!thread.serviceWindowExpiresAt || thread.serviceWindowExpiresAt <= Date.now())
    ) {
      throw new ConvexError({ code: "SERVICE_WINDOW_EXPIRED" });
    }
    await validateInboundReplyReference(ctx, {
      channelId: channel._id,
      threadKey: thread.threadKey,
      replyToProviderMessageId: args.replyToProviderMessageId,
    });
    if (args.messageKind === "template") {
      const payload = asObject(args.payload);
      const templateName = nonEmptyString(payload?.templateName);
      const languageCode = nonEmptyString(payload?.languageCode);
      if (!templateName || !languageCode) {
        throw new ConvexError({ code: "INVALID_TEMPLATE" });
      }
      const template = await ctx.db
        .query("channelTemplates")
        .withIndex("by_channel_name_language", (q) =>
          q
            .eq("channelId", channel._id)
            .eq("name", templateName)
            .eq("languageCode", languageCode),
        )
        .unique();
      if (!template || template.tenantId !== channel.tenantId) {
        throw new ConvexError({ code: "CHANNEL_TEMPLATE_NOT_FOUND" });
      }
      if (!["approved", "active"].includes(template.status.toLowerCase())) {
        throw new ConvexError({ code: "CHANNEL_TEMPLATE_NOT_APPROVED" });
      }
    }
    const existing = await ctx.db
      .query("channelOutbox")
      .withIndex("by_channel_business_key", (q) =>
        q.eq("channelId", channel._id).eq("businessKey", args.businessKey),
      )
      .unique();
    if (existing) {
      return {
        outboxId: existing._id,
        dispatch: false,
        status: existing.status,
        recipient: existing.recipient,
        providerMessageId: existing.providerMessageId,
      };
    }
    const now = Date.now();
    const outboxId = await ctx.db.insert("channelOutbox", {
      tenantId: channel.tenantId,
      channelId: channel._id,
      businessKey: args.businessKey,
      recipient,
      threadKey: thread.threadKey,
      replyToProviderMessageId: args.replyToProviderMessageId,
      messageKind: args.messageKind,
      payload: args.payload,
      status: "dispatching",
      dispatchAttempts: 1,
      claimedAt: now,
      createdBy: args.memberId,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(
      STALE_DISPATCH_MS + 60_000,
      internal.iaSolutionHub._markUnknownIfStale,
      { outboxId },
    );
    return {
      outboxId,
      dispatch: true,
      status: "dispatching",
      recipient,
    };
  },
});

export const _markUnknownIfStale = internalMutation({
  args: { outboxId: v.id("channelOutbox") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.outboxId);
    if (
      !row ||
      row.status !== "dispatching" ||
      !row.claimedAt ||
      row.claimedAt > Date.now() - STALE_DISPATCH_MS
    ) {
      return null;
    }
    const channel = await ctx.db.get(row.channelId);
    if (!channel || channel.provider !== PROVIDER) return null;
    await ctx.db.patch(row._id, {
      status: "unknown",
      failureReason: "Dispatch did not settle before the safety deadline.",
      unknownSince: Date.now(),
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const _settleOutbox = internalMutation({
  args: {
    outboxId: v.id("channelOutbox"),
    status: v.union(
      v.literal("accepted"),
      v.literal("failed"),
      v.literal("unknown"),
    ),
    providerMessageId: v.optional(v.string()),
    failureReason: v.optional(v.string()),
    flowContext: v.optional(
      v.object({ flowId: v.string(), flowToken: v.string() }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.outboxId);
    if (!row || row.status !== "dispatching") return null;
    const channel = await ctx.db.get(row.channelId);
    if (!channel || channel.provider !== PROVIDER) return null;
    const now = Date.now();
    await ctx.db.patch(row._id, {
      status: args.status,
      providerMessageId: args.providerMessageId,
      failureReason: args.failureReason?.slice(0, MAX_SECRET_ERROR),
      unknownSince: args.status === "unknown" ? now : undefined,
      updatedAt: now,
    });
    if (args.status !== "accepted" || !args.providerMessageId || !row.threadKey) {
      return null;
    }
    const eventKey = `outbox:${row.businessKey}`;
    const existingEvent = await ctx.db
      .query("channelEvents")
      .withIndex("by_channel_key", (q) =>
        q.eq("channelId", channel._id).eq("eventKey", eventKey),
      )
      .unique();
    if (!existingEvent) {
      await ctx.db.insert("channelEvents", {
        tenantId: channel.tenantId,
        channelId: channel._id,
        eventKey,
        providerEventId: args.providerMessageId,
        eventKind: `message.${row.messageKind}`,
        direction: "outgoing",
        actorProviderScopedId: row.recipient,
        actorPhone: row.recipient,
        threadKey: row.threadKey,
        replyToProviderMessageId: row.replyToProviderMessageId,
        payload: row.payload,
        rawPayload: "",
        rawBodySha256: "not_applicable_outbound",
        status: "processed",
        attempts: 1,
        receivedAt: now,
        processedAt: now,
      });
      await projectThreadFromEvent(ctx, {
        channel,
        event: {
          eventKind: `message.${row.messageKind}`,
          direction: "outgoing",
          providerEventId: args.providerMessageId,
          threadKey: row.threadKey,
          payload: row.payload,
        },
        now,
      });
    }
    if (args.flowContext) {
      const existingContext = await ctx.db
        .query("channelFlowContexts")
        .withIndex("by_channel_external_message", (q) =>
          q
            .eq("channelId", channel._id)
            .eq("externalMessageId", args.providerMessageId!),
        )
        .unique();
      if (!existingContext) {
        await ctx.db.insert("channelFlowContexts", {
          tenantId: channel.tenantId,
          channelId: channel._id,
          threadKey: row.threadKey,
          recipient: row.recipient,
          externalMessageId: args.providerMessageId,
          flowId: args.flowContext.flowId,
          flowToken: args.flowContext.flowToken,
          createdAt: now,
          expiresAt: now + 7 * 24 * 60 * 60 * 1_000,
        });
      }
    }
    return null;
  },
});

async function dispatch(
  ctx: any,
  args: {
    caller: Caller;
    channelId: Id<"channels">;
    threadKey: string;
    clientNonce: string;
    messageKind: "text" | "template" | "interactive" | "document";
    payload: unknown;
    replyToProviderMessageId?: string;
    flowContext?: { flowId: string; flowToken: string };
    sender: (
      token: string,
      recipient: string,
    ) => Promise<HubResult<HubMessageResult>>;
  },
): Promise<DispatchResult> {
  const nonce = args.clientNonce.trim();
  if (!nonce || nonce.length > 120) {
    throw new ConvexError({ code: "INVALID_CLIENT_NONCE" });
  }
  await ctx.runMutation(internal.iaSolutionHub._consumeRateLimit, {
    tenantId: args.caller.tenantId,
    channelId: args.channelId,
    scope: "outbound",
  });
  const token = (await ctx.runAction(
    internal.iaSolutionHub._decryptAccessToken,
    { channelId: args.channelId, tenantId: args.caller.tenantId },
  )) as string | null;
  if (!token) throw new ConvexError({ code: "HUB_CHANNEL_NOT_FOUND" });
  const claim = (await ctx.runMutation(internal.iaSolutionHub._claimOutbox, {
    tenantId: args.caller.tenantId,
    memberId: args.caller.memberId,
    channelId: args.channelId,
    threadKey: args.threadKey,
    businessKey: `hub:${args.messageKind}:${nonce}`,
    messageKind: args.messageKind,
    payload: args.payload,
    replyToProviderMessageId: args.replyToProviderMessageId,
  })) as {
    outboxId: Id<"channelOutbox">;
    dispatch: boolean;
    status: string;
    recipient: string;
    providerMessageId?: string;
  };
  if (!claim.dispatch) {
    return {
      outboxId: claim.outboxId,
      status: claim.status,
      providerMessageId: claim.providerMessageId,
    };
  }
  const result = await args.sender(token, claim.recipient);
  if (!result.ok) {
    const definitive = result.status !== undefined && result.status < 500;
    const status = definitive ? "failed" : "unknown";
    await ctx.runMutation(internal.iaSolutionHub._settleOutbox, {
      outboxId: claim.outboxId,
      status,
      failureReason: result.reason,
    });
    return { outboxId: claim.outboxId, status };
  }
  const acceptedId = providerMessageId(result.data);
  if (!acceptedId) {
    await ctx.runMutation(internal.iaSolutionHub._settleOutbox, {
      outboxId: claim.outboxId,
      status: "unknown",
      failureReason: "Hub accepted the request without a WAMID.",
    });
    return { outboxId: claim.outboxId, status: "unknown" };
  }
  await ctx.runMutation(internal.iaSolutionHub._settleOutbox, {
    outboxId: claim.outboxId,
    status: "accepted",
    providerMessageId: acceptedId,
    flowContext: args.flowContext,
  });
  return {
    outboxId: claim.outboxId,
    status: "accepted",
    providerMessageId: acceptedId,
  };
}

const dispatchReturnValidator = v.object({
  outboxId: v.id("channelOutbox"),
  status: v.string(),
  providerMessageId: v.optional(v.string()),
});

export const sendText = action({
  args: {
    channelId: v.id("channels"),
    threadKey: v.string(),
    text: v.string(),
    clientNonce: v.string(),
    previewUrl: v.optional(v.boolean()),
    replyToProviderMessageId: v.optional(v.string()),
  },
  returns: dispatchReturnValidator,
  handler: async (ctx, args) => {
    const caller = (await ctx.runQuery(
      internal.iaSolutionHub._meTenant,
      {},
    )) as Caller | null;
    requireOperator(caller);
    const text = args.text.trim();
    if (!text || text.length > 4_096) {
      throw new ConvexError({ code: "INVALID_TEXT" });
    }
    return await dispatch(ctx, {
      caller,
      channelId: args.channelId,
      threadKey: args.threadKey,
      clientNonce: args.clientNonce,
      messageKind: "text",
      payload: { text, previewUrl: args.previewUrl ?? false },
      replyToProviderMessageId: args.replyToProviderMessageId,
      sender: async (token, recipient) =>
        await sendTextViaHub({
          token,
          to: recipient,
          text,
          previewUrl: args.previewUrl,
          contextMessageId: args.replyToProviderMessageId,
        }),
    });
  },
});

export const sendTemplate = action({
  args: {
    channelId: v.id("channels"),
    threadKey: v.string(),
    templateName: v.string(),
    languageCode: v.string(),
    bodyVariables: v.optional(v.array(v.string())),
    clientNonce: v.string(),
  },
  returns: dispatchReturnValidator,
  handler: async (ctx, args) => {
    const caller = (await ctx.runQuery(
      internal.iaSolutionHub._meTenant,
      {},
    )) as Caller | null;
    requireOperator(caller);
    const templateName = args.templateName.trim();
    const languageCode = args.languageCode.trim();
    if (!templateName || !languageCode) {
      throw new ConvexError({ code: "INVALID_TEMPLATE" });
    }
    return await dispatch(ctx, {
      caller,
      channelId: args.channelId,
      threadKey: args.threadKey,
      clientNonce: args.clientNonce,
      messageKind: "template",
      payload: {
        templateName,
        languageCode,
        bodyVariables: args.bodyVariables ?? [],
      },
      sender: async (token, recipient) =>
        await sendTemplateViaHub({
          token,
          to: recipient,
          templateName,
          languageCode,
          bodyVariables: args.bodyVariables,
        }),
    });
  },
});

export const sendInteractive = action({
  args: {
    channelId: v.id("channels"),
    threadKey: v.string(),
    interactive: v.any(),
    clientNonce: v.string(),
    replyToProviderMessageId: v.optional(v.string()),
    flowContext: v.optional(v.object({ flowId: v.string(), flowToken: v.string() })),
  },
  returns: dispatchReturnValidator,
  handler: async (ctx, args) => {
    const caller = (await ctx.runQuery(
      internal.iaSolutionHub._meTenant,
      {},
    )) as Caller | null;
    requireOperator(caller);
    const interactive = asObject(args.interactive);
    const allowedTypes = ["button", "list", "cta_url"];
    if (
      !interactive ||
      !allowedTypes.includes(String(interactive.type)) ||
      interactive.context !== undefined ||
      JSON.stringify(interactive).length > 32_000
    ) {
      throw new ConvexError({ code: "INVALID_INTERACTIVE_PAYLOAD" });
    }
    const flowContext = args.flowContext
      ? {
          flowId: args.flowContext.flowId.trim(),
          flowToken: args.flowContext.flowToken.trim(),
        }
      : undefined;
    if (
      String(interactive.type) === "flow" &&
      (!flowContext?.flowId || !flowContext.flowToken)
    ) {
      throw new ConvexError({ code: "FLOW_CONTEXT_REQUIRED" });
    }
    const providerInteractive = {
      ...interactive,
      ...(args.replyToProviderMessageId
        ? { context: { message_id: args.replyToProviderMessageId } }
        : {}),
    };
    return await dispatch(ctx, {
      caller,
      channelId: args.channelId,
      threadKey: args.threadKey,
      clientNonce: args.clientNonce,
      messageKind: "interactive",
      payload: { interactive },
      replyToProviderMessageId: args.replyToProviderMessageId,
      flowContext,
      sender: async (token, recipient) =>
        await sendInteractiveViaHub({
          token,
          to: recipient,
          interactive: providerInteractive,
        }),
    });
  },
});

export const sendFlow = action({
  args: {
    channelId: v.id("channels"),
    threadKey: v.string(),
    draftId: v.id("channelFlowDrafts"),
    body: v.string(),
    cta: v.string(),
    initialScreen: v.optional(v.string()),
    clientNonce: v.string(),
    replyToProviderMessageId: v.optional(v.string()),
  },
  returns: dispatchReturnValidator,
  handler: async (ctx, args): Promise<DispatchResult> => {
    const caller = (await ctx.runQuery(
      internal.iaSolutionHub._meTenant,
      {},
    )) as Caller | null;
    requireOperator(caller);
    const draft = (await ctx.runQuery(
      internal.iaSolutionHub._loadFlowDraft,
      {
        tenantId: caller.tenantId,
        channelId: args.channelId,
        draftId: args.draftId,
      },
    )) as {
      status: string;
      providerFlowId?: string;
    } | null;
    if (
      !draft ||
      draft.status !== "published" ||
      !draft.providerFlowId
    ) {
      throw new ConvexError({ code: "PUBLISHED_FLOW_NOT_FOUND" });
    }
    const body = args.body.trim();
    const cta = args.cta.trim();
    if (!body || body.length > 1_024 || !cta || cta.length > 30) {
      throw new ConvexError({ code: "INVALID_FLOW_MESSAGE" });
    }
    const flowToken = randomFlowToken();
    const interactive = {
      type: "flow",
      body: { text: body },
      action: {
        name: "flow",
        parameters: {
          flow_message_version: "3",
          flow_token: flowToken,
          flow_id: draft.providerFlowId,
          flow_cta: cta,
          flow_action: "navigate",
          ...(args.initialScreen
            ? { flow_action_payload: { screen: args.initialScreen } }
            : {}),
        },
      },
      ...(args.replyToProviderMessageId
        ? { context: { message_id: args.replyToProviderMessageId } }
        : {}),
    };
    return await dispatch(ctx, {
      caller,
      channelId: args.channelId,
      threadKey: args.threadKey,
      clientNonce: args.clientNonce,
      messageKind: "interactive",
      payload: { interactive, flowId: draft.providerFlowId },
      replyToProviderMessageId: args.replyToProviderMessageId,
      flowContext: {
        flowId: draft.providerFlowId,
        flowToken,
      },
      sender: async (token, recipient) =>
        await sendInteractiveViaHub({
          token,
          to: recipient,
          interactive,
        }),
    });
  },
});

export const sendDocument = action({
  args: {
    channelId: v.id("channels"),
    threadKey: v.string(),
    mediaId: v.optional(v.string()),
    url: v.optional(v.string()),
    filename: v.optional(v.string()),
    caption: v.optional(v.string()),
    clientNonce: v.string(),
    replyToProviderMessageId: v.optional(v.string()),
  },
  returns: dispatchReturnValidator,
  handler: async (ctx, args) => {
    const caller = (await ctx.runQuery(
      internal.iaSolutionHub._meTenant,
      {},
    )) as Caller | null;
    requireOperator(caller);
    if (Boolean(args.mediaId) === Boolean(args.url)) {
      throw new ConvexError({ code: "DOCUMENT_REQUIRES_EXACTLY_ONE_SOURCE" });
    }
    return await dispatch(ctx, {
      caller,
      channelId: args.channelId,
      threadKey: args.threadKey,
      clientNonce: args.clientNonce,
      messageKind: "document",
      payload: {
        mediaId: args.mediaId,
        url: args.url,
        filename: args.filename,
        caption: args.caption,
      },
      replyToProviderMessageId: args.replyToProviderMessageId,
      sender: async (token, recipient) =>
        await sendDocumentViaHub({
          token,
          to: recipient,
          mediaId: args.mediaId,
          url: args.url,
          filename: args.filename,
          caption: args.caption,
          contextMessageId: args.replyToProviderMessageId,
        }),
    });
  },
});

async function validateFlowReply(
  ctx: any,
  channel: Doc<"channels">,
  event: NormalizedEvent,
): Promise<string | null> {
  if (event.eventKind !== "message.nfm_reply") return null;
  const payload = asObject(event.payload);
  if (!asObject(payload?.flowResponse)) {
    return nonEmptyString(payload?.flowResponseError) ?? "invalid_flow_response";
  }
  let flowContext: Doc<"channelFlowContexts"> | null = null;
  if (event.replyToProviderMessageId) {
    flowContext = await ctx.db
      .query("channelFlowContexts")
      .withIndex("by_channel_external_message", (q: any) =>
        q
          .eq("channelId", channel._id)
          .eq("externalMessageId", event.replyToProviderMessageId),
      )
      .unique();
  }
  if (!flowContext && event.flowToken) {
    flowContext = await ctx.db
      .query("channelFlowContexts")
      .withIndex("by_channel_flow_token", (q: any) =>
        q.eq("channelId", channel._id).eq("flowToken", event.flowToken),
      )
      .order("desc")
      .first();
  }
  if (!flowContext) return "flow_reply_context_not_found";
  if (flowContext.expiresAt && flowContext.expiresAt < Date.now()) {
    return "flow_reply_context_expired";
  }
  const actor = normalizePhone(event.actorPhone ?? event.actorProviderScopedId ?? "");
  if (!actor || actor !== normalizePhone(flowContext.recipient)) {
    return "flow_reply_recipient_mismatch";
  }
  if (event.threadKey && event.threadKey !== flowContext.threadKey) {
    return "flow_reply_thread_mismatch";
  }
  return null;
}

export const ingestWebhookEvents = internalMutation({
  args: {
    channelId: v.id("channels"),
    rawPayload: v.string(),
    rawBodySha256: v.string(),
    events: v.array(normalizedEventValidator),
  },
  returns: v.object({ accepted: v.number(), duplicates: v.number(), failed: v.number() }),
  handler: async (ctx, args) => {
    const channel = await ctx.db.get(args.channelId);
    if (!channel || channel.provider !== PROVIDER) {
      throw new ConvexError({ code: "HUB_CHANNEL_NOT_FOUND" });
    }
    let accepted = 0;
    let duplicates = 0;
    let failed = 0;
    const now = Date.now();
    for (const event of args.events as NormalizedEvent[]) {
      const existing = await ctx.db
        .query("channelEvents")
        .withIndex("by_channel_key", (q) =>
          q.eq("channelId", channel._id).eq("eventKey", event.eventKey),
        )
        .unique();
      if (existing) {
        duplicates += 1;
        continue;
      }
      const flowError = await validateFlowReply(ctx, channel, event);
      let identityId: Id<"channelIdentities"> | undefined;
      if (event.actorProviderScopedId) {
        const identity = await ctx.db
          .query("channelIdentities")
          .withIndex("by_channel_identity", (q) =>
            q
              .eq("channelId", channel._id)
              .eq("providerScopedId", event.actorProviderScopedId!),
          )
          .unique();
        if (identity) {
          identityId = identity._id;
          await ctx.db.patch(identity._id, {
            displayName: event.actorDisplayName ?? identity.displayName,
            phone: event.actorPhone ?? identity.phone,
            updatedAt: now,
          });
        } else {
          identityId = await ctx.db.insert("channelIdentities", {
            tenantId: channel.tenantId,
            channelId: channel._id,
            providerScopedId: event.actorProviderScopedId,
            displayName: event.actorDisplayName,
            phone: event.actorPhone,
            createdAt: now,
            updatedAt: now,
          });
        }
      }
      await ctx.db.insert("channelEvents", {
        tenantId: channel.tenantId,
        channelId: channel._id,
        eventKey: event.eventKey,
        providerEventId: event.providerEventId,
        eventKind: event.eventKind,
        direction: event.direction,
        actorProviderScopedId: event.actorProviderScopedId,
        actorDisplayName: event.actorDisplayName,
        actorPhone: event.actorPhone,
        threadKey: event.threadKey,
        replyToProviderMessageId: event.replyToProviderMessageId,
        flowToken: event.flowToken,
        payload: event.payload,
        rawPayload: args.rawPayload,
        rawBodySha256: args.rawBodySha256,
        providerTimestamp: event.providerTimestamp,
        status: flowError ? "failed" : "processed",
        attempts: 1,
        lastError: flowError ?? undefined,
        receivedAt: now,
        processedAt: now,
      });
      if (flowError) {
        failed += 1;
        accepted += 1;
        continue;
      }
      if (event.eventKind.startsWith("status.")) {
        await reconcileOutboxFromStatus(ctx, { channel, event });
      } else {
        await projectThreadFromEvent(ctx, { channel, event, identityId, now });
      }
      accepted += 1;
    }
    if (accepted > 0) {
      const lastEvent = args.events[args.events.length - 1];
      await ctx.db.patch(channel._id, {
        webhookStatus: "verified",
        connectionState:
          channel.connectionState === "ready"
            ? "allowlist_only"
            : channel.connectionState,
        lastWebhookAt: now,
        lastWebhookEventKind: lastEvent?.eventKind,
        updatedAt: now,
      });
    }
    return { accepted, duplicates, failed };
  },
});
