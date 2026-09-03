import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { writeAudit } from "./audit";
import { emitWebhookEvent } from "./webhooks";
import { markCampaignConversion } from "./campaignAttribution";
import { recordThreadSystemEvent } from "./channels/systemEvents";
import {
  addDays,
  formatLocalTime,
  localDateOf,
  localTimeToTimestamp,
  minuteOfDayOf,
  parseDate,
  parseTime,
  resolveTimeZone,
  weekdayOfDate,
} from "./clinicTime";

export type AgendaCtx = {
  db: any;
  tenantId: Id<"tenants">;
  memberId: Id<"members">;
  role?: string;
};

export const CONFLICT_SCAN_LIMIT = 200;
export const DEFAULT_MIN_LEAD_MINUTES = 30;

export type AppointmentSource = "operation" | "inbox" | "agenda" | "ai" | "patient";

export function isBookableStatus(status: Doc<"clinicAppointments">["status"]): boolean {
  return status === "scheduled" || status === "confirmed";
}

export async function tenantTimeZone(ctx: { db: any }, tenantId: Id<"tenants">): Promise<string> {
  const settings = (await ctx.db
    .query("clinicSettings")
    .withIndex("by_tenant", (q: any) => q.eq("tenantId", tenantId))
    .unique()) as Doc<"clinicSettings"> | null;
  if (settings?.timezone) return resolveTimeZone(settings.timezone);
  const tenant = (await ctx.db.get(tenantId)) as Doc<"tenants"> | null;
  return resolveTimeZone(tenant?.settings.timezone);
}

export async function loadClinicSettings(
  ctx: { db: any },
  tenantId: Id<"tenants">,
): Promise<Doc<"clinicSettings"> | null> {
  return (await ctx.db
    .query("clinicSettings")
    .withIndex("by_tenant", (q: any) => q.eq("tenantId", tenantId))
    .unique()) as Doc<"clinicSettings"> | null;
}

export function appointmentRange(service: Doc<"clinicServices">, startAt: number) {
  const endAt = startAt + service.durationMinutes * 60_000;
  return {
    startAt,
    endAt,
    protectedStartAt: startAt - service.bufferBeforeMinutes * 60_000,
    protectedEndAt: endAt + service.bufferAfterMinutes * 60_000,
  };
}

export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

type Availability = Array<{ weekday: number; start: string; end: string }>;

export function coversStart(
  availability: Availability,
  service: Doc<"clinicServices">,
  startAt: number,
  timeZone: string,
): boolean {
  const date = localDateOf(startAt, timeZone);
  const weekday = weekdayOfDate(date, timeZone);
  const local = minuteOfDayOf(startAt, timeZone);
  const endMinutes = local + service.durationMinutes;
  return availability.some(
    (slot) => slot.weekday === weekday && local >= parseTime(slot.start) && endMinutes <= parseTime(slot.end),
  );
}

/**
 * Conflicts are per professional when the booking names one; otherwise per
 * service (the pre-B4 behaviour). Bounded scan around the slot.
 */
