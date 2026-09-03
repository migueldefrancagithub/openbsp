import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { upsertOpsAlert } from "./lib/opsAlerts";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Retention sweep — Phase B only *reports*: for each tenant, whether provider
 * events older than `settings.retentionDays` exist. Deletion (and the
 * export/erasure flows it depends on) is a later, explicitly approved step.
 */
export const runDaily = internalMutation({
  args: { cursor: v.optional(v.string()) },
  returns: v.object({ tenants: v.number(), flagged: v.number(), isDone: v.boolean() }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("tenants")
      .paginate({ cursor: args.cursor ?? null, numItems: 50 });
    const now = Date.now();
    const day = new Date(now).toISOString().slice(0, 10);
    let flagged = 0;
    for (const tenant of page.page) {
      const retentionDays = tenant.settings?.retentionDays ?? 730;
      const cutoff = now - retentionDays * DAY_MS;
      const oldest = await ctx.db
        .query("channelEvents")
        .withIndex("by_tenant_received", (q) =>
          q.eq("tenantId", tenant._id).lt("receivedAt", cutoff),
        )
        .first();
      if (!oldest) continue;
      flagged += 1;
      await upsertOpsAlert(ctx, {
        tenantId: tenant._id,
        kind: "retention.candidates",
        businessKey: `retention:${day}`,
        severity: "info",
        title: `Existem eventos com mais de ${retentionDays} dias (política de retenção).`,
        payload: { retentionDays, cutoff, sampleReceivedAt: oldest.receivedAt },
        now,
      });
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.retention.runDaily, {
        cursor: page.continueCursor,
      });
    }
    return { tenants: page.page.length, flagged, isDone: page.isDone };
  },
});
