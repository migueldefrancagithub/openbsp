import { pauseAiRun, resumeAiRun } from "../ai/control";
import { stopThreadFollowUps } from "../followUpControl";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import { hasCapability, type Capability, type Role } from "../roles";
import { writeAudit } from "../audit";
import { recordThreadSystemEvent, type ThreadSystemEventKind } from "./systemEvents";
import { resolveAssignment } from "../assignment";
import { threadIntentValidator, type ThreadIntent } from "./intents";
import { listActiveDefinitions, mergeCustomFieldValues } from "../../customFields";

export const threadInboxStatusValidator = v.union(
  v.literal("open"),
  v.literal("active"),
  v.literal("awaiting_team"),
  v.literal("awaiting_patient"),
  v.literal("snoozed"),
  v.literal("closed"),
);

export const threadLeadStatusValidator = v.union(
  v.literal("new"),
  v.literal("interested"),
  v.literal("asked_price"),
  v.literal("wants_booking"),
  v.literal("awaiting_human"),
  v.literal("booked"),
  v.literal("confirmed"),
  v.literal("attended"),
  v.literal("no_show"),
  v.literal("lost"),
);

export const threadAutomationModeValidator = v.union(
  v.literal("idle"),
  v.literal("bot"),
  v.literal("human"),
  v.literal("stopped"),
);

/** Shared by `inboxOperations.updateThread` and future bulk lead moves. */
export const threadUpdateArgs = {
  inboxStatus: v.optional(threadInboxStatusValidator),
  starred: v.optional(v.boolean()),
  snoozedUntil: v.optional(v.number()),
  closeReasonId: v.optional(v.id("threadCloseReasons")),
  responsibleMemberId: v.optional(v.id("members")),
  clearResponsible: v.optional(v.boolean()),
  assignedTeamId: v.optional(v.id("teams")),
  clearTeam: v.optional(v.boolean()),
  leadStatus: v.optional(threadLeadStatusValidator),
  intent: v.optional(threadIntentValidator),
  clearIntent: v.optional(v.boolean()),
  nextStep: v.optional(v.string()),
  nextStepDueAt: v.optional(v.number()),
  clearNextStepDueAt: v.optional(v.boolean()),
  tags: v.optional(v.array(v.string())),
  customFields: v.optional(
    v.record(v.string(), v.union(v.string(), v.number(), v.boolean())),
  ),
  dnd: v.optional(v.boolean()),
  automationMode: v.optional(threadAutomationModeValidator),
};

export type ThreadUpdateArgs = {
  inboxStatus?: "open" | "active" | "awaiting_team" | "awaiting_patient" | "snoozed" | "closed";
  starred?: boolean;
  snoozedUntil?: number;
  closeReasonId?: Id<"threadCloseReasons">;
  responsibleMemberId?: Id<"members">;
  clearResponsible?: boolean;
  assignedTeamId?: Id<"teams">;
  clearTeam?: boolean;
  leadStatus?: Doc<"channelThreads">["leadStatus"];
  intent?: ThreadIntent;
  clearIntent?: boolean;
  nextStep?: string;
  nextStepDueAt?: number;
  clearNextStepDueAt?: boolean;
  tags?: string[];
  customFields?: Record<string, string | number | boolean>;
  dnd?: boolean;
  automationMode?: "idle" | "bot" | "human" | "stopped";
};

type Actor = { memberId: Id<"members">; role: Role };

/**
 * Which capability each field group needs. Checked before any write so a
 * partial update never lands.
 */
