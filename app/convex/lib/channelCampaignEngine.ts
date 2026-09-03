import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { findOrCreateContactForThread } from "./channels/contactBridge";
import { extractErrorCode } from "./channels/systemEvents";
import { threadHasMessageEvent } from "./channels/threadVisibility";
import { bumpCampaignStats } from "./campaignAttribution";
import {
  readCampaignStats,
  transitionStats,
  type CampaignRecipientStatus,
  type CampaignStats,
} from "./campaignStats";
import { upsertOpsAlert } from "./opsAlerts";

/** Pilot pacing: 15 sends spaced 3 s, one batch per 65 s (Hub limit 20/min/channel). */
export const BATCH_SIZE = 15;
export const SEND_SPACING_MS = 3_000;
export const BATCH_INTERVAL_MS = 65_000;
export const MAX_ATTEMPTS = 3;
export const FAILURE_RATE_PAUSE = 0.2;
export const FAILURE_RATE_MIN_SAMPLE = 10;
export const MATERIALIZE_PAGE = 100;
export const MAX_RECIPIENTS = 5_000;
export const MAX_SCAN = 10_000;
export const MAX_PICKED_THREADS = 200;
export const UNKNOWN_SETTLE_GRACE_MS = 10 * 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const CHANNEL_LEAD_STATUSES = [
  "new",
  "interested",
  "asked_price",
  "wants_booking",
  "awaiting_human",
  "booked",
  "confirmed",
  "attended",
  "no_show",
  "lost",
] as const;

export type CampaignAudience = {
  leadStatuses?: string[];
  tags?: string[];
  inboundWithinDays?: number;
  excludeDnd?: boolean;
  excludeLost?: boolean;
  excludeRecentCampaignDays?: number;
  threadKeys?: string[];
};

export type BlockReason =
  | "RECIPIENT_NOT_ALLOWLISTED"
  | "DND"
  | "LOST"
  | "OPT_OUT"
  | "RECENT_CAMPAIGN"
  | "SERVICE_WINDOW_EXPIRED"
  | "INVALID_RECIPIENT";

export type AudienceSummary = {
  scanned: number;
  matched: number;
  eligible: number;
  missing: number;
  capped: boolean;
  blocked: Record<BlockReason, number>;
};

export function emptyAudienceSummary(): AudienceSummary {
  return {
    scanned: 0,
    matched: 0,
    eligible: 0,
    missing: 0,
    capped: false,
    blocked: {
      RECIPIENT_NOT_ALLOWLISTED: 0,
      DND: 0,
      LOST: 0,
      OPT_OUT: 0,
      RECENT_CAMPAIGN: 0,
      SERVICE_WINDOW_EXPIRED: 0,
      INVALID_RECIPIENT: 0,
    },
  };
}

export function readAudienceSummary(value: unknown): AudienceSummary {
  const base = emptyAudienceSummary();
  if (!value || typeof value !== "object") return base;
  const raw = value as Partial<AudienceSummary>;
  return {
    scanned: raw.scanned ?? 0,
    matched: raw.matched ?? 0,
    eligible: raw.eligible ?? 0,
    missing: raw.missing ?? 0,
    capped: raw.capped ?? false,
    blocked: { ...base.blocked, ...(raw.blocked ?? {}) },
  };
}

function clampDays(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  const rounded = Math.floor(value);
  if (rounded <= 0) return undefined;
  return Math.min(rounded, 365);
}

export function normalizeAudience(raw: unknown): CampaignAudience {
  const input = (raw && typeof raw === "object" ? raw : {}) as CampaignAudience;
  const statuses = Array.from(
    new Set((input.leadStatuses ?? []).filter((s) => (CHANNEL_LEAD_STATUSES as readonly string[]).includes(s))),
  );
  const tags = Array.from(
    new Set((input.tags ?? []).map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0)),
  ).slice(0, 20);
  const threadKeys = Array.from(
    new Set((input.threadKeys ?? []).map((k) => k.trim()).filter((k) => k.length > 0)),
  ).slice(0, MAX_PICKED_THREADS);
  return {
    leadStatuses: statuses.length > 0 ? statuses : undefined,
    tags: tags.length > 0 ? tags : undefined,
    inboundWithinDays: clampDays(input.inboundWithinDays),
    excludeDnd: input.excludeDnd ?? true,
    excludeLost: input.excludeLost ?? true,
    excludeRecentCampaignDays: clampDays(input.excludeRecentCampaignDays),
    threadKeys: threadKeys.length > 0 ? threadKeys : undefined,
  };
}

