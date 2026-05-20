import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";

export type AiState = "eligible" | "paused" | "disabled";
export type AiAuditKind = "eligible" | "paused" | "blocked" | "drafted" | "approved";

type AiControlDb = {
  patch: any;
  insert: any;
};

type AiControlContext = {
  db: AiControlDb;
};

type ConversationForAi = Pick<
  Doc<"conversations">,
  | "_id"
  | "tenantId"
  | "contactId"
  | "leadSource"
  | "opportunityStatus"
  | "aiState"
  | "aiPausedReason"
>;

const PAUSING_OPPORTUNITY_STATUSES = new Set(["opportunity", "booked", "lost"]);

export function shouldPauseAiForOpportunityStatus(status: string): boolean {
  return PAUSING_OPPORTUNITY_STATUSES.has(status);
}

export function assertCanMakeAiEligible(
  conversation: ConversationForAi,
): void {
  if (conversation.leadSource !== "ctwa") {
    throw new ConvexError({
      code: "AI_NOT_CTWA_LEAD",
      message: "AI can only be made eligible for CTWA/ad leads by default.",
    });
  }
  if (
    conversation.opportunityStatus &&
    shouldPauseAiForOpportunityStatus(conversation.opportunityStatus)
  ) {
    throw new ConvexError({
      code: "AI_PAUSED_BY_OPPORTUNITY",
      status: conversation.opportunityStatus,
    });
  }
}

export async function recordAiAuditEvent(
  ctx: AiControlContext,
  args: {
    tenantId: Id<"tenants">;
    conversation: ConversationForAi;
    kind: AiAuditKind;
    reason?: string;
    payload?: unknown;
    createdBy?: Id<"members">;
    at?: number;
  },
): Promise<Id<"aiAuditEvents">> {
  return await ctx.db.insert("aiAuditEvents", {
    tenantId: args.tenantId,
    conversationId: args.conversation._id,
    contactId: args.conversation.contactId,
    kind: args.kind,
    reason: args.reason,
    payload: args.payload,
    createdBy: args.createdBy,
    createdAt: args.at ?? Date.now(),
  });
}

export async function applyAiTransition(
  ctx: AiControlContext,
  args: {
    tenantId: Id<"tenants">;
    conversation: ConversationForAi;
    state: AiState;
    reason?: string;
    payload?: unknown;
    createdBy?: Id<"members">;
    at?: number;
  },
): Promise<void> {
  if (args.state === "eligible") {
    assertCanMakeAiEligible(args.conversation);
  }

  await ctx.db.patch(args.conversation._id, {
    aiState: args.state,
    aiPausedReason: args.state === "paused" ? args.reason : undefined,
  });

  await recordAiAuditEvent(ctx, {
    tenantId: args.tenantId,
    conversation: args.conversation,
    kind:
      args.state === "eligible"
        ? "eligible"
        : args.state === "paused"
          ? "paused"
          : "blocked",
    reason: args.reason,
    payload: args.payload,
    createdBy: args.createdBy,
    at: args.at,
  });
}
