import type { Id } from "../_generated/dataModel";

export type AuditActorKind = "member" | "ai" | "system";

export type WriteAuditArgs = {
  action: string;
  targetType: string;
  targetId: string;
  payload?: unknown;
  /** Defaults to the acting member; automation passes the publishing member. */
  actorMemberId?: Id<"members">;
  actorKind?: AuditActorKind;
  now?: number;
};

/**
 * Single seam for operational audit writes. Today the sink is
 * `clinicAuditEvents` (read by the thread history and the Operação panel);
 * Phase B adds the hash-chained `auditLog` writer behind this same function
 * so callers never change.
 */
export async function writeAudit(
  ctx: { db: any; tenantId: Id<"tenants">; memberId: Id<"members"> },
  args: WriteAuditArgs,
): Promise<Id<"clinicAuditEvents">> {
  return await ctx.db.insert("clinicAuditEvents", {
    tenantId: ctx.tenantId,
    actorMemberId: args.actorMemberId ?? ctx.memberId,
    actorKind: args.actorKind ?? "member",
    action: args.action,
    targetType: args.targetType,
    targetId: args.targetId,
    payload: args.payload,
    createdAt: args.now ?? Date.now(),
  });
}
