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
const DEFAULT_NEXT_STEP_MS = 2 * 60 * 60 * 1000;

type CampaignRecipientStatus = "sent" | "delivered" | "read" | "failed";
type ChannelLeadStatus =
  | "new"
  | "interested"
  | "asked_price"
  | "wants_booking"
  | "awaiting_human"
  | "booked"
  | "confirmed"
  | "lost";

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

function normalizeIntentText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function deriveInboundText(payload: unknown): string {
  return normalizeIntentText(derivePreview(payload) ?? "");
}

function inferLeadStatusFromInbound(
  payload: unknown,
): ChannelLeadStatus | undefined {
  const text = deriveInboundText(payload);
  if (!text) return "interested";
  if (
    /\b(confirmo|confirmado|confirmada|esta confirmado|vou comparecer|estarei la|ok confirmado)\b/.test(
      text,
    )
  ) {
    return "confirmed";
  }
  if (
    /\b(marcar|agendar|consulta|slot|horario|horario disponivel|disponibilidade|remarcar)\b/.test(
      text,
    )
  ) {
    return "wants_booking";
  }
  if (/\b(preco|precos|valor|quanto custa|custa quanto|plano)\b/.test(text)) {
    return "asked_price";
  }
  if (/\b(humano|atendente|pessoa|equipa|equipe|falar com alguem|assistente)\b/.test(text)) {
    return "awaiting_human";
  }
  if (/\b(cancelar|nao quero|sem interesse|parar|sair|stop)\b/.test(text)) {
    return "lost";
  }
  return "interested";
}

function nextStepFor(status: ChannelLeadStatus): string {
  if (status === "asked_price") return "Responder com servico, condicoes e proximo horario possivel.";
  if (status === "wants_booking") return "Consultar agenda real antes de propor ou confirmar horario.";
  if (status === "awaiting_human") return "Atribuir a equipa e responder com contexto da conversa.";
  if (status === "confirmed") return "Confirmacao recebida. Rever se existe agendamento associado.";
  if (status === "booked") return "Acompanhar confirmacao e comparecimento.";
  if (status === "lost") return "Encerrar sem novo disparo, exceto se o cliente voltar.";
  return "Qualificar pedido e definir proxima acao.";
}

function shouldAdvanceLeadStatus(
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
    lost: 7,
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
  const inferredLeadStatus =
    incoming && event.eventKind.startsWith("message.")
      ? inferLeadStatusFromInbound(event.payload)
      : undefined;

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
      leadSource: incoming ? "organic" : undefined,
      leadStatus: inferredLeadStatus ?? "new",
      nextStep: inferredLeadStatus
        ? nextStepFor(inferredLeadStatus)
        : "Aguardar primeira resposta do paciente.",
      nextStepDueAt: incoming ? eventAt + DEFAULT_NEXT_STEP_MS : undefined,
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
  } else if (eventAt >= (existing.lastOutboundAt ?? 0)) {
    patch.lastOutboundAt = eventAt;
  }

  await ctx.db.patch(existing._id, patch);
}
