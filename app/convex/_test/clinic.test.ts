import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import schema from "../schema";
import { projectThreadFromEvent } from "../lib/channels/projection";

async function seedTenant(t: ReturnType<typeof convexTest>) {
  const userId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", { name: "Clinic Owner" });
  });
  const seeded = await t.run(async (ctx) => {
    const tenantId = await ctx.db.insert("tenants", {
      name: "Open Clinic",
      vertical: "clinic",
      healthcareMode: true,
      plan: "growth",
      settings: {
        defaultLocale: "pt-PT",
        timezone: "Africa/Maputo",
        retentionDays: 730,
      },
      createdAt: Date.now(),
    });
    const memberId = await ctx.db.insert("members", {
      tenantId,
      userId,
      role: "owner",
      status: "active",
      createdAt: Date.now(),
    });
    await ctx.db.insert("sessions", {
      userId,
      activeTenantId: tenantId,
      updatedAt: Date.now(),
    });
    return { tenantId, memberId };
  });
  return { owner: t.withIdentity({ subject: userId }), userId, ...seeded };
}

async function seedChannelThread(
  t: ReturnType<typeof convexTest>,
  args: { tenantId: Id<"tenants">; memberId: Id<"members"> },
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const channelId = await ctx.db.insert("channels", {
      tenantId: args.tenantId,
      publicId: "lab_openbsp_clinic_test",
      kind: "whatsapp",
      provider: "iasolution_hub",
      operationalTerritory: "openbsp",
      externalAccountId: "hub-channel",
      displayName: "Clinic Lab",
      status: "active",
      sendMode: "allowlist",
      outboundAllowlist: ["258840000000"],
      createdBy: args.memberId,
      createdAt: now,
      updatedAt: now,
    });
    const channel = (await ctx.db.get(channelId)) as Doc<"channels">;
    const threadId = await ctx.db.insert("channelThreads", {
      tenantId: args.tenantId,
      channelId,
      threadKey: "258840000000",
      lastEventAt: now - 60_000,
      lastEventKind: "message.text",
      lastInboundAt: now - 60_000,
      unreadCount: 0,
      serviceWindowExpiresAt: now + 60_000,
      leadSource: "organic",
      leadStatus: "interested",
      nextStep: "Qualificar pedido.",
      createdAt: now - 60_000,
      updatedAt: now - 60_000,
    });
    return { channel, channelId, threadId };
  });
}

describe("clinic operating system", () => {
  it("bootstraps services, knowledge, and follow-up once", async () => {
    const t = convexTest(schema);
    const { owner } = await seedTenant(t);

    const first = await owner.mutation(api.clinic.bootstrapDefaults, {});
    const second = await owner.mutation(api.clinic.bootstrapDefaults, {});
    const workspace = await owner.query(api.clinic.listWorkspace, {});

    expect(first.created.sort()).toEqual(["follow_up", "knowledge", "service"]);
    expect(second.created).toEqual([]);
    expect(workspace.readiness).toMatchObject({
      hasActiveService: true,
      hasActiveKnowledge: true,
      hasActiveFollowUp: true,
      blockingItems: [],
    });
  });

  it("versions trusted knowledge instead of overwriting history", async () => {
    const t = convexTest(schema);
    const { owner } = await seedTenant(t);

    const created = await owner.mutation(api.clinic.saveKnowledgeItem, {
      kind: "faq",
      title: "Horários",
      body: "A clínica atende em dias úteis com marcação confirmada.",
      status: "active",
    });
    const updated = await owner.mutation(api.clinic.saveKnowledgeItem, {
      itemId: created.itemId,
      kind: "hours",
      title: "Horários atualizados",
      body: "A clínica atende em dias úteis e sábado por marcação.",
      status: "active",
    });
    const revisions = await owner.query(api.clinic.listKnowledgeRevisions, {
      itemId: created.itemId,
    });

    expect(updated.version).toBe(2);
    expect(revisions.map((revision) => revision.version)).toEqual([2, 1]);
  });

  it("offers real slots and blocks overlapping appointments", async () => {
    const t = convexTest(schema);
    const { owner } = await seedTenant(t);

    const serviceId = await owner.mutation(api.clinic.createService, {
      name: "Consulta",
      durationMinutes: 45,
      availability: [{ weekday: 2, start: "08:00", end: "10:00" }],
    });
    const slots = await owner.query(api.clinic.listAvailableSlots, {
      serviceId,
      date: "2026-09-01",
      stepMinutes: 30,
    });
    const firstSlot = slots.find((slot) => slot.available)!;
    const appointmentId = await owner.mutation(api.clinic.createAppointment, {
      serviceId,
      startAt: firstSlot.startAt,
      patientName: "Paciente Teste",
    });
    const after = await owner.query(api.clinic.listAvailableSlots, {
      serviceId,
      date: "2026-09-01",
      stepMinutes: 30,
    });

    expect(appointmentId).toBeTruthy();
    expect(after.find((slot) => slot.startAt === firstSlot.startAt)?.available).toBe(false);
    await expect(
      owner.mutation(api.clinic.createAppointment, {
        serviceId,
        startAt: firstSlot.startAt,
        patientName: "Outro Paciente",
      }),
    ).rejects.toThrow(/APPOINTMENT_SLOT_UNAVAILABLE/);
  });

  it("stops scheduled follow-ups when the patient replies", async () => {
    const t = convexTest(schema);
    const seeded = await seedTenant(t);
    const { owner, tenantId, memberId } = seeded;
    const { channel, threadId } = await seedChannelThread(t, {
      tenantId,
      memberId,
    });
    const ruleId = await owner.mutation(api.clinic.createFollowUpRule, {
      name: "Sem resposta",
      trigger: "no_reply",
      delayMinutes: 30,
      message: "Ainda podemos ajudar?",
    });
    const scheduled = await owner.mutation(api.clinic.scheduleFollowUp, {
      ruleId,
      threadId,
      businessKey: "reply-stop-test",
    });

    await t.run(async (ctx) => {
      await projectThreadFromEvent(ctx as never, {
        channel,
        event: {
          eventKind: "message.text",
          direction: "incoming",
          threadKey: "258840000000",
          providerTimestamp: Date.now(),
          payload: { normalizedText: "Quero agendar" },
        },
        now: Date.now(),
      });
    });

    const workspace = await owner.query(api.clinic.listWorkspace, {});
    const stored = await t.run(async (ctx) => ctx.db.get(scheduled.taskId));

    expect(stored?.status).toBe("stopped");
    expect(stored?.stoppedReason).toBe("patient_replied");
    expect(workspace.followUpTasks).toEqual([]);
  });
});
