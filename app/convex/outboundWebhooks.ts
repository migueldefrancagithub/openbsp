import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { writeAudit } from "./lib/audit";
import { loadByIdInTenant, requireCapability, tenantMutation, tenantQuery } from "./lib/customFunctions";
import { upsertOpsAlert } from "./lib/opsAlerts";
import { allowPlaintextSecretStorageForTests, decryptSecret, encryptSecret, isSecretEncryptionConfigured } from "./lib/secrets";
import {
  backoffMsForAttempt,
  CLAIM_BATCH,
  DELIVERY_TIMEOUT_MS,
  isValidWebhookUrl,
  MAX_DELIVERY_ATTEMPTS,
  MAX_WEBHOOKS_PER_TENANT,
  PAUSE_AFTER_CONSECUTIVE_FAILURES,
  randomSecret,
  signWebhookBody,
  STALE_CLAIM_MS,
  WEBHOOK_EVENT_TYPES,
} from "./lib/webhooks";

const webhookRowValidator = v.object({
  _id: v.id("outboundWebhooks"),
  name: v.string(),
  url: v.string(),
  events: v.array(v.string()),
  active: v.boolean(),
  secretLast4: v.string(),
  consecutiveFailures: v.number(),
  pausedAt: v.optional(v.number()),
  pausedReason: v.optional(v.string()),
  lastDeliveredAt: v.optional(v.number()),
  createdAt: v.number(),
});

function rowOf(hook: Doc<"outboundWebhooks">) {
  return {
    _id: hook._id,
    name: hook.name,
    url: hook.url,
    events: hook.events,
    active: hook.active,
    secretLast4: hook.secretLast4,
    consecutiveFailures: hook.consecutiveFailures,
    pausedAt: hook.pausedAt,
    pausedReason: hook.pausedReason,
    lastDeliveredAt: hook.lastDeliveredAt,
    createdAt: hook.createdAt,
  };
}

function validateEvents(events: string[]): string[] {
  const valid = Array.from(new Set(events.filter((e) => (WEBHOOK_EVENT_TYPES as readonly string[]).includes(e))));
  if (valid.length === 0) throw new ConvexError({ code: "WEBHOOK_EVENTS_REQUIRED" });
  return valid;
}

export const eventTypes = tenantQuery({
  args: {},
  returns: v.array(v.string()),
  handler: async () => [...WEBHOOK_EVENT_TYPES],
});

export const list = tenantQuery({
  args: {},
  returns: v.array(webhookRowValidator),
  handler: async (ctx) => {
    requireCapability(ctx.role, "integrations.manage");
    const rows = [
      ...((await ctx.db.query("outboundWebhooks").withIndex("by_tenant_active", (q) => q.eq("tenantId", ctx.tenantId).eq("active", true)).take(MAX_WEBHOOKS_PER_TENANT)) as Doc<"outboundWebhooks">[]),
      ...((await ctx.db.query("outboundWebhooks").withIndex("by_tenant_active", (q) => q.eq("tenantId", ctx.tenantId).eq("active", false)).take(MAX_WEBHOOKS_PER_TENANT)) as Doc<"outboundWebhooks">[]),
    ];
    return rows.map(rowOf);
  },
});

