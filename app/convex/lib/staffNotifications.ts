import type { Id } from "../_generated/dataModel";

export type StaffResult =
  | { status: "queued"; deliveryId: Id<"staffNotificationDeliveries"> }
  | { status: "connection_missing" | "recipient_missing" | "recipient_disabled" };

/**
 * Queue an internal staff briefing. This never writes to the customer outbox:
 * the UAZAPI adapter is intentionally a separate transport and recipient set.
 */
export async function queueStaffBriefing(
  ctx: { db: any; scheduler?: any },
  args: {
    tenantId: Id<"tenants">;
    decisionId: Id<"agentDecisions">;
    memberId: Id<"members">;
    businessKey: string;
    text: string;
    now?: number;
  },
): Promise<StaffResult> {
  const now = args.now ?? Date.now();
  const connection = await ctx.db
    .query("staffNotificationConnections")
    .withIndex("by_tenant_provider", (q: any) =>
      q.eq("tenantId", args.tenantId).eq("provider", "uazapi"),
    )
    .unique();
  if (!connection || !connection.active || connection.pausedAt) {
    return { status: "connection_missing" };
  }
  const profile = await ctx.db
    .query("memberOperationalProfiles")
    .withIndex("by_tenant_member", (q: any) =>
      q.eq("tenantId", args.tenantId).eq("memberId", args.memberId),
    )
    .unique();
  if (!profile?.phoneE164) return { status: "recipient_missing" };
  if (!profile.active || !profile.receivesWhatsappBriefings) {
    return { status: "recipient_disabled" };
  }
  const existing = await ctx.db
    .query("staffNotificationDeliveries")
    .withIndex("by_tenant_business_key", (q: any) =>
      q.eq("tenantId", args.tenantId).eq("businessKey", args.businessKey),
    )
    .unique();
  if (existing) return { status: "queued", deliveryId: existing._id };
  const deliveryId = (await ctx.db.insert("staffNotificationDeliveries", {
    tenantId: args.tenantId,
    connectionId: connection._id,
    decisionId: args.decisionId,
    memberId: args.memberId,
    recipientE164: profile.phoneE164,
    text: args.text.slice(0, 4_000),
    businessKey: args.businessKey,
    status: "pending",
    attempts: 0,
    nextAttemptAt: now,
    createdAt: now,
    updatedAt: now,
  })) as Id<"staffNotificationDeliveries">;
  return { status: "queued", deliveryId };
}
