import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { writeAudit } from "./lib/audit";
import { loadByIdInTenant, tenantMutation, tenantQuery } from "./lib/customFunctions";

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
