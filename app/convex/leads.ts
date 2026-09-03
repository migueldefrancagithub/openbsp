import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { findOriginCampaign } from "./lib/channels/projection";
import { threadHasMessageEvent } from "./lib/channels/threadVisibility";
import { threadLeadStatusValidator } from "./lib/channels/threadUpdate";
import { tenantQuery } from "./lib/customFunctions";
import { classifyRisk, compareRisk, resolveStageWindow } from "./lib/leads/riskRadar";
import { threadCommand } from "./lib/channels/threadCommand";

const PAGE_SIZE = 100;
/** Column counts stop at 100+ — the kanban never needs the exact tail. */
const COUNT_CAP = 100;

/** How many recent conversations the radar reads per call. */
const RADAR_SCAN = 120;

export const LEAD_STATUSES = [
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

const leadCardValidator = v.object({
  _id: v.id("channelThreads"),
  channelId: v.id("channels"),
  threadKey: v.string(),
  displayName: v.optional(v.string()),
  phone: v.optional(v.string()),
  leadStatus: v.string(),
  leadSource: v.optional(v.string()),
  intent: v.optional(v.string()),
  nextStep: v.optional(v.string()),
  nextStepDueAt: v.optional(v.number()),
  responsibleMemberId: v.optional(v.id("members")),
  responsibleName: v.optional(v.string()),
  unreadCount: v.number(),
  lastEventAt: v.number(),
  lastPreview: v.optional(v.string()),
  serviceWindowExpiresAt: v.optional(v.number()),
  originCampaignName: v.optional(v.string()),
  automationMode: v.optional(v.string()),
  pilotBlocked: v.boolean(),
  /** Who holds the conversation, by the same resolver the inbox uses. */
  command: v.string(),
  /** Cold enough to be on the radar, and how cold. */
  riskBucket: v.optional(v.string()),
  hoursSinceActivity: v.number(),
});

async function memberLabel(ctx: { db: any }, memberId?: Id<"members">) {
  if (!memberId) return undefined;
  const member = (await ctx.db.get(memberId)) as Doc<"members"> | null;
  if (!member) return undefined;
  const user = await ctx.db.get(member.userId);
  return user?.name ?? user?.email ?? undefined;
}

/**
 * One kanban column: threads in a lead stage, newest activity first. Each
 * column paginates on its own index range, so a busy stage never forces the
 * others to load. Closed threads and status-only projections are skipped.
 */
export const listByStatus = tenantQuery({
  args: {
    leadStatus: threadLeadStatusValidator,
    channelId: v.optional(v.id("channels")),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(leadCardValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const channel = args.channelId ? await ctx.db.get(args.channelId) : null;
    if (args.channelId && (!channel || channel.tenantId !== ctx.tenantId)) {
      throw new ConvexError({ code: "CHANNEL_NOT_FOUND" });
    }
    const numItems = Math.min(Math.max(args.paginationOpts.numItems, 1), 50);
    const cursor = args.paginationOpts.cursor;
    const result = channel
      ? await ctx.db
          .query("channelThreads")
          .withIndex("by_channel_lead_status", (q) =>
            q.eq("channelId", channel._id).eq("leadStatus", args.leadStatus),
          )
          .filter((q) => q.eq(q.field("closedAt"), undefined))
          .order("desc")
          .paginate({ cursor, numItems })
      : await ctx.db
          .query("channelThreads")
          .withIndex("by_tenant_lead_status", (q) =>
            q.eq("tenantId", ctx.tenantId).eq("leadStatus", args.leadStatus),
          )
          .filter((q) => q.eq(q.field("closedAt"), undefined))
          .order("desc")
          .paginate({ cursor, numItems });
    const channels = new Map<string, Doc<"channels"> | null>();
    const campaigns = new Map<string, string | undefined>();
    const members = new Map<string, string | undefined>();
    const page = [];
    for (const thread of result.page) {
      if (thread.tenantId !== ctx.tenantId) continue;
      if (thread.closedAt || thread.inboxStatus === "closed") continue;
      if (!(await threadHasMessageEvent(ctx, thread))) continue;
      if (!channels.has(thread.channelId)) {
        channels.set(thread.channelId, await ctx.db.get(thread.channelId));
      }
      const threadChannel = channels.get(thread.channelId);
      const identity = thread.identityId ? await ctx.db.get(thread.identityId) : null;
      const recipient = identity?.phone ?? thread.threadKey;
      if (thread.originCampaignId && !campaigns.has(thread.originCampaignId)) {
        const campaign = await ctx.db.get(thread.originCampaignId);
        campaigns.set(thread.originCampaignId, campaign?.name);
      }
      if (thread.responsibleMemberId && !members.has(thread.responsibleMemberId)) {
        members.set(thread.responsibleMemberId, await memberLabel(ctx, thread.responsibleMemberId));
      }
      // The card carries the two facts that decide whether someone acts on it:
      // who holds the conversation, and whether it is going cold with nothing
      // planned. Both are the same rules the inbox and the radar use.
      const command = threadCommand(thread, Date.now());
      const risk = classifyRisk({
        lastActivityAt: Math.max(thread.lastInboundAt ?? 0, thread.lastOutboundAt ?? 0, thread.createdAt),
        now: Date.now(),
        inFlight: false,
        window: resolveStageWindow(thread.leadStatus),
      });
      page.push({
        _id: thread._id,
        channelId: thread.channelId,
        threadKey: thread.threadKey,
        displayName: identity?.displayName,
        phone: identity?.phone,
        command: command.who,
        riskBucket: risk.onRadar ? risk.bucket : undefined,
        hoursSinceActivity: Math.round(risk.hoursSinceActivity),
        leadStatus: thread.leadStatus ?? args.leadStatus,
        leadSource: thread.leadSource,
        intent: thread.intent,
        nextStep: thread.nextStep,
        nextStepDueAt: thread.nextStepDueAt,
        responsibleMemberId: thread.responsibleMemberId,
        responsibleName: thread.responsibleMemberId
          ? members.get(thread.responsibleMemberId)
          : undefined,
        unreadCount: thread.unreadCount,
        lastEventAt: thread.lastEventAt,
        lastPreview: thread.lastPreview,
        serviceWindowExpiresAt: thread.serviceWindowExpiresAt,
        originCampaignName: thread.originCampaignId
          ? campaigns.get(thread.originCampaignId)
          : undefined,
        automationMode: thread.automationMode,
        pilotBlocked:
          !!thread.pilotBlockedAt &&
          !(threadChannel?.outboundAllowlist ?? []).includes(recipient),
      });
    }
    return { page, isDone: result.isDone, continueCursor: result.continueCursor };
  },
});

/**
 * Per-stage counts for the kanban headers, capped at 100+. Index-level: open
 * threads per stage without the per-row message check the columns apply.
 */
export const counts = tenantQuery({
  args: { channelId: v.optional(v.id("channels")) },
  returns: v.array(
    v.object({
      status: v.string(),
      count: v.number(),
      capped: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    const channel = args.channelId ? await ctx.db.get(args.channelId) : null;
    if (args.channelId && (!channel || channel.tenantId !== ctx.tenantId)) {
      throw new ConvexError({ code: "CHANNEL_NOT_FOUND" });
    }
    const result = [];
    for (const status of LEAD_STATUSES) {
      const rows = channel
        ? await ctx.db
            .query("channelThreads")
            .withIndex("by_channel_lead_status", (q) =>
              q.eq("channelId", channel._id).eq("leadStatus", status),
            )
            .filter((q) => q.eq(q.field("closedAt"), undefined))
            .take(COUNT_CAP + 1)
        : await ctx.db
            .query("channelThreads")
            .withIndex("by_tenant_lead_status", (q) =>
              q.eq("tenantId", ctx.tenantId).eq("leadStatus", status),
            )
            .filter((q) => q.eq(q.field("closedAt"), undefined))
            .take(COUNT_CAP + 1);
      const open = rows.filter(
        (row) => row.tenantId === ctx.tenantId && !row.closedAt && row.inboxStatus !== "closed",
      );
      result.push({
        status,
        count: Math.min(open.length, COUNT_CAP),
        capped: rows.length > COUNT_CAP,
      });
    }
    return result;
  },
});

/**
 * Expand → migrate helpers for the lead consolidation (Phase A3). Both are
 * idempotent, paginated across the whole table (they run once per deploy,
 * from the CLI) and reschedule themselves until done:
 *
 *   npx convex run leads:_backfillLeadStatus '{}'
 *   npx convex run leads:_backfillOrigin '{}'
 */
export const _backfillLeadStatus = internalMutation({
  args: { cursor: v.optional(v.string()) },
  returns: v.object({ patched: v.number(), isDone: v.boolean() }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("channelThreads")
      .paginate({ cursor: args.cursor ?? null, numItems: PAGE_SIZE });
    let patched = 0;
    const now = Date.now();
    for (const thread of page.page) {
      if (thread.leadStatus !== undefined) continue;
      await ctx.db.patch(thread._id, { leadStatus: "new", updatedAt: now });
      patched += 1;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.leads._backfillLeadStatus, {
        cursor: page.continueCursor,
      });
    }
    return { patched, isDone: page.isDone };
  },
});

export const _backfillOrigin = internalMutation({
  args: { cursor: v.optional(v.string()) },
  returns: v.object({ patched: v.number(), isDone: v.boolean() }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("channelThreads")
      .paginate({ cursor: args.cursor ?? null, numItems: PAGE_SIZE });
    let patched = 0;
    const channels = new Map<string, Doc<"channels"> | null>();
    for (const thread of page.page) {
      if (thread.originCampaignId) continue;
      if (!channels.has(thread.channelId)) {
        channels.set(thread.channelId, await ctx.db.get(thread.channelId));
      }
      const channel = channels.get(thread.channelId);
      if (!channel) continue;
      // Historical rows: attribute relative to the thread's last inbound, not
      // "now", so old replies inside their own window still count.
      const origin = await findOriginCampaign(ctx, {
        channel,
        threadKey: thread.threadKey,
        now: thread.lastInboundAt ?? thread.lastEventAt,
      });
      if (!origin) continue;
      await ctx.db.patch(thread._id, {
        originCampaignId: origin.campaignId,
        originCampaignAt: origin.sentAt,
        leadSource:
          !thread.leadSource || thread.leadSource === "organic"
            ? "campaign_reply"
            : thread.leadSource,
        updatedAt: Date.now(),
      });
      patched += 1;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.leads._backfillOrigin, {
        cursor: page.continueCursor,
      });
    }
    return { patched, isDone: page.isDone };
  },
});

/**
 * The risk radar: open conversations that went cold, and the ones nobody has a
 * next step for.
 *
 * The empty state is only empty when BOTH lists are: a clinic with eight
 * demands without a next step and no cold lead would otherwise read "nothing at
 * risk", hiding exactly the leak this screen exists to show.
 */
export const riskRadar = tenantQuery({
  args: {},
  returns: v.object({
    counts: v.object({ critical: v.number(), at_risk: v.number(), in_flight: v.number() }),
    items: v.array(
      v.object({
        threadId: v.id("channelThreads"),
        threadKey: v.string(),
        channelId: v.id("channels"),
        displayName: v.optional(v.string()),
        leadStatus: v.optional(v.string()),
        bucket: v.string(),
        hoursSinceActivity: v.number(),
        nextStep: v.optional(v.string()),
        responsibleName: v.optional(v.string()),
      }),
    ),
    withoutNextStep: v.array(
      v.object({ threadId: v.id("channelThreads"), threadKey: v.string(), channelId: v.id("channels"), displayName: v.optional(v.string()), hoursOpen: v.number() }),
    ),
    scanned: v.number(),
  }),
  handler: async (ctx) => {
    const now = Date.now();
    const threads = (await ctx.db
      .query("channelThreads")
      .withIndex("by_tenant_last_event", (q) => q.eq("tenantId", ctx.tenantId))
      .order("desc")
      .take(RADAR_SCAN)) as Doc<"channelThreads">[];
    const counts = { critical: 0, at_risk: 0, in_flight: 0 };
    const items = [];
    const withoutNextStep = [];
    for (const thread of threads) {
      if (thread.closedAt || thread.dnd) continue;
      // A conversation the patient never answered is not "cold": nothing was
      // ever warm. The radar starts at the last real activity.
      const lastActivityAt = Math.max(thread.lastInboundAt ?? 0, thread.lastOutboundAt ?? 0, thread.createdAt);
      const followUps = (await ctx.db
        .query("followUpTasks")
        .withIndex("by_thread_status", (q) =>
          q.eq("tenantId", ctx.tenantId).eq("threadId", thread._id).eq("status", "scheduled"),
        )
        .take(5)) as Doc<"followUpTasks">[];
      const inFlight = followUps.some((task) => task.dueAt > now);
      const risk = classifyRisk({ lastActivityAt, now, inFlight, window: resolveStageWindow(thread.leadStatus) });
      if (!thread.nextStep && !thread.closedAt) {
        withoutNextStep.push({
          threadId: thread._id,
          threadKey: thread.threadKey,
          channelId: thread.channelId,
          displayName: (await threadDisplayName(ctx, thread)) ?? undefined,
          hoursOpen: Math.round((now - thread.createdAt) / 3_600_000),
        });
      }
      if (!risk.onRadar) continue;
      counts[risk.bucket as "critical" | "at_risk" | "in_flight"] += 1;
      items.push({
        threadId: thread._id,
        threadKey: thread.threadKey,
        channelId: thread.channelId,
        displayName: (await threadDisplayName(ctx, thread)) ?? undefined,
        leadStatus: thread.leadStatus,
        bucket: risk.bucket,
        hoursSinceActivity: Math.round(risk.hoursSinceActivity),
        nextStep: thread.nextStep,
        responsibleName: thread.responsibleMemberId
          ? await memberDisplayName(ctx, thread.responsibleMemberId)
          : undefined,
      });
    }
    items.sort(compareRisk);
    return { counts, items: items.slice(0, 40), withoutNextStep: withoutNextStep.slice(0, 20), scanned: threads.length };
  },
});

async function threadDisplayName(ctx: { db: any }, thread: Doc<"channelThreads">): Promise<string | null> {
  if (!thread.identityId) return null;
  const identity = (await ctx.db.get(thread.identityId)) as Doc<"channelIdentities"> | null;
  return identity?.displayName ?? null;
}

async function memberDisplayName(ctx: { db: any }, memberId: Id<"members">): Promise<string | undefined> {
  const member = (await ctx.db.get(memberId)) as Doc<"members"> | null;
  if (!member) return undefined;
  const user = await ctx.db.get(member.userId);
  return user?.name ?? user?.email;
}
