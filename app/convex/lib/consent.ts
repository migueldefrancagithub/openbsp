import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

/**
 * Bounds for the opt-out path. A patient who asks to stop must be honoured
 * inside one mutation, so the read is capped rather than left to grow with the
 * conversation history.
 */
export const MAX_CONSENT_CONVERSATIONS = 200;
export const MAX_CONSENT_MESSAGES = 100;

export type Purpose = "transactional" | "marketing" | "authentication";
export type ConsentStatus = "granted" | "revoked" | "unknown";

/**
 * Throw CONSENT_REQUIRED if no granted consent exists for this purpose.
 * Reads only from currentConsents — the single source of truth.
 */
export async function requireConsent(
  ctx: QueryCtx | MutationCtx,
  args: {
    tenantId: Id<"tenants">;
    contactId: Id<"contacts">;
    purpose: Purpose;
  },
): Promise<void> {
  const current = await ctx.db
    .query("currentConsents")
    .withIndex("by_tenant_contact_purpose_channel", (q) =>
      q
        .eq("tenantId", args.tenantId)
        .eq("contactId", args.contactId)
        .eq("purpose", args.purpose)
        .eq("channel", "whatsapp"),
    )
    .unique();
  if (!current || current.status !== "granted") {
    throw new ConvexError({
      code: "CONSENT_REQUIRED",
      purpose: args.purpose,
    });
  }
}

/**
 * Atomic transition: append immutable consentEvents row + upsert
 * currentConsents to point to it. If the new status is "revoked", caller
 * is responsible for cascading cancellations (cancelPendingForContact).
 */
export async function recordConsentTransition(
  ctx: MutationCtx,
  args: {
    tenantId: Id<"tenants">;
    contactId: Id<"contacts">;
    purpose: Purpose;
    newStatus: ConsentStatus;
    source: string;
    proofText?: string;
    proofVersion?: string;
    proofUrl?: string;
    capturedByMemberId?: Id<"members">;
    ipAddress?: string;
    userAgent?: string;
  },
): Promise<{ eventId: Id<"consentEvents">; currentId: Id<"currentConsents"> }> {
  const now = Date.now();
  const eventId = await ctx.db.insert("consentEvents", {
    tenantId: args.tenantId,
    contactId: args.contactId,
    purpose: args.purpose,
    channel: "whatsapp",
    newStatus: args.newStatus,
    source: args.source,
    proofText: args.proofText,
    proofVersion: args.proofVersion,
    proofUrl: args.proofUrl,
    capturedAt: now,
    capturedByMemberId: args.capturedByMemberId,
    ipAddress: args.ipAddress,
    userAgent: args.userAgent,
  });

  const existing = await ctx.db
    .query("currentConsents")
    .withIndex("by_tenant_contact_purpose_channel", (q) =>
      q
        .eq("tenantId", args.tenantId)
        .eq("contactId", args.contactId)
        .eq("purpose", args.purpose)
        .eq("channel", "whatsapp"),
    )
    .unique();

  let currentId: Id<"currentConsents">;
  if (existing) {
    await ctx.db.patch(existing._id, {
      status: args.newStatus,
      effectiveAt: now,
      lastEventId: eventId,
    });
    currentId = existing._id;
  } else {
    currentId = await ctx.db.insert("currentConsents", {
      tenantId: args.tenantId,
      contactId: args.contactId,
      purpose: args.purpose,
      channel: "whatsapp",
      status: args.newStatus,
      effectiveAt: now,
      lastEventId: eventId,
    });
  }

  return { eventId, currentId };
}

/**
 * After a revoke, sweep pending outbound work for this contact and mark it
 * as skipped_consent. Idempotent — safe to call multiple times.
 * Returns counts of items skipped per type.
 */
export async function cancelPendingForContact(
  ctx: MutationCtx,
  args: {
    tenantId: Id<"tenants">;
    contactId: Id<"contacts">;
  },
): Promise<{ messagesQueued: number }> {
  // Cancel queued outbound messages bound to this contact via conversation.
  // We need to find conversations for the contact, then queued messages.
  // Indexed by (tenant, contact): the previous read bound only the tenant and
  // filtered in JS, which is a full conversation scan inside the mutation an
  // inbound "stop" triggers. At a few thousand conversations it trips the read
  // limit and the opt-out fails silently — a compliance incident, not a slow
  // page.
  const conversations = await ctx.db
    .query("conversations")
    .withIndex("by_tenant_contact_lastmsg", (q) =>
      q.eq("tenantId", args.tenantId).eq("contactId", args.contactId),
    )
    .take(MAX_CONSENT_CONVERSATIONS);

  let messagesQueued = 0;
  for (const conv of conversations) {
    const queued = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conv._id))
      .filter((q) =>
        q.and(
          q.eq(q.field("direction"), "outgoing"),
          q.eq(q.field("status"), "queued"),
        ),
      )
      .take(MAX_CONSENT_MESSAGES);
    for (const msg of queued) {
      await ctx.db.patch(msg._id, {
        status: "failed",
        failureReason: "consent_revoked_pre_dispatch",
      });
      messagesQueued++;
    }
  }
  return { messagesQueued };
}