export async function findConflict(
  ctx: { db: any },
  args: {
    tenantId: Id<"tenants">;
    service: Doc<"clinicServices">;
    professionalId?: Id<"clinicProfessionals">;
    startAt: number;
    ignoreAppointmentId?: Id<"clinicAppointments">;
  },
): Promise<Doc<"clinicAppointments"> | null> {
  const range = appointmentRange(args.service, args.startAt);
  const windowStart = range.protectedStartAt - 12 * 60 * 60_000;
  const windowEnd = range.protectedEndAt + 12 * 60 * 60_000;
  const candidates = (args.professionalId
    ? await ctx.db
        .query("clinicAppointments")
        .withIndex("by_professional_start", (q: any) =>
          q.eq("professionalId", args.professionalId).gte("startAt", windowStart).lt("startAt", windowEnd),
        )
        .take(CONFLICT_SCAN_LIMIT)
    : await ctx.db
        .query("clinicAppointments")
        .withIndex("by_service_start", (q: any) =>
          q.eq("serviceId", args.service._id).gte("startAt", windowStart).lt("startAt", windowEnd),
        )
        .take(CONFLICT_SCAN_LIMIT)) as Doc<"clinicAppointments">[];
  for (const appointment of candidates) {
    if (appointment.tenantId !== args.tenantId) continue;
    if (appointment._id === args.ignoreAppointmentId) continue;
    if (!isBookableStatus(appointment.status)) continue;
    const bufferBefore = args.service.bufferBeforeMinutes * 60_000;
    const bufferAfter = args.service.bufferAfterMinutes * 60_000;
    if (
      overlaps(
        range.protectedStartAt,
        range.protectedEndAt,
        appointment.startAt - bufferBefore,
        appointment.endAt + bufferAfter,
      )
    ) {
      return appointment;
    }
  }
  return null;
}

async function loadProfessional(
  ctx: { db: any },
  tenantId: Id<"tenants">,
  professionalId: Id<"clinicProfessionals">,
): Promise<Doc<"clinicProfessionals">> {
  const professional = (await ctx.db.get(professionalId)) as Doc<"clinicProfessionals"> | null;
  if (!professional || professional.tenantId !== tenantId) {
    throw new ConvexError({ code: "PROFESSIONAL_NOT_FOUND" });
  }
  if (professional.status !== "active") throw new ConvexError({ code: "PROFESSIONAL_NOT_ACTIVE" });
  return professional;
}

export type ReserveSlotArgs = {
  serviceId: Id<"clinicServices">;
  professionalId?: Id<"clinicProfessionals">;
  threadId?: Id<"channelThreads">;
  patientName?: string;
  patientHandle?: string;
  startAt: number;
  businessKey: string;
  source: AppointmentSource;
  notes?: string;
  allowPast?: boolean;
};

/**
 * The booking primitive. Idempotent per (tenant, businessKey): a retry, a
 * double click or an AI tool re-run returns the same appointment. Validates
 * availability (service + professional), conflicts and the lead time, then
 * moves the thread to `booked` and attributes a campaign conversion.
 */