/** The secret is returned exactly once; afterwards only its last 4 chars are visible. */
export const create = tenantMutation({
  args: { name: v.string(), url: v.string(), events: v.array(v.string()) },
  returns: v.object({ webhookId: v.id("outboundWebhooks"), secret: v.string() }),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "integrations.manage");
    const name = args.name.trim();
    if (name.length < 2 || name.length > 80) throw new ConvexError({ code: "INVALID_TEXT_LENGTH", label: "name", min: 2, max: 80 });
    const url = args.url.trim();
    if (!isValidWebhookUrl(url)) throw new ConvexError({ code: "WEBHOOK_URL_INVALID" });
    const events = validateEvents(args.events);
    if (!isSecretEncryptionConfigured() && !allowPlaintextSecretStorageForTests()) throw new ConvexError({ code: "SECRET_ENCRYPTION_NOT_CONFIGURED" });
    const existing = await ctx.db.query("outboundWebhooks").withIndex("by_tenant_active", (q) => q.eq("tenantId", ctx.tenantId).eq("active", true)).take(MAX_WEBHOOKS_PER_TENANT + 1);
    if (existing.length >= MAX_WEBHOOKS_PER_TENANT) throw new ConvexError({ code: "WEBHOOK_LIMIT" });
    const secret = randomSecret();
    const encrypted = await encryptSecret(secret);
    const now = Date.now();
    const webhookId = await ctx.db.insert("outboundWebhooks", {
      tenantId: ctx.tenantId,
      name,
      url,
      secretCiphertext: encrypted.ciphertext,
      secretKeyVersion: encrypted.keyVersion,
      secretLast4: secret.slice(-4),
      events,
      active: true,
      consecutiveFailures: 0,
      createdBy: ctx.memberId,
      createdAt: now,
      updatedAt: now,
    });
    await writeAudit(ctx, { action: "webhook.created", targetType: "outboundWebhook", targetId: webhookId, payload: { name, host: new URL(url).host, events } });
    return { webhookId, secret };
  },
});

export const update = tenantMutation({
  args: { webhookId: v.id("outboundWebhooks"), name: v.optional(v.string()), url: v.optional(v.string()), events: v.optional(v.array(v.string())), active: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "integrations.manage");
    const hook = await loadByIdInTenant(ctx, "outboundWebhooks", args.webhookId);
    const patch: Partial<Doc<"outboundWebhooks">> = { updatedAt: Date.now() };
    if (args.name !== undefined) {
      const name = args.name.trim();
      if (name.length < 2 || name.length > 80) throw new ConvexError({ code: "INVALID_TEXT_LENGTH", label: "name", min: 2, max: 80 });
      patch.name = name;
    }
    if (args.url !== undefined) {
      if (!isValidWebhookUrl(args.url.trim())) throw new ConvexError({ code: "WEBHOOK_URL_INVALID" });
      patch.url = args.url.trim();
    }
    if (args.events !== undefined) patch.events = validateEvents(args.events);
    if (args.active !== undefined) {
      patch.active = args.active;
      if (args.active) {
        patch.pausedAt = undefined;
        patch.pausedReason = undefined;
        patch.consecutiveFailures = 0;
      }
    }
    await ctx.db.patch(hook._id, patch);
    await writeAudit(ctx, { action: "webhook.updated", targetType: "outboundWebhook", targetId: hook._id, payload: { fields: Object.keys(patch) } });
    return null;
  },
});

export const rotateSecret = tenantMutation({
  args: { webhookId: v.id("outboundWebhooks") },
  returns: v.object({ secret: v.string() }),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "integrations.manage");
    const hook = await loadByIdInTenant(ctx, "outboundWebhooks", args.webhookId);
    const secret = randomSecret();
    const encrypted = await encryptSecret(secret);
    await ctx.db.patch(hook._id, { secretCiphertext: encrypted.ciphertext, secretKeyVersion: encrypted.keyVersion, secretLast4: secret.slice(-4), updatedAt: Date.now() });
    await writeAudit(ctx, { action: "webhook.secret_rotated", targetType: "outboundWebhook", targetId: hook._id });
    return { secret };
  },
});

export const remove = tenantMutation({
  args: { webhookId: v.id("outboundWebhooks") },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "integrations.manage");
    const hook = await loadByIdInTenant(ctx, "outboundWebhooks", args.webhookId);
    await ctx.db.patch(hook._id, { active: false, pausedAt: Date.now(), pausedReason: "removed", updatedAt: Date.now() });
    await writeAudit(ctx, { action: "webhook.removed", targetType: "outboundWebhook", targetId: hook._id, payload: { name: hook.name } });
    return null;
  },
});

