import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { writeAudit } from "./lib/audit";
import {
  loadByIdInTenant,
  requireCapability,
  tenantMutation,
  tenantQuery,
} from "./lib/customFunctions";
import { openHumanCaseInternal } from "./lib/humanCases";
import { queueStaffBriefing } from "./lib/staffNotifications";

const objectiveValidator = v.union(
  v.literal("hot_lead_call"),
  v.literal("stale_lead_recovery"),
  v.literal("proposal_followup"),
  v.literal("appointment_confirmation"),
  v.literal("business_monitoring"),
  v.literal("owner_digest"),
);
const triggerValidator = v.union(v.literal("event"), v.literal("schedule"), v.literal("both"));
const decisionModeValidator = v.union(v.literal("suggest"), v.literal("approval"), v.literal("automatic"));
const actionValidator = v.union(
  v.literal("assign_owner"),
  v.literal("create_task"),
  v.literal("open_human_case"),
  v.literal("send_staff_briefing"),
  v.literal("update_stage"),
  v.literal("send_customer_message"),
);
const leadStatusValidator = v.union(
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
const intentValidator = v.union(
  v.literal("greeting"),
  v.literal("info_request"),
  v.literal("price_request"),
  v.literal("booking_request"),
  v.literal("reschedule"),
  v.literal("cancel"),
  v.literal("confirm_attendance"),
  v.literal("complaint"),
  v.literal("support"),
  v.literal("human_request"),
  v.literal("opt_out"),
  v.literal("clinical_question"),
  v.literal("out_of_scope"),
  v.literal("other"),
);
const routineStatusValidator = v.union(v.literal("draft"), v.literal("active"), v.literal("paused"));
const decisionStatusValidator = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("dismissed"),
  v.literal("executing"),
  v.literal("completed"),
  v.literal("cancelled"),
  v.literal("failed"),
  v.literal("expired"),
);

const DEFAULT_ACTIONS = ["assign_owner", "create_task", "open_human_case", "send_staff_briefing"] as const;
const DEFAULT_STATUSES = ["interested", "asked_price", "wants_booking", "awaiting_human"] as const;
const DECISION_TTL_MS = 48 * 60 * 60_000;

