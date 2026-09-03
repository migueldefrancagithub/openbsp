import { ConvexError, v } from "convex/values";
import { writeAudit } from "./lib/audit";
import { openHumanCaseInternal } from "./lib/humanCases";
import { emitWebhookEvent } from "./lib/webhooks";
import {
  setThreadAutomationMode,
  stopActiveAutomationRun,
} from "./lib/channels/automationControl";
import { recordThreadSystemEvent } from "./lib/channels/systemEvents";
import { requireCapability } from "./lib/customFunctions";
import {
  loadByIdInTenant,
  requireRoleAtLeast,
  tenantMutation,
  tenantQuery,
} from "./lib/customFunctions";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  appointmentNoticeText,
  appointmentRange,
  cancelInternal,
  confirmInternal,
  coversStart,
  findConflict,
  isBookableStatus,
  listSlotsInternal,
  loadClinicSettings,
  outcomeInternal,
  rescheduleInternal,
  reserveSlotInternal,
  slotBusinessKey,
  tenantTimeZone,
} from "./lib/clinicAgenda";
import {
  addDays,
  formatLocalDateTime,
  formatLocalTime,
  isValidTimeZone,
  localTimeToTimestamp,
  parseDate,
  weekdayOfDate,
} from "./lib/clinicTime";

const SLOT_LOOKAHEAD_DAYS = 21;
const DEFAULT_SLOT_STEP_MINUTES = 30;

const availabilityValidator = v.array(
  v.object({
    weekday: v.number(),
    start: v.string(),
    end: v.string(),
  }),
);

const knowledgeKindValidator = v.union(
  v.literal("faq"),
  v.literal("service"),
  v.literal("policy"),
  v.literal("hours"),
  v.literal("document"),
  v.literal("instruction"),
);

const humanCaseUrgencyValidator = v.union(
  v.literal("low"),
  v.literal("normal"),
  v.literal("high"),
  v.literal("urgent"),
);

const followUpTriggerValidator = v.union(
  v.literal("no_reply"),
  v.literal("appointment_unconfirmed"),
  v.literal("proposal_no_response"),
  v.literal("no_show"),
  v.literal("human_case_pending"),
);

const appointmentOutcomeValidator = v.union(
  v.literal("cancelled"),
  v.literal("completed"),
  v.literal("no_show"),
);

type Availability = Doc<"clinicServices">["availability"];
type ClinicMutationCtx = {
  db: {
    query: any;
    insert: any;
    patch: any;
  };
  tenantId: Id<"tenants">;
  memberId: Id<"members">;
};

const DEFAULT_AVAILABILITY: Availability = [
  { weekday: 1, start: "08:00", end: "17:00" },
  { weekday: 2, start: "08:00", end: "17:00" },
  { weekday: 3, start: "08:00", end: "17:00" },
  { weekday: 4, start: "08:00", end: "17:00" },
  { weekday: 5, start: "08:00", end: "17:00" },
];

function assertLength(value: string, label: string, min: number, max: number) {
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw new ConvexError({ code: "INVALID_TEXT_LENGTH", label, min, max });
  }
  return trimmed;
}

function optionalText(value: string | undefined, max: number) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, max);
}

function parseTime(value: string) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) throw new ConvexError({ code: "INVALID_TIME", value });
  return Number(match[1]) * 60 + Number(match[2]);
}

function validateAvailability(input?: Availability): Availability {
  const rows = input && input.length > 0 ? input : DEFAULT_AVAILABILITY;
  return rows.map((row) => {
    if (!Number.isInteger(row.weekday) || row.weekday < 0 || row.weekday > 6) {
      throw new ConvexError({ code: "INVALID_WEEKDAY", weekday: row.weekday });
    }
    const startMinutes = parseTime(row.start);
    const endMinutes = parseTime(row.end);
    if (startMinutes >= endMinutes) {
      throw new ConvexError({ code: "INVALID_AVAILABILITY_RANGE" });
    }
    return {
      weekday: row.weekday,
      start: row.start.trim(),
      end: row.end.trim(),
    };
  });
}

async function writeClinicAudit(
  ctx: ClinicMutationCtx,
  args: {
    action: string;
    targetType: string;
    targetId: string;
    payload?: unknown;
  },
) {
  await writeAudit(ctx, {
    action: args.action,
    targetType: args.targetType,
    targetId: args.targetId,
    payload: args.payload,
  });
}

export const listWorkspace = tenantQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const services = await ctx.db
      .query("clinicServices")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .take(40);
    const knowledge = (
      await ctx.db
        .query("clinicKnowledgeItems")
        .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
        .order("desc")
        .take(40)
    ).filter((item) => item.status !== "archived");
    const openCases = await ctx.db
      .query("humanCases")
      .withIndex("by_tenant_status_sla", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("status", "open"),
      )
      .take(20);
    const assignedCases = await ctx.db
      .query("humanCases")
      .withIndex("by_tenant_status_sla", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("status", "assigned"),
      )
      .take(20);
    const followUpRules = await ctx.db
      .query("followUpRules")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .take(40);
    const dueFollowUps = await ctx.db
      .query("followUpTasks")
      .withIndex("by_status_due", (q) =>
        q.eq("status", "scheduled").lt("dueAt", now + 7 * 24 * 60 * 60_000),
      )
      .filter((q) => q.eq(q.field("tenantId"), ctx.tenantId))
      .take(60);
    const appointments = await ctx.db
      .query("clinicAppointments")
      .withIndex("by_tenant_start", (q) =>
        q
          .eq("tenantId", ctx.tenantId)
          .gte("startAt", now - 24 * 60 * 60_000)
          .lt("startAt", now + SLOT_LOOKAHEAD_DAYS * 24 * 60 * 60_000),
      )
      .take(30);

    const blockingItems: string[] = [];
    if (!services.some((service) => service.status === "active")) {
      blockingItems.push("service");
    }
    if (!knowledge.some((item) => item.status === "active")) {
      blockingItems.push("knowledge");
    }
    if (!followUpRules.some((rule) => rule.status === "active")) {
      blockingItems.push("follow_up");
    }

    return {
      services,
      knowledge,
      humanCases: [...openCases, ...assignedCases].sort(
        (a, b) => a.slaDueAt - b.slaDueAt,
      ),
      followUpRules,
      followUpTasks: dueFollowUps
        .filter((task) => task.tenantId === ctx.tenantId)
        .sort((a, b) => a.dueAt - b.dueAt)
        .slice(0, 20),
      appointments,
      readiness: {
        hasActiveService: services.some((service) => service.status === "active"),
        hasActiveKnowledge: knowledge.some((item) => item.status === "active"),
        hasActiveFollowUp: followUpRules.some((rule) => rule.status === "active"),
        openHumanCases: openCases.length + assignedCases.length,
        blockingItems,
      },
    };
  },
});