export function recipientDigits(
  thread: Pick<Doc<"channelThreads">, "threadKey">,
  identity: Pick<Doc<"channelIdentities">, "phone"> | null,
): string {
  return (identity?.phone ?? thread.threadKey).replace(/\D/g, "");
}

export function matchesAudience(
  thread: Doc<"channelThreads">,
  audience: CampaignAudience,
  now: number,
): boolean {
  if (audience.leadStatuses && !audience.leadStatuses.includes(thread.leadStatus ?? "new")) {
    return false;
  }
  if (audience.tags) {
    const threadTags = (thread.tags ?? []).map((t) => t.toLowerCase());
    if (!audience.tags.some((tag) => threadTags.includes(tag))) return false;
  }
  if (audience.inboundWithinDays !== undefined) {
    if (thread.lastEventAt < now - audience.inboundWithinDays * DAY_MS) return false;
  }
  return true;
}

export async function blockReasonFor(
  ctx: { db: any },
  args: {
    channel: Doc<"channels">;
    thread: Doc<"channelThreads">;
    identity: Doc<"channelIdentities"> | null;
    kind: "channel_template" | "channel_text";
    campaignId?: Id<"campaigns">;
    audience: CampaignAudience;
    now: number;
  },
): Promise<BlockReason | null> {
  const digits = recipientDigits(args.thread, args.identity);
  if (!/^\d{8,18}$/.test(digits)) return "INVALID_RECIPIENT";
  // Pilot rule (mirrors `_claimOutbox`): anything short of `live` only reaches
  // allowlisted numbers, so a non-allowlisted recipient is never attempted.
  if (args.channel.sendMode !== "live" && !args.channel.outboundAllowlist.includes(digits)) {
    return "RECIPIENT_NOT_ALLOWLISTED";
  }
  if (args.thread.intent === "opt_out") return "OPT_OUT";
  if (args.audience.excludeDnd !== false && args.thread.dnd) return "DND";
  if (args.audience.excludeLost !== false && args.thread.leadStatus === "lost") return "LOST";
  if (
    args.kind === "channel_text" &&
    (!args.thread.serviceWindowExpiresAt || args.thread.serviceWindowExpiresAt <= args.now)
  ) {
    return "SERVICE_WINDOW_EXPIRED";
  }
  if (args.audience.excludeRecentCampaignDays !== undefined) {
    const cutoff = args.now - args.audience.excludeRecentCampaignDays * DAY_MS;
    const recent = (await ctx.db
      .query("campaignRecipients")
      .withIndex("by_tenant_channel_thread", (q: any) =>
        q
          .eq("tenantId", args.thread.tenantId)
          .eq("channelId", args.channel._id)
          .eq("threadKey", args.thread.threadKey),
      )
      .order("desc")
      .take(5)) as Doc<"campaignRecipients">[];
    if (
      recent.some(
        (row) =>
          row.campaignId !== args.campaignId &&
          row.sentAt !== undefined &&
          row.sentAt >= cutoff,
      )
    ) {
      return "RECENT_CAMPAIGN";
    }
  }
  return null;
}

