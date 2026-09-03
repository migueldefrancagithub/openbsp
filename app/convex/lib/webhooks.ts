import type { Doc, Id } from "../_generated/dataModel";
import { bytesToHex } from "./idempotency";

export const WEBHOOK_EVENT_TYPES = [
  "thread.lead_status_changed",
  "appointment.booked",
  "appointment.confirmed",
  "appointment.cancelled",
  "appointment.attended",
  "appointment.no_show",
  "human_case.opened",
  "human_case.resolved",
  "ai.replied",
  "ai.handoff",
  "campaign.completed",
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export const MAX_WEBHOOKS_PER_TENANT = 10;
export const MAX_DELIVERY_ATTEMPTS = 8;
export const PAUSE_AFTER_CONSECUTIVE_FAILURES = 20;
export const DELIVERY_TIMEOUT_MS = 10_000;
export const CLAIM_BATCH = 20;
export const STALE_CLAIM_MS = 5 * 60_000;

/** 1 min → 24 h across the 8 attempts. */
export function backoffMsForAttempt(attempt: number): number {
  const ladder = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 3 * 60 * 60_000, 6 * 60 * 60_000, 12 * 60 * 60_000, 24 * 60 * 60_000];
  return ladder[Math.min(ladder.length, Math.max(1, attempt)) - 1];
}

export function isValidWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".local") || /^(10\.|127\.|192\.168\.|169\.254\.|0\.)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    return url.length <= 500;
  } catch {
    return false;
  }
}

export function randomSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `whsec_${bytesToHex(bytes)}`;
}

/** Stripe-style signature: `t=<unix seconds>,v1=<hex hmac-sha256(secret, "<t>.<body>")>`. */
export async function signWebhookBody(secret: string, timestampSeconds: number, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestampSeconds}.${body}`)));
  return `t=${timestampSeconds},v1=${bytesToHex(signature)}`;
}

/** Enqueue one delivery per active webhook subscribed to `type` (idempotent per event). */
export async function emitWebhookEvent(
  ctx: { db: any; scheduler?: any },
  args: { tenantId: Id<"tenants">; type: WebhookEventType; eventId: string; payload: Record<string, unknown>; now?: number },
): Promise<number> {
  const now = args.now ?? Date.now();
  const hooks = (await ctx.db
    .query("outboundWebhooks")
    .withIndex("by_tenant_active", (q: any) => q.eq("tenantId", args.tenantId).eq("active", true))
    .take(MAX_WEBHOOKS_PER_TENANT)) as Doc<"outboundWebhooks">[];
  let queued = 0;
  for (const hook of hooks) {
    if (hook.pausedAt || !hook.events.includes(args.type)) continue;
    const businessKey = `${args.type}:${args.eventId}`;
    const existing = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_business_key", (q: any) => q.eq("webhookId", hook._id).eq("businessKey", businessKey))
      .unique();
    if (existing) continue;
    await ctx.db.insert("webhookDeliveries", {
      tenantId: args.tenantId,
      webhookId: hook._id,
      eventType: args.type,
      eventId: args.eventId,
      businessKey,
      payload: { id: args.eventId, type: args.type, createdAt: now, data: args.payload },
      status: "pending",
      attempts: 0,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    });
    queued += 1;
  }
  return queued;
}