export const bootstrapDefaults = tenantMutation({
  args: {},
  returns: v.object({ created: v.array(v.string()) }),
  handler: async (ctx) => {
    requireCapability(ctx.role, "clinic.manage_settings");
    const now = Date.now();
    const existingService = await ctx.db
      .query("clinicServices")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .first();
    const existingKnowledge = await ctx.db
      .query("clinicKnowledgeItems")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .first();
    const existingFollowUp = await ctx.db
      .query("followUpRules")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .first();

    const created: string[] = [];
    if (!existingService) {
      const serviceId = await ctx.db.insert("clinicServices", {
        tenantId: ctx.tenantId,
        name: "Consulta inicial",
        durationMinutes: 45,
        professionalName: "Equipa da clínica",
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 15,
        availability: DEFAULT_AVAILABILITY,
        status: "active",
        createdBy: ctx.memberId,
        createdAt: now,
        updatedAt: now,
      });
      await writeClinicAudit(ctx, {
        action: "clinic.service.created",
        targetType: "clinicService",
        targetId: serviceId,
        payload: { source: "bootstrap" },
      });
      created.push("service");
    }

    if (!existingKnowledge) {
      const itemId = await ctx.db.insert("clinicKnowledgeItems", {
        tenantId: ctx.tenantId,
        kind: "faq",
        title: "FAQ inicial da clínica",
        body:
          "Responde com calma, confirma sempre serviço e horário, e chama a equipa quando faltar informação clínica segura.",
        status: "active",
        currentVersion: 1,
        createdBy: ctx.memberId,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("clinicKnowledgeRevisions", {
        tenantId: ctx.tenantId,
        itemId,
        version: 1,
        title: "FAQ inicial da clínica",
        body:
          "Responde com calma, confirma sempre serviço e horário, e chama a equipa quando faltar informação clínica segura.",
        changedBy: ctx.memberId,
        createdAt: now,
      });
      await writeClinicAudit(ctx, {
        action: "clinic.knowledge.created",
        targetType: "clinicKnowledgeItem",
        targetId: itemId,
        payload: { source: "bootstrap" },
      });
      created.push("knowledge");
    }

    if (!existingFollowUp) {
      const ruleId = await ctx.db.insert("followUpRules", {
        tenantId: ctx.tenantId,
        name: "Lead sem resposta",
        trigger: "no_reply",
        delayMinutes: 180,
        message:
          "Olá! Continuamos por aqui para ajudar com o teu pedido. Queres que a equipa veja um horário para ti?",
        stopOnReply: true,
        status: "active",
        createdBy: ctx.memberId,
        createdAt: now,
        updatedAt: now,
      });
      await writeClinicAudit(ctx, {
        action: "clinic.follow_up_rule.created",
        targetType: "followUpRule",
        targetId: ruleId,
        payload: { source: "bootstrap" },
      });
      created.push("follow_up");
    }

    return { created };
  },
});

export const createService = tenantMutation({
  args: {
    name: v.string(),
    durationMinutes: v.number(),
    professionalName: v.optional(v.string()),
    bufferBeforeMinutes: v.optional(v.number()),
    bufferAfterMinutes: v.optional(v.number()),
    availability: v.optional(availabilityValidator),
  },
  returns: v.id("clinicServices"),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "clinic.manage_settings");
    const name = assertLength(args.name, "name", 2, 80);
    const durationMinutes = Math.round(args.durationMinutes);
    if (durationMinutes < 10 || durationMinutes > 480) {
      throw new ConvexError({ code: "INVALID_DURATION" });
    }
    const bufferBeforeMinutes = Math.round(args.bufferBeforeMinutes ?? 0);
    const bufferAfterMinutes = Math.round(args.bufferAfterMinutes ?? 15);
    if (
      bufferBeforeMinutes < 0 ||
      bufferBeforeMinutes > 240 ||
      bufferAfterMinutes < 0 ||
      bufferAfterMinutes > 240
    ) {
      throw new ConvexError({ code: "INVALID_BUFFER" });
    }
    const now = Date.now();
    const serviceId = await ctx.db.insert("clinicServices", {
      tenantId: ctx.tenantId,
      name,
      durationMinutes,
      professionalName: optionalText(args.professionalName, 80),
      bufferBeforeMinutes,
      bufferAfterMinutes,
      availability: validateAvailability(args.availability),
      status: "active",
      createdBy: ctx.memberId,
      createdAt: now,
      updatedAt: now,
    });
    await writeClinicAudit(ctx, {
      action: "clinic.service.created",
      targetType: "clinicService",
      targetId: serviceId,
    });
    return serviceId;
  },
});

