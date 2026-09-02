import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import schema from "../schema";
import { localTimeToTimestamp } from "../lib/clinicTime";
import { normalizeWebhook } from "../integrations/iaSolutionHub/webhook";

const TZ = "Africa/Maputo";
const PATIENT = "258840000099";

function nextWeekday(target: number): string {
  const d = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  while (d.getUTCDay() !== target) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function seed(t: ReturnType<typeof convexTest>) {
  const base = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: "Owner" });
    const tenantId = await ctx.db.insert("tenants", {
      name: "Clínica Sol",
      vertical: "clinic",
      plan: "starter",
      settings: { defaultLocale: "pt-MZ", timezone: TZ, retentionDays: 730 },
      createdAt: Date.now(),
    });
    const memberId = await ctx.db.insert("members", { tenantId, userId, role: "owner", status: "active", createdAt: Date.now() });
    await ctx.db.insert("sessions", { userId, activeTenantId: tenantId, updatedAt: Date.now() });
    const agentUser = await ctx.db.insert("users", { name: "Agent" });
    await ctx.db.insert("members", { tenantId, userId: agentUser, role: "agent", status: "active", createdAt: Date.now() });
    await ctx.db.insert("sessions", { userId: agentUser, activeTenantId: tenantId, updatedAt: Date.now() });
    return { userId, agentUser, tenantId, memberId };
  });
  const pending = await t.withIdentity({ subject: base.userId }).mutation(api.iaSolutionHub.createPendingChannel, { displayName: "Piloto" });
  const channelId = pending.channelId;
  const now = Date.now();
  const threadId = await t.run(async (ctx) => {
    const identityId = await ctx.db.insert("channelIdentities", {
      tenantId: base.tenantId,
      channelId,
      providerScopedId: PATIENT,
      phone: PATIENT,
      displayName: "Ana Maria",
      createdAt: now,
      updatedAt: now,
    });
    const threadId = await ctx.db.insert("channelThreads", {
      tenantId: base.tenantId,
      channelId,
      threadKey: PATIENT,
      identityId,
      lastEventAt: now,
      lastEventKind: "message.text",
      unreadCount: 0,
      leadStatus: "wants_booking",
      serviceWindowExpiresAt: now + 6 * 60 * 60 * 1000,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("channelEvents", {
      tenantId: base.tenantId,
      channelId,
      eventKey: "in:1",
      eventKind: "message.text",
      direction: "incoming",
      threadKey: PATIENT,
      payload: { text: "Quero marcar" },
      rawPayload: "{}",
      rawBodySha256: "sha",
      status: "processed",
      attempts: 1,
      receivedAt: now,
    });
    return threadId;
  });
  const asOwner = t.withIdentity({ subject: base.userId });
  const serviceId = await asOwner.mutation(api.clinic.createService, { name: "Consulta", durationMinutes: 30, bufferAfterMinutes: 10 });
  return { ...base, channelId, threadId, serviceId, asOwner, asAgent: t.withIdentity({ subject: base.agentUser }) };
}

describe("clinic agenda", () => {
  it("reserves idempotently, respects professional calendars and lists the agenda", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    const date = nextWeekday(2);
    const startAt = localTimeToTimestamp(date, "09:00", TZ);

    const drA = await s.asOwner.mutation(api.clinic.saveProfessional, { name: "Dra. Alice", serviceIds: [s.serviceId] });
    const drB = await s.asOwner.mutation(api.clinic.saveProfessional, { name: "Dr. Bruno", serviceIds: [s.serviceId] });
    expect(await s.asOwner.query(api.clinic.listProfessionals, {})).toHaveLength(2);

    const first = await s.asAgent.mutation(api.clinic.reserveSlot, {
      serviceId: s.serviceId,
      professionalId: drA,
      threadId: s.threadId,
      startAt,
      businessKey: "ai:turn-1:reservar",
      source: "ai",
    });
    expect(first.created).toBe(true);
    const replay = await s.asAgent.mutation(api.clinic.reserveSlot, {
      serviceId: s.serviceId,
      professionalId: drA,
      threadId: s.threadId,
      startAt,
      businessKey: "ai:turn-1:reservar",
      source: "ai",
    });
    expect(replay).toEqual({ appointmentId: first.appointmentId, created: false });

    // Same time with Dra. Alice conflicts; Dr. Bruno is free.
    await expect(
      s.asOwner.mutation(api.clinic.reserveSlot, { serviceId: s.serviceId, professionalId: drA, startAt, patientName: "Outro" }),
    ).rejects.toThrow(/APPOINTMENT_SLOT_UNAVAILABLE/);
    const second = await s.asOwner.mutation(api.clinic.reserveSlot, { serviceId: s.serviceId, professionalId: drB, startAt, patientName: "Carlos" });
    expect(second.created).toBe(true);

    const slotsA = await s.asOwner.query(api.clinic.listAvailableSlots, { serviceId: s.serviceId, date, professionalId: drA });
    expect(slotsA.find((slot) => slot.startAt === startAt)?.available).toBe(false);
    // Buffer after (10 min) protects 09:30 too.
    expect(slotsA.find((slot) => slot.startAt === startAt + 30 * 60_000)?.available).toBe(false);
    expect(slotsA.find((slot) => slot.startAt === startAt + 60 * 60_000)?.available).toBe(true);

    const thread = await t.run(async (ctx) => (await ctx.db.get(s.threadId)) as Doc<"channelThreads">);
    expect(thread.leadStatus).toBe("booked");

    const agenda = await s.asOwner.query(api.clinic.listAgenda, { from: date, to: date });
    expect(agenda.timeZone).toBe(TZ);
    expect(agenda.rows).toHaveLength(2);
    expect(agenda.rows.map((r) => r.professionalName).sort()).toEqual(["Dr. Bruno", "Dra. Alice"]);
    const byProfessional = await s.asOwner.query(api.clinic.listAgenda, { from: date, to: date, professionalId: drB });
    expect(byProfessional.rows).toHaveLength(1);
    await expect(s.asOwner.query(api.clinic.listAgenda, { from: date, to: "2099-01-01" })).rejects.toThrow(/INVALID_RANGE/);

    // Past / too soon is refused.
    await expect(
      s.asOwner.mutation(api.clinic.reserveSlot, { serviceId: s.serviceId, startAt: Date.now() - 60_000 }),
    ).rejects.toThrow(/APPOINTMENT_IN_PAST/);
  });

  it("confirms via patient reply, reschedules with links, cancels and records outcomes", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    const date = nextWeekday(3);
    const startAt = localTimeToTimestamp(date, "10:00", TZ);
    const { appointmentId } = await s.asOwner.mutation(api.clinic.reserveSlot, {
      serviceId: s.serviceId,
      threadId: s.threadId,
      startAt,
      patientName: "Ana Maria",
    });

    // Notice queued for the executor (idempotent).
    const notice = await s.asOwner.mutation(api.clinic.sendAppointmentNotice, { appointmentId, kind: "appointment_confirmation" });
    expect(notice.created).toBe(true);
    expect((await s.asOwner.mutation(api.clinic.sendAppointmentNotice, { appointmentId, kind: "appointment_confirmation" })).created).toBe(false);
    const task = await t.run(async (ctx) => (await ctx.db.get(notice.taskId)) as Doc<"followUpTasks">);
    expect(task.kind).toBe("appointment_confirmation");
    expect(task.message).toContain("Ana");
    expect(task.message).toContain("Consulta");

    // Patient replies "Confirmo" → confirmed via reply, notice stopped.
    const payload = {
      contacts: [{ profile: { name: "Ana Maria" }, wa_id: PATIENT }],
      messages: [{ from: PATIENT, id: "wamid.confirm.1", timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: "Confirmo" } }],
    };
    await t.mutation(internal.iaSolutionHub.ingestWebhookEvents, {
      channelId: s.channelId,
      rawPayload: JSON.stringify(payload),
      rawBodySha256: "sha-confirm",
      events: normalizeWebhook(payload, "sha-confirm"),
    });
    const confirmed = await t.run(async (ctx) => ({
      appointment: (await ctx.db.get(appointmentId)) as Doc<"clinicAppointments">,
      task: (await ctx.db.get(notice.taskId)) as Doc<"followUpTasks">,
      thread: (await ctx.db.get(s.threadId)) as Doc<"channelThreads">,
      events: await ctx.db.query("threadSystemEvents").collect(),
    }));
    expect(confirmed.appointment.status).toBe("confirmed");
    expect(confirmed.appointment.confirmedVia).toBe("reply");
    expect(confirmed.task.status).toBe("stopped");
    expect(confirmed.thread.leadStatus).toBe("confirmed");
    expect(confirmed.events.map((e) => e.kind)).toEqual(expect.arrayContaining(["agenda.booked", "agenda.confirmed"]));
    expect((await s.asOwner.mutation(api.clinic.confirmAppointment, { appointmentId })).idempotent).toBe(true);

    // Reschedule: old cancelled with forward link, new scheduled with back link.
    const newStart = startAt + 24 * 60 * 60_000;
    const moved = await s.asOwner.mutation(api.clinic.rescheduleAppointment, { appointmentId, startAt: newStart });
    expect(moved.created).toBe(true);
    const again = await s.asOwner.mutation(api.clinic.rescheduleAppointment, { appointmentId, startAt: newStart });
    expect(again).toEqual({ appointmentId: moved.appointmentId, created: false });
    const pair = await t.run(async (ctx) => ({
      old: (await ctx.db.get(appointmentId)) as Doc<"clinicAppointments">,
      next: (await ctx.db.get(moved.appointmentId)) as Doc<"clinicAppointments">,
    }));
    expect(pair.old).toMatchObject({ status: "cancelled", cancelReason: "rescheduled", rescheduledToId: moved.appointmentId });
    expect(pair.next).toMatchObject({ status: "scheduled", rescheduledFromId: appointmentId, startAt: newStart });

    // Outcome: no-show → thread no_show + rule follow-up task when a rule exists.
    await s.asOwner.mutation(api.clinic.createFollowUpRule, {
      name: "Remarcar após falta",
      trigger: "no_show",
      delayMinutes: 60,
      message: "Olá, faltou à consulta. Quer remarcar?",
    });
    const outcome = await s.asOwner.mutation(api.clinic.recordAppointmentOutcome, { appointmentId: moved.appointmentId, status: "no_show" });
    expect(outcome.updated).toBe(true);
    expect(outcome.followUpTaskId).toBeDefined();
    const afterNoShow = await t.run(async (ctx) => ({
      thread: (await ctx.db.get(s.threadId)) as Doc<"channelThreads">,
      task: (await ctx.db.get(outcome.followUpTaskId!)) as Doc<"followUpTasks">,
    }));
    expect(afterNoShow.thread.leadStatus).toBe("no_show");
    expect(afterNoShow.task).toMatchObject({ kind: "rule", status: "scheduled" });
    await expect(
      s.asOwner.mutation(api.clinic.cancelAppointment, { appointmentId: moved.appointmentId }),
    ).rejects.toThrow(/APPOINTMENT_NOT_BOOKABLE/);

    // Attended path on a fresh booking.
    const third = await s.asOwner.mutation(api.clinic.reserveSlot, { serviceId: s.serviceId, threadId: s.threadId, startAt: newStart + 2 * 60 * 60_000 });
    expect((await s.asOwner.mutation(api.clinic.recordAppointmentOutcome, { appointmentId: third.appointmentId, status: "completed" })).updated).toBe(true);
    const attended = await t.run(async (ctx) => (await ctx.db.get(s.threadId)) as Doc<"channelThreads">);
    expect(attended.leadStatus).toBe("attended");
  });

  it("stores agenda settings with validation and uses the tenant timezone", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    await expect(s.asOwner.mutation(api.clinic.saveSettings, { timezone: "Mars/Olympus" })).rejects.toThrow(/INVALID_TIMEZONE/);
    await expect(s.asAgent.mutation(api.clinic.saveSettings, { slotStepMinutes: 15 })).rejects.toThrow(/FORBIDDEN_CAPABILITY/);
    await s.asOwner.mutation(api.clinic.saveSettings, {
      timezone: "Europe/Lisbon",
      slotStepMinutes: 15,
      minLeadMinutes: 0,
      reminderHoursBefore: [48, 24, 24, 2, 1],
      confirmationText: "Olá {{nome}}, {{servico}} em {{quando}}.",
    });
    const settings = await s.asOwner.query(api.clinic.getSettings, {});
    expect(settings).toMatchObject({ timezone: "Europe/Lisbon", slotStepMinutes: 15, minLeadMinutes: 0, reminderHoursBefore: [48, 24, 2] });
    const date = nextWeekday(4);
    const slots = await s.asOwner.query(api.clinic.listAvailableSlots, { serviceId: s.serviceId, date });
    // 08:00 Lisbon (summer or winter) is never 08:00 Maputo.
    expect(slots[0].label).toBe("08:00");
    expect(slots[0].startAt).toBe(localTimeToTimestamp(date, "08:00", "Europe/Lisbon"));
    expect(slots[1].startAt - slots[0].startAt).toBe(15 * 60_000);
  });
});
