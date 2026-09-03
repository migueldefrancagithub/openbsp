import { autoAssignThread } from "../assignment";
import { stopThreadFollowUps } from "../followUpControl";
import { autoConfirmFromReply } from "../clinicAgenda";
import { bumpCampaignStats, markCampaignReply } from "../campaignAttribution";
import type { CampaignRecipientStatus as CampaignRowStatus } from "../campaignStats";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import {
  decideOutboxTransition,
  mapProviderStatusToOutboxStatus,
} from "./outboxStatus";
import {
  classifyInbound,
  normalizeIntentText,
  type ChannelLeadStatus,
  type InboundClassification,
} from "./intents";

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
const DEFAULT_NEXT_STEP_MS = 2 * 60 * 60 * 1000;
/** A reply within this window after a campaign send is attributed to it. */
const CAMPAIGN_ORIGIN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** A manual intent set by the team is not overwritten by inference for a day. */
const MANUAL_INTENT_HOLD_MS = 24 * 60 * 60 * 1000;
const ATTRIBUTABLE_RECIPIENT_STATUSES = new Set([
  "sent",
  "delivered",
  "read",
  "replied",
  "clicked",
]);

type CampaignRecipientStatus = "sent" | "delivered" | "read" | "failed";

const CAMPAIGN_STATUS_RANK: Record<string, number> = {
  pending: 0,
  queued: 1,
  dispatching: 2,
  sent: 3,
  delivered: 4,
  read: 5,
  replied: 6,
  clicked: 7,
  failed: 8,
  skipped: 8,
};

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

function deriveInboundText(payload: unknown): string {
  return normalizeIntentText(derivePreview(payload) ?? "");
}

/** Lead stage + intent for an inbound payload (zero-cost, deterministic). */
export function classifyInboundPayload(payload: unknown): InboundClassification {
  return classifyInbound(deriveInboundText(payload));
}

export function nextStepFor(status: ChannelLeadStatus): string {
  if (status === "asked_price") return "Responder com servico, condicoes e proximo horario possivel.";
  if (status === "wants_booking") return "Consultar agenda real antes de propor ou confirmar horario.";
  if (status === "awaiting_human") return "Atribuir a equipa e responder com contexto da conversa.";
  if (status === "confirmed") return "Confirmacao recebida. Rever se existe agendamento associado.";
  if (status === "booked") return "Acompanhar confirmacao e comparecimento.";
  if (status === "attended") return "Atendimento concluido. Registar resultado e proximo cuidado.";
  if (status === "no_show") return "Contactar para remarcar e registar o motivo da ausencia.";
  if (status === "lost") return "Encerrar sem novo disparo, exceto se o cliente voltar.";
  return "Qualificar pedido e definir proxima acao.";
}

export function shouldAdvanceLeadStatus(
  current: ChannelLeadStatus | undefined,
  next: ChannelLeadStatus,
): boolean {
  if (!current) return true;
  const rank: Record<ChannelLeadStatus, number> = {
    new: 0,
    interested: 1,
    asked_price: 2,
    wants_booking: 3,
    awaiting_human: 4,
    booked: 5,
    confirmed: 6,
    attended: 7,
    no_show: 7,
    lost: 8,
  };
  return rank[next] >= rank[current] || next === "awaiting_human";
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

  const settledAt = Date.now();
  patch.updatedAt = settledAt;
  await ctx.db.patch(row._id, patch);
  if (nextStatus) {
    await syncCampaignRecipientFromChannelOutbox(ctx, {
      outbox: row,
      nextOutboxStatus: nextStatus,
      event: args.event,
      at: settledAt,
    });
  }
}