export const saveKnowledgeItem = tenantMutation({
  args: {
    itemId: v.optional(v.id("clinicKnowledgeItems")),
    kind: knowledgeKindValidator,
    title: v.string(),
    body: v.string(),
    status: v.optional(v.union(v.literal("draft"), v.literal("active"))),
  },
  returns: v.object({ itemId: v.id("clinicKnowledgeItems"), version: v.number() }),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "clinic.manage_settings");
    const title = assertLength(args.title, "title", 2, 120);
    const body = assertLength(args.body, "body", 10, 12_000);
    const now = Date.now();
    if (args.itemId) {
      const current = await loadByIdInTenant(ctx, "clinicKnowledgeItems", args.itemId);
      const version = current.currentVersion + 1;
      await ctx.db.patch(current._id, {
        kind: args.kind,
        title,
        body,
        status: args.status ?? "active",
        currentVersion: version,
        updatedAt: now,
      });
      await ctx.db.insert("clinicKnowledgeRevisions", {
        tenantId: ctx.tenantId,
        itemId: current._id,
        version,
        title,
        body,
        changedBy: ctx.memberId,
        createdAt: now,
      });
      await writeClinicAudit(ctx, {
        action: "clinic.knowledge.updated",
        targetType: "clinicKnowledgeItem",
        targetId: current._id,
        payload: { version },
      });
      return { itemId: current._id, version };
    }

    const itemId = await ctx.db.insert("clinicKnowledgeItems", {
      tenantId: ctx.tenantId,
      kind: args.kind,
      title,
      body,
      status: args.status ?? "active",
      currentVersion: 1,
      createdBy: ctx.memberId,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("clinicKnowledgeRevisions", {
      tenantId: ctx.tenantId,
      itemId,
      version: 1,
      title,
      body,
      changedBy: ctx.memberId,
      createdAt: now,
    });
    await writeClinicAudit(ctx, {
      action: "clinic.knowledge.created",
      targetType: "clinicKnowledgeItem",
      targetId: itemId,
      payload: { version: 1 },
    });
    return { itemId, version: 1 };
  },
});

export const listKnowledgeRevisions = tenantQuery({
  args: { itemId: v.id("clinicKnowledgeItems") },
  handler: async (ctx, args) => {
    await loadByIdInTenant(ctx, "clinicKnowledgeItems", args.itemId);
    return await ctx.db
      .query("clinicKnowledgeRevisions")
      .withIndex("by_item_version", (q) => q.eq("itemId", args.itemId))
      .order("desc")
      .take(20);
  },
});

export const createFollowUpRule = tenantMutation({
  args: {
    name: v.string(),
    trigger: followUpTriggerValidator,
    delayMinutes: v.number(),
    message: v.string(),
  },
  returns: v.id("followUpRules"),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "clinic.manage_settings");
    const delayMinutes = Math.round(args.delayMinutes);
    if (delayMinutes < 5 || delayMinutes > 60 * 24 * 30) {
      throw new ConvexError({ code: "INVALID_DELAY" });
    }
    const now = Date.now();
    const ruleId = await ctx.db.insert("followUpRules", {
      tenantId: ctx.tenantId,
      name: assertLength(args.name, "name", 2, 80),
      trigger: args.trigger,
      delayMinutes,
      message: assertLength(args.message, "message", 5, 2_000),
      stopOnReply: true,
      status: "active",
      createdBy: ctx.memberId,
      createdAt: now,
      updatedAt: now,
    });
    await writeClinicAudit(ctx, {
      action: "clinic.follow_up_rule.created",
      targetType: "followUpRule",
      targetId: ruleId,
    });
    return ruleId;
  },
});

export const scheduleFollowUp = tenantMutation({
  args: {
    ruleId: v.id("followUpRules"),
    threadId: v.optional(v.id("channelThreads")),
    humanCaseId: v.optional(v.id("humanCases")),
    businessKey: v.optional(v.string()),
    dueAt: v.optional(v.number()),
  },
  returns: v.object({ taskId: v.id("followUpTasks"), created: v.boolean() }),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "clinic.manage_agenda");
    const rule = await loadByIdInTenant(ctx, "followUpRules", args.ruleId);
    if (rule.status !== "active") {
      throw new ConvexError({ code: "FOLLOW_UP_RULE_PAUSED" });
    }
    const thread = args.threadId
      ? await loadByIdInTenant(ctx, "channelThreads", args.threadId)
      : null;
    const humanCase = args.humanCaseId
      ? await loadByIdInTenant(ctx, "humanCases", args.humanCaseId)
      : null;
    if (!thread && !humanCase) {
      throw new ConvexError({ code: "FOLLOW_UP_TARGET_REQUIRED" });
    }
    const businessKey =
      optionalText(args.businessKey, 160) ??
      `followup:${rule._id}:${thread?._id ?? humanCase?._id}:${rule.trigger}`;
    const existing = await ctx.db
      .query("followUpTasks")
      .withIndex("by_business_key", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("businessKey", businessKey),
      )
      .first();
    if (existing) return { taskId: existing._id, created: false };

    const now = Date.now();
    const dueAt = args.dueAt ?? now + rule.delayMinutes * 60_000;
    const taskId = await ctx.db.insert("followUpTasks", {
      tenantId: ctx.tenantId,
      ruleId: rule._id,
      threadId: thread?._id,
      humanCaseId: humanCase?._id,
      kind: "rule",
      message: rule.message,
      businessKey,
      dueAt,
      status: "scheduled",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    });
    if (thread) {
      await ctx.db.patch(thread._id, {
        nextStep: "Follow-up agendado. Para automaticamente se o paciente responder.",
        nextStepDueAt: dueAt,
        updatedAt: now,
      });
    }
    await writeClinicAudit(ctx, {
      action: "clinic.follow_up_task.scheduled",
      targetType: "followUpTask",
      targetId: taskId,
      payload: { ruleId: rule._id, dueAt },
    });
    return { taskId, created: true };
  },
});

const SLA_MINUTES_BY_URGENCY = { urgent: 30, high: 120, normal: 8 * 60, low: 24 * 60 } as const;

function slaMinutesFor(
  urgency: keyof typeof SLA_MINUTES_BY_URGENCY,
  override?: number,
): number {
  if (override !== undefined && Number.isFinite(override)) {
    return Math.min(Math.max(Math.round(override), 15), 2880);
  }
  return SLA_MINUTES_BY_URGENCY[urgency];
}

/**
 * Open a human case: the AI pauses (any in-flight run is stopped), the
 * thread moves to "awaiting team" with an SLA, and the timeline records it.
 * Idempotent per thread: a thread with an open case returns that case.
 */