/** Insert (or find) the recipient row for a thread; returns the row's status. */
async function upsertRecipientForThread(
  ctx: { db: any },
  args: {
    campaign: Doc<"campaigns">;
    channel: Doc<"channels">;
    thread: Doc<"channelThreads">;
    audience: CampaignAudience;
    now: number;
  },
): Promise<{ inserted: boolean; blocked: BlockReason | null }> {
  const existing = await ctx.db
    .query("campaignRecipients")
    .withIndex("by_campaign_thread", (q: any) =>
      q.eq("campaignId", args.campaign._id).eq("threadKey", args.thread.threadKey),
    )
    .first();
  if (existing) return { inserted: false, blocked: null };
  const identity = args.thread.identityId
    ? ((await ctx.db.get(args.thread.identityId)) as Doc<"channelIdentities"> | null)
    : null;
  const contact = await findOrCreateContactForThread(
    { db: ctx.db, tenantId: args.campaign.tenantId },
    args.thread,
    identity,
  );
  const blocked = await blockReasonFor(ctx, {
    channel: args.channel,
    thread: args.thread,
    identity,
    kind: args.campaign.kind === "channel_text" ? "channel_text" : "channel_template",
    campaignId: args.campaign._id,
    audience: args.audience,
    now: args.now,
  });
  const digits = recipientDigits(args.thread, identity);
  await ctx.db.insert("campaignRecipients", {
    tenantId: args.campaign.tenantId,
    campaignId: args.campaign._id,
    contactId: contact._id,
    channelId: args.channel._id,
    threadId: args.thread._id,
    threadKey: args.thread.threadKey,
    identityKind: /^\d{8,18}$/.test(digits) ? "phone" : "bsuid",
    identityValue: /^\d{8,18}$/.test(digits) ? digits : args.thread.threadKey,
    status: blocked ? "skipped" : "pending",
    failureCode: blocked ?? undefined,
    dispatchAttempts: 0,
    createdAt: args.now,
    updatedAt: args.now,
  });
  return { inserted: true, blocked };
}

/**
 * One page of audience materialization. Idempotent per (campaign, thread);
 * self-contained so the caller can reschedule until `done`.
 */
export async function materializePage(
  ctx: { db: any },
  campaign: Doc<"campaigns">,
  now: number,
): Promise<{ done: boolean; inserted: number }> {
  if (!campaign.channelId) throw new ConvexError({ code: "HUB_CHANNEL_NOT_FOUND" });
  const channel = (await ctx.db.get(campaign.channelId)) as Doc<"channels"> | null;
  if (!channel || channel.tenantId !== campaign.tenantId) {
    throw new ConvexError({ code: "HUB_CHANNEL_NOT_FOUND" });
  }
  const audience = normalizeAudience(campaign.audience);
  const summary = readAudienceSummary(campaign.audienceSummary);
  let stats = readCampaignStats(campaign.stats);
  let inserted = 0;
  let done = false;
  let cursor: string | undefined = campaign.audienceCursor;

  const consider = async (thread: Doc<"channelThreads">) => {
    if (!(await threadHasMessageEvent(ctx, thread))) return;
    const result = await upsertRecipientForThread(ctx, { campaign, channel, thread, audience, now });
    // A re-run (retry after a partial page) must not double count.
    if (!result.inserted) return;
    summary.matched += 1;
    inserted += 1;
    if (result.blocked) {
      summary.blocked[result.blocked] += 1;
      stats = transitionStats(stats, null, "skipped");
    } else {
      summary.eligible += 1;
      stats = transitionStats(stats, null, "pending");
    }
  };

  if (audience.threadKeys) {
    for (const threadKey of audience.threadKeys) {
      summary.scanned += 1;
      const thread = (await ctx.db
        .query("channelThreads")
        .withIndex("by_channel_thread", (q: any) =>
          q.eq("channelId", channel._id).eq("threadKey", threadKey),
        )
        .unique()) as Doc<"channelThreads"> | null;
      if (!thread || thread.tenantId !== campaign.tenantId) {
        summary.missing += 1;
        continue;
      }
      await consider(thread);
    }
    done = true;
  } else {
    const page = await ctx.db
      .query("channelThreads")
      .withIndex("by_channel_last_event", (q: any) => q.eq("channelId", channel._id))
      .order("desc")
      .paginate({ cursor: cursor ?? null, numItems: MATERIALIZE_PAGE });
    let stop = false;
    for (const thread of page.page as Doc<"channelThreads">[]) {
      summary.scanned += 1;
      if (
        audience.inboundWithinDays !== undefined &&
        thread.lastEventAt < now - audience.inboundWithinDays * DAY_MS
      ) {
        stop = true;
        break;
      }
      if (!matchesAudience(thread, audience, now)) continue;
      if (summary.matched >= MAX_RECIPIENTS) {
        summary.capped = true;
        stop = true;
        break;
      }
      await consider(thread);
    }
    cursor = page.continueCursor;
    done = page.isDone || stop || summary.scanned >= MAX_SCAN;
    if (summary.scanned >= MAX_SCAN && !page.isDone) summary.capped = true;
  }

  await ctx.db.patch(campaign._id, {
    audienceCursor: cursor,
    audienceSummary: summary,
    audienceStatus: done ? (summary.eligible > 0 ? "ready" : "empty") : "materializing",
    stats,
    updatedAt: now,
  });
  return { done, inserted };
}

function randomToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function trackedLinkTarget(campaign: Doc<"campaigns">): string | undefined {
  return campaign.variableBindings?.find((b) => b.source === "tracked_link")?.value;
}

/**
 * Claim the next batch: pending recipients whose retry time has passed
 * become `queued` and get a dispatch job each, spaced 3 s apart.
 */
export async function queueNextBatch(
  ctx: { db: any; scheduler: any },
  campaign: Doc<"campaigns">,
  now: number,
): Promise<{ queued: number; pendingRemaining: boolean }> {
  const candidates = (await ctx.db
    .query("campaignRecipients")
    .withIndex("by_campaign_status", (q: any) =>
      q.eq("campaignId", campaign._id).eq("status", "pending"),
    )
    .take(BATCH_SIZE * 4)) as Doc<"campaignRecipients">[];
  const due = candidates
    .filter((row) => row.nextAttemptAt === undefined || row.nextAttemptAt <= now)
    .slice(0, BATCH_SIZE);
  let stats = readCampaignStats(campaign.stats);
  const linkTarget = trackedLinkTarget(campaign);
  let index = 0;
  for (const recipient of due) {
    const attempts = (recipient.dispatchAttempts ?? 0) + 1;
    let trackedLinkToken = recipient.trackedLinkToken;
    if (linkTarget && !trackedLinkToken) {
      trackedLinkToken = randomToken();
      await ctx.db.insert("trackedLinks", {
        tenantId: campaign.tenantId,
        campaignId: campaign._id,
        campaignRecipientId: recipient._id,
        token: trackedLinkToken,
        targetUrl: linkTarget,
        clickCount: 0,
        createdAt: now,
      });
    }
    await ctx.db.patch(recipient._id, {
      status: "queued",
      dispatchAttempts: attempts,
      nextAttemptAt: undefined,
      trackedLinkToken,
      updatedAt: now,
    });
    stats = transitionStats(stats, "pending", "queued");
    stats.attempts += 1;
    await ctx.scheduler.runAfter(index * SEND_SPACING_MS, internal.iaSolutionHub.dispatchOutboundJob, {
      job: { kind: "campaign_recipient", recipientId: recipient._id },
    });
    index += 1;
  }
  const remaining = await ctx.db
    .query("campaignRecipients")
    .withIndex("by_campaign_status", (q: any) =>
      q.eq("campaignId", campaign._id).eq("status", "pending"),
    )
    .first();
  await ctx.db.patch(campaign._id, { stats, lastBatchAt: now, updatedAt: now });
  return { queued: due.length, pendingRemaining: remaining !== null };
}

function firstNameOf(identity: Doc<"channelIdentities"> | null): string {
  const name = identity?.displayName?.trim() ?? "";
  return name.split(/\s+/)[0] ?? "";
}

export function renderCampaignText(text: string, firstName: string): string {
  return text.replace(/\{\{\s*(nome|name|first_name|primeiro_nome)\s*\}\}/gi, firstName).replace(/\s{2,}/g, " ").trim();
}

