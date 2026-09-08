import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { writeAudit } from "./lib/audit";
import {
  requireCapability,
  tenantMutation,
  tenantQuery,
} from "./lib/customFunctions";
import {
  allowPlaintextSecretStorageForTests,
  decryptSecret,
  encryptSecret,
  isSecretEncryptionConfigured,
} from "./lib/secrets";
import { isValidWebhookUrl } from "./lib/webhooks";

const MAX_ATTEMPTS = 5;
const CLAIM_LIMIT = 10;
const TIMEOUT_MS = 15_000;

function normalizeBaseUrl(raw: string): string {
  const value = raw.trim();
  if (!isValidWebhookUrl(value)) {
    throw new ConvexError({ code: "STAFF_NOTIFICATION_URL_INVALID" });
  }
  const parsed = new URL(value);
  parsed.search = "";
  parsed.hash = "";
  parsed.pathname = parsed.pathname.replace(/\/?send\/text\/?$/, "").replace(/\/$/, "");
  return parsed.toString().replace(/\/$/, "");
}

function backoffMs(attempt: number): number {
  return Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, attempt - 1));
}

export const getConnection = tenantQuery({
  args: {},
  returns: v.union(
    v.object({
      _id: v.id("staffNotificationConnections"),
      provider: v.literal("uazapi"),
      baseUrl: v.string(),
      tokenLast4: v.string(),
      active: v.boolean(),
      consecutiveFailures: v.number(),
      lastDeliveredAt: v.optional(v.number()),
      pausedAt: v.optional(v.number()),
      pausedReason: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    requireCapability(ctx.role, "integrations.manage");
    const row = await ctx.db
      .query("staffNotificationConnections")
      .withIndex("by_tenant_provider", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("provider", "uazapi"),
      )
      .unique();
    if (!row) return null;
    return {
      _id: row._id,
      provider: row.provider,
      baseUrl: row.baseUrl,
      tokenLast4: row.tokenLast4,
      active: row.active,
      consecutiveFailures: row.consecutiveFailures,
      lastDeliveredAt: row.lastDeliveredAt,
      pausedAt: row.pausedAt,
      pausedReason: row.pausedReason,
    };
  },
});

export const saveConnection = tenantMutation({
  args: {
    baseUrl: v.string(),
    token: v.optional(v.string()),
    active: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "integrations.manage");
    const baseUrl = normalizeBaseUrl(args.baseUrl);
    const existing = await ctx.db
      .query("staffNotificationConnections")
      .withIndex("by_tenant_provider", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("provider", "uazapi"),
      )
      .unique();
    const token = args.token?.trim();
    if (!existing && (!token || token.length < 8)) {
      throw new ConvexError({ code: "STAFF_NOTIFICATION_TOKEN_REQUIRED" });
    }
    if (token && token.length < 8) {
      throw new ConvexError({ code: "STAFF_NOTIFICATION_TOKEN_INVALID" });
    }
    if (token && !isSecretEncryptionConfigured() && !allowPlaintextSecretStorageForTests()) {
      throw new ConvexError({ code: "SECRET_ENCRYPTION_NOT_CONFIGURED" });
    }
    const now = Date.now();
    const encrypted = token ? await encryptSecret(token) : null;
    if (existing) {
      await ctx.db.patch(existing._id, {
        baseUrl,
        active: args.active,
        ...(encrypted
          ? {
              tokenCiphertext: encrypted.ciphertext,
              tokenKeyVersion: encrypted.keyVersion,
              tokenLast4: token!.slice(-4),
            }
          : {}),
        consecutiveFailures: args.active ? 0 : existing.consecutiveFailures,
        pausedAt: args.active ? undefined : existing.pausedAt,
        pausedReason: args.active ? undefined : existing.pausedReason,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("staffNotificationConnections", {
        tenantId: ctx.tenantId,
        provider: "uazapi",
        baseUrl,
        tokenCiphertext: encrypted!.ciphertext,
        tokenKeyVersion: encrypted!.keyVersion,
        tokenLast4: token!.slice(-4),
        active: args.active,
        consecutiveFailures: 0,
        createdBy: ctx.memberId,
        createdAt: now,
        updatedAt: now,
      });
    }
    await writeAudit(ctx, {
      action: "staff_notification.connection_saved",
      targetType: "staffNotificationConnection",
      targetId: existing?._id ?? "uazapi",
      payload: { provider: "uazapi", host: new URL(baseUrl).host, active: args.active, tokenRotated: !!token },
    });
    return null;
  },
});

export const listRecent = tenantQuery({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("staffNotificationDeliveries"),
      decisionId: v.id("agentDecisions"),
      memberId: v.id("members"),
      status: v.string(),
      attempts: v.number(),
      lastStatus: v.optional(v.number()),
      lastError: v.optional(v.string()),
      deliveredAt: v.optional(v.number()),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    requireCapability(ctx.role, "integrations.manage");
    const rows = await ctx.db
      .query("staffNotificationDeliveries")
      .withIndex("by_tenant_created", (q) => q.eq("tenantId", ctx.tenantId))
      .order("desc")
      .take(30);
    return rows.map((row) => ({
      _id: row._id,
      decisionId: row.decisionId,
      memberId: row.memberId,
      status: row.status,
      attempts: row.attempts,
      lastStatus: row.lastStatus,
      lastError: row.lastError,
      deliveredAt: row.deliveredAt,
      createdAt: row.createdAt,
    }));
  },
});

export const deliverDue = internalMutation({
  args: {},
  returns: v.object({ claimed: v.number(), released: v.number() }),
  handler: async (ctx) => {
    const now = Date.now();
    const due = (await ctx.db
      .query("staffNotificationDeliveries")
      .withIndex("by_status_next", (q) => q.eq("status", "pending").lte("nextAttemptAt", now))
      .take(CLAIM_LIMIT)) as Doc<"staffNotificationDeliveries">[];
    let claimed = 0;
    for (const row of due) {
      const connection = await ctx.db.get(row.connectionId);
      if (
        !connection?.active ||
        connection.pausedAt ||
        connection.tenantId !== row.tenantId
      ) {
        await ctx.db.patch(row._id, { status: "dead", lastError: "connection unavailable", updatedAt: now });
        continue;
      }
      await ctx.db.patch(row._id, { status: "claimed", attempts: row.attempts + 1, updatedAt: now });
      await ctx.scheduler.runAfter(claimed * 250, internal.staffNotifications.deliverOne, { deliveryId: row._id });
      claimed += 1;
    }
    const stale = (await ctx.db
      .query("staffNotificationDeliveries")
      .withIndex("by_status_next", (q) => q.eq("status", "claimed"))
      .take(30)) as Doc<"staffNotificationDeliveries">[];
    let released = 0;
    for (const row of stale) {
      if (row.updatedAt > now - 5 * 60_000) continue;
      await ctx.db.patch(row._id, { status: "pending", nextAttemptAt: now, updatedAt: now });
      released += 1;
    }
    return { claimed, released };
  },
});

export const _loadDelivery = internalQuery({
  args: { deliveryId: v.id("staffNotificationDeliveries") },
  returns: v.union(
    v.object({
      baseUrl: v.string(),
      tokenCiphertext: v.string(),
      tokenKeyVersion: v.number(),
      number: v.string(),
      text: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get(args.deliveryId);
    if (!delivery || delivery.status !== "claimed") return null;
    const connection = await ctx.db.get(delivery.connectionId);
    if (
      !connection?.active ||
      connection.pausedAt ||
      connection.tenantId !== delivery.tenantId
    ) {
      return null;
    }
    return {
      baseUrl: connection.baseUrl,
      tokenCiphertext: connection.tokenCiphertext,
      tokenKeyVersion: connection.tokenKeyVersion,
      number: delivery.recipientE164.replace(/\D/g, ""),
      text: delivery.text,
    };
  },
});

export const _settleDelivery = internalMutation({
  args: {
    deliveryId: v.id("staffNotificationDeliveries"),
    ok: v.boolean(),
    status: v.optional(v.number()),
    providerMessageId: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get(args.deliveryId);
    if (!delivery || delivery.status !== "claimed") return null;
    const connection = await ctx.db.get(delivery.connectionId);
    const now = Date.now();
    if (args.ok) {
      await ctx.db.patch(delivery._id, {
        status: "delivered",
        lastStatus: args.status,
        providerMessageId: args.providerMessageId?.slice(0, 200),
        lastError: undefined,
        deliveredAt: now,
        updatedAt: now,
      });
      if (connection?.tenantId === delivery.tenantId) {
        await ctx.db.patch(connection._id, { consecutiveFailures: 0, lastDeliveredAt: now, updatedAt: now });
      }
      return null;
    }
    const permanent = args.status === 401 || args.status === 403 || args.status === 404;
    const exhausted = delivery.attempts >= MAX_ATTEMPTS;
    await ctx.db.patch(delivery._id, {
      status: permanent || exhausted ? "dead" : "pending",
      nextAttemptAt: now + backoffMs(delivery.attempts),
      lastStatus: args.status,
      lastError: args.error?.slice(0, 300),
      updatedAt: now,
    });
    if (connection?.tenantId === delivery.tenantId) {
      const failures = connection.consecutiveFailures + 1;
      const shouldPause = permanent || failures >= MAX_ATTEMPTS;
      await ctx.db.patch(connection._id, {
        consecutiveFailures: failures,
        ...(shouldPause ? { pausedAt: now, pausedReason: permanent ? "authentication_failed" : "consecutive_failures" } : {}),
        updatedAt: now,
      });
    }
    return null;
  },
});

export const deliverOne = internalAction({
  args: { deliveryId: v.id("staffNotificationDeliveries") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const target = await ctx.runQuery(internal.staffNotifications._loadDelivery, args);
    if (!target) {
      await ctx.runMutation(internal.staffNotifications._settleDelivery, {
        deliveryId: args.deliveryId,
        ok: false,
        status: 410,
        error: "connection unavailable",
      });
      return null;
    }
    let token: string;
    try {
      token = await decryptSecret(target.tokenCiphertext, target.tokenKeyVersion);
    } catch (error) {
      await ctx.runMutation(internal.staffNotifications._settleDelivery, {
        deliveryId: args.deliveryId,
        ok: false,
        error: error instanceof Error ? error.message : "secret unavailable",
      });
      return null;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(`${target.baseUrl}/send/text`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          token,
          "user-agent": "OpenBSP-Staff-Briefings/1.0",
        },
        body: JSON.stringify({
          number: target.number,
          text: target.text,
          linkPreview: false,
          readchat: false,
          delay: 0,
        }),
        signal: controller.signal,
      });
      let providerMessageId: string | undefined;
      try {
        const body = (await response.json()) as Record<string, unknown>;
        const candidate = body.id ?? body.messageid ?? body.messageId;
        if (typeof candidate === "string") providerMessageId = candidate;
      } catch {
        // The HTTP status is the delivery verdict; response JSON is optional.
      }
      await ctx.runMutation(internal.staffNotifications._settleDelivery, {
        deliveryId: args.deliveryId,
        ok: response.ok,
        status: response.status,
        providerMessageId,
        error: response.ok ? undefined : `HTTP ${response.status}`,
      });
    } catch (error) {
      await ctx.runMutation(internal.staffNotifications._settleDelivery, {
        deliveryId: args.deliveryId,
        ok: false,
        error: error instanceof Error && error.name === "AbortError" ? "timeout" : error instanceof Error ? error.message : "request failed",
      });
    } finally {
      clearTimeout(timer);
    }
    return null;
  },
});
