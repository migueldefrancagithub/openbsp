import { ConvexError } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import { writeAudit } from "../audit";
import { recordThreadSystemEvent } from "../channels/systemEvents";

export type AiMode = "sandbox" | "copilot" | "autopilot";

/** Conversation override wins; otherwise the agent's mode; copilot by default. */
export function effectiveAiMode(thread: Pick<Doc<"channelThreads">, "aiMode">, agent: Pick<Doc<"aiAgents">, "mode"> | null): AiMode {
  if (thread.aiMode) return thread.aiMode;
  return agent?.mode ?? "copilot";
}

/**
 * A human takes over. Autopilot: pause the run and drop unsent turns.
 * Copilot: the human is expected to talk; only a pending suggestion for the
 * message just answered is retired.
 */
export async function pauseAiRun(
  ctx: { db: any },
  thread: Doc<"channelThreads">,
  reason: string,
  now: number,
): Promise<Id<"aiRuns"> | null> {
  const aiRun = (await ctx.db
    .query("aiRuns")
    .withIndex("by_thread_status", (q: any) => q.eq("threadId", thread._id).eq("status", "active"))
    .first()) as Doc<"aiRuns"> | null;
  if (!aiRun) return null;
  const agent = (await ctx.db.get(aiRun.agentId)) as Doc<"aiAgents"> | null;
  const recent = (await ctx.db
    .query("aiTurns")
    .withIndex("by_run", (q: any) => q.eq("runId", aiRun._id))
    .order("desc")
    .take(5)) as Doc<"aiTurns">[];
  if (effectiveAiMode(thread, agent) === "copilot") {
    for (const turn of recent) {
      if (turn.status === "awaiting_approval") {
        await ctx.db.patch(turn._id, { status: "skipped", failureCode: "HUMAN_REPLIED", updatedAt: now });
      }
    }
    return null;
  }
  await ctx.db.patch(aiRun._id, { status: "paused", pausedReason: reason, updatedAt: now });
  for (const turn of recent) {
    if (turn.status === "queued" || turn.status === "awaiting_send" || turn.status === "awaiting_approval") {
      await ctx.db.patch(turn._id, { status: "skipped", failureCode: "HUMAN_TAKEOVER", updatedAt: now });
    }
  }
  await recordThreadSystemEvent(ctx, {
    thread,
    kind: "ai.paused",
    severity: "info",
    code: reason,
    actorType: "system",
    dedupeKey: `airun:${aiRun._id}:paused:${now}`,
    now,
  });
  return aiRun._id;
}

/**
 * Hand the conversation back to the AI. Refused while a human case is open.
 * Leaves an internal note summarising what happened while it was paused so
 * the next AI turn (which reads the message history) and the team agree.
 */
export async function resumeAiRun(
  ctx: { db: any; tenantId: Id<"tenants">; memberId: Id<"members">; role?: string },
  args: { thread: Doc<"channelThreads">; now: number },
): Promise<{ resumed: boolean; runId?: Id<"aiRuns"> }> {
  const { thread, now } = args;
  if (thread.openHumanCaseId) {
    const open = (await ctx.db.get(thread.openHumanCaseId)) as Doc<"humanCases"> | null;
    if (open && open.status !== "resolved") throw new ConvexError({ code: "HUMAN_CASE_OPEN" });
  }
  let run: Doc<"aiRuns"> | null = null;
  for (const status of ["paused", "handed_off"] as const) {
    run = (await ctx.db
      .query("aiRuns")
      .withIndex("by_thread_status", (q: any) => q.eq("threadId", thread._id).eq("status", status))
      .first()) as Doc<"aiRuns"> | null;
    if (run) break;
  }
  if (!run) return { resumed: false };
  const agent = (await ctx.db.get(run.agentId)) as Doc<"aiAgents"> | null;
  if (!agent || agent.status !== "active" || !agent.publishedVersionId) return { resumed: false };
  const summary = await buildHandbackSummary(ctx, run, thread, now);
  await ctx.db.patch(run._id, { status: "active", versionId: agent.publishedVersionId, pausedReason: undefined, updatedAt: now });
  await ctx.db.insert("threadInternalNotes", {
    tenantId: ctx.tenantId,
    threadId: thread._id,
    body: summary,
    mentionedMemberIds: [],
    createdBy: ctx.memberId,
    createdAt: now,
    updatedAt: now,
  });
  await recordThreadSystemEvent(ctx, {
    thread,
    kind: "ai.resumed",
    severity: "info",
    actorType: "member",
    actorMemberId: ctx.memberId,
    payload: { runId: run._id, agentName: agent.name },
    dedupeKey: `airun:${run._id}:resumed:${now}`,
    now,
  });
  await writeAudit(ctx, { action: "ai.run.resumed", targetType: "channelThread", targetId: thread._id, payload: { runId: run._id, previousReason: run.pausedReason }, now });
  return { resumed: true, runId: run._id };
}

async function buildHandbackSummary(ctx: { db: any }, run: Doc<"aiRuns">, thread: Doc<"channelThreads">, now: number): Promise<string> {
  const turns = (await ctx.db
    .query("aiTurns")
    .withIndex("by_run", (q: any) => q.eq("runId", run._id))
    .order("desc")
    .take(10)) as Doc<"aiTurns">[];
  const completed = turns.filter((t) => t.status === "completed").length;
  const tools = turns.reduce((sum, t) => sum + t.toolCallCount, 0);
  const lastReply = turns.find((t) => t.replyText)?.replyText;
  const pausedFor = run.updatedAt ? Math.max(0, Math.round((now - run.updatedAt) / 60_000)) : 0;
  return [
    `IA retomada. Esteve em pausa ${pausedFor} min (${run.pausedReason ?? "sem motivo registado"}).`,
    `Nesta conversa: ${completed} resposta(s) automática(s), ${tools} ação(ões) de ferramenta.`,
    thread.leadStatus ? `Etapa atual: ${thread.leadStatus}.` : "",
    lastReply ? `Última resposta da IA: "${lastReply.slice(0, 160)}"` : "",
    "A IA vai ler as mensagens trocadas entretanto antes de responder.",
  ]
    .filter(Boolean)
    .join("\n");
}