function cleanText(value: string, min: number, max: number, label: string): string {
  const result = value.trim().replace(/\s+/g, " ");
  if (result.length < min || result.length > max) {
    throw new ConvexError({ code: "INVALID_TEXT_LENGTH", label, min, max });
  }
  return result;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function maskedPhone(value?: string): string | undefined {
  const digits = value?.replace(/\D/g, "") ?? "";
  if (!digits) return undefined;
  return `${digits.slice(0, 3)} •••• ${digits.slice(-4)}`;
}

function responsibilityFor(thread: Doc<"channelThreads">): Doc<"memberOperationalProfiles">["responsibilities"][number] {
  if (thread.intent === "support" || thread.intent === "complaint") return "support_calls";
  if (thread.intent === "booking_request" || thread.intent === "reschedule") return "appointment_calls";
  if (thread.leadStatus === "asked_price" || thread.leadStatus === "wants_booking") return "sales_calls";
  return "follow_up_calls";
}

async function memberName(ctx: { db: any }, memberId?: Id<"members">): Promise<string | undefined> {
  if (!memberId) return undefined;
  const member = (await ctx.db.get(memberId)) as Doc<"members"> | null;
  if (!member) return undefined;
  const user = await ctx.db.get(member.userId);
  return user?.name ?? user?.email;
}

async function pickAssignee(
  ctx: { db: any },
  routine: Doc<"agentRoutines">,
  thread: Doc<"channelThreads">,
): Promise<Id<"members"> | undefined> {
  if (routine.preferredMemberId) {
    const member = (await ctx.db.get(routine.preferredMemberId)) as Doc<"members"> | null;
    if (member?.tenantId === routine.tenantId && member.status === "active") return member._id;
  }
  const required = responsibilityFor(thread);
  let allowedMemberIds: Set<string> | null = null;
  if (routine.teamId) {
    const memberships = (await ctx.db
      .query("teamMembers")
      .withIndex("by_team", (q: any) => q.eq("teamId", routine.teamId))
      .take(100)) as Doc<"teamMembers">[];
    allowedMemberIds = new Set(memberships.filter((row) => row.tenantId === routine.tenantId).map((row) => String(row.memberId)));
  }
  const profiles = (await ctx.db
    .query("memberOperationalProfiles")
    .withIndex("by_tenant_active", (q: any) => q.eq("tenantId", routine.tenantId).eq("active", true))
    .take(100)) as Doc<"memberOperationalProfiles">[];
  const ranked = [];
  for (const profile of profiles) {
    if (allowedMemberIds && !allowedMemberIds.has(String(profile.memberId))) continue;
    if (!profile.responsibilities.includes(required)) continue;
    const member = (await ctx.db.get(profile.memberId)) as Doc<"members"> | null;
    if (!member || member.status !== "active") continue;
    const presence = await ctx.db
      .query("presence")
      .withIndex("by_tenant_member", (q: any) => q.eq("tenantId", routine.tenantId).eq("memberId", member._id))
      .unique();
    const pending = await ctx.db
      .query("agentDecisions")
      .withIndex("by_member_status_created", (q: any) =>
        q.eq("tenantId", routine.tenantId).eq("assignedMemberId", member._id).eq("status", "pending"),
      )
      .take(50);
    const age = presence ? Date.now() - presence.lastSeenAt : Number.POSITIVE_INFINITY;
    const presenceRank = age < 2 * 60_000 ? 0 : age < 10 * 60_000 ? 1 : 2;
    ranked.push({ memberId: member._id, score: presenceRank * 10_000 + pending.length * 100 + profile.priority });
  }
  ranked.sort((a, b) => a.score - b.score || String(a.memberId).localeCompare(String(b.memberId)));
  return ranked[0]?.memberId ?? thread.responsibleMemberId;
}

async function buildDecision(
  ctx: { db: any },
  routine: Doc<"agentRoutines">,
  runId: Id<"agentRoutineRuns">,
  thread: Doc<"channelThreads">,
  now: number,
): Promise<Id<"agentDecisions"> | null> {
  const sourceLastEventAt = thread.lastInboundAt ?? thread.lastEventAt;
  const dayBucket = Math.floor(now / (24 * 60 * 60_000));
  const businessKey = `${routine._id}:${thread._id}:${sourceLastEventAt}:${dayBucket}`;
  const existing = await ctx.db
    .query("agentDecisions")
    .withIndex("by_tenant_business_key", (q: any) =>
      q.eq("tenantId", routine.tenantId).eq("businessKey", businessKey),
    )
    .unique();
  if (existing) return null;
  const previous = (await ctx.db
    .query("agentDecisions")
    .withIndex("by_routine_created", (q: any) => q.eq("routineId", routine._id))
    .order("desc")
    .take(100)) as Doc<"agentDecisions">[];
  const attempts = previous.filter((row) => row.threadId === thread._id && row.status !== "cancelled" && row.status !== "expired").length;
  if (attempts >= routine.maxAttemptsPerContact) return null;

  const identity = thread.identityId ? await ctx.db.get(thread.identityId) : null;
  const assignedMemberId = await pickAssignee(ctx, routine, thread);
  const inactiveHours = Math.max(0, Math.floor((now - sourceLastEventAt) / 3_600_000));
  const contactName = identity?.displayName;
  const title = contactName ? `Ligar para ${contactName}` : "Lead precisa de uma chamada";
  const evidence = [
    thread.leadStatus ? `Etapa: ${thread.leadStatus}` : "Etapa ainda não definida",
    thread.intent ? `Intenção: ${thread.intent}` : "Intenção ainda não definida",
    `Sem nova mensagem há ${inactiveHours}h`,
  ];
  if (thread.lastPreview) evidence.push(`Última mensagem: ${thread.lastPreview.slice(0, 180)}`);
  const decisionId = (await ctx.db.insert("agentDecisions", {
    tenantId: routine.tenantId,
    routineId: routine._id,
    runId,
    agentId: routine.agentId,
    threadId: thread._id,
    assignedMemberId,
    kind: "call_required",
    title,
    evidence,
    reason: "A conversa mostra intenção comercial ou necessidade de ajuda e ficou sem avanço dentro do prazo definido.",
    expectedOutcome: assignedMemberId
      ? "Entregar contexto a uma pessoa responsável, pedir a chamada e registar o resultado."
      : "Colocar o lead na fila humana até existir uma pessoa responsável disponível.",
    actions: routine.allowedActions,
    businessKey,
    sourceLastEventAt,
    contextSnapshot: {
      contactName,
      contactPhoneMasked: maskedPhone(identity?.phone ?? thread.threadKey),
      lastPreview: thread.lastPreview?.slice(0, 300),
      leadStatus: thread.leadStatus,
      intent: thread.intent,
      nextStep: thread.nextStep,
      inactiveHours,
      responsibleName: await memberName(ctx, assignedMemberId),
    },
    status: "pending",
    decisionMode: routine.decisionMode,
    expiresAt: now + DECISION_TTL_MS,
    createdAt: now,
    updatedAt: now,
  })) as Id<"agentDecisions">;
  return decisionId;
}

function briefingText(decision: Doc<"agentDecisions">): string {
  const context = decision.contextSnapshot;
  const lines = [
    "OPENBSP · chamada recomendada",
    "",
    `Contacto: ${context.contactName ?? "Sem nome"}${context.contactPhoneMasked ? ` (${context.contactPhoneMasked})` : ""}`,
    `Motivo: ${decision.reason}`,
    context.leadStatus ? `Etapa: ${context.leadStatus}` : undefined,
    context.intent ? `Intenção: ${context.intent}` : undefined,
    context.lastPreview ? `Última mensagem: “${context.lastPreview}”` : undefined,
    context.nextStep ? `Próximo passo atual: ${context.nextStep}` : undefined,
    "",
    "Objetivo da chamada: confirmar a necessidade, resolver a objeção e registar o próximo passo no OpenBSP.",
  ];
  return lines.filter(Boolean).join("\n");
}

async function executeDecision(
  ctx: any,
  decision: Doc<"agentDecisions">,
  routine: Doc<"agentRoutines">,
  actorMemberId: Id<"members">,
  actorKind: "member" | "system",
): Promise<"completed" | "cancelled"> {
  if (decision.status !== "pending" && decision.status !== "approved") {
    throw new ConvexError({ code: "DECISION_NOT_PENDING" });
  }
  const now = Date.now();
  const thread = decision.threadId ? ((await ctx.db.get(decision.threadId)) as Doc<"channelThreads"> | null) : null;
  if (!thread || thread.tenantId !== decision.tenantId) {
    await ctx.db.patch(decision._id, { status: "cancelled", failureReason: "thread unavailable", updatedAt: now });
    return "cancelled";
  }
  if (
    thread.closedAt ||
    thread.dnd ||
    (decision.sourceLastEventAt !== undefined && (thread.lastInboundAt ?? 0) > decision.sourceLastEventAt)
  ) {
    await ctx.db.patch(decision._id, {
      status: "cancelled",
      failureReason: thread.dnd ? "opt_out" : thread.closedAt ? "conversation_closed" : "customer_replied",
      updatedAt: now,
    });
    return "cancelled";
  }
  const permitted = new Set(routine.allowedActions);
  if (decision.actions.some((action) => !permitted.has(action))) {
    throw new ConvexError({ code: "DECISION_ACTION_NOT_ALLOWED" });
  }
  if (decision.actions.includes("send_customer_message")) {
    throw new ConvexError({ code: "ROUTINE_CUSTOMER_SEND_NOT_READY" });
  }
  await ctx.db.patch(decision._id, { status: "executing", updatedAt: now });
  const result: Record<string, unknown> = {};
  const assignee = decision.assignedMemberId;
  if (assignee && decision.actions.includes("assign_owner")) {
    const member = (await ctx.db.get(assignee)) as Doc<"members"> | null;
    if (member?.tenantId === decision.tenantId && member.status === "active") {
      await ctx.db.patch(thread._id, { responsibleMemberId: assignee, assignedBy: "rule", updatedAt: now });
      result.assignedMemberId = assignee;
    }
  }
  if (assignee && decision.actions.includes("create_task")) {
    const reminderId = await ctx.db.insert("threadReminders", {
      tenantId: decision.tenantId,
      threadId: thread._id,
      note: `Ligar ao contacto. ${decision.reason}`.slice(0, 500),
      dueAt: now,
      status: "due",
      assignedMemberId: assignee,
      createdBy: actorMemberId,
      createdAt: now,
      updatedAt: now,
    });
    result.reminderId = reminderId;
  }
  if (decision.actions.includes("open_human_case")) {
    const humanCase = await openHumanCaseInternal(
      { ...ctx, tenantId: decision.tenantId, memberId: actorMemberId },
      {
        thread,
        reason: "Chamada recomendada pelo agente",
        urgency: thread.intent === "complaint" || thread.intent === "human_request" ? "high" : "normal",
        question: decision.evidence.join(" · ").slice(0, 2_000),
        responsibleMemberId: assignee,
        openedFrom: "automation",
        actorKind: actorKind === "system" ? "ai" : "member",
        now,
      },
    );
    result.humanCaseId = humanCase.caseId;
  }
  if (assignee && decision.actions.includes("send_staff_briefing")) {
    const briefing = await queueStaffBriefing(ctx, {
      tenantId: decision.tenantId,
      decisionId: decision._id,
      memberId: assignee,
      businessKey: `decision:${decision._id}:staff-briefing`,
      text: briefingText(decision),
      now,
    });
    result.staffBriefing = briefing.status;
    if (briefing.status === "queued") {
      await ctx.scheduler.runAfter(0, internal.staffNotifications.deliverDue, {});
    }
  }
  await ctx.db.patch(decision._id, { status: "completed", result, updatedAt: now });
  await writeAudit(
    { ...ctx, tenantId: decision.tenantId, memberId: actorMemberId },
    {
      action: "agent.decision.executed",
      targetType: "agentDecision",
      targetId: decision._id,
      payload: { routineId: routine._id, actions: decision.actions, result },
      actorMemberId,
      actorKind,
      now,
    },
  );
  return "completed";
}

const routineRowValidator = v.object({
  _id: v.id("agentRoutines"),
  agentId: v.optional(v.id("aiAgents")),
  name: v.string(),
  objective: objectiveValidator,
  triggerMode: triggerValidator,
  decisionMode: decisionModeValidator,
  allowedActions: v.array(actionValidator),
  leadStatuses: v.array(leadStatusValidator),
  intents: v.array(intentValidator),
  staleAfterHours: v.number(),
  intervalMinutes: v.number(),
  maxItemsPerRun: v.number(),
  maxAttemptsPerContact: v.number(),
  workingHoursOnly: v.boolean(),
  teamId: v.optional(v.id("teams")),
  preferredMemberId: v.optional(v.id("members")),
  status: routineStatusValidator,
  version: v.number(),
  nextRunAt: v.optional(v.number()),
  lastRunAt: v.optional(v.number()),
  updatedAt: v.number(),
});

const decisionRowValidator = v.object({
  _id: v.id("agentDecisions"),
  routineId: v.id("agentRoutines"),
  routineName: v.string(),
  threadId: v.optional(v.id("channelThreads")),
  assignedMemberId: v.optional(v.id("members")),
  assignedMemberName: v.optional(v.string()),
  kind: v.string(),
  title: v.string(),
  evidence: v.array(v.string()),
  reason: v.string(),
  expectedOutcome: v.string(),
  actions: v.array(actionValidator),
  contextSnapshot: v.object({
    contactName: v.optional(v.string()),
    contactPhoneMasked: v.optional(v.string()),
    lastPreview: v.optional(v.string()),
    leadStatus: v.optional(v.string()),
    intent: v.optional(v.string()),
    nextStep: v.optional(v.string()),
    inactiveHours: v.optional(v.number()),
    responsibleName: v.optional(v.string()),
  }),
  status: decisionStatusValidator,
  decisionMode: decisionModeValidator,
  failureReason: v.optional(v.string()),
  expiresAt: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const listRoutines = tenantQuery({
  args: {},
  returns: v.array(routineRowValidator),
  handler: async (ctx) => {
    requireCapability(ctx.role, "ai.view_runs");
    const rows = await ctx.db
      .query("agentRoutines")
      .withIndex("by_tenant_updated", (q) => q.eq("tenantId", ctx.tenantId))
      .order("desc")
      .take(50);
    return rows.map((row) => ({
      _id: row._id,
      agentId: row.agentId,
      name: row.name,
      objective: row.objective,
      triggerMode: row.triggerMode,
      decisionMode: row.decisionMode,
      allowedActions: row.allowedActions,
      leadStatuses: row.leadStatuses,
      intents: row.intents,
      staleAfterHours: row.staleAfterHours,
      intervalMinutes: row.intervalMinutes,
      maxItemsPerRun: row.maxItemsPerRun,
      maxAttemptsPerContact: row.maxAttemptsPerContact,
      workingHoursOnly: row.workingHoursOnly,
      teamId: row.teamId,
      preferredMemberId: row.preferredMemberId,
      status: row.status,
      version: row.version,
      nextRunAt: row.nextRunAt,
      lastRunAt: row.lastRunAt,
      updatedAt: row.updatedAt,
    }));
  },
});

export const listDecisions = tenantQuery({
  args: { status: v.optional(decisionStatusValidator) },
  returns: v.array(decisionRowValidator),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "ai.view_runs");
    const statuses = args.status ? [args.status] : (["pending", "completed", "cancelled", "dismissed", "failed"] as const);
    const decisions: Doc<"agentDecisions">[] = [];
    for (const status of statuses) {
      decisions.push(
        ...((await ctx.db
          .query("agentDecisions")
          .withIndex("by_tenant_status_created", (q) => q.eq("tenantId", ctx.tenantId).eq("status", status))
          .order("desc")
          .take(args.status ? 100 : 20)) as Doc<"agentDecisions">[]),
      );
    }
    decisions.sort((a, b) => b.createdAt - a.createdAt);
    const out = [];
    for (const row of decisions.slice(0, 100)) {
      const routine = await ctx.db.get(row.routineId);
      if (!routine || routine.tenantId !== ctx.tenantId) continue;
      out.push({
        _id: row._id,
        routineId: row.routineId,
        routineName: routine.name,
        threadId: row.threadId,
        assignedMemberId: row.assignedMemberId,
        assignedMemberName: await memberName(ctx, row.assignedMemberId),
        kind: row.kind,
        title: row.title,
        evidence: row.evidence,
        reason: row.reason,
        expectedOutcome: row.expectedOutcome,
        actions: row.actions,
        contextSnapshot: row.contextSnapshot,
        status: row.status,
        decisionMode: row.decisionMode,
        failureReason: row.failureReason,
        expiresAt: row.expiresAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
    }
    return out;
  },
});

export const create = tenantMutation({
  args: {
    name: v.string(),
    objective: objectiveValidator,
    agentId: v.optional(v.id("aiAgents")),
    triggerMode: triggerValidator,
    decisionMode: decisionModeValidator,
    allowedActions: v.optional(v.array(actionValidator)),
    leadStatuses: v.optional(v.array(leadStatusValidator)),
    intents: v.optional(v.array(intentValidator)),
    staleAfterHours: v.number(),
    intervalMinutes: v.number(),
    maxItemsPerRun: v.number(),
    maxAttemptsPerContact: v.number(),
    workingHoursOnly: v.boolean(),
    teamId: v.optional(v.id("teams")),
    preferredMemberId: v.optional(v.id("members")),
  },
  returns: v.id("agentRoutines"),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "ai.configure");
    if (args.agentId) await loadByIdInTenant(ctx, "aiAgents", args.agentId);
    if (args.teamId) await loadByIdInTenant(ctx, "teams", args.teamId);
    if (args.preferredMemberId) await loadByIdInTenant(ctx, "members", args.preferredMemberId);
    const allowedActions = Array.from(new Set(args.allowedActions ?? DEFAULT_ACTIONS));
    if (allowedActions.includes("send_customer_message")) {
      throw new ConvexError({ code: "ROUTINE_CUSTOMER_SEND_NOT_READY" });
    }
    const now = Date.now();
    const routineId = await ctx.db.insert("agentRoutines", {
      tenantId: ctx.tenantId,
      agentId: args.agentId,
      name: cleanText(args.name, 2, 100, "name"),
      objective: args.objective,
      triggerMode: args.triggerMode,
      decisionMode: args.decisionMode,
      allowedActions,
      leadStatuses: Array.from(new Set(args.leadStatuses ?? DEFAULT_STATUSES)),
      intents: Array.from(new Set(args.intents ?? [])),
      staleAfterHours: clamp(args.staleAfterHours, 1, 720),
      intervalMinutes: clamp(args.intervalMinutes, 15, 10_080),
      maxItemsPerRun: clamp(args.maxItemsPerRun, 1, 25),
      maxAttemptsPerContact: clamp(args.maxAttemptsPerContact, 1, 10),
      workingHoursOnly: args.workingHoursOnly,
      teamId: args.teamId,
      preferredMemberId: args.preferredMemberId,
      status: "active",
      version: 1,
      nextRunAt: args.triggerMode === "event" ? undefined : now,
      createdBy: ctx.memberId,
      createdAt: now,
      updatedAt: now,
    });
    await writeAudit(ctx, {
      action: "agent.routine.created",
      targetType: "agentRoutine",
      targetId: routineId,
      payload: { objective: args.objective, decisionMode: args.decisionMode, allowedActions },
    });
    return routineId;
  },
});

export const setStatus = tenantMutation({
  args: { routineId: v.id("agentRoutines"), status: routineStatusValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "ai.configure");
    const routine = await loadByIdInTenant(ctx, "agentRoutines", args.routineId);
    const now = Date.now();
    await ctx.db.patch(routine._id, {
      status: args.status,
      nextRunAt:
        args.status === "active" && routine.triggerMode !== "event" ? now : undefined,
      version: routine.version + 1,
      updatedAt: now,
    });
    await writeAudit(ctx, {
      action: "agent.routine.status_changed",
      targetType: "agentRoutine",
      targetId: routine._id,
      payload: { from: routine.status, to: args.status },
    });
    return null;
  },
});

