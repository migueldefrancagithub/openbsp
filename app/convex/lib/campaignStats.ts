import { v } from "convex/values";

export const CAMPAIGN_RECIPIENT_STATUSES = [
  "pending",
  "queued",
  "dispatching",
  "sent",
  "delivered",
  "read",
  "replied",
  "clicked",
  "failed",
  "skipped",
] as const;
export type CampaignRecipientStatus = (typeof CAMPAIGN_RECIPIENT_STATUSES)[number];

export const CAMPAIGN_RECIPIENT_STATUS_RANK: Record<CampaignRecipientStatus, number> = {
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

export const campaignStatsValidator = v.object({
  total: v.number(),
  byStatus: v.object({
    pending: v.number(),
    queued: v.number(),
    dispatching: v.number(),
    sent: v.number(),
    delivered: v.number(),
    read: v.number(),
    replied: v.number(),
    clicked: v.number(),
    failed: v.number(),
    skipped: v.number(),
  }),
  /** dispatching rows whose outbox never settled (never retried). */
  unknown: v.number(),
  replied: v.number(),
  clicked: v.number(),
  converted: v.number(),
  attempts: v.number(),
  rateLimited: v.number(),
});

export type CampaignStats = {
  total: number;
  byStatus: Record<CampaignRecipientStatus, number>;
  unknown: number;
  replied: number;
  clicked: number;
  converted: number;
  attempts: number;
  rateLimited: number;
};

export function emptyCampaignStats(): CampaignStats {
  return {
    total: 0,
    byStatus: {
      pending: 0,
      queued: 0,
      dispatching: 0,
      sent: 0,
      delivered: 0,
      read: 0,
      replied: 0,
      clicked: 0,
      failed: 0,
      skipped: 0,
    },
    unknown: 0,
    replied: 0,
    clicked: 0,
    converted: 0,
    attempts: 0,
    rateLimited: 0,
  };
}

/** Defensive parse: campaigns created before B2 have no stats. */
export function readCampaignStats(value: unknown): CampaignStats {
  const base = emptyCampaignStats();
  if (!value || typeof value !== "object") return base;
  const raw = value as Partial<CampaignStats>;
  const byStatus = { ...base.byStatus, ...(raw.byStatus ?? {}) };
  return {
    total: raw.total ?? 0,
    byStatus,
    unknown: raw.unknown ?? 0,
    replied: raw.replied ?? 0,
    clicked: raw.clicked ?? 0,
    converted: raw.converted ?? 0,
    attempts: raw.attempts ?? 0,
    rateLimited: raw.rateLimited ?? 0,
  };
}

/** Move one recipient between status buckets; never goes negative. */
export function transitionStats(
  stats: CampaignStats,
  from: CampaignRecipientStatus | null,
  to: CampaignRecipientStatus,
): CampaignStats {
  const next = { ...stats, byStatus: { ...stats.byStatus } };
  if (from === null) {
    next.total += 1;
  } else {
    next.byStatus[from] = Math.max(0, next.byStatus[from] - 1);
  }
  next.byStatus[to] += 1;
  return next;
}

export type CampaignRates = {
  attempted: number;
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  clicked: number;
  converted: number;
  failed: number;
  skipped: number;
  unknown: number;
  pending: number;
  deliveryRate: number;
  readRate: number;
  replyRate: number;
  clickRate: number;
  conversionRate: number;
  failureRate: number;
};

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.min(1, Math.max(0, numerator / denominator));
}

/** Funnel counts are cumulative (a read message was also delivered and sent). */
export function deriveCampaignRates(stats: CampaignStats): CampaignRates {
  const b = stats.byStatus;
  const sent = b.sent + b.delivered + b.read + b.replied + b.clicked;
  const delivered = b.delivered + b.read + b.replied + b.clicked;
  const read = b.read + b.replied + b.clicked;
  const attempted = sent + b.failed + stats.unknown;
  return {
    attempted,
    sent,
    delivered,
    read,
    replied: stats.replied,
    clicked: stats.clicked,
    converted: stats.converted,
    failed: b.failed,
    skipped: b.skipped,
    unknown: stats.unknown,
    pending: b.pending + b.queued + Math.max(0, b.dispatching - stats.unknown),
    deliveryRate: ratio(delivered, sent),
    readRate: ratio(read, sent),
    replyRate: ratio(stats.replied, sent),
    clickRate: ratio(stats.clicked, sent),
    conversionRate: ratio(stats.converted, sent),
    failureRate: ratio(b.failed, attempted),
  };
}
