import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { writeAudit } from "./lib/audit";
import { effectiveAiMode } from "./lib/ai/control";
import { executeAiTool } from "./lib/ai/tools";
import { recordThreadSystemEvent } from "./lib/channels/systemEvents";
import { derivePreview } from "./lib/channels/projection";
import { loadByIdInTenant, requireCapability, tenantMutation, tenantQuery } from "./lib/customFunctions";

const actionValidator = v.object({ index: v.number(), name: v.string(), input: v.any(), output: v.any() });

const pendingValidator = v.union(
  v.object({
    turnId: v.id("aiTurns"),
    agentName: v.string(),
    stage: v.string(),
    text: v.string(),
    routerIntent: v.optional(v.string()),
    actions: v.array(actionValidator),
    violations: v.array(v.string()),
    createdAt: v.number(),
  }),
  v.null(),
);

async function latestPending(ctx: { db: any }, threadId: Id<"channelThreads">): Promise<Doc<"aiTurns"> | null> {
  const rows = (await ctx.db
    .query("aiTurns")
    .withIndex("by_thread_status", (q: any) => q.eq("threadId", threadId).eq("status", "awaiting_approval"))
    .order("desc")
    .take(1)) as Doc<"aiTurns">[];
  return rows[0] ?? null;
}

async function patientTextFor(ctx: { db: any }, turn: Doc<"aiTurns">, thread: Doc<"channelThreads">): Promise<string> {
  if (turn.sourceEventId) {
    const event = (await ctx.db.get(turn.sourceEventId)) as Doc<"channelEvents"> | null;
    if (event) return derivePreview(event.payload) ?? "";
  }
  return thread.lastPreview ?? "";
}

/** The suggestion waiting in the inbox composer for this conversation. */
export const pendingForThread = tenantQuery({
  args: { threadId: v.id("channelThreads") },
  returns: pendingValidator,
  handler: async (ctx, args) => {
    const thread = await loadByIdInTenant(ctx, "channelThreads", args.threadId);
    const turn = await latestPending(ctx, thread._id);
    if (!turn) return null;
    const run = await ctx.db.get(turn.runId);
    const agent = run ? await ctx.db.get(run.agentId) : null;
    const decision = (turn.routerDecision ?? {}) as { intent?: string; violations?: string[] };
    const actions = ((turn.proposedActions as Array<{ name: string; input: unknown; output: unknown }> | undefined) ?? []).map((a, index) => ({ index, name: a.name, input: a.input ?? {}, output: a.output ?? null }));
    return { turnId: turn._id, agentName: agent?.name ?? "IA", stage: turn.stage ?? "reply", text: turn.suggestedText ?? "", routerIntent: decision.intent, actions, violations: decision.violations ?? [], createdAt: turn.createdAt };
  },
});

/**
 * Approve (optionally edited) and send. Approved write actions run for real
 * here, with the operator as actor; the reply then goes through the same
 * outbox job as autopilot replies. Edits become calibration examples.
 */