export const listDeliveries = tenantQuery({
  args: { webhookId: v.id("outboundWebhooks"), paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(v.object({ _id: v.id("webhookDeliveries"), eventType: v.string(), eventId: v.string(), status: v.string(), attempts: v.number(), nextAttemptAt: v.number(), lastStatus: v.optional(v.number()), lastError: v.optional(v.string()), deliveredAt: v.optional(v.number()), createdAt: v.number() })),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "integrations.manage");
    const hook = await loadByIdInTenant(ctx, "outboundWebhooks", args.webhookId);
    const result = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_webhook_created", (q) => q.eq("webhookId", hook._id))
      .order("desc")
      .paginate({ cursor: args.paginationOpts.cursor, numItems: Math.min(Math.max(args.paginationOpts.numItems, 1), 50) });
    return {
      page: result.page.map((row) => ({ _id: row._id, eventType: row.eventType, eventId: row.eventId, status: row.status, attempts: row.attempts, nextAttemptAt: row.nextAttemptAt, lastStatus: row.lastStatus, lastError: row.lastError, deliveredAt: row.deliveredAt, createdAt: row.createdAt })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const retryDelivery = tenantMutation({
  args: { deliveryId: v.id("webhookDeliveries") },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "integrations.manage");
    const delivery = await loadByIdInTenant(ctx, "webhookDeliveries", args.deliveryId);
    if (delivery.status !== "failed" && delivery.status !== "dead") throw new ConvexError({ code: "WEBHOOK_NOT_RETRYABLE" });
    await ctx.db.patch(delivery._id, { status: "pending", attempts: 0, nextAttemptAt: Date.now(), updatedAt: Date.now() });
    return null;
  },
});

/** Cron (1 min): claim due deliveries and hand each to the delivery action. */
export const deliverDue = internalMutation({
  args: {},
  returns: v.object({ claimed: v.number(), released: v.number() }),
  handler: async (ctx) => {
    const now = Date.now();
    const due = (await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_status_next", (q) => q.eq("status", "pending").lte("nextAttemptAt", now))
      .take(CLAIM_BATCH)) as Doc<"webhookDeliveries">[];
    let claimed = 0;
    for (const delivery of due) {
      const hook = await ctx.db.get(delivery.webhookId);
      if (!hook || !hook.active || hook.pausedAt) {
        await ctx.db.patch(delivery._id, { status: "dead", lastError: "webhook inactive", updatedAt: now });
        continue;
      }
      await ctx.db.patch(delivery._id, { status: "claimed", attempts: delivery.attempts + 1, updatedAt: now });
      await ctx.scheduler.runAfter(claimed * 250, internal.outboundWebhooks.deliverOne, { deliveryId: delivery._id });
      claimed += 1;
    }
    const stale = (await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_status_next", (q) => q.eq("status", "claimed"))
      .take(50)) as Doc<"webhookDeliveries">[];
    let released = 0;
    for (const delivery of stale) {
      if (delivery.updatedAt > now - STALE_CLAIM_MS) continue;
      await ctx.db.patch(delivery._id, { status: "pending", nextAttemptAt: now, updatedAt: now });
      released += 1;
    }
    return { claimed, released };
  },
});

export const _loadDelivery = internalQuery({
  args: { deliveryId: v.id("webhookDeliveries") },
  returns: v.union(v.object({ url: v.string(), secretCiphertext: v.string(), secretKeyVersion: v.number(), body: v.string(), eventType: v.string(), eventId: v.string() }), v.null()),
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get(args.deliveryId);
    if (!delivery || delivery.status !== "claimed") return null;
    const hook = await ctx.db.get(delivery.webhookId);
    if (!hook || !hook.active || hook.pausedAt) return null;
    return { url: hook.url, secretCiphertext: hook.secretCiphertext, secretKeyVersion: hook.secretKeyVersion, body: JSON.stringify(delivery.payload), eventType: delivery.eventType, eventId: delivery.eventId };
  },
});

export const _settleDelivery = internalMutation({
  args: { deliveryId: v.id("webhookDeliveries"), ok: v.boolean(), status: v.optional(v.number()), error: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get(args.deliveryId);
    if (!delivery || delivery.status !== "claimed") return null;
    const hook = await ctx.db.get(delivery.webhookId);
    const now = Date.now();
    if (args.ok) {
      await ctx.db.patch(delivery._id, { status: "delivered", lastStatus: args.status, lastError: undefined, deliveredAt: now, updatedAt: now });
      if (hook) await ctx.db.patch(hook._id, { consecutiveFailures: 0, lastDeliveredAt: now, updatedAt: now });
      return null;
    }
    const permanent = args.status === 410 || args.status === 404 || args.status === 401 || args.status === 403;
    const exhausted = delivery.attempts >= MAX_DELIVERY_ATTEMPTS;
    if (permanent || exhausted) {
      await ctx.db.patch(delivery._id, { status: "dead", lastStatus: args.status, lastError: args.error?.slice(0, 300), updatedAt: now });
    } else {
      await ctx.db.patch(delivery._id, { status: "pending", lastStatus: args.status, lastError: args.error?.slice(0, 300), nextAttemptAt: now + backoffMsForAttempt(delivery.attempts), updatedAt: now });
    }
    if (hook) {
      const failures = hook.consecutiveFailures + 1;
      const pause = failures >= PAUSE_AFTER_CONSECUTIVE_FAILURES;
      await ctx.db.patch(hook._id, { consecutiveFailures: failures, ...(pause ? { pausedAt: now, pausedReason: "consecutive_failures" } : {}), updatedAt: now });
      if (pause) {
        await upsertOpsAlert(ctx, {
          tenantId: hook.tenantId,
          kind: "webhook.paused",
          businessKey: `webhook:${hook._id}:paused`,
          severity: "warn",
          title: `Webhook "${hook.name}" pausado após ${failures} falhas seguidas.`,
          payload: { webhookId: hook._id, lastStatus: args.status },
          href: "/app/settings?tab=integrations",
          reopen: true,
          now,
        });
      }
    }
    return null;
  },
});

/** POST the signed event; classify the outcome for the settle mutation. */
export const deliverOne = internalAction({
  args: { deliveryId: v.id("webhookDeliveries") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const target = await ctx.runQuery(internal.outboundWebhooks._loadDelivery, { deliveryId: args.deliveryId });
    if (!target) {
      await ctx.runMutation(internal.outboundWebhooks._settleDelivery, { deliveryId: args.deliveryId, ok: false, status: 410, error: "webhook inactive" });
      return null;
    }
    let secret: string;
    try {
      secret = await decryptSecret(target.secretCiphertext, target.secretKeyVersion);
    } catch (error) {
      await ctx.runMutation(internal.outboundWebhooks._settleDelivery, { deliveryId: args.deliveryId, ok: false, error: `secret unavailable: ${error instanceof Error ? error.message : String(error)}` });
      return null;
    }
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = await signWebhookBody(secret, timestamp, target.body);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
    try {
      const response = await fetch(target.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "OpenBSP-Webhooks/1.0",
          "x-openbsp-event": target.eventType,
          "x-openbsp-delivery": target.eventId,
          "x-openbsp-signature": signature,
        },
        body: target.body,
        signal: controller.signal,
      });
      const ok = response.status >= 200 && response.status < 300;
      await ctx.runMutation(internal.outboundWebhooks._settleDelivery, { deliveryId: args.deliveryId, ok, status: response.status, error: ok ? undefined : `HTTP ${response.status}` });
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      await ctx.runMutation(internal.outboundWebhooks._settleDelivery, { deliveryId: args.deliveryId, ok: false, error: aborted ? "timeout" : error instanceof Error ? error.message : String(error) });
    } finally {
      clearTimeout(timer);
    }
    return null;
  },
});

export type WebhookId = Id<"outboundWebhooks">;
