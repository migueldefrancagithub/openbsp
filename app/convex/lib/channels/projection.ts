import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import {
  decideOutboxTransition,
  mapProviderStatusToOutboxStatus,
} from "./outboxStatus";

/**
 * Channel-neutral reconciliation and thread projection.
 *
 * These are plain functions taking the mutation ctx rather than Convex
 * mutations, because a Convex mutation cannot call another mutation and both
 * of these must run in the SAME transaction as the channelEvents insert. That
 * atomicity is what makes reconciliation crash-safe without a scheduler.
 *
 * Nothing here may read or write the legacy WhatsApp domain (conversations,
 * messages, contacts, phoneNumbers). See ADR-002.
 */

/** WhatsApp customer-service window. */
const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;
const PREVIEW_MAX_CHARS = 160;
const FAILURE_REASON_MAX_CHARS = 500;

export type ProjectableEvent = {
  eventKind: string;
  direction: "incoming" | "outgoing";
  providerEventId?: string;
  threadKey?: string;
  providerTimestamp?: number;
  payload: unknown;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Derive a short human-readable preview from the normalized payload.
 *
 * Deliberately narrow: only known text locations are read. Raw provider
 * payloads are evidence and must never be serialized into a field the browser
 * reads, so there is no stringify fallback.
 */
export function derivePreview(payload: unknown): string | undefined {
  const root = asObject(payload);
  if (!root) return undefined;

  const normalized = root.normalizedText;
  if (typeof normalized === "string" && normalized.trim()) {
    return normalized.trim().slice(0, PREVIEW_MAX_CHARS);
  }

  const message = asObject(root.message);
  const text = asObject(message?.text);
  const body = text?.body;
  if (typeof body === "string" && body.trim()) {
    return body.trim().slice(0, PREVIEW_MAX_CHARS);
  }

  return undefined;
}

/**
 * Settle the outbox row a provider status event refers to.
 *
 * Matching is strictly by provider message ID. A status for a message OpenBSP
 * did not send is evidence only, not an error, and is never matched by
 * recipient or timestamp — guessing there could mark an unsent message
 * delivered.
 */
export async function reconcileOutboxFromStatus(
  ctx: MutationCtx,
  args: { channel: Doc<"channels">; event: ProjectableEvent },
): Promise<void> {
  const providerMessageId = args.event.providerEventId;
  if (!providerMessageId) return;

  const row = await ctx.db
    .query("channelOutbox")
    .withIndex("by_channel_provider_message", (q) =>
      q
        .eq("channelId", args.channel._id)
        .eq("providerMessageId", providerMessageId),
    )
    .first();
  if (!row) return;

  const incoming = mapProviderStatusToOutboxStatus(args.event.eventKind);
  const { nextStatus, recordFailureReason } = decideOutboxTransition({
    current: row.status,
    incoming,
  });

  const patch: Partial<Doc<"channelOutbox">> = {};
  if (nextStatus) patch.status = nextStatus;
  if (recordFailureReason) {
    const reason = deriveFailureReason(args.event.payload);
    if (reason) patch.failureReason = reason.slice(0, FAILURE_REASON_MAX_CHARS);
  }
  if (Object.keys(patch).length === 0) return;

  patch.updatedAt = Date.now();
  await ctx.db.patch(row._id, patch);
}

function deriveFailureReason(payload: unknown): string | undefined {
  const root = asObject(payload);
  const status = asObject(root?.status);
  const errors = status?.errors;
  const first = Array.isArray(errors) ? asObject(errors[0]) : null;
  const parts: string[] = [];
  for (const key of ["code", "title", "message"]) {
    const value = first?.[key];
    if (typeof value === "string" && value.trim()) parts.push(value.trim());
    else if (typeof value === "number") parts.push(String(value));
  }
  if (parts.length > 0) return parts.join(": ");
  const reason = status?.reason ?? root?.reason;
  return typeof reason === "string" && reason.trim()
    ? reason.trim()
    : "Provider reported a delivery failure without detail.";
}

/**
 * Upsert the neutral thread a normalized event belongs to.
 *
 * `lastEventAt` only ever advances: a late-arriving older event must not
 * rewind inbox ordering.
 */
export async function projectThreadFromEvent(
  ctx: MutationCtx,
  args: {
    channel: Doc<"channels">;
    event: ProjectableEvent;
    identityId?: Id<"channelIdentities">;
    now: number;
  },
): Promise<void> {
  const threadKey = args.event.threadKey;
  if (!threadKey) return;

  const { channel, event, now } = args;
  const eventAt = event.providerTimestamp ?? now;
  const incoming = event.direction === "incoming";
  const preview = derivePreview(event.payload);

  const existing = await ctx.db
    .query("channelThreads")
    .withIndex("by_channel_thread", (q) =>
      q.eq("channelId", channel._id).eq("threadKey", threadKey),
    )
    .unique();

  if (!existing) {
    await ctx.db.insert("channelThreads", {
      tenantId: channel.tenantId,
      channelId: channel._id,
      threadKey,
      identityId: args.identityId,
      lastEventAt: eventAt,
      lastEventKind: event.eventKind,
      lastInboundAt: incoming ? eventAt : undefined,
      lastOutboundAt: incoming ? undefined : eventAt,
      lastPreview: preview,
      unreadCount: incoming ? 1 : 0,
      serviceWindowExpiresAt: incoming
        ? eventAt + SERVICE_WINDOW_MS
        : undefined,
      createdAt: now,
      updatedAt: now,
    });
    return;
  }

  const isNewest = eventAt >= existing.lastEventAt;
  const patch: Partial<Doc<"channelThreads">> = { updatedAt: now };

  if (isNewest) {
    patch.lastEventAt = eventAt;
    patch.lastEventKind = event.eventKind;
    if (preview) patch.lastPreview = preview;
  }
  if (args.identityId && !existing.identityId) {
    patch.identityId = args.identityId;
  }

  if (incoming) {
    patch.unreadCount = existing.unreadCount + 1;
    if (eventAt >= (existing.lastInboundAt ?? 0)) {
      patch.lastInboundAt = eventAt;
      patch.serviceWindowExpiresAt = eventAt + SERVICE_WINDOW_MS;
    }
  } else if (eventAt >= (existing.lastOutboundAt ?? 0)) {
    patch.lastOutboundAt = eventAt;
  }

  await ctx.db.patch(existing._id, patch);
}
