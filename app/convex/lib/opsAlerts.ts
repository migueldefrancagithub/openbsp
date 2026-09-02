import type { Id } from "../_generated/dataModel";

export type OpsAlertSeverity = "info" | "warn" | "critical";

/**
 * Upsert an operational alert by businessKey: a condition observed again
 * refreshes the row instead of adding a duplicate; an acknowledged alert is
 * reopened only if `reopen` is set.
 */
export async function upsertOpsAlert(
  ctx: { db: any },
  args: {
    tenantId: Id<"tenants">;
    kind: string;
    businessKey: string;
    severity: OpsAlertSeverity;
    title: string;
    payload?: unknown;
    href?: string;
    reopen?: boolean;
    now?: number;
  },
): Promise<{ alertId: Id<"opsAlerts">; created: boolean }> {
  const now = args.now ?? Date.now();
  const existing = await ctx.db
    .query("opsAlerts")
    .withIndex("by_business_key", (q: any) =>
      q.eq("tenantId", args.tenantId).eq("businessKey", args.businessKey),
    )
    .unique();
  if (existing) {
    await ctx.db.patch(existing._id, {
      severity: args.severity,
      title: args.title,
      payload: args.payload,
      href: args.href,
      updatedAt: now,
      ...(args.reopen && existing.status === "acknowledged"
        ? { status: "open", acknowledgedBy: undefined, acknowledgedAt: undefined }
        : {}),
    });
    return { alertId: existing._id, created: false };
  }
  const alertId = await ctx.db.insert("opsAlerts", {
    tenantId: args.tenantId,
    kind: args.kind,
    businessKey: args.businessKey,
    severity: args.severity,
    title: args.title,
    payload: args.payload,
    href: args.href,
    status: "open",
    createdAt: now,
    updatedAt: now,
  });
  return { alertId, created: true };
}
