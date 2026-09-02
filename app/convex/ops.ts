import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { writeAudit } from "./lib/audit";
import { loadByIdInTenant, tenantMutation, tenantQuery } from "./lib/customFunctions";
import { upsertOpsAlert } from "./lib/opsAlerts";

const alertValidator = v.object({
  _id: v.id("opsAlerts"),
  kind: v.string(),
  severity: v.string(),
  title: v.string(),
  payload: v.optional(v.any()),
  href: v.optional(v.string()),
  status: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const listAlerts = tenantQuery({
  args: { status: v.optional(v.union(v.literal("open"), v.literal("acknowledged"))) },
  returns: v.array(alertValidator),
  handler: async (ctx, args) => {
    const rows = (await ctx.db
      .query("opsAlerts")
      .withIndex("by_tenant_status_created", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("status", args.status ?? "open"),
      )
      .order("desc")
      .take(100)) as Doc<"opsAlerts">[];
    return rows.map((row) => ({
      _id: row._id,
      kind: row.kind,
      severity: row.severity,
      title: row.title,
      payload: row.payload,
      href: row.href,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  },
});

export const acknowledgeAlert = tenantMutation({
  args: { alertId: v.id("opsAlerts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const alert = await loadByIdInTenant(ctx, "opsAlerts", args.alertId);
    if (alert.status === "acknowledged") return null;
    const now = Date.now();
    await ctx.db.patch(alert._id, {
      status: "acknowledged",
      acknowledgedBy: ctx.memberId,
      acknowledgedAt: now,
      updatedAt: now,
    });
    await writeAudit(ctx, {
      action: "ops.alert.acknowledged",
      targetType: "opsAlert",
      targetId: alert._id,
      payload: { kind: alert.kind },
    });
    return null;
  },
});

export const summary = tenantQuery({
  args: {},
  returns: v.object({ open: v.number(), critical: v.number(), warn: v.number() }),
  handler: async (ctx) => {
    const rows = (await ctx.db
      .query("opsAlerts")
      .withIndex("by_tenant_status_created", (q) => q.eq("tenantId", ctx.tenantId).eq("status", "open"))
      .take(101)) as Doc<"opsAlerts">[];
    return {
      open: rows.length,
      critical: rows.filter((row) => row.severity === "critical").length,
      warn: rows.filter((row) => row.severity === "warn").length,
    };
  },
});

/**
 * Outbox rows stuck in `unknown` (provider never confirmed) in the last 24h,
 * grouped per tenant into one alert per day. Never retries them.
 */
export const sweepUnknownOutbox = internalMutation({
  args: {},
  returns: v.object({ rows: v.number(), tenants: v.number() }),
  handler: async (ctx) => {
    const now = Date.now();
    const rows = (await ctx.db
      .query("channelOutbox")
      .withIndex("by_status_unknown_since", (q) =>
        q.eq("status", "unknown").gte("unknownSince", now - 24 * 60 * 60_000),
      )
      .take(200)) as Doc<"channelOutbox">[];
    const byTenant = new Map<string, { tenantId: Id<"tenants">; count: number; latest: number }>();
    for (const row of rows) {
      const entry = byTenant.get(row.tenantId) ?? { tenantId: row.tenantId, count: 0, latest: 0 };
      entry.count += 1;
      entry.latest = Math.max(entry.latest, row.unknownSince ?? row.updatedAt);
      byTenant.set(row.tenantId, entry);
    }
    const day = new Date(now).toISOString().slice(0, 10);
    for (const entry of byTenant.values()) {
      await upsertOpsAlert(ctx, {
        tenantId: entry.tenantId,
        kind: "outbox.unknown",
        businessKey: `outbox:unknown:${day}`,
        severity: entry.count >= 5 ? "critical" : "warn",
        title: `${entry.count} envio(s) sem confirmação do provedor nas últimas 24h.`,
        payload: { count: entry.count, latest: entry.latest },
        href: "/app/admin/logs?tab=outbox&status=unknown",
        reopen: true,
        now,
      });
    }
    return { rows: rows.length, tenants: byTenant.size };
  },
});

/** Open/assigned human cases past their SLA → one critical alert per case. */
export const sweepSlaBreaches = internalMutation({
  args: { cursor: v.optional(v.string()) },
  returns: v.object({ tenants: v.number(), breached: v.number(), isDone: v.boolean() }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const page = await ctx.db.query("tenants").paginate({ cursor: args.cursor ?? null, numItems: 50 });
    let breached = 0;
    for (const tenant of page.page) {
      for (const status of ["open", "assigned"] as const) {
        const cases = (await ctx.db
          .query("humanCases")
          .withIndex("by_tenant_status_sla", (q) =>
            q.eq("tenantId", tenant._id).eq("status", status).lt("slaDueAt", now),
          )
          .take(20)) as Doc<"humanCases">[];
        for (const humanCase of cases) {
          breached += 1;
          const thread = humanCase.threadId ? await ctx.db.get(humanCase.threadId) : null;
          await upsertOpsAlert(ctx, {
            tenantId: tenant._id,
            kind: "sla.human_case",
            businessKey: `sla:human_case:${humanCase._id}`,
            severity: humanCase.urgency === "urgent" || humanCase.urgency === "high" ? "critical" : "warn",
            title: `Caso humano fora do SLA: ${humanCase.reason.slice(0, 80)}`,
            payload: { caseId: humanCase._id, slaDueAt: humanCase.slaDueAt, urgency: humanCase.urgency },
            href: thread ? `/app/channel-inbox/${thread.threadKey}?channel=${thread.channelId}` : "/app?tab=clinic",
            now,
          });
        }
      }
    }
    const day = new Date(now).toISOString().slice(0, 10);
    for (const tenant of page.page) {
      const overdue = (await ctx.db
        .query("channelThreads")
        .withIndex("by_tenant_first_response_due", (q) =>
          q.eq("tenantId", tenant._id).gt("firstResponseDueAt", 0).lt("firstResponseDueAt", now),
        )
        .take(51)) as Doc<"channelThreads">[];
      const open = overdue.filter((row) => !row.closedAt);
      if (open.length === 0) continue;
      breached += open.length;
      await upsertOpsAlert(ctx, {
        tenantId: tenant._id,
        kind: "sla.first_response",
        businessKey: `sla:first_response:${day}`,
        severity: open.length >= 5 ? "critical" : "warn",
        title: `${open.length >= 51 ? "50+" : open.length} conversa(s) sem primeira resposta dentro do SLA.`,
        payload: { count: open.length, sample: open.slice(0, 5).map((row) => row.threadKey) },
        href: "/app/channel-inbox?filter=unassigned",
        reopen: true,
        now,
      });
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.ops.sweepSlaBreaches, { cursor: page.continueCursor });
    }
    return { tenants: page.page.length, breached, isDone: page.isDone };
  },
});