export const approve = tenantMutation({
  args: { turnId: v.id("aiTurns"), text: v.string(), approvedActionIndexes: v.array(v.number()) },
  returns: v.object({ sent: v.boolean(), actions: v.array(v.object({ name: v.string(), status: v.string(), errorCode: v.optional(v.string()) })) }),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "messages.send");
    const turn = await loadByIdInTenant(ctx, "aiTurns", args.turnId);
    if (turn.status !== "awaiting_approval") throw new ConvexError({ code: "AI_SUGGESTION_NOT_PENDING" });
    const thread = await loadByIdInTenant(ctx, "channelThreads", turn.threadId);
    const run = await ctx.db.get(turn.runId);
    if (!run) throw new ConvexError({ code: "RUN_NOT_ACTIVE" });
    const version = await ctx.db.get(run.versionId);
    const text = args.text.trim().slice(0, 4_096);
    if (!text) throw new ConvexError({ code: "INVALID_TEXT" });
    const now = Date.now();
    const proposed = ((turn.proposedActions as Array<{ name: string; input: unknown }> | undefined) ?? []);
    const approvedNames: string[] = [];
    const rejectedNames: string[] = [];
    const results: Array<{ name: string; status: string; errorCode?: string }> = [];
    let handedOff = false;
    let templateQueued: { templateName: string; languageCode: string; bodyVariables: string[] } | undefined;
    const channel = await ctx.db.get(thread.channelId);
    const templates = channel
      ? ((await ctx.db.query("channelTemplates").withIndex("by_channel", (q) => q.eq("channelId", channel._id)).take(200)) as Doc<"channelTemplates">[])
      : [];
    for (const [index, action] of proposed.entries()) {
      if (!args.approvedActionIndexes.includes(index)) {
        rejectedNames.push(action.name);
        continue;
      }
      const outcome = await executeAiTool(
        {
          db: ctx.db,
          scheduler: ctx.scheduler,
          tenantId: ctx.tenantId,
          memberId: ctx.memberId,
          thread,
          turnId: turn._id,
          dryRun: false,
          allowedTools: version?.config.tools ?? [],
          approvedTemplates: templates.filter((t) => ["approved", "active"].includes(t.status.toLowerCase())).map((t) => ({ name: t.name, languageCode: t.languageCode })),
          now,
        },
        action.name,
        action.input,
      );
      results.push({ name: action.name, status: outcome.status, errorCode: outcome.errorCode });
      await ctx.db.insert("aiToolInvocations", {
        tenantId: ctx.tenantId,
        turnId: turn._id,
        runId: run._id,
        threadId: thread._id,
        name: action.name,
        businessKey: `approved:${turn._id}:${action.name}:${index}`,
        input: action.input ?? {},
        output: outcome.output,
        status: outcome.status,
        errorCode: outcome.errorCode,
        durationMs: Date.now() - now,
        createdAt: now,
      });
      if (outcome.status === "error" || outcome.status === "denied") {
        throw new ConvexError({ code: outcome.errorCode ?? "TOOL_FAILED", tool: action.name });
      }
      approvedNames.push(action.name);
      if (outcome.effects?.handedOff) handedOff = true;
      if (outcome.effects?.templateQueued) templateQueued = outcome.effects.templateQueued;
    }
    const patientText = await patientTextFor(ctx, turn, thread);
    const edited = text !== (turn.suggestedText ?? "").trim();
    await ctx.db.insert("aiFeedback", {
      tenantId: ctx.tenantId,
      agentId: run.agentId,
      versionId: run.versionId,
      turnId: turn._id,
      threadId: thread._id,
      patientText: patientText.slice(0, 1_000),
      suggestedText: (turn.suggestedText ?? "").slice(0, 2_000),
      finalText: text.slice(0, 2_000),
      outcome: edited ? "edited" : "approved",
      approvedActions: approvedNames,
      rejectedActions: rejectedNames,
      memberId: ctx.memberId,
      createdAt: now,
    });
    const fresh = (await ctx.db.get(thread._id)) as Doc<"channelThreads">;
    const windowOpen = !!fresh.serviceWindowExpiresAt && fresh.serviceWindowExpiresAt > now;
    const reply = templateQueued && !windowOpen ? { kind: "template" as const, ...templateQueued } : { kind: "text" as const, text };
    if (reply.kind === "text" && !windowOpen) throw new ConvexError({ code: "SERVICE_WINDOW_EXPIRED" });
    if (handedOff) await ctx.db.patch(run._id, { status: "handed_off", pausedReason: "copilot_handoff", updatedAt: now });
    await ctx.db.patch(turn._id, {
      status: "awaiting_send",
      stage: handedOff ? "handoff" : "copilot",
      routerDecision: { ...((turn.routerDecision as object) ?? {}), reply },
      replyText: reply.kind === "text" ? reply.text : undefined,
      editedText: edited ? text : undefined,
      approvedBy: ctx.memberId,
      approvedAt: now,
      toolCallCount: turn.toolCallCount + approvedNames.length,
      updatedAt: now,
    });
    await recordThreadSystemEvent(ctx, { thread: fresh, kind: "ai.approved", severity: "info", actorType: "member", actorMemberId: ctx.memberId, payload: { turnId: turn._id, edited, actions: approvedNames.join(",") }, dedupeKey: `aiturn:${turn._id}:approved`, now });
    await ctx.db.patch(thread._id, { nextStep: undefined, nextStepDueAt: undefined, updatedAt: now });
    await ctx.scheduler.runAfter(0, internal.iaSolutionHub.dispatchOutboundJob, { job: { kind: "ai_reply", turnId: turn._id } });
    await writeAudit(ctx, { action: "ai.suggestion.approved", targetType: "aiTurn", targetId: turn._id, payload: { edited, approvedActions: approvedNames, rejectedActions: rejectedNames } });
    return { sent: true, actions: results };
  },
});

