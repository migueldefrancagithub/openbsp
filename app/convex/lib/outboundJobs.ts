import { v } from "convex/values";

/**
 * A durable outbound job is anything the product sends without a human
 * pressing "send": campaign recipients (B2) and follow-up tasks (B5). The
 * Hub-side action `iaSolutionHub.dispatchOutboundJob` only knows this shape;
 * `outboundJobs.loadJob/settleJob` route to the owning module.
 */
export const outboundJobValidator = v.union(
  v.object({
    kind: v.literal("campaign_recipient"),
    recipientId: v.id("campaignRecipients"),
  }),
  v.object({
    kind: v.literal("follow_up"),
    taskId: v.id("followUpTasks"),
  }),
);

export const outboundJobTargetValidator = v.object({
  tenantId: v.id("tenants"),
  memberId: v.id("members"),
  channelId: v.id("channels"),
  threadKey: v.string(),
  /** Becomes the outbox businessKey (`hub:{kind}:{nonce}`); retries add a suffix. */
  clientNonce: v.string(),
  messageKind: v.union(v.literal("text"), v.literal("template")),
  payload: v.any(),
});

export const outboundJobSettleStatusValidator = v.union(
  v.literal("accepted"),
  v.literal("failed"),
  v.literal("unknown"),
);