export async function reserveSlotInternal(
  ctx: AgendaCtx,
  args: ReserveSlotArgs,
): Promise<{ appointmentId: Id<"clinicAppointments">; created: boolean }> {
  const businessKey = args.businessKey.trim().slice(0, 160);
  if (!businessKey) throw new ConvexError({ code: "INVALID_BUSINESS_KEY" });
  const existing = (await ctx.db
    .query("clinicAppointments")
    .withIndex("by_tenant_business_key", (q: any) =>
      q.eq("tenantId", ctx.tenantId).eq("businessKey", businessKey),
    )
    .unique()) as Doc<"clinicAppointments"> | null;
  if (existing) return { appointmentId: existing._id, created: false };

  const service = (await ctx.db.get(args.serviceId)) as Doc<"clinicServices"> | null;
  if (!service || service.tenantId !== ctx.tenantId) throw new ConvexError({ code: "NOT_FOUND" });
  if (service.status !== "active") throw new ConvexError({ code: "SERVICE_NOT_ACTIVE" });
  const timeZone = await tenantTimeZone(ctx, ctx.tenantId);
  const settings = await loadClinicSettings(ctx, ctx.tenantId);
  const now = Date.now();
  const minLead = (settings?.minLeadMinutes ?? DEFAULT_MIN_LEAD_MINUTES) * 60_000;
  if (!args.allowPast && args.startAt < now + minLead) {
    throw new ConvexError({ code: "APPOINTMENT_IN_PAST" });
  }
  if (!coversStart(service.availability, service, args.startAt, timeZone)) {
    throw new ConvexError({ code: "APPOINTMENT_OUTSIDE_AVAILABILITY" });
  }
  let professional: Doc<"clinicProfessionals"> | null = null;
  if (args.professionalId) {
    professional = await loadProfessional(ctx, ctx.tenantId, args.professionalId);
    if (service.professionalIds && service.professionalIds.length > 0 && !service.professionalIds.includes(professional._id)) {
      throw new ConvexError({ code: "PROFESSIONAL_NOT_FOR_SERVICE" });
    }
    if (professional.availability && professional.availability.length > 0 && !coversStart(professional.availability, service, args.startAt, timeZone)) {
      throw new ConvexError({ code: "APPOINTMENT_OUTSIDE_AVAILABILITY" });
    }
  }
  const conflict = await findConflict(ctx, {
    tenantId: ctx.tenantId,
    service,
    professionalId: professional?._id,
    startAt: args.startAt,
  });
  if (conflict) throw new ConvexError({ code: "APPOINTMENT_SLOT_UNAVAILABLE" });

  const thread = args.threadId
    ? ((await ctx.db.get(args.threadId)) as Doc<"channelThreads"> | null)
    : null;
  if (args.threadId && (!thread || thread.tenantId !== ctx.tenantId)) {
    throw new ConvexError({ code: "THREAD_NOT_FOUND" });
  }
  const range = appointmentRange(service, args.startAt);
  const appointmentId = (await ctx.db.insert("clinicAppointments", {
    tenantId: ctx.tenantId,
    serviceId: service._id,
    professionalId: professional?._id,
    threadId: thread?._id,
    patientName: args.patientName?.trim().slice(0, 120) || undefined,
    patientHandle: args.patientHandle?.trim().slice(0, 120) || undefined,
    startAt: range.startAt,
    endAt: range.endAt,
    status: "scheduled",
    businessKey,
    source: args.source,
    notes: args.notes?.trim().slice(0, 500) || undefined,
    createdBy: ctx.memberId,
    createdAt: now,
    updatedAt: now,
  })) as Id<"clinicAppointments">;

  if (thread) {
    await ctx.db.patch(thread._id, {
      leadStatus: "booked",
      nextStep: "Agendamento criado. Confirmar presença antes da consulta.",
      nextStepDueAt: Math.max(now, range.startAt - 24 * 60 * 60_000),
      updatedAt: now,
    });
    await recordThreadSystemEvent(ctx, {
      thread,
      kind: "agenda.booked",
      severity: "info",
      actorType: args.source === "ai" ? "automation" : "member",
      actorMemberId: args.source === "ai" ? undefined : ctx.memberId,
      payload: { appointmentId, startAt: range.startAt, serviceName: service.name },
      dedupeKey: `agenda:${appointmentId}:booked`,
      now,
    });
    await markCampaignConversion(ctx, {
      tenantId: ctx.tenantId,
      channelId: thread.channelId,
      threadKey: thread.threadKey,
      label: "booking",
      now,
    });
  }
  await emitWebhookEvent(ctx, {
    tenantId: ctx.tenantId,
    type: "appointment.booked",
    eventId: `appointment:${appointmentId}:booked`,
    payload: { appointmentId, serviceId: service._id, serviceName: service.name, professionalId: professional?._id, startAt: range.startAt, endAt: range.endAt, threadKey: thread?.threadKey, source: args.source },
    now,
  });
  await writeAudit(ctx, {
    action: "clinic.appointment.created",
    targetType: "clinicAppointment",
    targetId: appointmentId,
    payload: { serviceId: service._id, professionalId: professional?._id, startAt: range.startAt, source: args.source },
    actorKind: args.source === "ai" ? "ai" : "member",
  });
  return { appointmentId, created: true };
}

export async function loadAppointment(
  ctx: { db: any; tenantId: Id<"tenants"> },
  appointmentId: Id<"clinicAppointments">,
): Promise<Doc<"clinicAppointments">> {
  const appointment = (await ctx.db.get(appointmentId)) as Doc<"clinicAppointments"> | null;
  if (!appointment || appointment.tenantId !== ctx.tenantId) throw new ConvexError({ code: "NOT_FOUND" });
  return appointment;
}