export const createHumanCase = tenantMutation({
  args: {
    threadId: v.optional(v.id("channelThreads")),
    reason: v.string(),
    urgency: humanCaseUrgencyValidator,
    question: v.string(),
    responsibleMemberId: v.optional(v.id("members")),
    slaMinutes: v.optional(v.number()),
    openedFrom: v.optional(
      v.union(v.literal("inbox"), v.literal("operation"), v.literal("automation")),
    ),
  },
  returns: v.id("humanCases"),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "inbox.handoff");
    const thread = args.threadId
      ? await loadByIdInTenant(ctx, "channelThreads", args.threadId)
      : null;
    if (args.responsibleMemberId) {
      await loadByIdInTenant(ctx, "members", args.responsibleMemberId);
    }
    const result = await openHumanCaseInternal(ctx, {
      thread,
      reason: args.reason,
      urgency: args.urgency,
      question: args.question,
      responsibleMemberId: args.responsibleMemberId,
      slaMinutes: args.slaMinutes,
      openedFrom: args.openedFrom ?? "operation",
      actorKind: "member",
    });
    return result.caseId;
  },
});

export const assignHumanCase = tenantMutation({
  args: {
    caseId: v.id("humanCases"),
    responsibleMemberId: v.id("members"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "inbox.handoff");
    const humanCase = await loadByIdInTenant(ctx, "humanCases", args.caseId);
    if (humanCase.status === "resolved") return null;
    await loadByIdInTenant(ctx, "members", args.responsibleMemberId);
    const now = Date.now();
    await ctx.db.patch(humanCase._id, {
      status: "assigned",
      responsibleMemberId: args.responsibleMemberId,
      assignedAt: now,
      updatedAt: now,
    });
    const thread = humanCase.threadId ? await ctx.db.get(humanCase.threadId) : null;
    if (thread) {
      await ctx.db.patch(thread._id, {
        responsibleMemberId: args.responsibleMemberId,
        updatedAt: now,
      });
      await recordThreadSystemEvent(ctx, {
        thread,
        kind: "handoff.case_assigned",
        severity: "info",
        actorType: "member",
        actorMemberId: ctx.memberId,
        humanCaseId: humanCase._id,
        dedupeKey: `case:${humanCase._id}:assigned:${args.responsibleMemberId}`,
        now,
      });
    }
    await writeClinicAudit(ctx, {
      action: "clinic.human_case.assigned",
      targetType: "humanCase",
      targetId: humanCase._id,
      payload: { responsibleMemberId: args.responsibleMemberId },
    });
    return null;
  },
});

/**
 * Close a human case with a decision. `returnToAi` hands the thread back to
 * automation (next inbound is eligible for bots again); otherwise the team
 * keeps the conversation. The stage returns from awaiting_human to where it
 * was before the case.
 */
export const resolveHumanCase = tenantMutation({
  args: {
    caseId: v.id("humanCases"),
    decision: v.string(),
    returnToAi: v.optional(v.boolean()),
  },
  returns: v.object({ resolved: v.boolean(), idempotent: v.optional(v.boolean()) }),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "inbox.handoff");
    const humanCase = await loadByIdInTenant(ctx, "humanCases", args.caseId);
    if (humanCase.status === "resolved") {
      return { resolved: false, idempotent: true };
    }
    const now = Date.now();
    const returnToAi = args.returnToAi === true;
    await ctx.db.patch(humanCase._id, {
      status: "resolved",
      decision: assertLength(args.decision, "decision", 2, 2_000),
      resolvedAt: now,
      returnedToAiAt: returnToAi ? now : undefined,
      updatedAt: now,
    });
    const thread = humanCase.threadId ? await ctx.db.get(humanCase.threadId) : null;
    if (thread) {
      const restoredLeadStatus =
        thread.leadStatus === "awaiting_human"
          ? (humanCase.previousLeadStatus ?? "interested")
          : thread.leadStatus;
      await ctx.db.patch(thread._id, {
        openHumanCaseId: undefined,
        leadStatus: restoredLeadStatus,
        inboxStatus: returnToAi ? "open" : "active",
        nextStep: returnToAi
          ? "Devolvida à IA com a decisão registada."
          : "Decisão humana registada. A equipa continua o atendimento.",
        nextStepDueAt: now + 60 * 60_000,
        updatedAt: now,
      });
      await setThreadAutomationMode(
        ctx,
        thread,
        returnToAi ? "idle" : "human",
        returnToAi ? "human_case_returned_to_ai" : "human_case_resolved",
        now,
      );
      await recordThreadSystemEvent(ctx, {
        thread,
        kind: "handoff.case_resolved",
        severity: "info",
        actorType: "member",
        actorMemberId: ctx.memberId,
        humanCaseId: humanCase._id,
        payload: { decision: args.decision.slice(0, 160) },
        dedupeKey: `case:${humanCase._id}:resolved`,
        now,
      });
      if (returnToAi) {
        await recordThreadSystemEvent(ctx, {
          thread,
          kind: "handoff.returned_to_ai",
          severity: "info",
          actorType: "member",
          actorMemberId: ctx.memberId,
          humanCaseId: humanCase._id,
          dedupeKey: `case:${humanCase._id}:returned`,
          now,
        });
      }
    }
    await writeClinicAudit(ctx, {
      action: "clinic.human_case.resolved",
      targetType: "humanCase",
      targetId: humanCase._id,
      payload: { returnToAi, threadId: thread?._id },
    });
    await emitWebhookEvent(ctx, { tenantId: ctx.tenantId, type: "human_case.resolved", eventId: `human_case:${humanCase._id}:resolved`, payload: { caseId: humanCase._id, threadId: humanCase.threadId, decision: args.decision.slice(0, 200), returnToAi: args.returnToAi ?? false }, now });
    return { resolved: true };
  },
});

/** Migrate step for A5: cache the open case on its thread. Idempotent. */
export const _backfillOpenHumanCases = internalMutation({
  args: { cursor: v.optional(v.string()) },
  returns: v.object({ patched: v.number(), isDone: v.boolean() }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("humanCases")
      .paginate({ cursor: args.cursor ?? null, numItems: 100 });
    let patched = 0;
    for (const humanCase of page.page) {
      if (humanCase.status === "resolved" || !humanCase.threadId) continue;
      const thread = await ctx.db.get(humanCase.threadId);
      if (!thread || thread.openHumanCaseId === humanCase._id) continue;
      await ctx.db.patch(thread._id, { openHumanCaseId: humanCase._id, updatedAt: Date.now() });
      patched += 1;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.clinic._backfillOpenHumanCases, {
        cursor: page.continueCursor,
      });
    }
    return { patched, isDone: page.isDone };
  },
});