export const discard = tenantMutation({
  args: { turnId: v.id("aiTurns"), reason: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "messages.send");
    const turn = await loadByIdInTenant(ctx, "aiTurns", args.turnId);
    if (turn.status !== "awaiting_approval") throw new ConvexError({ code: "AI_SUGGESTION_NOT_PENDING" });
    const thread = await loadByIdInTenant(ctx, "channelThreads", turn.threadId);
    const run = await ctx.db.get(turn.runId);
    const now = Date.now();
    await ctx.db.patch(turn._id, { status: "skipped", failureCode: "DISCARDED", failureReason: args.reason?.slice(0, 200), approvedBy: ctx.memberId, approvedAt: now, updatedAt: now });
    if (run) {
      await ctx.db.insert("aiFeedback", {
        tenantId: ctx.tenantId,
        agentId: run.agentId,
        versionId: run.versionId,
        turnId: turn._id,
        threadId: thread._id,
        patientText: (await patientTextFor(ctx, turn, thread)).slice(0, 1_000),
        suggestedText: (turn.suggestedText ?? "").slice(0, 2_000),
        finalText: "",
        outcome: "discarded",
        approvedActions: [],
        rejectedActions: ((turn.proposedActions as Array<{ name: string }> | undefined) ?? []).map((a) => a.name),
        memberId: ctx.memberId,
        createdAt: now,
      });
    }
    await recordThreadSystemEvent(ctx, { thread, kind: "ai.discarded", severity: "info", actorType: "member", actorMemberId: ctx.memberId, payload: { turnId: turn._id, reason: args.reason?.slice(0, 120) }, dedupeKey: `aiturn:${turn._id}:discarded`, now });
    await ctx.db.patch(thread._id, { nextStep: undefined, nextStepDueAt: undefined, updatedAt: now });
    return null;
  },
});

/** Ask the agent again (e.g. after the team changed the lead stage). */
export const regenerate = tenantMutation({
  args: { turnId: v.id("aiTurns") },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "messages.send");
    const turn = await loadByIdInTenant(ctx, "aiTurns", args.turnId);
    if (turn.status !== "awaiting_approval") throw new ConvexError({ code: "AI_SUGGESTION_NOT_PENDING" });
    await ctx.db.patch(turn._id, { status: "queued", suggestedText: undefined, proposedActions: undefined, updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.aiRuntime.processTurn, { turnId: turn._id });
    return null;
  },
});