export async function confirmInternal(
  ctx: AgendaCtx,
  args: { appointmentId: Id<"clinicAppointments">; via: "manual" | "reply" | "ai"; at?: number },
): Promise<{ confirmed: boolean; idempotent?: boolean }> {
  const appointment = await loadAppointment(ctx, args.appointmentId);
  if (appointment.status === "confirmed") return { confirmed: false, idempotent: true };
  if (appointment.status !== "scheduled") throw new ConvexError({ code: "APPOINTMENT_NOT_BOOKABLE" });
  const now = args.at ?? Date.now();
  await ctx.db.patch(appointment._id, {
    status: "confirmed",
    confirmedVia: args.via,
    confirmedAt: now,
    confirmationReadAt: appointment.confirmationReadAt ?? now,
    updatedAt: now,
  });
  await stopAppointmentTasks(ctx, appointment._id, "confirmed", now);
  if (appointment.threadId) {
    const thread = (await ctx.db.get(appointment.threadId)) as Doc<"channelThreads"> | null;
    if (thread) {
      await ctx.db.patch(thread._id, {
        leadStatus: "confirmed",
        nextStep: "Consulta confirmada. Monitorar comparecimento.",
        nextStepDueAt: appointment.startAt,
        updatedAt: now,
      });
      await recordThreadSystemEvent(ctx, {
        thread,
        kind: "agenda.confirmed",
        severity: "info",
        actorType: args.via === "manual" ? "member" : args.via === "ai" ? "automation" : "system",
        actorMemberId: args.via === "manual" ? ctx.memberId : undefined,
        payload: { appointmentId: appointment._id, via: args.via },
        dedupeKey: `agenda:${appointment._id}:confirmed`,
        now,
      });
      await markCampaignConversion(ctx, {
        tenantId: ctx.tenantId,
        channelId: thread.channelId,
        threadKey: thread.threadKey,
        label: "confirmed",
        now,
      });
    }
  }
  await emitWebhookEvent(ctx, { tenantId: ctx.tenantId, type: "appointment.confirmed", eventId: `appointment:${appointment._id}:confirmed`, payload: { appointmentId: appointment._id, startAt: appointment.startAt, via: args.via, threadId: appointment.threadId }, now });
  await writeAudit(ctx, {
    action: "clinic.appointment.confirmed",
    targetType: "clinicAppointment",
    targetId: appointment._id,
    payload: { via: args.via },
    actorKind: args.via === "manual" ? "member" : args.via === "ai" ? "ai" : "system",
  });
  return { confirmed: true };
}

export async function cancelInternal(
  ctx: AgendaCtx,
  args: {
    appointmentId: Id<"clinicAppointments">;
    by: "clinic" | "patient" | "system";
    reason?: string;
    at?: number;
  },
): Promise<{ cancelled: boolean; idempotent?: boolean }> {
  const appointment = await loadAppointment(ctx, args.appointmentId);
  if (appointment.status === "cancelled") return { cancelled: false, idempotent: true };
  if (!isBookableStatus(appointment.status)) throw new ConvexError({ code: "APPOINTMENT_NOT_BOOKABLE" });
  const now = args.at ?? Date.now();
  await ctx.db.patch(appointment._id, {
    status: "cancelled",
    cancelledAt: now,
    cancelledBy: args.by,
    cancelReason: args.reason?.trim().slice(0, 300) || undefined,
    updatedAt: now,
  });
  await stopAppointmentTasks(ctx, appointment._id, "cancelled", now);
  if (appointment.threadId) {
    const thread = (await ctx.db.get(appointment.threadId)) as Doc<"channelThreads"> | null;
    if (thread) {
      await ctx.db.patch(thread._id, {
        leadStatus: "interested",
        nextStep: "Consulta cancelada. Oferecer nova data.",
        nextStepDueAt: now + 24 * 60 * 60_000,
        updatedAt: now,
      });
      await recordThreadSystemEvent(ctx, {
        thread,
        kind: "agenda.cancelled",
        severity: "warning",
        actorType: args.by === "clinic" ? "member" : "system",
        actorMemberId: args.by === "clinic" ? ctx.memberId : undefined,
        payload: { appointmentId: appointment._id, by: args.by, reason: args.reason?.slice(0, 120) },
        dedupeKey: `agenda:${appointment._id}:cancelled`,
        now,
      });
    }
  }
  await writeAudit(ctx, {
    action: "clinic.appointment.cancelled",
    targetType: "clinicAppointment",
    targetId: appointment._id,
    payload: { by: args.by, reason: args.reason?.slice(0, 120) },
  });
  await emitWebhookEvent(ctx, { tenantId: ctx.tenantId, type: "appointment.cancelled", eventId: `appointment:${appointment._id}:cancelled`, payload: { appointmentId: appointment._id, startAt: appointment.startAt, by: args.by, reason: args.reason?.slice(0, 120), threadId: appointment.threadId }, now });
  return { cancelled: true };
}

