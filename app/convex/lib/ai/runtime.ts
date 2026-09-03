import type { Doc, Id } from "../../_generated/dataModel";
import { extractErrorCode, recordThreadSystemEvent } from "../channels/systemEvents";
import { upsertOpsAlert } from "../opsAlerts";

/** Target for `iaSolutionHub.dispatchOutboundJob` (kind ai_reply). */
export async function loadAiReplyTarget(
  ctx: { db: any },
  turnId: Id<"aiTurns">,
): Promise<{
  tenantId: Id<"tenants">;
  memberId: Id<"members">;
  channelId: Id<"channels">;
  threadKey: string;
  clientNonce: string;
  messageKind: "text" | "template";
  payload: unknown;
} | null> {
  const turn = (await ctx.db.get(turnId)) as Doc<"aiTurns"> | null;
  if (!turn || turn.status !== "awaiting_send") return null;
  const run = (await ctx.db.get(turn.runId)) as Doc<"aiRuns"> | null;
  const thread = (await ctx.db.get(turn.threadId)) as Doc<"channelThreads"> | null;
  if (!run || !thread || thread.automationMode === "stopped") return null;
  // A handoff reply is the one AI message allowed after the thread moved to the team.
  const handoffReply = run.status === "handed_off" && turn.stage === "handoff";
  if (thread.automationMode === "human" && !handoffReply) return null;
  if (run.status !== "active" && !handoffReply) return null;
  const version = (await ctx.db.get(run.versionId)) as Doc<"aiAgentVersions"> | null;
  if (!version) return null;
  const pending = turn.routerDecision as { reply?: { kind: "text"; text: string } | { kind: "template"; templateName: string; languageCode: string; bodyVariables: string[] } } | undefined;
  const reply = pending?.reply;
  if (!reply) return null;
  return {
    tenantId: turn.tenantId,
    memberId: version.publishedBy,
    channelId: thread.channelId,
    threadKey: thread.threadKey,
    clientNonce: `ai:${turn._id}:reply`,
    messageKind: reply.kind,
    payload: reply.kind === "text" ? { text: reply.text } : { templateName: reply.templateName, languageCode: reply.languageCode, bodyVariables: reply.bodyVariables },
  };
}

export async function settleAiReply(
  ctx: { db: any },
  args: {
    turnId: Id<"aiTurns">;
    status: "accepted" | "failed" | "unknown";
    outboxId?: Id<"channelOutbox">;
    providerMessageId?: string;
    failureReason?: string;
  },
): Promise<void> {
  const turn = (await ctx.db.get(args.turnId)) as Doc<"aiTurns"> | null;
  if (!turn || turn.status !== "awaiting_send") return;
  const run = (await ctx.db.get(turn.runId)) as Doc<"aiRuns"> | null;
  const thread = (await ctx.db.get(turn.threadId)) as Doc<"channelThreads"> | null;
  const now = Date.now();
  const reason = args.failureReason?.slice(0, 500);

  if (args.status === "accepted" || args.status === "unknown") {
    await ctx.db.patch(turn._id, {
      status: "completed",
      outboxId: args.outboxId,
      providerMessageId: args.providerMessageId,
      failureCode: args.status === "unknown" ? "OUTBOX_UNKNOWN" : undefined,
      completedAt: now,
      updatedAt: now,
    });
    if (run) {
      await ctx.db.patch(run._id, { turnsCount: run.turnsCount + 1, lastTurnAt: now, updatedAt: now });
    }
    if (thread) {
      await recordThreadSystemEvent(ctx, {
        thread,
        kind: "ai.replied",
        severity: "info",
        actorType: "automation",
        payload: { turnId: turn._id, stage: turn.stage, toolCalls: turn.toolCallCount, unknown: args.status === "unknown" },
        dedupeKey: `aiturn:${turn._id}:replied`,
        now,
      });
      if (turn.stage === "handoff" || run?.status === "handed_off") {
        await ctx.db.patch(thread._id, { nextStep: "Equipa humana precisa continuar esta conversa.", nextStepDueAt: now, updatedAt: now });
      }
    }
    return;
  }

  const code = extractErrorCode(reason) ?? "SEND_FAILED";
  await ctx.db.patch(turn._id, { status: "failed", outboxId: args.outboxId, failureCode: code, failureReason: reason, completedAt: now, updatedAt: now });
  if (run && run.status === "active") {
    await ctx.db.patch(run._id, { status: "paused", pausedReason: `outbound_failed:${code}`, updatedAt: now });
  }
  if (thread) {
    await recordThreadSystemEvent(ctx, {
      thread,
      kind: "ai.failed",
      severity: "error",
      code,
      actorType: "automation",
      payload: { turnId: turn._id, reason: reason?.slice(0, 160) },
      dedupeKey: `aiturn:${turn._id}:failed`,
      now,
    });
    if (code === "RECIPIENT_NOT_ALLOWLISTED") {
      await recordThreadSystemEvent(ctx, {
        thread,
        kind: "pilot.recipient_not_allowlisted",
        severity: "warning",
        code,
        actorType: "system",
        dedupeKey: `pilot:${thread._id}:not_allowlisted`,
        now,
      });
      await ctx.db.patch(thread._id, { pilotBlockedAt: now, updatedAt: now });
    }
    await ctx.db.patch(thread._id, {
      automationMode: "human",
      automationChangedAt: now,
      automationChangeReason: `ai_outbound_failed:${code}`.slice(0, 200),
      nextStep: "A IA não conseguiu enviar a resposta. Responder manualmente.",
      nextStepDueAt: now,
      updatedAt: now,
    });
    await upsertOpsAlert(ctx, {
      tenantId: turn.tenantId,
      kind: "ai.provider_down",
      businessKey: `ai:send_failed:${thread._id}`,
      severity: "warn",
      title: `Resposta da IA não enviada (${code}).`,
      payload: { turnId: turn._id, code },
      href: `/app/channel-inbox/${thread.threadKey}?channel=${thread.channelId}`,
      reopen: true,
      now,
    });
  }
}