async function syncCampaignRecipientFromChannelOutbox(
  ctx: MutationCtx,
  args: {
    outbox: Doc<"channelOutbox">;
    nextOutboxStatus: string;
    event: ProjectableEvent;
    at: number;
  },
): Promise<void> {
  const nextStatus = mapOutboxStatusToCampaignRecipientStatus(
    args.nextOutboxStatus,
  );
  if (!nextStatus) return;
  const recipient = await ctx.db
    .query("campaignRecipients")
    .withIndex("by_channel_outbox", (q) =>
      q.eq("channelOutboxId", args.outbox._id),
    )
    .first();
  if (!recipient) return;

  const patch: Partial<Doc<"campaignRecipients">> = { updatedAt: args.at };
  const advances =
    (CAMPAIGN_STATUS_RANK[nextStatus] ?? 0) >
      (CAMPAIGN_STATUS_RANK[recipient.status] ?? 0) ||
    nextStatus === "failed";
  if (advances) patch.status = nextStatus;
  if (nextStatus === "sent") {
    if (!recipient.sentAt) patch.sentAt = args.at;
  } else if (nextStatus === "delivered") {
    if (!recipient.sentAt) patch.sentAt = args.at;
    if (!recipient.deliveredAt) patch.deliveredAt = args.at;
  } else if (nextStatus === "read") {
    if (!recipient.sentAt) patch.sentAt = args.at;
    if (!recipient.deliveredAt) patch.deliveredAt = args.at;
    if (!recipient.readAt) patch.readAt = args.at;
  } else if (nextStatus === "failed") {
    patch.failureReason = deriveFailureReason(args.event.payload)?.slice(
      0,
      FAILURE_REASON_MAX_CHARS,
    );
  }

  const hadTimestamp =
    nextStatus === "sent"
      ? !!recipient.sentAt
      : nextStatus === "delivered"
        ? !!recipient.deliveredAt
        : nextStatus === "read"
          ? !!recipient.readAt
          : recipient.status === "failed";
  if (!advances && hadTimestamp) return;

  await ctx.db.patch(recipient._id, patch);
  if (advances) {
    const campaign = await ctx.db.get(recipient.campaignId);
    if (campaign) {
      await bumpCampaignStats(
        ctx,
        campaign,
        {
          from: recipient.status as CampaignRowStatus,
          to: nextStatus as CampaignRowStatus,
          unknown: recipient.failureCode === "OUTBOX_UNKNOWN" ? -1 : 0,
        },
        args.at,
      );
    }
  }
  await ctx.db.insert("campaignEvents", {
    tenantId: recipient.tenantId,
    campaignId: recipient.campaignId,
    campaignRecipientId: recipient._id,
    type: `campaign.recipient.${nextStatus}`,
    payload: {
      channelOutboxId: args.outbox._id,
      providerMessageId: args.outbox.providerMessageId,
      providerStatus: args.event.eventKind,
      previousStatus: recipient.status,
      threadKey: args.outbox.threadKey,
    },
    createdAt: args.at,
  });
  await ctx.db.patch(recipient.campaignId, { updatedAt: args.at });
}

async function stopScheduledFollowUpsForReply(
  ctx: MutationCtx,
  args: { thread: Doc<"channelThreads">; now: number; optOut?: boolean },
): Promise<void> {
  await stopThreadFollowUps(ctx, {
    thread: args.thread,
    reason: args.optOut ? "opt_out" : "patient_replied",
    now: args.now,
  });
}