/** Cancel + book: the new appointment links back, the old one forward. */
export async function rescheduleInternal(
  ctx: AgendaCtx,
  args: {
    appointmentId: Id<"clinicAppointments">;
    startAt: number;
    professionalId?: Id<"clinicProfessionals">;
    businessKey: string;
    source: AppointmentSource;
  },
): Promise<{ appointmentId: Id<"clinicAppointments">; created: boolean }> {
  const previous = await loadAppointment(ctx, args.appointmentId);
  if (previous.rescheduledToId) {
    return { appointmentId: previous.rescheduledToId, created: false };
  }
  if (!isBookableStatus(previous.status)) throw new ConvexError({ code: "APPOINTMENT_NOT_BOOKABLE" });
  const service = (await ctx.db.get(previous.serviceId)) as Doc<"clinicServices"> | null;
  if (!service) throw new ConvexError({ code: "NOT_FOUND" });
  const professionalId = args.professionalId ?? previous.professionalId;
  const conflict = await findConflict(ctx, {
    tenantId: ctx.tenantId,
    service,
    professionalId,
    startAt: args.startAt,
    ignoreAppointmentId: previous._id,
  });
  if (conflict) throw new ConvexError({ code: "APPOINTMENT_SLOT_UNAVAILABLE" });
  const now = Date.now();
  await ctx.db.patch(previous._id, {
    status: "cancelled",
    cancelledAt: now,
    cancelledBy: args.source === "patient" ? "patient" : "clinic",
    cancelReason: "rescheduled",
    updatedAt: now,
  });
  await stopAppointmentTasks(ctx, previous._id, "rescheduled", now);
  const result = await reserveSlotInternal(ctx, {
    serviceId: previous.serviceId,
    professionalId,
    threadId: previous.threadId,
    patientName: previous.patientName,
    patientHandle: previous.patientHandle,
    startAt: args.startAt,
    businessKey: args.businessKey,
    source: args.source,
    notes: previous.notes,
  });
  await ctx.db.patch(result.appointmentId, { rescheduledFromId: previous._id });
  await ctx.db.patch(previous._id, { rescheduledToId: result.appointmentId });
  await writeAudit(ctx, {
    action: "clinic.appointment.rescheduled",
    targetType: "clinicAppointment",
    targetId: previous._id,
    payload: { to: result.appointmentId, startAt: args.startAt },
  });
  return result;
}

