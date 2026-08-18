import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { tenantMutation } from "./lib/customFunctions";
import {
  decryptSecret,
  encryptSecret,
  getSecretEncryptionStatus,
} from "./lib/secrets";
import {
  createFlow as createFlowViaHub,
  getPhoneHealth,
  getPhoneInfo,
  listFlows,
  normalizePhone,
  providerMessageId,
  sendInteractive as sendInteractiveViaHub,
  sendTemplate as sendTemplateViaHub,
  sendText as sendTextViaHub,
  publishFlow as publishFlowViaHub,
  uploadFlowAsset as uploadFlowAssetViaHub,
  type HubMessageResult,
  type HubResult,
} from "./integrations/leoHub/client";

const LAB_PROVIDER = "lab_bridge" as const;

const normalizedEventValidator = v.object({
  eventKey: v.string(),
  providerEventId: v.optional(v.string()),
  eventKind: v.string(),
  direction: v.union(v.literal("incoming"), v.literal("outgoing")),
  actorProviderScopedId: v.optional(v.string()),
  actorDisplayName: v.optional(v.string()),
  actorPhone: v.optional(v.string()),
  threadKey: v.optional(v.string()),
  providerTimestamp: v.optional(v.number()),
  payload: v.any(),
});

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

function requireAdmin(caller: Caller | null): asserts caller is Caller {
  if (!caller) throw new ConvexError({ code: "UNAUTHENTICATED" });
  if (caller.role !== "owner" && caller.role !== "admin") {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "Only an owner or admin can operate the Hub laboratory.",
    });
  }
}

function normalizeAllowlist(values: string[]): string[] {
  const normalized = [...new Set(values.map(normalizePhone).filter(Boolean))];
  for (const phone of normalized) {
    if (!/^\d{8,18}$/.test(phone)) {
      throw new ConvexError({
        code: "INVALID_ALLOWLIST_PHONE",
        message: "Allowlist phones must use E.164 digits.",
      });
    }
  }
  return normalized;
}

function randomPublicId(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `lab_${btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")}`;
}

function validateConnectionInput(args: {
  externalChannelId: string;
  displayName: string;
  channelToken: string;
  webhookSecret: string;
  outboundAllowlist: string[];
}) {
  const externalChannelId = args.externalChannelId.trim();
  const displayName = args.displayName.trim();
  const channelToken = args.channelToken.trim();
  const webhookSecret = args.webhookSecret.trim();
  if (!externalChannelId || externalChannelId.length > 160) {
    throw new ConvexError({ code: "INVALID_EXTERNAL_CHANNEL_ID" });
  }
  if (!displayName || displayName.length > 100) {
    throw new ConvexError({ code: "INVALID_DISPLAY_NAME" });
  }
  if (channelToken.length < 20) {
    throw new ConvexError({ code: "INVALID_CHANNEL_TOKEN" });
  }
  if (webhookSecret.length < 24) {
    throw new ConvexError({
      code: "WEAK_WEBHOOK_SECRET",
      message: "Use a random webhook secret with at least 24 characters.",
    });
  }
  const outboundAllowlist = normalizeAllowlist(args.outboundAllowlist);
  if (outboundAllowlist.length === 0) {
    throw new ConvexError({
      code: "ALLOWLIST_REQUIRED",
      message: "Add at least one test recipient before connecting the lab.",
    });
  }
  return {
    externalChannelId,
    displayName,
    channelToken,
    webhookSecret,
    outboundAllowlist,
  };
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

export const _upsertConnection = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    memberId: v.id("members"),
    publicId: v.string(),
    externalChannelId: v.string(),
    displayName: v.string(),
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
    const existing = await ctx.db
      .query("channels")
      .withIndex("by_provider_identity", (q) =>
        q
          .eq("provider", LAB_PROVIDER)
          .eq("kind", "whatsapp")
          .eq("externalAccountId", args.externalChannelId),
      )
      .unique();
    if (existing && existing.tenantId !== args.tenantId) {
      throw new ConvexError({ code: "CHANNEL_ALREADY_CONNECTED" });
    }

    const now = Date.now();
    const channelId = existing?._id ??
      (await ctx.db.insert("channels", {
        tenantId: args.tenantId,
        publicId: args.publicId,
        kind: "whatsapp",
        provider: LAB_PROVIDER,
        externalAccountId: args.externalChannelId,
        displayName: args.displayName,
        status: "active",
        sendMode: "disabled",
        outboundAllowlist: args.outboundAllowlist,
        lastHealthStatus: args.healthStatus,
        lastHealthCheckAt: now,
        createdBy: args.memberId,
        createdAt: now,
        updatedAt: now,
      }));

    if (existing) {
      await ctx.db.patch(existing._id, {
        displayName: args.displayName,
        status: "active",
        sendMode: "disabled",
        outboundAllowlist: args.outboundAllowlist,
        lastHealthStatus: args.healthStatus,
        lastHealthCheckAt: now,
        updatedAt: now,
      });
    }

    const priorSecret = await ctx.db
      .query("channelSecrets")
      .withIndex("by_channel", (q) => q.eq("channelId", channelId))
      .unique();
    const secretFields = {
      tenantId: args.tenantId,
      channelId,
      accessTokenCiphertext: args.accessTokenCiphertext,
      accessTokenKeyVersion: args.accessTokenKeyVersion,
      webhookSecretCiphertext: args.webhookSecretCiphertext,
      webhookSecretKeyVersion: args.webhookSecretKeyVersion,
      encryptedAt: args.encryptedAt,
    };
    if (priorSecret) await ctx.db.replace(priorSecret._id, secretFields);
    else await ctx.db.insert("channelSecrets", secretFields);

    return {
      channelId,
      publicId: existing?.publicId ?? args.publicId,
    };
  },
});

