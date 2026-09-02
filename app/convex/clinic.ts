import { ConvexError, v } from "convex/values";
import { writeAudit } from "./lib/audit";
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

const MAPUTO_OFFSET = "+02:00";
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

function dateParts(date: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new ConvexError({ code: "INVALID_DATE" });
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function weekdayFor(date: string) {
  const { year, month, day } = dateParts(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function localTimeToTimestamp(date: string, time: string) {
  dateParts(date);
  parseTime(time);
  return Date.parse(`${date}T${time}:00.000${MAPUTO_OFFSET}`);
}

function timestampToLocalDate(timestamp: number) {
  return new Date(timestamp + 2 * 60 * 60_000).toISOString().slice(0, 10);
}

function timestampToLocalMinuteOfDay(timestamp: number) {
  const shifted = new Date(timestamp + 2 * 60 * 60_000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

function appointmentConflictRange(
  service: Doc<"clinicServices">,
  startAt: number,
) {
  const endAt = startAt + service.durationMinutes * 60_000;
  return {
    startAt,
    endAt,
    protectedStartAt: startAt - service.bufferBeforeMinutes * 60_000,
    protectedEndAt: endAt + service.bufferAfterMinutes * 60_000,
  };
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && bStart < aEnd;
}

function isBookableStatus(status: Doc<"clinicAppointments">["status"]) {
  return status === "scheduled" || status === "confirmed";
}

async function assertNoAppointmentConflict(
  ctx: ClinicMutationCtx,
  service: Doc<"clinicServices">,
  startAt: number,
) {
  const range = appointmentConflictRange(service, startAt);
  const candidates = await ctx.db
    .query("clinicAppointments")
    .withIndex("by_service_start", (q: any) =>
      q
        .eq("serviceId", service._id)
        .gte("startAt", range.protectedStartAt - 12 * 60 * 60_000)
        .lt("startAt", range.protectedEndAt + 12 * 60 * 60_000),
    )
    .collect();

  const conflict = (candidates as Doc<"clinicAppointments">[]).find((appointment) => {
    if (appointment.tenantId !== ctx.tenantId || !isBookableStatus(appointment.status)) {
      return false;
    }
    const candidateProtectedStart =
      appointment.startAt - service.bufferBeforeMinutes * 60_000;
    const candidateProtectedEnd =
      appointment.endAt + service.bufferAfterMinutes * 60_000;
    return overlaps(
      range.protectedStartAt,
      range.protectedEndAt,
      candidateProtectedStart,
      candidateProtectedEnd,
    );
  });
  if (conflict) {
    throw new ConvexError({ code: "APPOINTMENT_SLOT_UNAVAILABLE" });
  }
  return range;
}

function serviceCoversStart(service: Doc<"clinicServices">, startAt: number) {
  const date = timestampToLocalDate(startAt);
  const weekday = weekdayFor(date);
  const localMinutes = timestampToLocalMinuteOfDay(startAt);
  const endMinutes = localMinutes + service.durationMinutes;
  return service.availability.some((slot) => {
    if (slot.weekday !== weekday) return false;
    return localMinutes >= parseTime(slot.start) && endMinutes <= parseTime(slot.end);
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
    if (thread?.openHumanCaseId) {
      const existing = await ctx.db.get(thread.openHumanCaseId);
      if (existing && existing.status !== "resolved") return existing._id;
    }
    if (args.responsibleMemberId) {
      await loadByIdInTenant(ctx, "members", args.responsibleMemberId);
    }
    const now = Date.now();
    const slaMinutes = slaMinutesFor(args.urgency, args.slaMinutes);
    const slaDueAt = now + slaMinutes * 60_000;
    const caseId = await ctx.db.insert("humanCases", {
      tenantId: ctx.tenantId,
      threadId: thread?._id,
      reason: assertLength(args.reason, "reason", 2, 80),
      urgency: args.urgency,
      question: assertLength(args.question, "question", 3, 2_000),
      status: args.responsibleMemberId ? "assigned" : "open",
      responsibleMemberId: args.responsibleMemberId,
      assignedAt: args.responsibleMemberId ? now : undefined,
      slaDueAt,
      previousLeadStatus:
        thread && thread.leadStatus !== "awaiting_human" ? thread.leadStatus : undefined,
      openedFrom: args.openedFrom ?? "operation",
      createdBy: ctx.memberId,
      createdAt: now,
      updatedAt: now,
    });
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
        actorType: "member",
        actorMemberId: ctx.memberId,
        humanCaseId: caseId,
        payload: { urgency: args.urgency, slaDueAt, reason: args.reason.slice(0, 80) },
        dedupeKey: `case:${caseId}:opened`,
        now,
      });
    }
    await writeClinicAudit(ctx, {
      action: "clinic.human_case.created",
      targetType: "humanCase",
      targetId: caseId,
      payload: { urgency: args.urgency, threadId: thread?._id, openedFrom: args.openedFrom },
    });
    return caseId;
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

export const listAvailableSlots = tenantQuery({
  args: {
    serviceId: v.id("clinicServices"),
    date: v.string(),
    stepMinutes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const service = await loadByIdInTenant(ctx, "clinicServices", args.serviceId);
    if (service.status !== "active") return [];
    const weekday = weekdayFor(args.date);
    const dayAvailability = service.availability.filter(
      (slot) => slot.weekday === weekday,
    );
    if (dayAvailability.length === 0) return [];

    const dayStart = localTimeToTimestamp(args.date, "00:00");
    const dayEnd = dayStart + 24 * 60 * 60_000;
    const appointments = await ctx.db
      .query("clinicAppointments")
      .withIndex("by_service_start", (q) =>
        q.eq("serviceId", service._id).gte("startAt", dayStart).lt("startAt", dayEnd),
      )
      .collect();
    const protectedAppointments = appointments
      .filter((appointment) => appointment.tenantId === ctx.tenantId)
      .filter((appointment) => isBookableStatus(appointment.status))
      .map((appointment) => ({
        start:
          appointment.startAt - service.bufferBeforeMinutes * 60_000,
        end: appointment.endAt + service.bufferAfterMinutes * 60_000,
      }));

    const step = Math.max(5, Math.min(120, Math.round(args.stepMinutes ?? DEFAULT_SLOT_STEP_MINUTES)));
    const slots: Array<{
      startAt: number;
      endAt: number;
      label: string;
      available: boolean;
    }> = [];
    for (const window of dayAvailability) {
      const start = localTimeToTimestamp(args.date, window.start);
      const end = localTimeToTimestamp(args.date, window.end);
      for (
        let startAt = start;
        startAt + service.durationMinutes * 60_000 <= end;
        startAt += step * 60_000
      ) {
        const range = appointmentConflictRange(service, startAt);
        const available = !protectedAppointments.some((appointment) =>
          overlaps(
            range.protectedStartAt,
            range.protectedEndAt,
            appointment.start,
            appointment.end,
          ),
        );
        slots.push({
          startAt,
          endAt: range.endAt,
          label: new Intl.DateTimeFormat("pt-MZ", {
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
            timeZone: "Africa/Maputo",
          }).format(startAt),
          available,
        });
      }
    }
    return slots.slice(0, 64);
  },
});

export const createAppointment = tenantMutation({
  args: {
    serviceId: v.id("clinicServices"),
    threadId: v.optional(v.id("channelThreads")),
    patientName: v.optional(v.string()),
    patientHandle: v.optional(v.string()),
    startAt: v.number(),
  },
  returns: v.id("clinicAppointments"),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "clinic.manage_agenda");
    const service = await loadByIdInTenant(ctx, "clinicServices", args.serviceId);
    if (service.status !== "active") {
      throw new ConvexError({ code: "SERVICE_NOT_ACTIVE" });
    }
    if (!serviceCoversStart(service, args.startAt)) {
      throw new ConvexError({ code: "APPOINTMENT_OUTSIDE_AVAILABILITY" });
    }
    const range = await assertNoAppointmentConflict(ctx, service, args.startAt);
    const thread = args.threadId
      ? await loadByIdInTenant(ctx, "channelThreads", args.threadId)
      : null;
    const now = Date.now();
    const appointmentId = await ctx.db.insert("clinicAppointments", {
      tenantId: ctx.tenantId,
      serviceId: service._id,
      threadId: thread?._id,
      patientName: optionalText(args.patientName, 120),
      patientHandle: optionalText(args.patientHandle, 120),
      startAt: range.startAt,
      endAt: range.endAt,
      status: "scheduled",
      createdBy: ctx.memberId,
      createdAt: now,
      updatedAt: now,
    });
    if (thread) {
      await ctx.db.patch(thread._id, {
        leadStatus: "booked",
        nextStep: "Agendamento criado. Confirmar presença antes da consulta.",
        nextStepDueAt: Math.max(now, range.startAt - 24 * 60 * 60_000),
        updatedAt: now,
      });
    }
    await writeClinicAudit(ctx, {
      action: "clinic.appointment.created",
      targetType: "clinicAppointment",
      targetId: appointmentId,
      payload: { serviceId: service._id, startAt: range.startAt },
    });
    return appointmentId;
  },
});

export const confirmAppointment = tenantMutation({
  args: {
    appointmentId: v.id("clinicAppointments"),
    confirmationReadAt: v.optional(v.number()),
  },
  returns: v.object({ confirmed: v.boolean(), idempotent: v.optional(v.boolean()) }),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "clinic.manage_agenda");
    const appointment = await loadByIdInTenant(ctx, "clinicAppointments", args.appointmentId);
    if (appointment.status === "confirmed") {
      return { confirmed: false, idempotent: true };
    }
    const now = Date.now();
    await ctx.db.patch(appointment._id, {
      status: "confirmed",
      confirmationReadAt: args.confirmationReadAt ?? now,
      updatedAt: now,
    });
    if (appointment.threadId) {
      await ctx.db.patch(appointment.threadId, {
        leadStatus: "confirmed",
        nextStep: "Consulta confirmada. Monitorar comparecimento.",
        nextStepDueAt: appointment.startAt,
        updatedAt: now,
      });
    }
    await writeClinicAudit(ctx, {
      action: "clinic.appointment.confirmed",
      targetType: "clinicAppointment",
      targetId: appointment._id,
    });
    return { confirmed: true };
  },
});

export const recordAppointmentOutcome = tenantMutation({
  args: {
    appointmentId: v.id("clinicAppointments"),
    status: appointmentOutcomeValidator,
  },
  returns: v.object({ updated: v.boolean(), idempotent: v.optional(v.boolean()) }),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "clinic.manage_agenda");
    const appointment = await loadByIdInTenant(ctx, "clinicAppointments", args.appointmentId);
    if (appointment.status === args.status) {
      return { updated: false, idempotent: true };
    }
    const now = Date.now();
    await ctx.db.patch(appointment._id, {
      status: args.status,
      updatedAt: now,
    });
    if (appointment.threadId) {
      await ctx.db.patch(appointment.threadId, {
        leadStatus: args.status === "completed" ? "confirmed" : "lost",
        nextStep:
          args.status === "completed"
            ? "Atendimento concluído. Pode entrar em rotina de retenção."
            : "Rever se precisa remarcar ou encerrar.",
        nextStepDueAt: now + 2 * 60 * 60_000,
        updatedAt: now,
      });
    }
    await writeClinicAudit(ctx, {
      action: `clinic.appointment.${args.status}`,
      targetType: "clinicAppointment",
      targetId: appointment._id,
    });
    return { updated: true };
  },
});
