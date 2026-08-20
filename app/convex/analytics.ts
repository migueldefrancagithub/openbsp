import { v } from "convex/values";
import { tenantQuery } from "./lib/customFunctions";
import type { Doc, Id } from "./_generated/dataModel";
import { DEFAULT_CURRENCY, normalizeCurrency } from "./lib/money";

const granularityValidator = v.union(v.literal("hour"), v.literal("day"));
const pricingCategoryValidator = v.union(
  v.literal("marketing"),
  v.literal("utility"),
  v.literal("authentication"),
  v.literal("service"),
);
const retrySafetyValidator = v.union(
  v.literal("safe"),
  v.literal("review"),
  v.literal("unsafe"),
);
const qualityRiskValidator = v.union(
  v.literal("low"),
  v.literal("watch"),
  v.literal("high"),
);

const MAX_ANALYTICS_ROWS = 2_500;

const reportRowValidator = v.object({
  bucketStart: v.number(),
  bucketLabel: v.string(),
  sent: v.number(),
  delivered: v.number(),
  failed: v.number(),
  deliveryRate: v.number(),
  costMinor: v.number(),
  costCurrency: v.string(),
  category: pricingCategoryValidator,
  country: v.string(),
  retrySafety: retrySafetyValidator,
  qualityRisk: qualityRiskValidator,
});

const breakdownValidator = v.object({
  key: v.string(),
  sent: v.number(),
  delivered: v.number(),
  failed: v.number(),
  deliveryRate: v.number(),
  costMinor: v.number(),
  costCurrency: v.string(),
});