const professionalStatusValidator = v.union(v.literal("active"), v.literal("archived"));
const appointmentSourceValidator = v.union(
  v.literal("operation"),
  v.literal("inbox"),
  v.literal("agenda"),
  v.literal("ai"),
  v.literal("patient"),
);
const slotValidator = v.object({
  startAt: v.number(),
  endAt: v.number(),
  label: v.string(),
  available: v.boolean(),
  professionalId: v.optional(v.id("clinicProfessionals")),
});

const AGENDA_RANGE_MAX_DAYS = 31;
const AGENDA_TAKE = 500;

/**
 * Free slots for a service on a local date. When professionals exist, pass
 * `professionalId` to check that calendar; otherwise the service calendar
 * (pre-B4 behaviour). Bounded reads, tenant timezone.
 */
export const listAvailableSlots = tenantQuery({
  args: {
    serviceId: v.id("clinicServices"),
    date: v.string(),
    stepMinutes: v.optional(v.number()),
    professionalId: v.optional(v.id("clinicProfessionals")),
  },
  returns: v.array(slotValidator),
  handler: async (ctx, args) => {
    await loadByIdInTenant(ctx, "clinicServices", args.serviceId);
    if (args.professionalId) await loadByIdInTenant(ctx, "clinicProfessionals", args.professionalId);
    return await listSlotsInternal(ctx, {
      tenantId: ctx.tenantId,
      serviceId: args.serviceId,
      date: args.date,
      professionalId: args.professionalId,
      stepMinutes: args.stepMinutes,
    });
  },
});

/**
 * Book a slot. Idempotent per `businessKey` — the contract AI tools (C3) and
 * the inbox use: the caller only gets an appointment id after the row exists.
 */
export const reserveSlot = tenantMutation({
  args: {
    serviceId: v.id("clinicServices"),
    professionalId: v.optional(v.id("clinicProfessionals")),
    threadId: v.optional(v.id("channelThreads")),
    patientName: v.optional(v.string()),
    patientHandle: v.optional(v.string()),
    startAt: v.number(),
    businessKey: v.optional(v.string()),
    source: v.optional(appointmentSourceValidator),
    notes: v.optional(v.string()),
  },
  returns: v.object({ appointmentId: v.id("clinicAppointments"), created: v.boolean() }),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "clinic.manage_agenda");
    if (args.threadId) await loadByIdInTenant(ctx, "channelThreads", args.threadId);
    return await reserveSlotInternal(ctx, {
      serviceId: args.serviceId,
      professionalId: args.professionalId,
      threadId: args.threadId,
      patientName: args.patientName,
      patientHandle: args.patientHandle,
      startAt: args.startAt,
      businessKey:
        args.businessKey?.trim() ||
        slotBusinessKey({ memberId: ctx.memberId, serviceId: args.serviceId, startAt: args.startAt, threadId: args.threadId, patientName: args.patientName }),
      source: args.source ?? (args.threadId ? "inbox" : "operation"),
      notes: args.notes,
    });
  },
});

/** Kept for the Operação panel; same engine as `reserveSlot`. */
export const createAppointment = tenantMutation({
  args: {
    serviceId: v.id("clinicServices"),
    professionalId: v.optional(v.id("clinicProfessionals")),
    threadId: v.optional(v.id("channelThreads")),
    patientName: v.optional(v.string()),
    patientHandle: v.optional(v.string()),
    startAt: v.number(),
  },
  returns: v.id("clinicAppointments"),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "clinic.manage_agenda");
    if (args.threadId) await loadByIdInTenant(ctx, "channelThreads", args.threadId);
    const result = await reserveSlotInternal(ctx, {
      serviceId: args.serviceId,
      professionalId: args.professionalId,
      threadId: args.threadId,
      patientName: args.patientName,
      patientHandle: args.patientHandle,
      startAt: args.startAt,
      businessKey: slotBusinessKey({ memberId: ctx.memberId, serviceId: args.serviceId, startAt: args.startAt, threadId: args.threadId, patientName: args.patientName }),
      source: args.threadId ? "inbox" : "operation",
    });
    return result.appointmentId;
  },
});

export const rescheduleAppointment = tenantMutation({
  args: {
    appointmentId: v.id("clinicAppointments"),
    startAt: v.number(),
    professionalId: v.optional(v.id("clinicProfessionals")),
  },
  returns: v.object({ appointmentId: v.id("clinicAppointments"), created: v.boolean() }),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "clinic.manage_agenda");
    await loadByIdInTenant(ctx, "clinicAppointments", args.appointmentId);
    return await rescheduleInternal(ctx, {
      appointmentId: args.appointmentId,
      startAt: args.startAt,
      professionalId: args.professionalId,
      businessKey: `reschedule:${args.appointmentId}:${args.startAt}`,
      source: "agenda",
    });
  },
});

export const cancelAppointment = tenantMutation({
  args: {
    appointmentId: v.id("clinicAppointments"),
    reason: v.optional(v.string()),
    by: v.optional(v.union(v.literal("clinic"), v.literal("patient"))),
  },
  returns: v.object({ cancelled: v.boolean(), idempotent: v.optional(v.boolean()) }),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "clinic.manage_agenda");
    await loadByIdInTenant(ctx, "clinicAppointments", args.appointmentId);
    return await cancelInternal(ctx, {
      appointmentId: args.appointmentId,
      by: args.by ?? "clinic",
      reason: args.reason,
    });
  },
});

export const confirmAppointment = tenantMutation({
  args: {
    appointmentId: v.id("clinicAppointments"),
    confirmationReadAt: v.optional(v.number()),
    via: v.optional(v.union(v.literal("manual"), v.literal("reply"), v.literal("ai"))),
  },
  returns: v.object({ confirmed: v.boolean(), idempotent: v.optional(v.boolean()) }),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "clinic.manage_agenda");
    await loadByIdInTenant(ctx, "clinicAppointments", args.appointmentId);
    return await confirmInternal(ctx, {
      appointmentId: args.appointmentId,
      via: args.via ?? "manual",
      at: args.confirmationReadAt,
    });
  },
});

