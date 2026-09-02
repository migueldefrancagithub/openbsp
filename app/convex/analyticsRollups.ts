import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { tenantTimeZone } from "./lib/clinicAgenda";
import { addDays, localDateOf, localTimeToTimestamp, parseDate } from "./lib/clinicTime";
import { requireCapability, tenantQuery } from "./lib/customFunctions";

const PAGE = 500;
const MAX_ROWS_PER_SOURCE = 20_000;
const MAX_RANGE_DAYS = 92;

type Counters = Omit<Doc<"analyticsDailyRollups">, "_id" | "_creationTime" | "tenantId" | "day" | "channelId" | "timeZone" | "computedAt">;

function emptyCounters(): Counters {
  return {
    newThreads: 0,
    inboundMessages: 0,
    outboundHuman: 0,
    outboundBot: 0,
    outboundCampaign: 0,
    outboundFollowUp: 0,
    outboundFailed: 0,
    booked: 0,
    confirmed: 0,
    attended: 0,
    noShow: 0,
    cancelled: 0,
    firstResponseCount: 0,
    firstResponseTotalMs: 0,
    approximate: false,
  };
}

export type OutboxBucket = "outboundHuman" | "outboundBot" | "outboundCampaign" | "outboundFollowUp" | "outboundFailed";

/** Outbox rows carry their origin in the business key (see dispatch nonces). */
export function classifyOutbox(row: Pick<Doc<"channelOutbox">, "businessKey" | "status">): OutboxBucket | null {
  if (row.status === "failed") return "outboundFailed";
  if (row.status !== "accepted") return null;
  const key = row.businessKey;
  if (/^hub:[a-z]+:campaign:/.test(key) || /^hub:[a-z]+:micro:/.test(key)) return "outboundCampaign";
  if (/^hub:[a-z]+:followup:/.test(key)) return "outboundFollowUp";
  if (/^hub:[a-z]+:automation:/.test(key) || /^hub:[a-z]+:micro-reply:/.test(key) || /^hub:[a-z]+:ai:/.test(key)) return "outboundBot";
  return "outboundHuman";
}

const rollupArgs = {
  tenantId: v.id("tenants"),
  day: v.string(),
  phase: v.optional(v.union(v.literal("events"), v.literal("outbox"), v.literal("threads"), v.literal("appointments"))),
  cursor: v.optional(v.string()),
  scanned: v.optional(v.number()),
  partial: v.optional(v.any()),
};

/**
 * Rebuild one tenant-day. Four index-bounded phases, each paginated and
 * self-rescheduling; the final phase upserts the row. Re-running replaces the
 * counters (idempotent).
 */
