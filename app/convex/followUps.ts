import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internalMutation } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { writeAudit } from "./lib/audit";
import { loadByIdInTenant, requireCapability, tenantMutation, tenantQuery } from "./lib/customFunctions";
import { stopThreadFollowUps } from "./lib/followUpControl";
import { claimDueFollowUps, releaseStaleClaims } from "./lib/followUpEngine";

/** Cron (1 min): claim due follow-ups and hand each one to the outbox bridge. */
export const runDue = internalMutation({
  args: {},
  returns: v.object({ claimed: v.number(), failed: v.number(), skipped: v.number() }),
  handler: async (ctx) => await claimDueFollowUps(ctx, Date.now()),
});

/** Cron (10 min): claims whose dispatch job vanished are requeued. */
export const sweepStaleClaims = internalMutation({
  args: {},
  returns: v.object({ released: v.number() }),
  handler: async (ctx) => ({ released: await releaseStaleClaims(ctx, Date.now()) }),
});

const taskRowValidator = v.object({
  _id: v.id("followUpTasks"),
  kind: v.string(),
  ruleName: v.optional(v.string()),
  message: v.optional(v.string()),
  appointmentId: v.optional(v.id("clinicAppointments")),
  status: v.string(),
  dueAt: v.number(),
  nextAttemptAt: v.optional(v.number()),
  attempts: v.number(),
  sentAt: v.optional(v.number()),
  stoppedReason: v.optional(v.string()),
  failureCode: v.optional(v.string()),
  updatedAt: v.number(),
});

async function rowOf(ctx: { db: any }, task: Doc<"followUpTasks">) {
  const rule = task.ruleId ? ((await ctx.db.get(task.ruleId)) as Doc<"followUpRules"> | null) : null;
  return {
    _id: task._id,
    kind: task.kind ?? "rule",
    ruleName: rule?.name,
    message: task.message,
    appointmentId: task.appointmentId,
    status: task.status,
    dueAt: task.dueAt,
    nextAttemptAt: task.nextAttemptAt,
    attempts: task.attempts,
    sentAt: task.sentAt,
    stoppedReason: task.stoppedReason,
    failureCode: task.failureCode,
    updatedAt: task.updatedAt,
  };
}

/** Pending first, then the most recent outcomes — bounded per status. */
export const listForThread = tenantQuery({
  args: { threadId: v.id("channelThreads") },
  returns: v.array(taskRowValidator),
  handler: async (ctx, args) => {
    const thread = await loadByIdInTenant(ctx, "channelThreads", args.threadId);
    const out = [];
    for (const status of ["scheduled", "claimed", "failed", "sent", "stopped"] as const) {
      const rows = (await ctx.db
        .query("followUpTasks")
        .withIndex("by_thread_status", (q) =>
          q.eq("tenantId", ctx.tenantId).eq("threadId", thread._id).eq("status", status),
        )
        .order("desc")
        .take(status === "scheduled" || status === "claimed" ? 10 : 3)) as Doc<"followUpTasks">[];
      for (const row of rows) out.push(await rowOf(ctx, row));
    }
    return out;
  },
});

export const stopTask = tenantMutation({
  args: { taskId: v.id("followUpTasks") },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "clinic.manage_agenda");
    const task = await loadByIdInTenant(ctx, "followUpTasks", args.taskId);
    if (task.status !== "scheduled" && task.status !== "claimed") {
      throw new ConvexError({ code: "FOLLOW_UP_TASK_NOT_ACTIVE" });
    }
    const now = Date.now();
    await ctx.db.patch(task._id, { status: "stopped", stoppedReason: "manual", updatedAt: now });
    await writeAudit(ctx, { action: "clinic.follow_up_task.stopped", targetType: "followUpTask", targetId: task._id });
    return null;
  },
});

/** Stop everything pending on a thread (used by the inbox "stop follow-ups"). */
export const stopForThread = tenantMutation({
  args: { threadId: v.id("channelThreads") },
  returns: v.object({ stopped: v.number() }),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "clinic.manage_agenda");
    const thread = await loadByIdInTenant(ctx, "channelThreads", args.threadId);
    const stopped = await stopThreadFollowUps(ctx, {
      thread,
      reason: "manual",
      now: Date.now(),
      actorMemberId: ctx.memberId,
    });
    await writeAudit(ctx, {
      action: "clinic.follow_up.stopped_for_thread",
      targetType: "channelThread",
      targetId: thread._id,
      payload: { stopped },
    });
    return { stopped };
  },
});

/** A failed task (not `unknown`) can be requeued once the cause is fixed. */
export const retryTask = tenantMutation({
  args: { taskId: v.id("followUpTasks") },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "clinic.manage_agenda");
    const task = await loadByIdInTenant(ctx, "followUpTasks", args.taskId);
    if (task.status !== "failed" || task.failureCode === "OUTBOX_UNKNOWN") {
      throw new ConvexError({ code: "FOLLOW_UP_NOT_RETRYABLE" });
    }
    const now = Date.now();
    await ctx.db.patch(task._id, {
      status: "scheduled",
      dueAt: now,
      nextAttemptAt: undefined,
      attempts: 0,
      failureCode: undefined,
      failureReason: undefined,
      updatedAt: now,
    });
    await writeAudit(ctx, { action: "clinic.follow_up_task.retried", targetType: "followUpTask", targetId: task._id });
    return null;
  },
});

/** Admin › Logs: recent tasks of the tenant, newest due first. */
export const listRecent = tenantQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(
      v.object({
        _id: v.id("followUpTasks"),
        kind: v.string(),
        threadKey: v.optional(v.string()),
        status: v.string(),
        dueAt: v.number(),
        attempts: v.number(),
        failureCode: v.optional(v.string()),
        stoppedReason: v.optional(v.string()),
      }),
    ),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "logs.read");
    const result = await ctx.db
      .query("followUpTasks")
      .withIndex("by_tenant_due", (q) => q.eq("tenantId", ctx.tenantId))
      .order("desc")
      .paginate({ cursor: args.paginationOpts.cursor, numItems: Math.min(Math.max(args.paginationOpts.numItems, 1), 100) });
    const page = [];
    for (const row of result.page) {
      const thread = row.threadId ? await ctx.db.get(row.threadId) : null;
      page.push({
        _id: row._id,
        kind: row.kind ?? "rule",
        threadKey: thread?.threadKey,
        status: row.status,
        dueAt: row.dueAt,
        attempts: row.attempts,
        failureCode: row.failureCode,
        stoppedReason: row.stoppedReason,
      });
    }
    return { page, isDone: result.isDone, continueCursor: result.continueCursor };
  },
});