export function buildRecipientPayload(args: {
  campaign: Doc<"campaigns">;
  recipient: Doc<"campaignRecipients">;
  identity: Doc<"channelIdentities"> | null;
  siteUrl: string | undefined;
}): { messageKind: "text"; payload: { text: string } } | { messageKind: "template"; payload: { templateName: string; languageCode: string; bodyVariables: string[] } } | null {
  const firstName = firstNameOf(args.identity);
  if (args.campaign.kind === "channel_text") {
    const text = renderCampaignText(args.campaign.messageText ?? "", firstName);
    if (!text || text.length > 4_096) return null;
    return { messageKind: "text", payload: { text } };
  }
  if (args.campaign.kind !== "channel_template") return null;
  if (!args.campaign.templateName || !args.campaign.templateLanguage) return null;
  const bindings = [...(args.campaign.variableBindings ?? [])].sort((a, b) => a.index - b.index);
  const bodyVariables: string[] = [];
  for (const binding of bindings) {
    if (binding.source === "static") {
      bodyVariables.push(binding.value ?? "");
    } else if (binding.source === "first_name") {
      bodyVariables.push(firstName || binding.value || "");
    } else {
      if (!args.recipient.trackedLinkToken || !args.siteUrl) return null;
      bodyVariables.push(`${args.siteUrl.replace(/\/$/, "")}/r/${args.recipient.trackedLinkToken}`);
    }
  }
  return {
    messageKind: "template",
    payload: {
      templateName: args.campaign.templateName,
      languageCode: args.campaign.templateLanguage,
      bodyVariables,
    },
  };
}

export async function loadRecipientDispatchTarget(
  ctx: { db: any },
  recipientId: Id<"campaignRecipients">,
): Promise<{
  tenantId: Id<"tenants">;
  memberId: Id<"members">;
  channelId: Id<"channels">;
  threadKey: string;
  clientNonce: string;
  messageKind: "text" | "template";
  payload: unknown;
} | null> {
  const recipient = (await ctx.db.get(recipientId)) as Doc<"campaignRecipients"> | null;
  if (!recipient || recipient.status !== "queued" || !recipient.channelId || !recipient.threadKey) {
    return null;
  }
  const campaign = (await ctx.db.get(recipient.campaignId)) as Doc<"campaigns"> | null;
  if (!campaign || campaign.status !== "running" || !campaign.createdBy) return null;
  if (campaign.channelId !== recipient.channelId) return null;
  const thread = recipient.threadId
    ? ((await ctx.db.get(recipient.threadId)) as Doc<"channelThreads"> | null)
    : null;
  const identity = thread?.identityId
    ? ((await ctx.db.get(thread.identityId)) as Doc<"channelIdentities"> | null)
    : null;
  const built = buildRecipientPayload({
    campaign,
    recipient,
    identity,
    siteUrl: process.env.SITE_URL,
  });
  if (!built) return null;
  const attempt = recipient.dispatchAttempts ?? 1;
  const clientNonce =
    attempt <= 1
      ? `campaign:${campaign._id}:${recipient._id}`
      : `campaign:${campaign._id}:${recipient._id}:a${attempt}`;
  return {
    tenantId: campaign.tenantId,
    memberId: campaign.createdBy,
    channelId: recipient.channelId,
    threadKey: recipient.threadKey,
    clientNonce,
    messageKind: built.messageKind,
    payload: built.payload,
  };
}

function retryAfterMsFrom(reason: string | undefined): number | undefined {
  if (!reason) return undefined;
  const match = reason.match(/"retryAfterMs"\s*:\s*(\d+)/);
  return match ? Number(match[1]) : undefined;
}

function isTransientFailure(code: string | undefined, reason: string | undefined): boolean {
  if (code) return false;
  return /fetch|network|timeout|timed out|unavailable|5\d\d|ECONN|socket/i.test(reason ?? "");
}

async function recordRecipientEvent(
  ctx: { db: any },
  recipient: Doc<"campaignRecipients">,
  type: string,
  payload: unknown,
  now: number,
) {
  await ctx.db.insert("campaignEvents", {
    tenantId: recipient.tenantId,
    campaignId: recipient.campaignId,
    campaignRecipientId: recipient._id,
    type,
    payload,
    createdAt: now,
  });
}