export const runNow = tenantMutation({
  args: { routineId: v.id("agentRoutines") },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "ai.configure");
    const routine = await loadByIdInTenant(ctx, "agentRoutines", args.routineId);
    if (routine.status !== "active") throw new ConvexError({ code: "ROUTINE_NOT_ACTIVE" });
    await ctx.scheduler.runAfter(0, internal.agentRoutines.runOne, { routineId: routine._id, now: Date.now() });
    return null;
  },
});

export const decide = tenantMutation({
  args: {
    decisionId: v.id("agentDecisions"),
    decision: v.union(v.literal("approve"), v.literal("dismiss"), v.literal("authorize_routine")),
  },
  returns: v.object({ status: v.string() }),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "ai.compose");
    const decision = await loadByIdInTenant(ctx, "agentDecisions", args.decisionId);
    if (decision.status !== "pending") throw new ConvexError({ code: "DECISION_NOT_PENDING" });
    const routine = await loadByIdInTenant(ctx, "agentRoutines", decision.routineId);
    const now = Date.now();
    if (args.decision === "dismiss") {
      await ctx.db.patch(decision._id, { status: "dismissed", decidedBy: ctx.memberId, decidedAt: now, updatedAt: now });
      await writeAudit(ctx, { action: "agent.decision.dismissed", targetType: "agentDecision", targetId: decision._id, payload: { routineId: routine._id } });
      return { status: "dismissed" };
    }
    if (args.decision === "authorize_routine") {
      requireCapability(ctx.role, "ai.publish");
      await ctx.db.patch(routine._id, { decisionMode: "automatic", version: routine.version + 1, updatedAt: now });
      await writeAudit(ctx, { action: "agent.routine.authorized", targetType: "agentRoutine", targetId: routine._id, payload: { previousMode: routine.decisionMode } });
    }
    await ctx.db.patch(decision._id, { status: "approved", decidedBy: ctx.memberId, decidedAt: now, updatedAt: now });
    const status = await executeDecision(ctx, { ...decision, status: "approved", decidedBy: ctx.memberId, decidedAt: now, updatedAt: now }, routine, ctx.memberId, "member");
    return { status };
  },
});