export async function outcomeInternal(
  ctx: AgendaCtx,
  args: { appointmentId: Id<"clinicAppointments">; status: "completed" | "no_show" | "cancelled" },
): Promise<{ updated: boolean; idempotent?: boolean; followUpTaskId?: Id<"followUpTasks"> }> {
  if (args.status === "cancelled") {
    const cancelled = await cancelInternal(ctx, { appointmentId: args.appointmentId, by: "clinic" });
    return { updated: cancelled.cancelled, idempotent: cancelled.idempotent };
  }
  const appointment = await loadAppointment(ctx, args.appointmentId);
  if (appointment.status === args.status) return { updated: false, idempotent: true };
  if (!isBookableStatus(appointment.status)) throw new ConvexError({ code: "APPOINTMENT_NOT_BOOKABLE" });
  const now = Date.now();
  await ctx.db.patch(appointment._id, { status: args.status, outcomeAt: now, updatedAt: now });
  await stopAppointmentTasks(ctx, appointment._id, args.status, now);
  let followUpTaskId: Id<"followUpTasks"> | undefined;
  if (appointment.threadId) {
    const thread = (await ctx.db.get(appointment.threadId)) as Doc<"channelThreads"> | null;
    if (thread) {
      await ctx.db.patch(thread._id, {
        leadStatus: args.status === "completed" ? "attended" : "no_show",
        nextStep:
          args.status === "completed"
            ? "Atendimento concluído. Pode entrar em rotina de retenção."
            : "Faltou à consulta. Oferecer remarcação.",
        nextStepDueAt: now + (args.status === "completed" ? 7 * 24 : 2) * 60 * 60_000,
        updatedAt: now,
      });
      await recordThreadSystemEvent(ctx, {
        thread,
        kind: args.status === "completed" ? "agenda.attended" : "agenda.no_show",
        severity: args.status === "completed" ? "info" : "warning",
        actorType: "member",
        actorMemberId: ctx.memberId,
        payload: { appointmentId: appointment._id },
        dedupeKey: `agenda:${appointment._id}:${args.status}`,
        now,
      });
      if (args.status === "completed") {
        await markCampaignConversion(ctx, {
          tenantId: ctx.tenantId,
          channelId: thread.channelId,
          threadKey: thread.threadKey,
          label: "attended",
          now,
        });
      } else {
        followUpTaskId = await scheduleRuleFollowUp(ctx, {
          trigger: "no_show",
          thread,
          appointmentId: appointment._id,
          now,
        });
      }
    }
  }
  await writeAudit(ctx, {
    action: `clinic.appointment.${args.status}`,
    targetType: "clinicAppointment",
    targetId: appointment._id,
  });
  await emitWebhookEvent(ctx, { tenantId: ctx.tenantId, type: args.status === "completed" ? "appointment.attended" : "appointment.no_show", eventId: `appointment:${appointment._id}:${args.status}`, payload: { appointmentId: appointment._id, startAt: appointment.startAt, threadId: appointment.threadId }, now });
  return { updated: true, followUpTaskId };
}

/** Pending notices for an appointment stop when it is no longer bookable. */
async function stopAppointmentTasks(
  ctx: { db: any },
  appointmentId: Id<"clinicAppointments">,
  reason: string,
  now: number,
) {
  const tasks = (await ctx.db
    .query("followUpTasks")
    .withIndex("by_appointment", (q: any) => q.eq("appointmentId", appointmentId).eq("status", "scheduled"))
    .take(20)) as Doc<"followUpTasks">[];
  for (const task of tasks) {
    await ctx.db.patch(task._id, { status: "stopped", stoppedReason: reason, updatedAt: now });
  }
}