export function requiredCapabilities(args: ThreadUpdateArgs, actor: Actor): Capability[] {
  const needed = new Set<Capability>();
  if (args.responsibleMemberId !== undefined || args.clearResponsible) {
    needed.add(
      args.responsibleMemberId === actor.memberId && !args.clearResponsible
        ? "conversations.assign_self"
        : "conversations.assign_other",
    );
  }
  if (args.assignedTeamId !== undefined || args.clearTeam) {
    needed.add("conversations.assign_other");
  }
  if (args.inboxStatus === "closed") needed.add("conversations.close");
  if (
    args.leadStatus !== undefined ||
    args.intent !== undefined ||
    args.clearIntent ||
    args.nextStep !== undefined ||
    args.nextStepDueAt !== undefined ||
    args.clearNextStepDueAt ||
    args.tags !== undefined
  ) {
    needed.add("leads.update");
  }
  if (args.customFields !== undefined) needed.add("inbox.custom_fields");
  if (
    args.starred !== undefined ||
    args.dnd !== undefined ||
    args.automationMode !== undefined ||
    (args.inboxStatus !== undefined && args.inboxStatus !== "closed")
  ) {
    needed.add("messages.send");
  }
  return [...needed];
}

export function assertCanUpdateThread(args: ThreadUpdateArgs, actor: Actor): void {
  for (const capability of requiredCapabilities(args, actor)) {
    if (!hasCapability(actor.role, capability)) {
      throw new ConvexError({
        code: "FORBIDDEN_CAPABILITY",
        capability,
        role: actor.role,
      });
    }
  }
}

function pickTracked(thread: Partial<Doc<"channelThreads">>) {
  return {
    inboxStatus: thread.inboxStatus,
    leadStatus: thread.leadStatus,
    intent: thread.intent,
    responsibleMemberId: thread.responsibleMemberId,
    assignedTeamId: thread.assignedTeamId,
    nextStep: thread.nextStep,
    nextStepDueAt: thread.nextStepDueAt,
    tags: thread.tags,
    customFields: thread.customFields,
    dnd: thread.dnd,
    starred: Boolean(thread.starredAt),
    snoozedUntil: thread.snoozedUntil,
    automationMode: thread.automationMode,
  };
}

/**
 * Apply an operator update to a thread: capability checks, the patch, an
 * audit row with before/after, and the system-timeline entries the thread
 * view shows. The caller has already tenant-fenced the thread and any
 * referenced members/teams/close reasons.
 */