export const recordAppointmentOutcome = tenantMutation({
  args: {
    appointmentId: v.id("clinicAppointments"),
    status: appointmentOutcomeValidator,
  },
  returns: v.object({
    updated: v.boolean(),
    idempotent: v.optional(v.boolean()),
    followUpTaskId: v.optional(v.id("followUpTasks")),
  }),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "clinic.manage_agenda");
    await loadByIdInTenant(ctx, "clinicAppointments", args.appointmentId);
    return await outcomeInternal(ctx, { appointmentId: args.appointmentId, status: args.status });
  },
});

const agendaRowValidator = v.object({
  _id: v.id("clinicAppointments"),
  serviceId: v.id("clinicServices"),
  serviceName: v.string(),
  professionalId: v.optional(v.id("clinicProfessionals")),
  professionalName: v.optional(v.string()),
  threadId: v.optional(v.id("channelThreads")),
  threadKey: v.optional(v.string()),
  channelId: v.optional(v.id("channels")),
  patientName: v.optional(v.string()),
  patientHandle: v.optional(v.string()),
  startAt: v.number(),
  endAt: v.number(),
  status: v.string(),
  source: v.optional(v.string()),
  confirmedVia: v.optional(v.string()),
  notes: v.optional(v.string()),
  pendingNotices: v.number(),
});

/** Appointments in a local date range (≤31 days), optionally per professional. */
export const listAgenda = tenantQuery({
  args: {
    from: v.string(),
    to: v.string(),
    professionalId: v.optional(v.id("clinicProfessionals")),
    includeCancelled: v.optional(v.boolean()),
  },
  returns: v.object({ rows: v.array(agendaRowValidator), timeZone: v.string(), capped: v.boolean() }),
  handler: async (ctx, args) => {
    const timeZone = await tenantTimeZone(ctx, ctx.tenantId);
    parseDate(args.from);
    parseDate(args.to);
    const start = localTimeToTimestamp(args.from, "00:00", timeZone);
    const end = localTimeToTimestamp(addDays(args.to, 1), "00:00", timeZone);
    if (end <= start || end - start > AGENDA_RANGE_MAX_DAYS * 24 * 60 * 60_000) {
      throw new ConvexError({ code: "INVALID_RANGE" });
    }
    const rows = (args.professionalId
      ? await ctx.db
          .query("clinicAppointments")
          .withIndex("by_professional_start", (q) =>
            q.eq("professionalId", args.professionalId).gte("startAt", start).lt("startAt", end),
          )
          .take(AGENDA_TAKE + 1)
      : await ctx.db
          .query("clinicAppointments")
          .withIndex("by_tenant_start", (q) => q.eq("tenantId", ctx.tenantId).gte("startAt", start).lt("startAt", end))
          .take(AGENDA_TAKE + 1)) as Doc<"clinicAppointments">[];
    const services = new Map<string, Doc<"clinicServices">>();
    const professionals = new Map<string, Doc<"clinicProfessionals">>();
    const out = [];
    for (const row of rows.slice(0, AGENDA_TAKE)) {
      if (row.tenantId !== ctx.tenantId) continue;
      if (!args.includeCancelled && row.status === "cancelled") continue;
      let service = services.get(row.serviceId);
      if (!service) {
        service = (await ctx.db.get(row.serviceId)) ?? undefined;
        if (service) services.set(row.serviceId, service);
      }
      let professional: Doc<"clinicProfessionals"> | undefined;
      if (row.professionalId) {
        professional = professionals.get(row.professionalId);
        if (!professional) {
          professional = (await ctx.db.get(row.professionalId)) ?? undefined;
          if (professional) professionals.set(row.professionalId, professional);
        }
      }
      const thread = row.threadId ? await ctx.db.get(row.threadId) : null;
      const pending = await ctx.db
        .query("followUpTasks")
        .withIndex("by_appointment", (q) => q.eq("appointmentId", row._id).eq("status", "scheduled"))
        .take(5);
      out.push({
        _id: row._id,
        serviceId: row.serviceId,
        serviceName: service?.name ?? "",
        professionalId: row.professionalId,
        professionalName: professional?.name,
        threadId: row.threadId,
        threadKey: thread?.threadKey,
        channelId: thread?.channelId,
        patientName: row.patientName ?? thread?.threadKey,
        patientHandle: row.patientHandle,
        startAt: row.startAt,
        endAt: row.endAt,
        status: row.status,
        source: row.source,
        confirmedVia: row.confirmedVia,
        notes: row.notes,
        pendingNotices: pending.length,
      });
    }
    return { rows: out, timeZone, capped: rows.length > AGENDA_TAKE };
  },
});

export const listThreadAppointments = tenantQuery({
  args: { threadId: v.id("channelThreads") },
  returns: v.array(agendaRowValidator),
  handler: async (ctx, args) => {
    const thread = await loadByIdInTenant(ctx, "channelThreads", args.threadId);
    const rows = (await ctx.db
      .query("clinicAppointments")
      .withIndex("by_thread", (q) => q.eq("tenantId", ctx.tenantId).eq("threadId", thread._id))
      .order("desc")
      .take(20)) as Doc<"clinicAppointments">[];
    const out = [];
    for (const row of rows) {
      const service = await ctx.db.get(row.serviceId);
      const professional = row.professionalId ? await ctx.db.get(row.professionalId) : null;
      const pending = await ctx.db
        .query("followUpTasks")
        .withIndex("by_appointment", (q) => q.eq("appointmentId", row._id).eq("status", "scheduled"))
        .take(5);
      out.push({
        _id: row._id,
        serviceId: row.serviceId,
        serviceName: service?.name ?? "",
        professionalId: row.professionalId,
        professionalName: professional?.name,
        threadId: row.threadId,
        threadKey: thread.threadKey,
        channelId: thread.channelId,
        patientName: row.patientName,
        patientHandle: row.patientHandle,
        startAt: row.startAt,
        endAt: row.endAt,
        status: row.status,
        source: row.source,
        confirmedVia: row.confirmedVia,
        notes: row.notes,
        pendingNotices: pending.length,
      });
    }
    return out;
  },
});