export const runDue = internalMutation({
  args: {},
  returns: v.object({ scheduled: v.number() }),
  handler: async (ctx) => {
    const now = Date.now();
    const routines = await ctx.db
      .query("agentRoutines")
      .withIndex("by_status_next_run", (q) => q.eq("status", "active").lte("nextRunAt", now))
      .take(10);
    for (const routine of routines) {
      await ctx.scheduler.runAfter(0, internal.agentRoutines.runOne, { routineId: routine._id, now });
      await ctx.db.patch(routine._id, { nextRunAt: now + routine.intervalMinutes * 60_000, updatedAt: now });
    }
    return { scheduled: routines.length };
  },
});

export const onInbound = internalMutation({
  args: {
    eventId: v.id("channelEvents"),
    threadId: v.id("channelThreads"),
  },
  returns: v.object({ proposed: v.number(), executed: v.number() }),
  handler: async (ctx, args) => {
    const [event, thread] = await Promise.all([
      ctx.db.get(args.eventId),
      ctx.db.get(args.threadId),
    ]);
    if (
      !event ||
      !thread ||
      event.tenantId !== thread.tenantId ||
      event.direction !== "incoming" ||
      !event.eventKind.startsWith("message.") ||
      thread.closedAt ||
      thread.dnd ||
      thread.openHumanCaseId
    ) {
      return { proposed: 0, executed: 0 };
    }
    const eventRoutines = await ctx.db
      .query("agentRoutines")
      .withIndex("by_tenant_status_trigger", (q) =>
        q
          .eq("tenantId", thread.tenantId)
          .eq("status", "active")
          .eq("triggerMode", "event"),
      )
      .order("desc")
      .take(25);
    const hybridRoutines = await ctx.db
      .query("agentRoutines")
      .withIndex("by_tenant_status_trigger", (q) =>
        q
          .eq("tenantId", thread.tenantId)
          .eq("status", "active")
          .eq("triggerMode", "both"),
      )
      .order("desc")
      .take(25);
    const routines = [...eventRoutines, ...hybridRoutines];
    let proposed = 0;
    let executed = 0;
    for (const routine of routines) {
      if (
        routine.status !== "active" ||
        (routine.triggerMode !== "event" && routine.triggerMode !== "both") ||
        routine.objective !== "hot_lead_call" ||
        !thread.leadStatus ||
        !routine.leadStatuses.includes(thread.leadStatus) ||
        (routine.intents.length > 0 && (!thread.intent || !routine.intents.includes(thread.intent)))
      ) {
        continue;
      }
      const businessKey = `${routine._id}:event:${event._id}`;
      const existingRun = await ctx.db
        .query("agentRoutineRuns")
        .withIndex("by_business_key", (q) =>
          q.eq("tenantId", routine.tenantId).eq("businessKey", businessKey),
        )
        .unique();
      if (existingRun) continue;
      const now = event.receivedAt;
      const runId = await ctx.db.insert("agentRoutineRuns", {
        tenantId: routine.tenantId,
        routineId: routine._id,
        businessKey,
        status: "running",
        scanned: 1,
        proposed: 0,
        executed: 0,
        startedAt: now,
      });
      const decisionId = await buildDecision(ctx, routine, runId, thread, now);
      let runExecuted = 0;
      if (decisionId) {
        proposed += 1;
        if (routine.decisionMode === "automatic") {
          const decision = (await ctx.db.get(decisionId)) as Doc<"agentDecisions">;
          if (await executeDecision(ctx, decision, routine, routine.createdBy, "system") === "completed") {
            executed += 1;
            runExecuted = 1;
          }
        }
      }
      await ctx.db.patch(runId, {
        status: "completed",
        proposed: decisionId ? 1 : 0,
        executed: runExecuted,
        completedAt: Date.now(),
      });
    }
    return { proposed, executed };
  },
});