export const reports = tenantQuery({
  args: {
    dateFrom: v.optional(v.number()),
    dateTo: v.optional(v.number()),
    granularity: v.optional(granularityValidator),
  },
  returns: v.object({
    summary: v.object({
      sent: v.number(),
      delivered: v.number(),
      failed: v.number(),
      totalMessages: v.number(),
      totalCostMinor: v.number(),
      costCurrency: v.string(),
      deliveryRate: v.number(),
      failureRate: v.number(),
      costPerDeliveredMinor: v.number(),
    }),
    series: v.array(
      v.object({
        bucketStart: v.number(),
        bucketLabel: v.string(),
        sent: v.number(),
        delivered: v.number(),
        failed: v.number(),
        costMinor: v.number(),
        costCurrency: v.string(),
      }),
    ),
    details: v.array(reportRowValidator),
    categoryBreakdown: v.array(
      v.object({
        category: pricingCategoryValidator,
        sent: v.number(),
        delivered: v.number(),
        failed: v.number(),
        deliveryRate: v.number(),
        costMinor: v.number(),
        costCurrency: v.string(),
      }),
    ),
    countryBreakdown: v.array(breakdownValidator),
    health: v.object({
      deliveryRisk: qualityRiskValidator,
      failureRisk: qualityRiskValidator,
      spendRisk: qualityRiskValidator,
    }),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const dateTo = args.dateTo ?? now;
    const dateFrom = args.dateFrom ?? dateTo - 24 * 60 * 60 * 1000;
    const granularity = args.granularity ?? "hour";

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_tenant_created", (q) =>
        q
          .eq("tenantId", ctx.tenantId)
          .gte("createdAt", dateFrom)
          .lt("createdAt", dateTo),
      )
      .take(MAX_ANALYTICS_ROWS);
    const channelEvents = await ctx.db
      .query("channelEvents")
      .withIndex("by_tenant_received", (q) =>
        q
          .eq("tenantId", ctx.tenantId)
          .gte("receivedAt", dateFrom)
          .lt("receivedAt", dateTo),
      )
      .take(MAX_ANALYTICS_ROWS);

    const conversationCache = new Map<
      Id<"conversations">,
      Doc<"conversations"> | null
    >();
    const contactCache = new Map<Id<"contacts">, Doc<"contacts"> | null>();
    const series = new Map<string, SeriesRow>();
    const details = new Map<string, DetailRow>();
    const categoryBreakdown = new Map<string, BreakdownRow>();
    const countryBreakdown = new Map<string, BreakdownRow>();
    let costCurrency = DEFAULT_CURRENCY;

    for (const message of messages) {
      if (message.direction !== "outgoing") continue;
      if (!isReportableStatus(message.status)) continue;

      const conversation = await getConversation(
        ctx,
        conversationCache,
        message.conversationId,
      );
      const contact = conversation
        ? await getContact(ctx, contactCache, conversation.contactId)
        : null;
      const category = message.pricingCategory ?? "service";
      const country = inferCountry(contact);
      const bucketStart = bucketTimestamp(message.createdAt, granularity);
      const bucketLabel = formatBucket(bucketStart, granularity);
      const costMinor = message.costMinor ?? 0;
      costCurrency = normalizeCurrency(message.costCurrency ?? costCurrency);
      const counters = statusCounters(message.status);
      const failureSignal = `${message.failureCode ?? ""} ${
        message.failureReason ?? ""
      }`;

      upsertSeries(series, bucketStart, bucketLabel, counters, costMinor, costCurrency);
      upsertDetail(
        details,
        { bucketStart, bucketLabel, category, country },
        counters,
        costMinor,
        costCurrency,
        failureSignal,
      );
      upsertBreakdown(
        categoryBreakdown,
        category,
        counters,
        costMinor,
        costCurrency,
      );
      upsertBreakdown(
        countryBreakdown,
        country,
        counters,
        costMinor,
        costCurrency,
      );
    }

    for (const event of collapseChannelLifecycleEvents(channelEvents)) {
      const status = event.eventKind.slice("status.".length);
      if (!isReportableStatus(status)) continue;

      const timestamp = event.providerTimestamp ?? event.receivedAt;
      const category: PricingCategory = "service";
      const country = inferCountryFromIdentity(event.threadKey);
      const bucketStart = bucketTimestamp(timestamp, granularity);
      const bucketLabel = formatBucket(bucketStart, granularity);
      const counters = statusCounters(status);
      const failureSignal =
        status === "failed" ? event.lastError ?? "channel delivery failed" : "";

      upsertSeries(series, bucketStart, bucketLabel, counters, 0, costCurrency);
      upsertDetail(
        details,
        { bucketStart, bucketLabel, category, country },
        counters,
        0,
        costCurrency,
        failureSignal,
      );
      upsertBreakdown(
        categoryBreakdown,
        category,
        counters,
        0,
        costCurrency,
      );
      upsertBreakdown(
        countryBreakdown,
        country,
        counters,
        0,
        costCurrency,
      );
    }

    const summary = summarize([...series.values()], costCurrency);
    const detailRows = [...details.values()]
      .map(finalizeDetail)
      .sort(sortReportRows);
    const categoryRows = [...categoryBreakdown.entries()]
      .map(([category, row]) => ({
        category: category as PricingCategory,
        ...finalizeBreakdown(row),
      }))
      .sort((a, b) => b.sent + b.failed - (a.sent + a.failed));
    const countryRows = [...countryBreakdown.entries()]
      .map(([key, row]) => ({
        key,
        ...finalizeBreakdown(row),
      }))
      .sort((a, b) => b.sent + b.failed - (a.sent + a.failed));

    return {
      summary,
      series: [...series.values()].sort((a, b) => a.bucketStart - b.bucketStart),
      details: detailRows,
      categoryBreakdown: categoryRows,
      countryBreakdown: countryRows,
      health: {
        deliveryRisk: deliveryHealth(summary.deliveryRate),
        failureRisk: failureHealth(summary.failureRate),
        spendRisk: spendHealth(
          summary.totalCostMinor,
          summary.costPerDeliveredMinor,
        ),
      },
    };
  },
});

type PricingCategory = "marketing" | "utility" | "authentication" | "service";
type RetrySafety = "safe" | "review" | "unsafe";
type QualityRisk = "low" | "watch" | "high";
type Counters = { sent: number; delivered: number; failed: number };
type ChannelLifecycleEvent = Doc<"channelEvents">;
type SeriesRow = Counters & {
  bucketStart: number;
  bucketLabel: string;
  costMinor: number;
  costCurrency: string;
};
type BreakdownRow = Counters & {
  costMinor: number;
  costCurrency: string;
};
type DetailRow = BreakdownRow & {
  bucketStart: number;
  bucketLabel: string;
  category: PricingCategory;
  country: string;
  failureSignals: string[];
};

async function getConversation(
  ctx: { db: { get: <T extends "conversations">(id: Id<T>) => Promise<Doc<T> | null> } },
  cache: Map<Id<"conversations">, Doc<"conversations"> | null>,
  conversationId: Id<"conversations">,
) {
  if (!cache.has(conversationId)) {
    cache.set(conversationId, await ctx.db.get(conversationId));
  }
  return cache.get(conversationId) ?? null;
}

async function getContact(
  ctx: { db: { get: <T extends "contacts">(id: Id<T>) => Promise<Doc<T> | null> } },
  cache: Map<Id<"contacts">, Doc<"contacts"> | null>,
  contactId: Id<"contacts">,
) {
  if (!cache.has(contactId)) {
    cache.set(contactId, await ctx.db.get(contactId));
  }
  return cache.get(contactId) ?? null;
}

