import type { Doc, Id } from "../../_generated/dataModel";

/**
 * Stop whatever automation is currently driving a thread. Used when a human
 * takes over (operator reply, human case) so an in-flight dispatch can never
 * resume the flow: `channelAutomation.settleDispatch` only advances runs that
 * are still `active`.
 */
export async function stopActiveAutomationRun(
  ctx: { db: any },
  thread: Pick<Doc<"channelThreads">, "_id" | "channelId">,
  reason: string,
  now: number = Date.now(),
): Promise<Id<"channelAutomationRuns"> | null> {
  const run = (await ctx.db
    .query("channelAutomationRuns")
    .withIndex("by_thread_status", (q: any) =>
      q
        .eq("channelId", thread.channelId)
        .eq("threadId", thread._id)
        .eq("status", "active"),
    )
    .first()) as Doc<"channelAutomationRuns"> | null;
  if (!run) return null;
  await ctx.db.patch(run._id, {
    status: "stopped",
    pendingDispatchId: undefined,
    endedAt: now,
    endReason: reason.slice(0, 200),
    lastAdvancedAt: now,
  });
  await ctx.db.insert("channelAutomationEvents", {
    tenantId: run.tenantId,
    chatbotId: run.chatbotId,
    runId: run._id,
    channelId: run.channelId,
    threadId: run.threadId,
    eventType: "stopped",
    nodeKey: run.currentNodeKey,
    payload: { reason },
    createdAt: now,
  });
  return run._id;
}

export async function setThreadAutomationMode(
  ctx: { db: any },
  thread: Pick<Doc<"channelThreads">, "_id">,
  mode: "idle" | "bot" | "human" | "stopped",
  reason: string,
  now: number = Date.now(),
): Promise<void> {
  await ctx.db.patch(thread._id, {
    automationMode: mode,
    automationChangedAt: now,
    automationChangeReason: reason.slice(0, 200),
    updatedAt: now,
  });
}