export const runOne = internalMutation({
  args: { routineId: v.id("agentRoutines"), now: v.number() },
  returns: v.object({ scanned: v.number(), proposed: v.number(), executed: v.number() }),
  handler: async (ctx, args) => {
    const routine = await ctx.db.get(args.routineId);
    if (!routine || routine.status !== "active") return { scanned: 0, proposed: 0, executed: 0 };
    const slot = Math.floor(args.now / Math.max(15 * 60_000, routine.intervalMinutes * 60_000));
    const runBusinessKey = `${routine._id}:${slot}`;
    const existingRun = await ctx.db
      .query("agentRoutineRuns")
      .withIndex("by_business_key", (q) => q.eq("tenantId", routine.tenantId).eq("businessKey", runBusinessKey))
      .unique();
    if (existingRun) return { scanned: existingRun.scanned, proposed: existingRun.proposed, executed: existingRun.executed };
    const runId = await ctx.db.insert("agentRoutineRuns", {
      tenantId: routine.tenantId,
      routineId: routine._id,
      businessKey: runBusinessKey,
      status: "running",
      scanned: 0,
      proposed: 0,
      executed: 0,
      startedAt: args.now,
    });
    const cutoff = args.now - routine.staleAfterHours * 60 * 60_000;
    const candidates = new Map<string, Doc<"channelThreads">>();
    for (const status of routine.leadStatuses) {
      const rows = (await ctx.db
        .query("channelThreads")
        .withIndex("by_tenant_lead_status", (q) =>
          q.eq("tenantId", routine.tenantId).eq("leadStatus", status).lt("lastEventAt", cutoff),
        )
        .order("asc")
        .take(routine.maxItemsPerRun)) as Doc<"channelThreads">[];
      for (const row of rows) candidates.set(String(row._id), row);
      if (candidates.size >= routine.maxItemsPerRun) break;
    }
    let scanned = 0;
    let proposed = 0;
    let executed = 0;
    const ordered = [...candidates.values()].sort((a, b) => a.lastEventAt - b.lastEventAt).slice(0, routine.maxItemsPerRun);
    for (const thread of ordered) {
      scanned += 1;
      if (thread.closedAt || thread.dnd || !thread.lastInboundAt || thread.openHumanCaseId) continue;
      if (routine.intents.length > 0 && (!thread.intent || !routine.intents.includes(thread.intent))) continue;
      const decisionId = await buildDecision(ctx, routine, runId, thread, args.now);
      if (!decisionId) continue;
      proposed += 1;
      if (routine.decisionMode === "automatic") {
        const decision = (await ctx.db.get(decisionId)) as Doc<"agentDecisions">;
        const result = await executeDecision(ctx, decision, routine, routine.createdBy, "system");
        if (result === "completed") executed += 1;
      }
    }
    await ctx.db.patch(runId, { status: "completed", scanned, proposed, executed, completedAt: Date.now() });
    await ctx.db.patch(routine._id, { lastRunAt: args.now, nextRunAt: args.now + routine.intervalMinutes * 60_000, updatedAt: Date.now() });
    return { scanned, proposed, executed };
  },
});

export const sweepExpired = internalMutation({
  args: {},
  returns: v.object({ expired: v.number() }),
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db
      .query("agentDecisions")
      .withIndex("by_status_expires", (q) => q.eq("status", "pending").lte("expiresAt", now))
      .take(100);
    for (const row of rows) await ctx.db.patch(row._id, { status: "expired", updatedAt: now });
    return { expired: rows.length };
  },
});