/** Create a rule-driven follow-up task if an active rule exists for the trigger. */
export async function scheduleRuleFollowUp(
  ctx: { db: any; tenantId: Id<"tenants"> },
  args: {
    trigger: Doc<"followUpRules">["trigger"];
    thread: Doc<"channelThreads">;
    appointmentId?: Id<"clinicAppointments">;
    humanCaseId?: Id<"humanCases">;
    now: number;
  },
): Promise<Id<"followUpTasks"> | undefined> {
  const rules = (await ctx.db
    .query("followUpRules")
    .withIndex("by_tenant_status", (q: any) => q.eq("tenantId", ctx.tenantId).eq("status", "active"))
    .take(40)) as Doc<"followUpRules">[];
  const rule = rules.find((row) => row.trigger === args.trigger);
  if (!rule) return undefined;
  const businessKey = `followup:${rule._id}:${args.thread._id}:${args.trigger}${args.appointmentId ? `:${args.appointmentId}` : ""}`;
  const existing = (await ctx.db
    .query("followUpTasks")
    .withIndex("by_business_key", (q: any) => q.eq("tenantId", ctx.tenantId).eq("businessKey", businessKey))
    .first()) as Doc<"followUpTasks"> | null;
  if (existing) return existing._id;
  const dueAt = args.now + rule.delayMinutes * 60_000;
  const taskId = (await ctx.db.insert("followUpTasks", {
    tenantId: ctx.tenantId,
    ruleId: rule._id,
    threadId: args.thread._id,
    humanCaseId: args.humanCaseId,
    appointmentId: args.appointmentId,
    kind: "rule",
    message: rule.message,
    businessKey,
    dueAt,
    status: "scheduled",
    attempts: 0,
    createdAt: args.now,
    updatedAt: args.now,
  })) as Id<"followUpTasks">;
  return taskId;
}

/**
 * Inbound "confirmo" on a thread with an upcoming scheduled appointment
 * confirms it (via: reply). Called from the projection after classification.
 */
export async function autoConfirmFromReply(
  ctx: { db: any },
  args: { thread: Doc<"channelThreads">; now: number },
): Promise<Id<"clinicAppointments"> | null> {
  const upcoming = (await ctx.db
    .query("clinicAppointments")
    .withIndex("by_thread", (q: any) =>
      q.eq("tenantId", args.thread.tenantId).eq("threadId", args.thread._id).gte("startAt", args.now - 60 * 60_000),
    )
    .take(10)) as Doc<"clinicAppointments">[];
  const target = upcoming.find((row) => row.status === "scheduled");
  if (!target) return null;
  await confirmInternal(
    { db: ctx.db, tenantId: args.thread.tenantId, memberId: target.createdBy, role: "system" },
    { appointmentId: target._id, via: "reply", at: args.now },
  );
  return target._id;
}

/** Build the appointment notice text from settings (or a sane default). */
export function appointmentNoticeText(args: {
  kind: "appointment_confirmation" | "appointment_reminder";
  settings: Doc<"clinicSettings"> | null;
  patientName?: string;
  serviceName: string;
  when: string;
  clinicName: string;
}): string {
  const template =
    args.kind === "appointment_confirmation"
      ? args.settings?.confirmationText ??
        "Olá {{nome}}, a sua consulta de {{servico}} está marcada para {{quando}} na {{clinica}}. Responda CONFIRMO para confirmar."
      : args.settings?.reminderText ??
        "Olá {{nome}}, lembramos a sua consulta de {{servico}} {{quando}} na {{clinica}}. Se não puder vir, responda REMARCAR.";
  const firstName = (args.patientName ?? "").trim().split(/\s+/)[0] ?? "";
  return template
    .replace(/\{\{\s*(nome|name)\s*\}\}/gi, firstName)
    .replace(/\{\{\s*(servico|serviço|service)\s*\}\}/gi, args.serviceName)
    .replace(/\{\{\s*(quando|when)\s*\}\}/gi, args.when)
    .replace(/\{\{\s*(clinica|clínica|clinic)\s*\}\}/gi, args.clinicName)
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Default key for manual bookings: the same patient (thread, or name for
 * walk-ins) at the same slot is a double click; a different patient at the
 * same slot must go through the conflict check.
 */
export function slotBusinessKey(args: {
  memberId: Id<"members">;
  serviceId: Id<"clinicServices">;
  startAt: number;
  threadId?: Id<"channelThreads">;
  patientName?: string;
}): string {
  const who =
    args.threadId ??
    (args.patientName?.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 40) || `member:${args.memberId}`);
  return `manual:${who}:${args.serviceId}:${args.startAt}`;
}