function mapOutboxStatusToCampaignRecipientStatus(
  status: string,
): CampaignRecipientStatus | null {
  if (status === "accepted") return "sent";
  if (status === "delivered") return "delivered";
  if (status === "read") return "read";
  if (status === "failed") return "failed";
  return null;
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
 * Newest campaign send to this thread inside the attribution window. One
 * indexed read per inbound message; only consulted while the thread has no
 * origin yet.
 */
export async function findOriginCampaign(
  ctx: MutationCtx,
  args: { channel: Doc<"channels">; threadKey: string; now: number },
): Promise<
  { campaignId: Id<"campaigns">; recipientId: Id<"campaignRecipients">; sentAt: number } | undefined
> {
  const recipient = await ctx.db
    .query("campaignRecipients")
    .withIndex("by_tenant_channel_thread", (q) =>
      q
        .eq("tenantId", args.channel.tenantId)
        .eq("channelId", args.channel._id)
        .eq("threadKey", args.threadKey),
    )
    .order("desc")
    .first();
  if (!recipient?.sentAt) return undefined;
  if (!ATTRIBUTABLE_RECIPIENT_STATUSES.has(recipient.status)) return undefined;
  if (args.now - recipient.sentAt > CAMPAIGN_ORIGIN_WINDOW_MS) return undefined;
  return { campaignId: recipient.campaignId, recipientId: recipient._id, sentAt: recipient.sentAt };
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
  const isInboundMessage = incoming && event.eventKind.startsWith("message.");
  const classified: InboundClassification = isInboundMessage
    ? classifyInboundPayload(event.payload)
    : {};
  const inferredLeadStatus = classified.leadStatus;
  const origin = isInboundMessage
    ? await findOriginCampaign(ctx, { channel, threadKey, now })
    : undefined;
  if (origin) {
    await markCampaignReply(ctx, { recipientId: origin.recipientId, at: eventAt });
  }

  const existing = await ctx.db
    .query("channelThreads")
    .withIndex("by_channel_thread", (q) =>
      q.eq("channelId", channel._id).eq("threadKey", threadKey),
    )
    .unique();

  if (!existing) {
    const slaMs = isInboundMessage ? await firstResponseSlaMs(ctx, channel.tenantId) : 0;
    const threadId = await ctx.db.insert("channelThreads", {
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
      leadSource: origin ? "campaign_reply" : incoming ? "organic" : undefined,
      leadStatus: inferredLeadStatus ?? "new",
      intent: classified.intent,
      intentSource: classified.intent ? "inferred" : undefined,
      intentUpdatedAt: classified.intent ? eventAt : undefined,
      originCampaignId: origin?.campaignId,
      originCampaignAt: origin?.sentAt,
      nextStep: inferredLeadStatus
        ? nextStepFor(inferredLeadStatus)
        : "Aguardar primeira resposta do paciente.",
      nextStepDueAt: incoming ? eventAt + DEFAULT_NEXT_STEP_MS : undefined,
      firstResponseDueAt: isInboundMessage ? eventAt + slaMs : undefined,
      createdAt: now,
      updatedAt: now,
    });
    if (isInboundMessage) {
      const created = (await ctx.db.get(threadId)) as Doc<"channelThreads"> | null;
      if (created) await autoAssignThread(ctx, { thread: created, now });
    }
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
    if (
      inferredLeadStatus &&
      shouldAdvanceLeadStatus(existing.leadStatus, inferredLeadStatus)
    ) {
      patch.leadStatus = inferredLeadStatus;
      patch.nextStep = nextStepFor(inferredLeadStatus);
      patch.nextStepDueAt =
        inferredLeadStatus === "confirmed" || inferredLeadStatus === "lost"
          ? undefined
          : eventAt + DEFAULT_NEXT_STEP_MS;
    } else if (!existing.nextStep) {
      patch.nextStep = nextStepFor(existing.leadStatus ?? "interested");
      patch.nextStepDueAt = existing.nextStepDueAt ?? eventAt + DEFAULT_NEXT_STEP_MS;
    }
    const manualHold =
      existing.intentSource === "manual" &&
      eventAt - (existing.intentUpdatedAt ?? 0) < MANUAL_INTENT_HOLD_MS;
    if (classified.intent && !manualHold) {
      patch.intent = classified.intent;
      patch.intentSource = "inferred";
      patch.intentUpdatedAt = eventAt;
    }
    if (origin && !existing.originCampaignId) {
      patch.originCampaignId = origin.campaignId;
      patch.originCampaignAt = origin.sentAt;
      if (!existing.leadSource || existing.leadSource === "organic") {
        patch.leadSource = "campaign_reply";
      }
    }
    if (isInboundMessage && !existing.firstResponseDueAt) {
      patch.firstResponseDueAt = eventAt + (await firstResponseSlaMs(ctx, channel.tenantId));
    }
  } else if (eventAt >= (existing.lastOutboundAt ?? 0)) {
    patch.lastOutboundAt = eventAt;
    if (event.eventKind.startsWith("message.") && existing.firstResponseDueAt) {
      patch.firstResponseDueAt = undefined;
      patch.firstRespondedAt = eventAt;
    }
  }

  await ctx.db.patch(existing._id, patch);
  if (incoming) {
    await stopScheduledFollowUpsForReply(ctx, { thread: existing, now });
  }

  if (isInboundMessage && classified.intent === "confirm_attendance") {
    const current = await ctx.db
      .query("channelThreads")
      .withIndex("by_channel_thread", (q) => q.eq("channelId", channel._id).eq("threadKey", threadKey))
      .unique();
    if (current) await autoConfirmFromReply(ctx, { thread: current, now });
  }
}

const DEFAULT_FIRST_RESPONSE_SLA_MS = 15 * 60_000;

async function firstResponseSlaMs(ctx: MutationCtx, tenantId: Id<"tenants">): Promise<number> {
  const settings = await ctx.db
    .query("clinicSettings")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .unique();
  const minutes = settings?.firstResponseSlaMinutes;
  return minutes && minutes > 0 ? minutes * 60_000 : DEFAULT_FIRST_RESPONSE_SLA_MS;
}
