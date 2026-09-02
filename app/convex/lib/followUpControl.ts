import type { Doc, Id } from "../_generated/dataModel";
import { recordThreadSystemEvent } from "./channels/systemEvents";

export type FollowUpStopReason =
  | "patient_replied"
  | "opt_out"
  | "dnd"
  | "thread_closed"
  | "confirmed"
  | "cancelled"
  | "rescheduled"
  | "manual"
  | "human_case_open";

/**
 * Stop every pending follow-up on a thread. Called when the patient replies
 * or opts out, when the team sets DND or stops manually, and when the
 * appointment the notice refers to changes. Idempotent.
 */
export async function stopThreadFollowUps(
  ctx: { db: any },
  args: {
    thread: Doc<"channelThreads">;
    reason: FollowUpStopReason;
    now: number;
    actorMemberId?: Id<"members">;
  },
): Promise<number> {
  let stopped = 0;
  for (const status of ["scheduled", "claimed"] as const) {
    const tasks = (await ctx.db
      .query("followUpTasks")
      .withIndex("by_thread_status", (q: any) =>
        q.eq("tenantId", args.thread.tenantId).eq("threadId", args.thread._id).eq("status", status),
      )
      .take(20)) as Doc<"followUpTasks">[];
    for (const task of tasks) {
      await ctx.db.patch(task._id, {
        status: "stopped",
        stoppedReason: args.reason,
        updatedAt: args.now,
      });
      stopped += 1;
    }
  }
  if (stopped > 0) {
    await recordThreadSystemEvent(ctx, {
      thread: args.thread,
      kind: "followup.stopped",
      severity: "info",
      actorType: args.actorMemberId ? "member" : "system",
      actorMemberId: args.actorMemberId,
      payload: { reason: args.reason, count: stopped },
      dedupeKey: `followup:stop:${args.thread._id}:${args.reason}:${args.now}`,
      now: args.now,
    });
  }
  return stopped;
}