function isReportableStatus(status: string) {
  return (
    status === "sent" ||
    status === "delivered" ||
    status === "read" ||
    status === "played" ||
    status === "failed"
  );
}

function statusCounters(status: string): Counters {
  if (status === "failed") return { sent: 0, delivered: 0, failed: 1 };
  return {
    sent: 1,
    delivered:
      status === "delivered" || status === "read" || status === "played"
        ? 1
        : 0,
    failed: 0,
  };
}

function upsertSeries(
  rows: Map<string, SeriesRow>,
  bucketStart: number,
  bucketLabel: string,
  counters: Counters,
  costMinor: number,
  costCurrency: string,
) {
  const key = String(bucketStart);
  const row =
    rows.get(key) ??
    {
      bucketStart,
      bucketLabel,
      sent: 0,
      delivered: 0,
      failed: 0,
      costMinor: 0,
      costCurrency,
    };
  addCounters(row, counters, costMinor, costCurrency);
  rows.set(key, row);
}

function upsertDetail(
  rows: Map<string, DetailRow>,
  meta: {
    bucketStart: number;
    bucketLabel: string;
    category: PricingCategory;
    country: string;
  },
  counters: Counters,
  costMinor: number,
  costCurrency: string,
  failureSignal: string,
) {
  const key = `${meta.bucketStart}:${meta.category}:${meta.country}`;
  const row =
    rows.get(key) ??
    {
      ...meta,
      sent: 0,
      delivered: 0,
      failed: 0,
      costMinor: 0,
      costCurrency,
      failureSignals: [],
    };
  addCounters(row, counters, costMinor, costCurrency);
  if (counters.failed > 0) row.failureSignals.push(failureSignal);
  rows.set(key, row);
}

function upsertBreakdown(
  rows: Map<string, BreakdownRow>,
  key: string,
  counters: Counters,
  costMinor: number,
  costCurrency: string,
) {
  const row =
    rows.get(key) ??
    { sent: 0, delivered: 0, failed: 0, costMinor: 0, costCurrency };
  addCounters(row, counters, costMinor, costCurrency);
  rows.set(key, row);
}

function addCounters(
  row: BreakdownRow,
  counters: Counters,
  costMinor: number,
  costCurrency: string,
) {
  row.sent += counters.sent;
  row.delivered += counters.delivered;
  row.failed += counters.failed;
  row.costMinor += costMinor;
  row.costCurrency = costCurrency;
}

function finalizeDetail(row: DetailRow) {
  const deliveryRate = row.sent > 0 ? row.delivered / row.sent : 0;
  const failureRate = row.sent + row.failed > 0 ? row.failed / (row.sent + row.failed) : 0;
  return {
    bucketStart: row.bucketStart,
    bucketLabel: row.bucketLabel,
    sent: row.sent,
    delivered: row.delivered,
    failed: row.failed,
    deliveryRate,
    costMinor: row.costMinor,
    costCurrency: row.costCurrency,
    category: row.category,
    country: row.country,
    retrySafety: retrySafety(row.failed, row.failureSignals),
    qualityRisk: qualityRisk(deliveryRate, failureRate),
  };
}

function finalizeBreakdown(row: BreakdownRow) {
  return {
    sent: row.sent,
    delivered: row.delivered,
    failed: row.failed,
    deliveryRate: row.sent > 0 ? row.delivered / row.sent : 0,
    costMinor: row.costMinor,
    costCurrency: row.costCurrency,
  };
}

function summarize(rows: SeriesRow[], fallbackCurrency: string) {
  const sent = rows.reduce((sum, row) => sum + row.sent, 0);
  const delivered = rows.reduce((sum, row) => sum + row.delivered, 0);
  const failed = rows.reduce((sum, row) => sum + row.failed, 0);
  const totalCostMinor = rows.reduce((sum, row) => sum + row.costMinor, 0);
  const costCurrency = rows.find((row) => row.costCurrency)?.costCurrency ?? fallbackCurrency;
  return {
    sent,
    delivered,
    failed,
    totalMessages: sent + failed,
    totalCostMinor,
    costCurrency,
    deliveryRate: sent > 0 ? delivered / sent : 0,
    failureRate: sent + failed > 0 ? failed / (sent + failed) : 0,
    costPerDeliveredMinor: delivered > 0 ? totalCostMinor / delivered : 0,
  };
}

