import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import {
  outboundJobSettleStatusValidator,
  outboundJobTargetValidator,
  outboundJobValidator,
} from "./lib/outboundJobs";
import {
  loadRecipientDispatchTarget,
  settleRecipientDispatch,
} from "./lib/channelCampaignEngine";
import { loadFollowUpDispatchTarget, settleFollowUpDispatch } from "./lib/followUpEngine";

/**
 * Router between `iaSolutionHub.dispatchOutboundJob` (the only place that
 * talks to the provider) and the modules that own each job kind. Returning
 * null means "do not send": the job was cancelled, paused or already done.
 */
export const loadJob = internalQuery({
  args: { job: outboundJobValidator },
  returns: v.union(outboundJobTargetValidator, v.null()),
  handler: async (ctx, args) => {
    switch (args.job.kind) {
      case "campaign_recipient":
        return await loadRecipientDispatchTarget(ctx, args.job.recipientId);
      case "follow_up":
        return await loadFollowUpDispatchTarget(ctx, args.job.taskId);
    }
  },
});

export const settleJob = internalMutation({
  args: {
    job: outboundJobValidator,
    status: outboundJobSettleStatusValidator,
    outboxId: v.optional(v.id("channelOutbox")),
    providerMessageId: v.optional(v.string()),
    failureReason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    switch (args.job.kind) {
      case "campaign_recipient":
        await settleRecipientDispatch(ctx, {
          recipientId: args.job.recipientId,
          status: args.status,
          outboxId: args.outboxId,
          providerMessageId: args.providerMessageId,
          failureReason: args.failureReason,
        });
        return null;
      case "follow_up":
        await settleFollowUpDispatch(ctx, {
          taskId: args.job.taskId,
          status: args.status,
          outboxId: args.outboxId,
          providerMessageId: args.providerMessageId,
          failureReason: args.failureReason,
        });
        return null;
    }
  },
});