export const rollupDay = internalMutation({
  args: rollupArgs,
  returns: v.object({ isDone: v.boolean(), phase: v.string() }),
  handler: async (ctx, args) => {
    parseDate(args.day);
    const timeZone = await tenantTimeZone(ctx, args.tenantId);
    const dayStart = localTimeToTimestamp(args.day, "00:00", timeZone);
    const dayEnd = localTimeToTimestamp(addDays(args.day, 1), "00:00", timeZone);
    const counters: Counters = { ...emptyCounters(), ...((args.partial as Partial<Counters> | undefined) ?? {}) };
    const phase = args.phase ?? "events";
    const scanned = args.scanned ?? 0;
    let nextCursor: string | undefined;
    let done = false;

    if (phase === "events") {
      const page = await ctx.db
        .query("channelEvents")
        .withIndex("by_tenant_received", (q) => q.eq("tenantId", args.tenantId).gte("receivedAt", dayStart).lt("receivedAt", dayEnd))
        .paginate({ cursor: args.cursor ?? null, numItems: PAGE });
      for (const row of page.page) {
        if (row.direction === "incoming" && row.eventKind.startsWith("message.")) counters.inboundMessages += 1;
      }
      nextCursor = page.continueCursor;
      done = page.isDone;
    } else if (phase === "outbox") {
      const page = await ctx.db
        .query("channelOutbox")
        .withIndex("by_tenant_created", (q) => q.eq("tenantId", args.tenantId).gte("createdAt", dayStart).lt("createdAt", dayEnd))
        .paginate({ cursor: args.cursor ?? null, numItems: PAGE });
      for (const row of page.page) {
        const bucket = classifyOutbox(row);
        if (bucket) counters[bucket] += 1;
      }
      nextCursor = page.continueCursor;
      done = page.isDone;
    } else if (phase === "threads") {
      // Threads created on the day necessarily have lastEventAt >= dayStart.
      const page = await ctx.db
        .query("channelThreads")
        .withIndex("by_tenant_last_event", (q) => q.eq("tenantId", args.tenantId).gte("lastEventAt", dayStart))
        .paginate({ cursor: args.cursor ?? null, numItems: PAGE });
      for (const row of page.page) {
        if (row.createdAt >= dayStart && row.createdAt < dayEnd) counters.newThreads += 1;
        if (row.firstRespondedAt && row.firstRespondedAt >= dayStart && row.firstRespondedAt < dayEnd && row.lastInboundAt) {
          const started = Math.min(row.lastInboundAt, row.firstRespondedAt);
          counters.firstResponseCount += 1;
          counters.firstResponseTotalMs += Math.max(0, row.firstRespondedAt - started);
        }
      }
      nextCursor = page.continueCursor;
      done = page.isDone;
    } else {
      const page = await ctx.db
        .query("clinicAppointments")
        .withIndex("by_tenant_start", (q) => q.eq("tenantId", args.tenantId).gte("startAt", dayStart).lt("startAt", dayEnd))
        .paginate({ cursor: args.cursor ?? null, numItems: PAGE });
      for (const row of page.page) {
        counters.booked += 1;
        if (row.status === "confirmed") counters.confirmed += 1;
        if (row.status === "completed") counters.attended += 1;
        if (row.status === "no_show") counters.noShow += 1;
        if (row.status === "cancelled") counters.cancelled += 1;
      }
      nextCursor = page.continueCursor;
      done = page.isDone;
    }

    const totalScanned = scanned + PAGE;
    if (!done && totalScanned >= MAX_ROWS_PER_SOURCE) {
      counters.approximate = true;
      done = true;
    }
    const nextPhase: typeof phase | null = !done
      ? phase
      : phase === "events"
        ? "outbox"
        : phase === "outbox"
          ? "threads"
          : phase === "threads"
            ? "appointments"
            : null;

    if (nextPhase) {
      await ctx.scheduler.runAfter(0, internal.analyticsRollups.rollupDay, {
        tenantId: args.tenantId,
        day: args.day,
        phase: nextPhase,
        cursor: nextPhase === phase ? nextCursor : undefined,
        scanned: nextPhase === phase ? totalScanned : 0,
        partial: counters,
      });
      return { isDone: false, phase: nextPhase };
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("analyticsDailyRollups")
      .withIndex("by_tenant_day", (q) => q.eq("tenantId", args.tenantId).eq("day", args.day))
      .filter((q) => q.eq(q.field("channelId"), undefined))
      .first();
    const row = { tenantId: args.tenantId, day: args.day, channelId: undefined, timeZone, ...counters, computedAt: now };
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("analyticsDailyRollups", row);
    return { isDone: true, phase: "done" };
  },
});

/** Hourly: today and yesterday for every tenant (paginated over tenants). */
export const runHourly = internalMutation({
  args: { cursor: v.optional(v.string()) },
  returns: v.object({ tenants: v.number(), isDone: v.boolean() }),
  handler: async (ctx, args) => {
    const page = await ctx.db.query("tenants").paginate({ cursor: args.cursor ?? null, numItems: 25 });
    const now = Date.now();
    for (const tenant of page.page) {
      const timeZone = await tenantTimeZone(ctx, tenant._id);
      const today = localDateOf(now, timeZone);
      for (const day of [today, addDays(today, -1)]) {
        await ctx.scheduler.runAfter(0, internal.analyticsRollups.rollupDay, { tenantId: tenant._id, day });
      }
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.analyticsRollups.runHourly, { cursor: page.continueCursor });
    }
    return { tenants: page.page.length, isDone: page.isDone };
  },
});