/** Inbox toggle: copilot / autopilot for this conversation (null = follow the agent). */
export const setThreadMode = tenantMutation({
  args: { threadId: v.id("channelThreads"), mode: v.union(v.literal("copilot"), v.literal("autopilot"), v.null()) },
  returns: v.object({ effective: v.string() }),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "inbox.handoff");
    const thread = await loadByIdInTenant(ctx, "channelThreads", args.threadId);
    const now = Date.now();
    await ctx.db.patch(thread._id, { aiMode: args.mode ?? undefined, updatedAt: now });
    let agent: Doc<"aiAgents"> | null = null;
    for (const status of ["active", "paused", "handed_off"] as const) {
      const run = await ctx.db.query("aiRuns").withIndex("by_thread_status", (q) => q.eq("threadId", thread._id).eq("status", status)).first();
      if (run) {
        agent = await ctx.db.get(run.agentId);
        break;
      }
    }
    if (!agent) {
      const actives = await ctx.db.query("aiAgents").withIndex("by_tenant_channel_status", (q) => q.eq("tenantId", ctx.tenantId).eq("channelId", thread.channelId).eq("status", "active")).take(1);
      agent = actives[0] ?? null;
    }
    const effective = effectiveAiMode({ aiMode: args.mode ?? undefined }, agent);
    if (args.mode === "copilot" && thread.automationMode === "bot") {
      // Autopilot was answering; the team takes the wheel from now on.
      await ctx.db.patch(thread._id, { automationMode: "human", automationChangedAt: now, automationChangeReason: "copilot_mode", updatedAt: now });
    }
    await recordThreadSystemEvent(ctx, { thread, kind: "ai.mode_changed", severity: "info", actorType: "member", actorMemberId: ctx.memberId, payload: { mode: args.mode ?? "agent_default", effective }, dedupeKey: `ai:mode:${thread._id}:${now}`, now });
    await writeAudit(ctx, { action: "ai.thread_mode_changed", targetType: "channelThread", targetId: thread._id, payload: { mode: args.mode, effective } });
    return { effective };
  },
});

const feedbackRowValidator = v.object({
  _id: v.id("aiFeedback"),
  patientText: v.string(),
  suggestedText: v.string(),
  finalText: v.string(),
  outcome: v.string(),
  approvedActions: v.array(v.string()),
  rejectedActions: v.array(v.string()),
  createdAt: v.number(),
});

export const listFeedback = tenantQuery({
  args: { agentId: v.id("aiAgents"), paginationOpts: paginationOptsValidator },
  returns: v.object({ page: v.array(feedbackRowValidator), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "ai.view_runs");
    const agent = await loadByIdInTenant(ctx, "aiAgents", args.agentId);
    const result = await ctx.db
      .query("aiFeedback")
      .withIndex("by_agent_created", (q) => q.eq("agentId", agent._id))
      .order("desc")
      .paginate({ cursor: args.paginationOpts.cursor, numItems: Math.min(Math.max(args.paginationOpts.numItems, 1), 50) });
    return {
      page: result.page.map((row) => ({ _id: row._id, patientText: row.patientText, suggestedText: row.suggestedText, finalText: row.finalText, outcome: row.outcome, approvedActions: row.approvedActions, rejectedActions: row.rejectedActions, createdAt: row.createdAt })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const feedbackStats = tenantQuery({
  args: { agentId: v.id("aiAgents") },
  returns: v.object({ approved: v.number(), edited: v.number(), discarded: v.number(), examples: v.number(), sampled: v.boolean() }),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "ai.view_runs");
    const agent = await loadByIdInTenant(ctx, "aiAgents", args.agentId);
    const rows = (await ctx.db.query("aiFeedback").withIndex("by_agent_created", (q) => q.eq("agentId", agent._id)).order("desc").take(501)) as Doc<"aiFeedback">[];
    const sample = rows.slice(0, 500);
    return {
      approved: sample.filter((r) => r.outcome === "approved").length,
      edited: sample.filter((r) => r.outcome === "edited").length,
      discarded: sample.filter((r) => r.outcome === "discarded").length,
      examples: Math.min(8, sample.filter((r) => r.outcome !== "discarded" && r.finalText.trim()).length),
      sampled: rows.length > 500,
    };
  },
});

export const removeFeedback = tenantMutation({
  args: { feedbackId: v.id("aiFeedback") },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "ai.configure");
    const row = await loadByIdInTenant(ctx, "aiFeedback", args.feedbackId);
    await ctx.db.delete(row._id);
    await writeAudit(ctx, { action: "ai.feedback.removed", targetType: "aiFeedback", targetId: row._id });
    return null;
  },
});