export { localTimeToTimestamp };

export type SlotRow = {
  startAt: number;
  endAt: number;
  label: string;
  available: boolean;
  professionalId?: Id<"clinicProfessionals">;
};

/**
 * Free slots for a service on a local date (tenant timezone). Used by the
 * Operação/agenda queries and by the AI tool `consultar_agenda`.
 */
export async function listSlotsInternal(
  ctx: { db: any },
  args: {
    tenantId: Id<"tenants">;
    serviceId: Id<"clinicServices">;
    date: string;
    professionalId?: Id<"clinicProfessionals">;
    stepMinutes?: number;
    now?: number;
    limit?: number;
  },
): Promise<SlotRow[]> {
  const service = (await ctx.db.get(args.serviceId)) as Doc<"clinicServices"> | null;
  if (!service || service.tenantId !== args.tenantId) throw new ConvexError({ code: "NOT_FOUND" });
  if (service.status !== "active") return [];
  const timeZone = await tenantTimeZone(ctx, args.tenantId);
  const settings = await loadClinicSettings(ctx, args.tenantId);
  parseDate(args.date);
  const weekday = weekdayOfDate(args.date, timeZone);
  let professional: Doc<"clinicProfessionals"> | null = null;
  if (args.professionalId) {
    professional = (await ctx.db.get(args.professionalId)) as Doc<"clinicProfessionals"> | null;
    if (!professional || professional.tenantId !== args.tenantId) throw new ConvexError({ code: "PROFESSIONAL_NOT_FOUND" });
    if (professional.status !== "active") return [];
  }
  const availability =
    professional?.availability && professional.availability.length > 0 ? professional.availability : service.availability;
  const dayAvailability = availability.filter((slot) => slot.weekday === weekday);
  if (dayAvailability.length === 0) return [];
  const dayStart = localTimeToTimestamp(args.date, "00:00", timeZone);
  const dayEnd = localTimeToTimestamp(addDays(args.date, 1), "00:00", timeZone);
  const appointments = (professional
    ? await ctx.db
        .query("clinicAppointments")
        .withIndex("by_professional_start", (q: any) =>
          q.eq("professionalId", professional!._id).gte("startAt", dayStart - 6 * 60 * 60_000).lt("startAt", dayEnd),
        )
        .take(500)
    : await ctx.db
        .query("clinicAppointments")
        .withIndex("by_service_start", (q: any) =>
          q.eq("serviceId", service._id).gte("startAt", dayStart - 6 * 60 * 60_000).lt("startAt", dayEnd),
        )
        .take(500)) as Doc<"clinicAppointments">[];
  const busy = appointments
    .filter((row) => row.tenantId === args.tenantId && isBookableStatus(row.status))
    .map((row) => ({ start: row.startAt - service.bufferBeforeMinutes * 60_000, end: row.endAt + service.bufferAfterMinutes * 60_000 }));
  const step = Math.max(5, Math.min(120, Math.round(args.stepMinutes ?? settings?.slotStepMinutes ?? 30)));
  const now = args.now ?? Date.now();
  const minLead = (settings?.minLeadMinutes ?? DEFAULT_MIN_LEAD_MINUTES) * 60_000;
  const slots: SlotRow[] = [];
  const limit = args.limit ?? 96;
  for (const window of dayAvailability) {
    const start = localTimeToTimestamp(args.date, window.start, timeZone);
    const end = localTimeToTimestamp(args.date, window.end, timeZone);
    for (let startAt = start; startAt + service.durationMinutes * 60_000 <= end; startAt += step * 60_000) {
      const range = appointmentRange(service, startAt);
      const available = startAt >= now + minLead && !busy.some((b) => b.start < range.protectedEndAt && range.protectedStartAt < b.end);
      slots.push({ startAt, endAt: range.endAt, label: formatLocalTime(startAt, timeZone), available, professionalId: professional?._id });
      if (slots.length >= limit) return slots;
    }
  }
  return slots;
}