/** One-off: rebuild the last `days` days for one tenant (or all). */
export const backfill = internalMutation({
  args: { tenantId: v.optional(v.id("tenants")), days: v.optional(v.number()), cursor: v.optional(v.string()) },
  returns: v.object({ scheduled: v.number(), isDone: v.boolean() }),
  handler: async (ctx, args) => {
    const days = Math.min(Math.max(args.days ?? 30, 1), MAX_RANGE_DAYS);
    const tenants = args.tenantId
      ? { page: [await ctx.db.get(args.tenantId)].filter((t): t is Doc<"tenants"> => !!t), isDone: true, continueCursor: "" }
      : await ctx.db.query("tenants").paginate({ cursor: args.cursor ?? null, numItems: 10 });
    const now = Date.now();
    let scheduled = 0;
    for (const tenant of tenants.page) {
      const timeZone = await tenantTimeZone(ctx, tenant._id);
      const today = localDateOf(now, timeZone);
      for (let offset = 0; offset < days; offset += 1) {
        await ctx.scheduler.runAfter(offset * 200, internal.analyticsRollups.rollupDay, { tenantId: tenant._id, day: addDays(today, -offset) });
        scheduled += 1;
      }
    }
    if (!tenants.isDone) {
      await ctx.scheduler.runAfter(0, internal.analyticsRollups.backfill, { days, cursor: tenants.continueCursor });
    }
    return { scheduled, isDone: tenants.isDone };
  },
});

const rollupRowValidator = v.object({
  day: v.string(),
  newThreads: v.number(),
  inboundMessages: v.number(),
  outboundHuman: v.number(),
  outboundBot: v.number(),
  outboundCampaign: v.number(),
  outboundFollowUp: v.number(),
  outboundFailed: v.number(),
  booked: v.number(),
  confirmed: v.number(),
  attended: v.number(),
  noShow: v.number(),
  cancelled: v.number(),
  firstResponseAvgMs: v.optional(v.number()),
  approximate: v.boolean(),
  computedAt: v.number(),
});

export const readRange = tenantQuery({
  args: { from: v.string(), to: v.string() },
  returns: v.object({ rows: v.array(rollupRowValidator), timeZone: v.string(), missingDays: v.array(v.string()) }),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "analytics.read");
    parseDate(args.from);
    parseDate(args.to);
    const timeZone = await tenantTimeZone(ctx, ctx.tenantId);
    const rows = (await ctx.db
      .query("analyticsDailyRollups")
      .withIndex("by_tenant_day", (q) => q.eq("tenantId", ctx.tenantId).gte("day", args.from).lte("day", args.to))
      .take(MAX_RANGE_DAYS * 2)) as Doc<"analyticsDailyRollups">[];
    const byDay = new Map<string, Doc<"analyticsDailyRollups">>();
    for (const row of rows) if (!row.channelId) byDay.set(row.day, row);
    const out = [];
    const missing: string[] = [];
    for (let day = args.from, i = 0; day <= args.to && i < MAX_RANGE_DAYS; day = addDays(day, 1), i += 1) {
      const row = byDay.get(day);
      if (!row) {
        missing.push(day);
        continue;
      }
      out.push({
        day: row.day,
        newThreads: row.newThreads,
        inboundMessages: row.inboundMessages,
        outboundHuman: row.outboundHuman,
        outboundBot: row.outboundBot,
        outboundCampaign: row.outboundCampaign,
        outboundFollowUp: row.outboundFollowUp,
        outboundFailed: row.outboundFailed,
        booked: row.booked,
        confirmed: row.confirmed,
        attended: row.attended,
        noShow: row.noShow,
        cancelled: row.cancelled,
        firstResponseAvgMs: row.firstResponseCount > 0 ? Math.round(row.firstResponseTotalMs / row.firstResponseCount) : undefined,
        approximate: row.approximate,
        computedAt: row.computedAt,
      });
    }
    return { rows: out, timeZone, missingDays: missing };
  },
});

export type RollupId = Id<"analyticsDailyRollups">;
