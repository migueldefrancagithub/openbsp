import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { writeAudit } from "./audit";
import { setThreadAutomationMode, stopActiveAutomationRun } from "./channels/automationControl";
import { recordThreadSystemEvent } from "./channels/systemEvents";

export const SLA_MINUTES_BY_URGENCY = { urgent: 30, high: 120, normal: 8 * 60, low: 24 * 60 } as const;
export type HumanCaseUrgency = keyof typeof SLA_MINUTES_BY_URGENCY;

export function slaMinutesFor(urgency: HumanCaseUrgency, override?: number): number {
  if (override !== undefined) return Math.min(2880, Math.max(15, Math.round(override)));
  return SLA_MINUTES_BY_URGENCY[urgency];
}

function assertLength(value: string, label: string, min: number, max: number) {
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) throw new ConvexError({ code: "INVALID_TEXT_LENGTH", label, min, max });
  return trimmed;
}

/**
 * Open a human case for a thread (idempotent while one is open). Shared by
 * the inbox/Operação mutation and the AI tool `abrir_caso_humano`: stops
 * keyword automations, parks the thread in `awaiting_human` and records the
 * system event with the right actor.
 */
export async function openHumanCaseInternal(
  ctx: { db: any; tenantId: Id<"tenants">; memberId: Id<"members">; role?: string },
  args: {
    thread: Doc<"channelThreads"> | null;
    reason: string;
    urgency: HumanCaseUrgency;
    question: string;
    responsibleMemberId?: Id<"members">;
    slaMinutes?: number;
    openedFrom: "inbox" | "operation" | "automation";
    actorKind: "member" | "ai" | "system";
    now?: number;
  },
): Promise<{ caseId: Id<"humanCases">; created: boolean }> {
  const { thread } = args;
  if (thread?.openHumanCaseId) {
    const existing = (await ctx.db.get(thread.openHumanCaseId)) as Doc<"humanCases"> | null;
    if (existing && existing.status !== "resolved") return { caseId: existing._id, created: false };
  }
  const now = args.now ?? Date.now();
  const slaMinutes = slaMinutesFor(args.urgency, args.slaMinutes);
  const slaDueAt = now + slaMinutes * 60_000;
  const caseId = (await ctx.db.insert("humanCases", {
    tenantId: ctx.tenantId,
    threadId: thread?._id,
    reason: assertLength(args.reason, "reason", 2, 80),
    urgency: args.urgency,
    question: assertLength(args.question, "question", 3, 2_000),
    status: args.responsibleMemberId ? "assigned" : "open",
    responsibleMemberId: args.responsibleMemberId,
    assignedAt: args.responsibleMemberId ? now : undefined,
    slaDueAt,
    previousLeadStatus: thread && thread.leadStatus !== "awaiting_human" ? thread.leadStatus : undefined,
    openedFrom: args.openedFrom,
    createdBy: ctx.memberId,
    createdAt: now,
    updatedAt: now,
  })) as Id<"humanCases">;
  if (thread) {
    await stopActiveAutomationRun(ctx, thread, "human_case_created", now);
    await ctx.db.patch(thread._id, {
      leadStatus: "awaiting_human",
      inboxStatus: "awaiting_team",
      openHumanCaseId: caseId,
      responsibleMemberId: args.responsibleMemberId ?? thread.responsibleMemberId,
      nextStep: "Equipa humana precisa decidir este caso antes da IA continuar.",
      nextStepDueAt: slaDueAt,
      updatedAt: now,
    });
    await setThreadAutomationMode(ctx, thread, "human", "human_case_created", now);
    await recordThreadSystemEvent(ctx, {
      thread,
      kind: "handoff.case_opened",
      severity: "warning",
      actorType: args.actorKind === "member" ? "member" : args.actorKind === "ai" ? "automation" : "system",
      actorMemberId: args.actorKind === "member" ? ctx.memberId : undefined,
      humanCaseId: caseId,
      payload: { urgency: args.urgency, slaDueAt, reason: args.reason.slice(0, 80), openedFrom: args.openedFrom },
      dedupeKey: `case:${caseId}:opened`,
      now,
    });
  }
  await writeAudit(ctx, {
    action: "clinic.human_case.created",
    targetType: "humanCase",
    targetId: caseId,
    payload: { urgency: args.urgency, threadId: thread?._id, openedFrom: args.openedFrom },
    actorKind: args.actorKind,
    now,
  });
  return { caseId, created: true };
}