function bucketTimestamp(timestamp: number, granularity: "hour" | "day") {
  const date = new Date(timestamp);
  if (granularity === "day") {
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  }
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
  );
}

function formatBucket(bucketStart: number, granularity: "hour" | "day") {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: granularity === "hour" ? "numeric" : undefined,
    timeZone: "UTC",
  }).format(bucketStart);
}

function inferCountry(contact: Doc<"contacts"> | null): string {
  const e164 = contact?.e164;
  if (e164?.startsWith("+258")) return "MZ";
  if (e164?.startsWith("+351")) return "PT";
  if (e164?.startsWith("+55")) return "BR";
  if (e164?.startsWith("+244")) return "AO";
  if (e164?.startsWith("+27")) return "ZA";
  if (e164?.startsWith("+44")) return "GB";
  if (e164?.startsWith("+1")) return "US";
  const bsuidCountry = contact?.bsuid?.split(".")[0];
  return bsuidCountry && bsuidCountry.length <= 3 ? bsuidCountry : "Unknown";
}

function inferCountryFromIdentity(identity?: string): string {
  const digits = identity?.replace(/\D/g, "") ?? "";
  if (digits.startsWith("258")) return "MZ";
  if (digits.startsWith("351")) return "PT";
  if (digits.startsWith("55")) return "BR";
  if (digits.startsWith("244")) return "AO";
  if (digits.startsWith("27")) return "ZA";
  if (digits.startsWith("44")) return "GB";
  if (digits.startsWith("1")) return "US";
  return "Unknown";
}

function collapseChannelLifecycleEvents(
  events: ChannelLifecycleEvent[],
): ChannelLifecycleEvent[] {
  const latestByMessage = new Map<string, ChannelLifecycleEvent>();
  for (const event of events) {
    if (
      event.direction !== "outgoing" ||
      !event.eventKind.startsWith("status.")
    ) {
      continue;
    }
    const key = event.providerEventId ?? event.eventKey;
    const existing = latestByMessage.get(key);
    if (!existing || channelEventIsLater(event, existing)) {
      latestByMessage.set(key, event);
    }
  }
  return [...latestByMessage.values()];
}

function channelEventIsLater(
  candidate: ChannelLifecycleEvent,
  existing: ChannelLifecycleEvent,
): boolean {
  const candidateAt = candidate.providerTimestamp ?? candidate.receivedAt;
  const existingAt = existing.providerTimestamp ?? existing.receivedAt;
  if (candidateAt !== existingAt) return candidateAt > existingAt;
  return (
    channelStatusRank(candidate.eventKind) >
    channelStatusRank(existing.eventKind)
  );
}

function channelStatusRank(eventKind: string): number {
  switch (eventKind) {
    case "status.sent":
      return 1;
    case "status.delivered":
      return 2;
    case "status.read":
    case "status.played":
      return 3;
    case "status.failed":
      return 4;
    default:
      return 0;
  }
}

function retrySafety(failed: number, signals: string[]): RetrySafety {
  if (failed === 0) return "safe";
  const signal = signals.join(" ").toLowerCase();
  if (/(quality|spam|policy|blocked by user|user report)/.test(signal)) {
    return "unsafe";
  }
  if (/(temporary|rate|timeout|throttle|billing)/.test(signal)) {
    return "safe";
  }
  return "review";
}

function qualityRisk(deliveryRate: number, failureRate: number): QualityRisk {
  if (failureRate >= 0.15 || (deliveryRate > 0 && deliveryRate < 0.75)) {
    return "high";
  }
  if (failureRate >= 0.05 || (deliveryRate > 0 && deliveryRate < 0.9)) {
    return "watch";
  }
  return "low";
}

function deliveryHealth(deliveryRate: number): QualityRisk {
  if (deliveryRate >= 0.9) return "low";
  if (deliveryRate >= 0.8) return "watch";
  return "high";
}

function failureHealth(failureRate: number): QualityRisk {
  if (failureRate <= 0.02) return "low";
  if (failureRate <= 0.08) return "watch";
  return "high";
}

function spendHealth(totalCostMinor: number, costPerDeliveredMinor: number): QualityRisk {
  if (totalCostMinor === 0) return "low";
  if (costPerDeliveredMinor <= 50) return "low";
  return "watch";
}

function sortReportRows(a: { bucketStart: number; category: string; country: string }, b: { bucketStart: number; category: string; country: string }) {
  if (a.bucketStart !== b.bucketStart) return a.bucketStart - b.bucketStart;
  if (a.category !== b.category) return a.category.localeCompare(b.category);
  return a.country.localeCompare(b.country);
}