export async function applyThreadUpdate(
  ctx: { db: any; tenantId: Id<"tenants">; memberId: Id<"members">; role: Role },
  thread: Doc<"channelThreads">,
  args: ThreadUpdateArgs,
  options: { now?: number; auditAction?: string } = {},
): Promise<void> {
  assertCanUpdateThread(args, { memberId: ctx.memberId, role: ctx.role });
  if (args.automationMode === "bot" && thread.openHumanCaseId) {
    const openCase = await ctx.db.get(thread.openHumanCaseId);
    if (openCase && openCase.status !== "resolved") {
      throw new ConvexError({ code: "HUMAN_CASE_OPEN", caseId: openCase._id });
    }
  }
  const now = options.now ?? Date.now();
  const patch: Record<string, unknown> = { updatedAt: now };

  if (args.inboxStatus !== undefined) {
    patch.inboxStatus = args.inboxStatus;
    if (args.inboxStatus === "closed") {
      patch.closedAt = now;
      patch.closedReasonId = args.closeReasonId;
      patch.nextStep = undefined;
      patch.nextStepDueAt = undefined;
    } else {
      patch.closedAt = undefined;
      patch.closedReasonId = undefined;
      if (args.inboxStatus === "snoozed") {
        if (!args.snoozedUntil || args.snoozedUntil <= now) {
          throw new ConvexError({ code: "INVALID_SNOOZE_TIME" });
        }
        patch.snoozedUntil = args.snoozedUntil;
      } else {
        patch.snoozedUntil = undefined;
      }
    }
  }
  if (args.starred !== undefined) patch.starredAt = args.starred ? now : undefined;

  const assignment = resolveAssignment({
    requestedMemberId: args.responsibleMemberId,
    requestedTeamId: args.assignedTeamId,
    clearMember: args.clearResponsible,
    clearTeam: args.clearTeam,
  });
  if (assignment.responsibleMemberId === null) {
    patch.responsibleMemberId = undefined;
  } else if (assignment.responsibleMemberId !== undefined) {
    patch.responsibleMemberId = assignment.responsibleMemberId;
  }
  if (assignment.assignedTeamId === null) {
    patch.assignedTeamId = undefined;
  } else if (assignment.assignedTeamId !== undefined) {
    patch.assignedTeamId = assignment.assignedTeamId;
  }

  if (args.leadStatus !== undefined) patch.leadStatus = args.leadStatus;
  if (args.clearIntent) {
    patch.intent = undefined;
    patch.intentSource = undefined;
    patch.intentUpdatedAt = now;
  } else if (args.intent !== undefined) {
    patch.intent = args.intent;
    patch.intentSource = "manual";
    patch.intentUpdatedAt = now;
  }
  if (args.nextStep !== undefined) patch.nextStep = args.nextStep.trim().slice(0, 240);
  if (args.clearNextStepDueAt) {
    patch.nextStepDueAt = undefined;
  } else if (args.nextStepDueAt !== undefined) {
    patch.nextStepDueAt = args.nextStepDueAt;
  }
  if (args.tags !== undefined) {
    patch.tags = Array.from(
      new Set(args.tags.map((tag) => tag.trim()).filter(Boolean)),
    ).slice(0, 30);
  }
  if (args.customFields !== undefined) {
    const definitions = await listActiveDefinitions(ctx);
    patch.customFields = mergeCustomFieldValues(definitions, thread.customFields, args.customFields);
  }
  if (args.dnd !== undefined) patch.dnd = args.dnd;
  if (args.dnd === true && !thread.dnd) {
    await stopThreadFollowUps(ctx, { thread, reason: "dnd", now, actorMemberId: ctx.memberId });
  }
  if (args.automationMode !== undefined) {
    patch.automationMode = args.automationMode;
    if (args.automationMode === "human" && thread.automationMode !== "human") {
      await pauseAiRun(ctx, thread, "paused_by_operator", now);
    }
    if (args.automationMode === "bot" && thread.automationMode !== "bot") {
      await resumeAiRun(ctx, { thread, now });
    }
    patch.automationChangedAt = now;
    patch.automationChangeReason = "manual_inbox_control";
    if (args.automationMode === "human") {
      patch.inboxStatus = "awaiting_team";
      patch.leadStatus = "awaiting_human";
    }
  }

  await ctx.db.patch(thread._id, patch);

  const before = pickTracked(thread);
  const after = pickTracked({ ...thread, ...(patch as Partial<Doc<"channelThreads">>) });
  const changed: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after) as (keyof typeof after)[]) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changed[key] = { from: before[key], to: after[key] };
    }
  }
  await writeAudit(ctx, {
    action: options.auditAction ?? "inbox.thread.updated",
    targetType: "channel_thread",
    targetId: thread._id,
    payload: { changed },
    now,
  });

  const events: Array<{ kind: ThreadSystemEventKind; payload?: Record<string, string | number | boolean | undefined> }> = [];
  if (changed.leadStatus) {
    events.push({ kind: "lead.status_changed", payload: { from: String(changed.leadStatus.from ?? ""), to: String(changed.leadStatus.to ?? "") } });
  }
  if (changed.intent) {
    events.push({ kind: "lead.intent_changed", payload: { from: String(changed.intent.from ?? ""), to: String(changed.intent.to ?? "") } });
  }
  if (changed.responsibleMemberId || changed.assignedTeamId) {
    events.push({ kind: "inbox.assigned" });
  }
  if (changed.inboxStatus) {
    const to = after.inboxStatus;
    const from = before.inboxStatus;
    if (to === "snoozed") events.push({ kind: "inbox.snoozed", payload: { until: after.snoozedUntil } });
    else if (from === "snoozed") events.push({ kind: "inbox.unsnoozed" });
    if (to === "closed") events.push({ kind: "inbox.closed" });
    else if (from === "closed" || thread.closedAt) events.push({ kind: "inbox.reopened" });
  }
  for (const [index, event] of events.entries()) {
    await recordThreadSystemEvent(ctx, {
      thread,
      kind: event.kind,
      severity: "info",
      actorType: "member",
      actorMemberId: ctx.memberId,
      payload: event.payload,
      dedupeKey: `manual:${ctx.memberId}:${now}:${index}:${event.kind}`,
      now,
    });
  }
}