export const configure = action({
  args: {
    externalChannelId: v.string(),
    displayName: v.string(),
    channelToken: v.string(),
    webhookSecret: v.string(),
    outboundAllowlist: v.array(v.string()),
  },
  returns: v.object({
    channelId: v.id("channels"),
    publicId: v.string(),
    webhookPath: v.string(),
    sendMode: v.literal("disabled"),
    phoneInfo: v.any(),
  }),
  handler: async (ctx, rawArgs) => {
    const caller = (await ctx.runQuery(
      internal.leoHubLab._meTenant,
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

    const compliance = (await ctx.runQuery(
      internal.whatsappAccounts.checkConnectionCompliance,
      { tenantId: caller.tenantId },
    )) as { allowed: boolean; code?: string; message?: string };
    if (!compliance.allowed) {
      throw new ConvexError({
        code: compliance.code ?? "COMPLIANCE_REQUIRED",
        message: compliance.message,
      });
    }

    const args = validateConnectionInput(rawArgs);
    const phoneInfo = await getPhoneInfo({ token: args.channelToken });
    if (!phoneInfo.ok) {
      throw new ConvexError({
        code: "HUB_TOKEN_VALIDATION_FAILED",
        status: phoneInfo.status,
        message: phoneInfo.reason,
      });
    }

    const [tokenSecret, webhookSecret] = await Promise.all([
      encryptSecret(args.channelToken),
      encryptSecret(args.webhookSecret),
    ]);
    const result = (await ctx.runMutation(
      internal.leoHubLab._upsertConnection,
      {
        tenantId: caller.tenantId,
        memberId: caller.memberId,
        publicId: randomPublicId(),
        externalChannelId: args.externalChannelId,
        displayName: args.displayName,
        outboundAllowlist: args.outboundAllowlist,
        accessTokenCiphertext: tokenSecret.ciphertext,
        accessTokenKeyVersion: tokenSecret.keyVersion,
        webhookSecretCiphertext: webhookSecret.ciphertext,
        webhookSecretKeyVersion: webhookSecret.keyVersion,
        encryptedAt: Math.max(tokenSecret.encryptedAt, webhookSecret.encryptedAt),
        healthStatus:
          typeof phoneInfo.data.health_status === "string"
            ? phoneInfo.data.health_status
            : undefined,
      },
    )) as { channelId: Id<"channels">; publicId: string };

    return {
      ...result,
      webhookPath: `/provider-webhook/leo-hub/${result.publicId}`,
      sendMode: "disabled" as const,
      phoneInfo: phoneInfo.data,
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
      channel.provider !== LAB_PROVIDER
    ) {
      throw new ConvexError({ code: "LAB_CHANNEL_NOT_FOUND" });
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

export const disconnect = tenantMutation({
  args: { channelId: v.id("channels") },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (ctx.role !== "owner" && ctx.role !== "admin") {
      throw new ConvexError({ code: "FORBIDDEN" });
    }
    const channel = await ctx.db.get(args.channelId);
    if (
      !channel ||
      channel.tenantId !== ctx.tenantId ||
      channel.provider !== LAB_PROVIDER
    ) {
      throw new ConvexError({ code: "LAB_CHANNEL_NOT_FOUND" });
    }
    await ctx.db.patch(channel._id, {
      status: "disconnected",
      sendMode: "disabled",
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
      channel.provider !== LAB_PROVIDER
    ) {
      return null;
    }
    const secret = await ctx.db
      .query("channelSecrets")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
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
      internal.leoHubLab._loadSecret,
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
      webhookSecretCiphertext: v.string(),
      webhookSecretKeyVersion: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const channel = await ctx.db
      .query("channels")
      .withIndex("by_public_id", (q) => q.eq("publicId", args.publicId))
      .unique();
    if (!channel || channel.provider !== LAB_PROVIDER) return null;
    const secret = await ctx.db
      .query("channelSecrets")
      .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
      .unique();
    if (!secret || secret.tenantId !== channel.tenantId) return null;
    return {
      channelId: channel._id,
      status: channel.status,
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
      webhookSecret: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const target = (await ctx.runQuery(
      internal.leoHubLab._loadWebhookTarget,
      args,
    )) as {
      channelId: Id<"channels">;
      status: string;
      webhookSecretCiphertext: string;
      webhookSecretKeyVersion: number;
    } | null;
    if (!target) return null;
    return {
      channelId: target.channelId,
      status: target.status,
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
    status: v.union(v.literal("active"), v.literal("degraded")),
    healthStatus: v.optional(v.string()),
    detail: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const channel = await ctx.db.get(args.channelId);
    if (!channel || channel.provider !== LAB_PROVIDER) return null;
    await ctx.db.patch(channel._id, {
      status: args.status,
      lastHealthStatus: args.healthStatus,
      lastHealthDetail: args.detail?.slice(0, 500),
      lastHealthCheckAt: Date.now(),
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const checkHealth = action({
  args: { channelId: v.id("channels") },
  returns: v.object({
    ok: v.boolean(),
    phoneInfo: v.any(),
    phoneHealth: v.any(),
  }),
  handler: async (ctx, args) => {
    const caller = (await ctx.runQuery(
      internal.leoHubLab._meTenant,
      {},
    )) as Caller | null;
    requireAdmin(caller);
    const token = (await ctx.runAction(
      internal.leoHubLab._decryptAccessToken,
      { channelId: args.channelId, tenantId: caller.tenantId },
    )) as string | null;
    if (!token) throw new ConvexError({ code: "LAB_CHANNEL_NOT_FOUND" });
    const [info, health] = await Promise.all([
      getPhoneInfo({ token }),
      getPhoneHealth({ token }),
    ]);
    const ok = info.ok && health.ok;
    const healthData = health.ok ? health.data : undefined;
    const healthStatus =
      healthData && typeof healthData.health_status === "string"
        ? healthData.health_status
        : undefined;
    await ctx.runMutation(internal.leoHubLab._patchHealth, {
      channelId: args.channelId,
      status: ok ? "active" : "degraded",
      healthStatus,
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

export const inspectFlows = action({
  args: { channelId: v.id("channels") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const caller = (await ctx.runQuery(
      internal.leoHubLab._meTenant,
      {},
    )) as Caller | null;
    requireAdmin(caller);
    const token = (await ctx.runAction(
      internal.leoHubLab._decryptAccessToken,
      { channelId: args.channelId, tenantId: caller.tenantId },
    )) as string | null;
    if (!token) throw new ConvexError({ code: "LAB_CHANNEL_NOT_FOUND" });
    const result = await listFlows({ token });
    if (!result.ok) {
      throw new ConvexError({
        code: "HUB_FLOWS_FAILED",
        status: result.status,
        message: result.reason,
      });
    }
    return result.data;
  },
});

export const createLabFlow = action({
  args: {
    channelId: v.id("channels"),
    name: v.string(),
    categories: v.array(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const caller = (await ctx.runQuery(
      internal.leoHubLab._meTenant,
      {},
    )) as Caller | null;
    requireAdmin(caller);
    const name = args.name.trim();
    if (!name.startsWith("obsp_lab_") || name.length > 80) {
      throw new ConvexError({
        code: "LAB_FLOW_PREFIX_REQUIRED",
        message: "Laboratory Flow names must start with obsp_lab_.",
      });
    }
    if (args.categories.length === 0 || args.categories.length > 5) {
      throw new ConvexError({ code: "INVALID_FLOW_CATEGORIES" });
    }
    const token = (await ctx.runAction(
      internal.leoHubLab._decryptAccessToken,
      { channelId: args.channelId, tenantId: caller.tenantId },
    )) as string | null;
    if (!token) throw new ConvexError({ code: "LAB_CHANNEL_NOT_FOUND" });
    const result = await createFlowViaHub({
      token,
      name,
      categories: args.categories,
    });
    if (!result.ok) {
      throw new ConvexError({
        code: "HUB_FLOW_CREATE_FAILED",
        status: result.status,
        message: result.reason,
      });
    }
    return result.data;
  },
});

async function requireLabFlow(token: string, flowId: string) {
  const normalizedId = flowId.trim();
  if (!normalizedId || normalizedId.length > 160) {
    throw new ConvexError({ code: "INVALID_FLOW_ID" });
  }
  const result = await listFlows({ token });
  if (!result.ok) {
    throw new ConvexError({
      code: "HUB_FLOWS_FAILED",
      status: result.status,
      message: result.reason,
    });
  }
  const flow = result.data.find(
    (candidate) =>
      candidate.flow_id === normalizedId || candidate.id === normalizedId,
  );
  if (!flow || !flow.name?.startsWith("obsp_lab_")) {
    throw new ConvexError({
      code: "LAB_FLOW_NOT_FOUND",
      message: "Only obsp_lab_ Flows can be changed through the laboratory.",
    });
  }
  return normalizedId;
}

export const uploadLabFlowAsset = action({
  args: {
    channelId: v.id("channels"),
    flowId: v.string(),
    flowJson: v.any(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const caller = (await ctx.runQuery(
      internal.leoHubLab._meTenant,
      {},
    )) as Caller | null;
    requireAdmin(caller);
    const serialized = JSON.stringify(args.flowJson);
    if (
      !args.flowJson ||
      typeof args.flowJson !== "object" ||
      serialized.length > 256_000
    ) {
      throw new ConvexError({ code: "INVALID_FLOW_JSON" });
    }
    const token = (await ctx.runAction(
      internal.leoHubLab._decryptAccessToken,
      { channelId: args.channelId, tenantId: caller.tenantId },
    )) as string | null;
    if (!token) throw new ConvexError({ code: "LAB_CHANNEL_NOT_FOUND" });
    const flowId = await requireLabFlow(token, args.flowId);
    const result = await uploadFlowAssetViaHub({
      token,
      flowId,
      flowJson: args.flowJson,
    });
    if (!result.ok) {
      throw new ConvexError({
        code: "HUB_FLOW_UPLOAD_FAILED",
        status: result.status,
        message: result.reason,
      });
    }
    return result.data;
  },
});

export const publishLabFlow = action({
  args: { channelId: v.id("channels"), flowId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const caller = (await ctx.runQuery(
      internal.leoHubLab._meTenant,
      {},
    )) as Caller | null;
    requireAdmin(caller);
    const token = (await ctx.runAction(
      internal.leoHubLab._decryptAccessToken,
      { channelId: args.channelId, tenantId: caller.tenantId },
    )) as string | null;
    if (!token) throw new ConvexError({ code: "LAB_CHANNEL_NOT_FOUND" });
    const flowId = await requireLabFlow(token, args.flowId);
    const result = await publishFlowViaHub({ token, flowId });
    if (!result.ok) {
      throw new ConvexError({
        code: "HUB_FLOW_PUBLISH_FAILED",
        status: result.status,
        message: result.reason,
      });
    }
    return result.data;
  },
});

export const _claimOutbox = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    memberId: v.id("members"),
    channelId: v.id("channels"),
    businessKey: v.string(),
    recipient: v.string(),
    messageKind: v.union(
      v.literal("text"),
      v.literal("template"),
      v.literal("interactive"),
    ),
    payload: v.any(),
  },
  returns: v.object({
    outboxId: v.id("channelOutbox"),
    dispatch: v.boolean(),
    status: v.string(),
    providerMessageId: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const channel = await ctx.db.get(args.channelId);
    if (
      !channel ||
      channel.tenantId !== args.tenantId ||
      channel.provider !== LAB_PROVIDER
    ) {
      throw new ConvexError({ code: "LAB_CHANNEL_NOT_FOUND" });
    }
    if (channel.status !== "active") {
      throw new ConvexError({ code: "LAB_CHANNEL_NOT_ACTIVE" });
    }
    if (channel.sendMode === "disabled") {
      throw new ConvexError({
        code: "LAB_KILL_SWITCH_ACTIVE",
        message: "Enable allowlist mode before sending a lab message.",
      });
    }
    if (!channel.outboundAllowlist.includes(args.recipient)) {
      throw new ConvexError({ code: "RECIPIENT_NOT_ALLOWLISTED" });
    }

    const existing = await ctx.db
      .query("channelOutbox")
      .withIndex("by_channel_business_key", (q) =>
        q.eq("channelId", args.channelId).eq("businessKey", args.businessKey),
      )
      .unique();
    if (existing) {
      return {
        outboxId: existing._id,
        dispatch: false,
        status: existing.status,
        providerMessageId: existing.providerMessageId,
      };
    }

    const now = Date.now();
    const outboxId = await ctx.db.insert("channelOutbox", {
      tenantId: args.tenantId,
      channelId: args.channelId,
      businessKey: args.businessKey,
      recipient: args.recipient,
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
      3 * 60 * 1_000,
      internal.leoHubLab._markUnknownIfStale,
      { outboxId },
    );
    return { outboxId, dispatch: true, status: "dispatching" };
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
      row.claimedAt > Date.now() - 2 * 60 * 1_000
    ) {
      return null;
    }
    await ctx.db.patch(row._id, {
      status: "unknown",
      failureReason:
        "Dispatch did not settle before the laboratory safety deadline.",
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
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.outboxId);
    if (!row || row.status !== "dispatching") return null;
    await ctx.db.patch(row._id, {
      status: args.status,
      providerMessageId: args.providerMessageId,
      failureReason: args.failureReason?.slice(0, 500),
      unknownSince: args.status === "unknown" ? Date.now() : undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

async function dispatch(
  ctx: any,
  args: {
    caller: Caller;
    channelId: Id<"channels">;
    clientNonce: string;
    recipient: string;
    messageKind: "text" | "template" | "interactive";
    payload: unknown;
    sender: (token: string) => Promise<HubResult<HubMessageResult>>;
  },
): Promise<{ outboxId: Id<"channelOutbox">; status: string; providerMessageId?: string }> {
  const recipient = normalizePhone(args.recipient);
  if (!/^\d{8,18}$/.test(recipient)) {
    throw new ConvexError({ code: "INVALID_RECIPIENT" });
  }
  const clientNonce = args.clientNonce.trim();
  if (!clientNonce || clientNonce.length > 120) {
    throw new ConvexError({ code: "INVALID_CLIENT_NONCE" });
  }
  const token = (await ctx.runAction(
    internal.leoHubLab._decryptAccessToken,
    { channelId: args.channelId, tenantId: args.caller.tenantId },
  )) as string | null;
  if (!token) throw new ConvexError({ code: "LAB_CHANNEL_NOT_FOUND" });

  const claim = (await ctx.runMutation(internal.leoHubLab._claimOutbox, {
    tenantId: args.caller.tenantId,
    memberId: args.caller.memberId,
    channelId: args.channelId,
    businessKey: `lab:${args.messageKind}:${clientNonce}`,
    recipient,
    messageKind: args.messageKind,
    payload: args.payload,
  })) as {
    outboxId: Id<"channelOutbox">;
    dispatch: boolean;
    status: string;
    providerMessageId?: string;
  };
  if (!claim.dispatch) {
    return {
      outboxId: claim.outboxId,
      status: claim.status,
      providerMessageId: claim.providerMessageId,
    };
  }

  const result = await args.sender(token);
  if (!result.ok) {
    const definitive = result.status !== undefined && result.status < 500;
    const status = definitive ? "failed" : "unknown";
    await ctx.runMutation(internal.leoHubLab._settleOutbox, {
      outboxId: claim.outboxId,
      status,
      failureReason: result.reason,
    });
    return { outboxId: claim.outboxId, status };
  }

  const acceptedId = providerMessageId(result.data);
  if (!acceptedId) {
    await ctx.runMutation(internal.leoHubLab._settleOutbox, {
      outboxId: claim.outboxId,
      status: "unknown",
      failureReason: "Hub accepted the request without a message identifier.",
    });
    return { outboxId: claim.outboxId, status: "unknown" };
  }
  await ctx.runMutation(internal.leoHubLab._settleOutbox, {
    outboxId: claim.outboxId,
    status: "accepted",
    providerMessageId: acceptedId,
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
    to: v.string(),
    text: v.string(),
    clientNonce: v.string(),
    previewUrl: v.optional(v.boolean()),
  },
  returns: dispatchReturnValidator,
  handler: async (ctx, args) => {
    const caller = (await ctx.runQuery(
      internal.leoHubLab._meTenant,
      {},
    )) as Caller | null;
    requireAdmin(caller);
    const text = args.text.trim();
    if (!text || text.length > 4_096) {
      throw new ConvexError({ code: "INVALID_TEXT" });
    }
    return await dispatch(ctx, {
      caller,
      channelId: args.channelId,
      clientNonce: args.clientNonce,
      recipient: args.to,
      messageKind: "text",
      payload: { text, previewUrl: args.previewUrl ?? false },
      sender: async (token) =>
        await sendTextViaHub({
          token,
          to: args.to,
          text,
          previewUrl: args.previewUrl,
        }),
    });
  },
});

export const sendTemplate = action({
  args: {
    channelId: v.id("channels"),
    to: v.string(),
    templateName: v.string(),
    languageCode: v.string(),
    bodyVariables: v.optional(v.array(v.string())),
    clientNonce: v.string(),
  },
  returns: dispatchReturnValidator,
  handler: async (ctx, args) => {
    const caller = (await ctx.runQuery(
      internal.leoHubLab._meTenant,
      {},
    )) as Caller | null;
    requireAdmin(caller);
    const templateName = args.templateName.trim();
    if (!templateName.startsWith("obsp_lab_")) {
      throw new ConvexError({
        code: "LAB_TEMPLATE_PREFIX_REQUIRED",
        message: "Laboratory templates must start with obsp_lab_.",
      });
    }
    return await dispatch(ctx, {
      caller,
      channelId: args.channelId,
      clientNonce: args.clientNonce,
      recipient: args.to,
      messageKind: "template",
      payload: {
        templateName,
        languageCode: args.languageCode,
        bodyVariables: args.bodyVariables ?? [],
      },
      sender: async (token) =>
        await sendTemplateViaHub({
          token,
          to: args.to,
          templateName,
          languageCode: args.languageCode,
          bodyVariables: args.bodyVariables,
        }),
    });
  },
});

export const sendInteractive = action({
  args: {
    channelId: v.id("channels"),
    to: v.string(),
    interactive: v.any(),
    clientNonce: v.string(),
  },
  returns: dispatchReturnValidator,
  handler: async (ctx, args) => {
    const caller = (await ctx.runQuery(
      internal.leoHubLab._meTenant,
      {},
    )) as Caller | null;
    requireAdmin(caller);
    const interactive = args.interactive as {
      type?: unknown;
      header?: unknown;
      body?: unknown;
      footer?: unknown;
      action?: unknown;
      context?: unknown;
    };
    const allowedTypes = ["button", "list", "cta_url", "flow"];
    if (
      !interactive ||
      typeof interactive !== "object" ||
      !allowedTypes.includes(String(interactive.type)) ||
      JSON.stringify(interactive).length > 32_000
    ) {
      throw new ConvexError({ code: "INVALID_INTERACTIVE_PAYLOAD" });
    }
    return await dispatch(ctx, {
      caller,
      channelId: args.channelId,
      clientNonce: args.clientNonce,
      recipient: args.to,
      messageKind: "interactive",
      payload: { interactive },
      sender: async (token) =>
        await sendInteractiveViaHub({ token, to: args.to, interactive }),
    });
  },
});

export const ingestWebhookEvents = internalMutation({
  args: {
    channelId: v.id("channels"),
    rawPayload: v.string(),
    rawBodySha256: v.string(),
    events: v.array(normalizedEventValidator),
  },
  returns: v.object({ accepted: v.number(), duplicates: v.number() }),
  handler: async (ctx, args) => {
    const channel = await ctx.db.get(args.channelId);
    if (!channel || channel.provider !== LAB_PROVIDER) {
      throw new ConvexError({ code: "LAB_CHANNEL_NOT_FOUND" });
    }
    let accepted = 0;
    let duplicates = 0;
    const now = Date.now();
    for (const event of args.events) {
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
          await ctx.db.patch(identity._id, {
            displayName: event.actorDisplayName ?? identity.displayName,
            phone: event.actorPhone ?? identity.phone,
            updatedAt: now,
          });
        } else {
          await ctx.db.insert("channelIdentities", {
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
        threadKey: event.threadKey,
        payload: event.payload,
        rawPayload: args.rawPayload,
        rawBodySha256: args.rawBodySha256,
        providerTimestamp: event.providerTimestamp,
        status: "processed",
        attempts: 1,
        receivedAt: now,
        processedAt: now,
      });
      accepted += 1;
    }
    return { accepted, duplicates };
  },
});
