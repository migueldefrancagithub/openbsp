import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { findOriginCampaign } from "./lib/channels/projection";

const PAGE_SIZE = 100;

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