/**
 * Queue a confirmation request or reminder for an appointment. The follow-up
 * executor (B5) sends it through the guarded outbox; idempotent per kind.
 */
export const sendAppointmentNotice = tenantMutation({
  args: {
    appointmentId: v.id("clinicAppointments"),
    kind: v.union(v.literal("appointment_confirmation"), v.literal("appointment_reminder")),
    dueAt: v.optional(v.number()),
  },
  returns: v.object({ taskId: v.id("followUpTasks"), created: v.boolean() }),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "clinic.manage_agenda");
    const appointment = await loadByIdInTenant(ctx, "clinicAppointments", args.appointmentId);
    if (!appointment.threadId) throw new ConvexError({ code: "FOLLOW_UP_TARGET_REQUIRED" });
    if (!isBookableStatus(appointment.status)) throw new ConvexError({ code: "APPOINTMENT_NOT_BOOKABLE" });
    const now = Date.now();
    const businessKey = `appointment:${appointment._id}:${args.kind}${args.kind === "appointment_reminder" && args.dueAt ? `:${args.dueAt}` : ""}`;
    const existing = await ctx.db
      .query("followUpTasks")
      .withIndex("by_business_key", (q) => q.eq("tenantId", ctx.tenantId).eq("businessKey", businessKey))
      .first();
    if (existing) return { taskId: existing._id, created: false };
    const [service, settings, tenant] = await Promise.all([
      ctx.db.get(appointment.serviceId),
      loadClinicSettings(ctx, ctx.tenantId),
      ctx.db.get(ctx.tenantId),
    ]);
    const timeZone = await tenantTimeZone(ctx, ctx.tenantId);
    const useTemplate =
      args.kind === "appointment_confirmation"
        ? settings?.confirmationTemplateName
        : settings?.reminderTemplateName;
    const message = appointmentNoticeText({
      kind: args.kind,
      settings,
      patientName: appointment.patientName,
      serviceName: service?.name ?? "consulta",
      when: formatLocalDateTime(appointment.startAt, timeZone),
      clinicName: tenant?.name ?? "clínica",
    });
    const dueAt = Math.max(now, args.dueAt ?? now);
    const taskId = await ctx.db.insert("followUpTasks", {
      tenantId: ctx.tenantId,
      threadId: appointment.threadId,
      appointmentId: appointment._id,
      kind: args.kind,
      message,
      templateName: useTemplate,
      templateLanguage:
        args.kind === "appointment_confirmation"
          ? settings?.confirmationTemplateLanguage
          : settings?.reminderTemplateLanguage,
      businessKey,
      dueAt,
      status: "scheduled",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    });
    await writeClinicAudit(ctx, {
      action: `clinic.appointment.notice_queued`,
      targetType: "clinicAppointment",
      targetId: appointment._id,
      payload: { kind: args.kind, taskId, dueAt },
    });
    return { taskId, created: true };
  },
});

// ---------------------------------------------------------------------------
// Professionals + settings
// ---------------------------------------------------------------------------

const professionalRowValidator = v.object({
  _id: v.id("clinicProfessionals"),
  name: v.string(),
  specialty: v.optional(v.string()),
  color: v.optional(v.string()),
  memberId: v.optional(v.id("members")),
  availability: v.optional(availabilityValidator),
  status: professionalStatusValidator,
  order: v.number(),
});

export const listProfessionals = tenantQuery({
  args: { includeArchived: v.optional(v.boolean()) },
  returns: v.array(professionalRowValidator),
  handler: async (ctx, args) => {
    const active = (await ctx.db
      .query("clinicProfessionals")
      .withIndex("by_tenant_status", (q) => q.eq("tenantId", ctx.tenantId).eq("status", "active"))
      .take(100)) as Doc<"clinicProfessionals">[];
    const archived = args.includeArchived
      ? ((await ctx.db
          .query("clinicProfessionals")
          .withIndex("by_tenant_status", (q) => q.eq("tenantId", ctx.tenantId).eq("status", "archived"))
          .take(100)) as Doc<"clinicProfessionals">[])
      : [];
    return [...active, ...archived].map((row) => ({
      _id: row._id,
      name: row.name,
      specialty: row.specialty,
      color: row.color,
      memberId: row.memberId,
      availability: row.availability,
      status: row.status,
      order: row.order,
    }));
  },
});

export const saveProfessional = tenantMutation({
  args: {
    professionalId: v.optional(v.id("clinicProfessionals")),
    name: v.string(),
    specialty: v.optional(v.string()),
    color: v.optional(v.string()),
    memberId: v.optional(v.id("members")),
    availability: v.optional(availabilityValidator),
    serviceIds: v.optional(v.array(v.id("clinicServices"))),
  },
  returns: v.id("clinicProfessionals"),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "clinic.manage_settings");
    const name = assertLength(args.name, "name", 2, 80);
    const availability = args.availability && args.availability.length > 0 ? validateAvailability(args.availability) : undefined;
    if (args.color && !/^#[0-9a-fA-F]{6}$/.test(args.color)) throw new ConvexError({ code: "INVALID_COLOR" });
    if (args.memberId) await loadByIdInTenant(ctx, "members", args.memberId);
    const now = Date.now();
    let professionalId: Id<"clinicProfessionals">;
    if (args.professionalId) {
      const existing = await loadByIdInTenant(ctx, "clinicProfessionals", args.professionalId);
      await ctx.db.patch(existing._id, {
        name,
        specialty: optionalText(args.specialty, 80),
        color: args.color,
        memberId: args.memberId,
        availability,
        updatedAt: now,
      });
      professionalId = existing._id;
    } else {
      const count = (await ctx.db
        .query("clinicProfessionals")
        .withIndex("by_tenant_status", (q) => q.eq("tenantId", ctx.tenantId).eq("status", "active"))
        .take(101)).length;
      if (count >= 100) throw new ConvexError({ code: "PROFESSIONAL_LIMIT" });
      professionalId = await ctx.db.insert("clinicProfessionals", {
        tenantId: ctx.tenantId,
        name,
        specialty: optionalText(args.specialty, 80),
        color: args.color,
        memberId: args.memberId,
        availability,
        status: "active",
        order: count,
        createdBy: ctx.memberId,
        createdAt: now,
        updatedAt: now,
      });
    }
    if (args.serviceIds) {
      for (const serviceId of args.serviceIds) {
        const service = await loadByIdInTenant(ctx, "clinicServices", serviceId);
        const ids = new Set(service.professionalIds ?? []);
        ids.add(professionalId);
        await ctx.db.patch(service._id, { professionalIds: Array.from(ids), updatedAt: now });
      }
    }
    await writeClinicAudit(ctx, {
      action: args.professionalId ? "clinic.professional.updated" : "clinic.professional.created",
      targetType: "clinicProfessional",
      targetId: professionalId,
      payload: { name },
    });
    return professionalId;
  },
});

