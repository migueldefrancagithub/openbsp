import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { sha256Hex } from "./lib/idempotency";
import { executeAiTool } from "./lib/ai/tools";
import { loadByIdInTenant, requireCapability, tenantQuery } from "./lib/customFunctions";

const outcomeValidator = v.object({
  status: v.union(v.literal("ok"), v.literal("error"), v.literal("denied"), v.literal("dry_run")),
  output: v.any(),
  errorCode: v.optional(v.string()),
  effects: v.optional(v.any()),
  replayed: v.boolean(),
});

/**
 * Real tool execution for a turn. Idempotent per turn + tool + input hash:
 * a retried step returns the stored verdict instead of booking twice.
 */
export const invoke = internalMutation({
  args: {
    turnId: v.id("aiTurns"),
    name: v.string(),
    input: v.any(),
  },
  returns: outcomeValidator,
  handler: async (ctx, args) => {
    const turn = (await ctx.db.get(args.turnId)) as Doc<"aiTurns"> | null;
    if (!turn) return { status: "denied" as const, output: { error: "TURN_NOT_FOUND" }, errorCode: "TURN_NOT_FOUND", replayed: false };
    const run = (await ctx.db.get(turn.runId)) as Doc<"aiRuns"> | null;
    const thread = (await ctx.db.get(turn.threadId)) as Doc<"channelThreads"> | null;
    if (!run || !thread || run.status !== "active") {
      return { status: "denied" as const, output: { error: "RUN_NOT_ACTIVE" }, errorCode: "RUN_NOT_ACTIVE", replayed: false };
    }
    const inputHash = (await sha256Hex(JSON.stringify(args.input ?? {}))).slice(0, 24);
    const businessKey = `tool:${turn._id}:${args.name}:${inputHash}`;
    const existing = (await ctx.db
      .query("aiToolInvocations")
      .withIndex("by_tenant_business_key", (q) => q.eq("tenantId", turn.tenantId).eq("businessKey", businessKey))
      .unique()) as Doc<"aiToolInvocations"> | null;
    if (existing) {
      return { status: existing.status, output: existing.output ?? null, errorCode: existing.errorCode, effects: (existing.output as { _effects?: unknown } | null)?._effects, replayed: true };
    }
    const version = (await ctx.db.get(run.versionId)) as Doc<"aiAgentVersions"> | null;
    const agent = (await ctx.db.get(run.agentId)) as Doc<"aiAgents"> | null;
    const channel = (await ctx.db.get(thread.channelId)) as Doc<"channels"> | null;
    const templates = channel
      ? ((await ctx.db
          .query("channelTemplates")
          .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
          .take(200)) as Doc<"channelTemplates">[])
      : [];
    const started = Date.now();
    const outcome = await executeAiTool(
      {
        db: ctx.db,
        scheduler: ctx.scheduler,
        tenantId: turn.tenantId,
        memberId: version?.publishedBy ?? agent?.createdBy ?? run.tenantId as unknown as Id<"members">,
        thread,
        turnId: turn._id,
        dryRun: false,
        allowedTools: version?.config.tools ?? [],
        approvedTemplates: templates.filter((t) => ["approved", "active"].includes(t.status.toLowerCase())).map((t) => ({ name: t.name, languageCode: t.languageCode })),
        now: started,
      },
      args.name,
      args.input,
    );
    await ctx.db.insert("aiToolInvocations", {
      tenantId: turn.tenantId,
      turnId: turn._id,
      runId: run._id,
      threadId: thread._id,
      name: args.name,
      businessKey,
      input: args.input ?? {},
      output: outcome.effects ? { ...(typeof outcome.output === "object" && outcome.output ? (outcome.output as object) : { value: outcome.output }), _effects: outcome.effects } : outcome.output,
      status: outcome.status,
      errorCode: outcome.errorCode,
      durationMs: Date.now() - started,
      createdAt: started,
    });
    await ctx.db.patch(turn._id, { toolCallCount: turn.toolCallCount + 1, updatedAt: Date.now() });
    return { ...outcome, replayed: false };
  },
});

/** Sandbox: same code path, no writes, no persistence. */
export const dryRun = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    memberId: v.id("members"),
    threadId: v.optional(v.id("channelThreads")),
    allowedTools: v.array(v.string()),
    name: v.string(),
    input: v.any(),
  },
  returns: outcomeValidator,
  handler: async (ctx, args) => {
    const thread = args.threadId ? ((await ctx.db.get(args.threadId)) as Doc<"channelThreads"> | null) : null;
    const fakeThread = thread ?? ({
      _id: "sandbox" as Id<"channelThreads">,
      _creationTime: Date.now(),
      tenantId: args.tenantId,
      channelId: "sandbox" as Id<"channels">,
      threadKey: "sandbox",
      lastEventAt: Date.now(),
      lastEventKind: "message.text",
      unreadCount: 0,
      leadStatus: "interested",
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as unknown as Doc<"channelThreads">);
    const outcome = await executeAiTool(
      {
        db: ctx.db,
        tenantId: args.tenantId,
        memberId: args.memberId,
        thread: fakeThread,
        dryRun: true,
        allowedTools: args.allowedTools,
        approvedTemplates: [],
        now: Date.now(),
      },
      args.name,
      args.input,
    );
    return { ...outcome, replayed: false };
  },
});

export const listForTurn = tenantQuery({
  args: { turnId: v.id("aiTurns") },
  returns: v.array(
    v.object({
      _id: v.id("aiToolInvocations"),
      name: v.string(),
      status: v.string(),
      errorCode: v.optional(v.string()),
      input: v.any(),
      output: v.any(),
      durationMs: v.number(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "ai.view_runs");
    const turn = await loadByIdInTenant(ctx, "aiTurns", args.turnId);
    const rows = (await ctx.db
      .query("aiToolInvocations")
      .withIndex("by_turn", (q) => q.eq("turnId", turn._id))
      .take(50)) as Doc<"aiToolInvocations">[];
    return rows.map((row) => ({ _id: row._id, name: row.name, status: row.status, errorCode: row.errorCode, input: row.input, output: row.output, durationMs: row.durationMs, createdAt: row.createdAt }));
  },
});