async function pauseCampaign(
  ctx: { db: any },
  campaign: Doc<"campaigns">,
  reason: string,
  now: number,
) {
  if (campaign.status !== "running") return;
  await ctx.db.patch(campaign._id, {
    status: "paused",
    pausedAt: now,
    pauseReason: reason,
    updatedAt: now,
  });
  await ctx.db.insert("campaignEvents", {
    tenantId: campaign.tenantId,
    campaignId: campaign._id,
    type: "campaign.auto_paused",
    payload: { reason },
    createdAt: now,
  });
  await upsertOpsAlert(ctx, {
    tenantId: campaign.tenantId,
    kind: "campaign.auto_paused",
    businessKey: `campaign:${campaign._id}:paused:${reason}`,
    severity: "warn",
    title: `Campanha "${campaign.name}" pausada automaticamente (${reason}).`,
    payload: { campaignId: campaign._id, reason },
    href: `/app/campaigns/${campaign._id}`,
    now,
  });
}

/**
 * Settle the outcome of one dispatch job. Idempotent: only a `queued`
 * recipient can be settled, and every branch moves it out of `queued`.
 */
export async function settleRecipientDispatch(
  ctx: { db: any },
  args: {
    recipientId: Id<"campaignRecipients">;
    status: "accepted" | "failed" | "unknown";
    outboxId?: Id<"channelOutbox">;
    providerMessageId?: string;
    failureReason?: string;
  },
): Promise<void> {
  const recipient = (await ctx.db.get(args.recipientId)) as Doc<"campaignRecipients"> | null;
  if (!recipient || recipient.status !== "queued") return;
  const campaign = (await ctx.db.get(recipient.campaignId)) as Doc<"campaigns"> | null;
  if (!campaign) return;
  const now = Date.now();
  const reason = args.failureReason?.slice(0, 500);

  if (args.status === "accepted") {
    await ctx.db.patch(recipient._id, {
      status: "sent",
      sentAt: now,
      channelOutboxId: args.outboxId,
      providerMessageId: args.providerMessageId,
      failureCode: undefined,
      failureReason: undefined,
      updatedAt: now,
    });
    await recordRecipientEvent(ctx, recipient, "campaign.recipient.sent", {
      channelOutboxId: args.outboxId,
      providerMessageId: args.providerMessageId,
      threadKey: recipient.threadKey,
      attempt: recipient.dispatchAttempts,
    }, now);
    await bumpCampaignStats(ctx, campaign, { from: "queued", to: "sent" }, now);
    return;
  }

  if (args.status === "unknown") {
    await ctx.db.patch(recipient._id, {
      status: "dispatching",
      channelOutboxId: args.outboxId,
      failureCode: "OUTBOX_UNKNOWN",
      failureReason: reason,
      updatedAt: now,
    });
    await recordRecipientEvent(ctx, recipient, "campaign.recipient.unknown", {
      channelOutboxId: args.outboxId,
      threadKey: recipient.threadKey,
      reason,
    }, now);
    await bumpCampaignStats(ctx, campaign, { from: "queued", to: "dispatching", unknown: 1 }, now);
    await upsertOpsAlert(ctx, {
      tenantId: campaign.tenantId,
      kind: "campaign.unknown_delivery",
      businessKey: `campaign:${campaign._id}:unknown`,
      severity: "warn",
      title: `Campanha "${campaign.name}": envios sem confirmação do provedor.`,
      payload: { campaignId: campaign._id },
      href: `/app/campaigns/${campaign._id}`,
      reopen: true,
      now,
    });
    return;
  }

  const code = extractErrorCode(reason);
  const attempts = recipient.dispatchAttempts ?? 1;

  // Paused/cancelled while the job was in flight: put the row back, no failure.
  if (campaign.status !== "running") {
    await ctx.db.patch(recipient._id, {
      status: campaign.status === "cancelled" ? "skipped" : "pending",
      failureCode: campaign.status === "cancelled" ? "CANCELLED" : undefined,
      dispatchAttempts: Math.max(0, attempts - 1),
      updatedAt: now,
    });
    await bumpCampaignStats(
      ctx,
      campaign,
      { from: "queued", to: campaign.status === "cancelled" ? "skipped" : "pending" },
      now,
    );
    return;
  }

  if (code === "CHANNEL_RATE_LIMITED") {
    const retryAfter = retryAfterMsFrom(reason) ?? 60_000;
    await ctx.db.patch(recipient._id, {
      status: "pending",
      nextAttemptAt: now + retryAfter + 1_000,
      dispatchAttempts: Math.max(0, attempts - 1),
      updatedAt: now,
    });
    await recordRecipientEvent(ctx, recipient, "campaign.recipient.rate_limited", {
      retryAfterMs: retryAfter,
      threadKey: recipient.threadKey,
    }, now);
    await bumpCampaignStats(ctx, campaign, { from: "queued", to: "pending", rateLimited: 1 }, now);
    return;
  }

  if (code === "HUB_PILOT_KILL_SWITCH_ACTIVE" || code === "HUB_CHANNEL_NOT_FOUND") {
    await ctx.db.patch(recipient._id, {
      status: "pending",
      dispatchAttempts: Math.max(0, attempts - 1),
      updatedAt: now,
    });
    await bumpCampaignStats(ctx, campaign, { from: "queued", to: "pending" }, now);
    const fresh = (await ctx.db.get(campaign._id)) as Doc<"campaigns">;
    await pauseCampaign(ctx, fresh, code, now);
    return;
  }

  if (isTransientFailure(code, reason) && attempts < MAX_ATTEMPTS) {
    const backoff = 60_000 * 2 ** (attempts - 1);
    await ctx.db.patch(recipient._id, {
      status: "pending",
      nextAttemptAt: now + backoff,
      failureReason: reason,
      updatedAt: now,
    });
    await recordRecipientEvent(ctx, recipient, "campaign.recipient.retry_scheduled", {
      attempt: attempts,
      backoffMs: backoff,
      reason,
      threadKey: recipient.threadKey,
    }, now);
    await bumpCampaignStats(ctx, campaign, { from: "queued", to: "pending" }, now);
    return;
  }

  await ctx.db.patch(recipient._id, {
    status: "failed",
    channelOutboxId: args.outboxId,
    failureCode: code ?? "SEND_FAILED",
    failureReason: reason,
    updatedAt: now,
  });
  await recordRecipientEvent(ctx, recipient, "campaign.recipient.failed", {
    code: code ?? "SEND_FAILED",
    reason,
    attempt: attempts,
    threadKey: recipient.threadKey,
    channelOutboxId: args.outboxId,
  }, now);
  await bumpCampaignStats(ctx, campaign, { from: "queued", to: "failed" }, now);

  const fresh = (await ctx.db.get(campaign._id)) as Doc<"campaigns">;
  const stats: CampaignStats = readCampaignStats(fresh.stats);
  const b = stats.byStatus;
  const attempted = b.sent + b.delivered + b.read + b.replied + b.clicked + b.failed + stats.unknown;
  if (attempted >= FAILURE_RATE_MIN_SAMPLE && b.failed / attempted >= FAILURE_RATE_PAUSE) {
    await pauseCampaign(ctx, fresh, "failure_rate", now);
  }
}

/** Recompute stats from rows (repair/backfill). Paginated by the caller. */
export function accumulateRecipient(stats: CampaignStats, row: Doc<"campaignRecipients">): CampaignStats {
  const next = transitionStats(stats, null, row.status as CampaignRecipientStatus);
  if (row.repliedAt) next.replied += 1;
  if (row.clickedAt) next.clicked += 1;
  if (row.convertedAt) next.converted += 1;
  if (row.status === "dispatching" && row.failureCode === "OUTBOX_UNKNOWN") next.unknown += 1;
  next.attempts += row.dispatchAttempts ?? 0;
  return next;
}