export const archiveProfessional = tenantMutation({
  args: { professionalId: v.id("clinicProfessionals") },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "clinic.manage_settings");
    const professional = await loadByIdInTenant(ctx, "clinicProfessionals", args.professionalId);
    if (professional.status === "archived") return null;
    await ctx.db.patch(professional._id, { status: "archived", updatedAt: Date.now() });
    await writeClinicAudit(ctx, {
      action: "clinic.professional.archived",
      targetType: "clinicProfessional",
      targetId: professional._id,
    });
    return null;
  },
});

const clinicSettingsValidator = v.object({
  timezone: v.string(),
  slotStepMinutes: v.number(),
  minLeadMinutes: v.number(),
  reminderHoursBefore: v.array(v.number()),
  confirmationTemplateName: v.optional(v.string()),
  confirmationTemplateLanguage: v.optional(v.string()),
  reminderTemplateName: v.optional(v.string()),
  reminderTemplateLanguage: v.optional(v.string()),
  confirmationText: v.optional(v.string()),
  reminderText: v.optional(v.string()),
  fallbackText: v.optional(v.string()),
  humanSlaMinutes: v.number(),
  firstResponseSlaMinutes: v.number(),
});

export const getSettings = tenantQuery({
  args: {},
  returns: clinicSettingsValidator,
  handler: async (ctx) => {
    const settings = await loadClinicSettings(ctx, ctx.tenantId);
    const timeZone = await tenantTimeZone(ctx, ctx.tenantId);
    return {
      timezone: timeZone,
      slotStepMinutes: settings?.slotStepMinutes ?? DEFAULT_SLOT_STEP_MINUTES,
      minLeadMinutes: settings?.minLeadMinutes ?? 30,
      reminderHoursBefore: settings?.reminderHoursBefore ?? [24],
      confirmationTemplateName: settings?.confirmationTemplateName,
      confirmationTemplateLanguage: settings?.confirmationTemplateLanguage,
      reminderTemplateName: settings?.reminderTemplateName,
      reminderTemplateLanguage: settings?.reminderTemplateLanguage,
      confirmationText: settings?.confirmationText,
      reminderText: settings?.reminderText,
      fallbackText: settings?.fallbackText,
      humanSlaMinutes: settings?.humanSlaMinutes ?? 8 * 60,
      firstResponseSlaMinutes: settings?.firstResponseSlaMinutes ?? 15,
    };
  },
});

export const saveSettings = tenantMutation({
  args: {
    timezone: v.optional(v.string()),
    slotStepMinutes: v.optional(v.number()),
    minLeadMinutes: v.optional(v.number()),
    reminderHoursBefore: v.optional(v.array(v.number())),
    confirmationTemplateName: v.optional(v.string()),
    confirmationTemplateLanguage: v.optional(v.string()),
    reminderTemplateName: v.optional(v.string()),
    reminderTemplateLanguage: v.optional(v.string()),
    confirmationText: v.optional(v.string()),
    reminderText: v.optional(v.string()),
    fallbackText: v.optional(v.string()),
    humanSlaMinutes: v.optional(v.number()),
    firstResponseSlaMinutes: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "clinic.manage_settings");
    if (args.timezone !== undefined && !isValidTimeZone(args.timezone)) {
      throw new ConvexError({ code: "INVALID_TIMEZONE" });
    }
    const clampInt = (value: number | undefined, min: number, max: number) =>
      value === undefined ? undefined : Math.min(max, Math.max(min, Math.round(value)));
    const reminders = args.reminderHoursBefore
      ?.map((h) => clampInt(h, 1, 168)!)
      .filter((h, i, all) => all.indexOf(h) === i)
      .slice(0, 3);
    const patch = {
      timezone: args.timezone,
      slotStepMinutes: clampInt(args.slotStepMinutes, 5, 120),
      minLeadMinutes: clampInt(args.minLeadMinutes, 0, 24 * 60),
      reminderHoursBefore: reminders,
      confirmationTemplateName: optionalText(args.confirmationTemplateName, 120),
      confirmationTemplateLanguage: optionalText(args.confirmationTemplateLanguage, 12),
      reminderTemplateName: optionalText(args.reminderTemplateName, 120),
      reminderTemplateLanguage: optionalText(args.reminderTemplateLanguage, 12),
      confirmationText: optionalText(args.confirmationText, 1000),
      reminderText: optionalText(args.reminderText, 1000),
      fallbackText: optionalText(args.fallbackText, 1000),
      humanSlaMinutes: clampInt(args.humanSlaMinutes, 15, 2880),
      firstResponseSlaMinutes: clampInt(args.firstResponseSlaMinutes, 1, 1440),
    };
    const now = Date.now();
    const existing = await loadClinicSettings(ctx, ctx.tenantId);
    const defined = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
    if (existing) {
      await ctx.db.patch(existing._id, { ...defined, updatedBy: ctx.memberId, updatedAt: now });
    } else {
      await ctx.db.insert("clinicSettings", {
        tenantId: ctx.tenantId,
        ...defined,
        updatedBy: ctx.memberId,
        updatedAt: now,
      });
    }
    await writeClinicAudit(ctx, {
      action: "clinic.settings.updated",
      targetType: "clinicSettings",
      targetId: String(ctx.tenantId),
      payload: { keys: Object.keys(defined) },
    });
    return null;
  },
});
