import { convexTest } from "convex-test";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import schema from "../schema";
import { encryptSecret } from "../lib/secrets";
import { normalizeWebhook } from "../integrations/iaSolutionHub/webhook";

const previousKey = process.env.WABA_TOKEN_ENCRYPTION_KEY_V1;
process.env.WABA_TOKEN_ENCRYPTION_KEY_V1 = "f".repeat(64);
const PATIENT = "258840000099";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
afterAll(() => {
  if (previousKey === undefined) delete process.env.WABA_TOKEN_ENCRYPTION_KEY_V1;
  else process.env.WABA_TOKEN_ENCRYPTION_KEY_V1 = previousKey;
});

async function seed(t: ReturnType<typeof convexTest>, opts: { windowOpen?: boolean } = {}) {
  const base = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: "Owner" });
    const tenantId = await ctx.db.insert("tenants", {
      name: "Clínica",
      vertical: "clinic",
      plan: "starter",
      settings: { defaultLocale: "pt-MZ", timezone: "Africa/Maputo", retentionDays: 730 },
      createdAt: Date.now(),
    });
    const memberId = await ctx.db.insert("members", { tenantId, userId, role: "owner", status: "active", createdAt: Date.now() });
    await ctx.db.insert("sessions", { userId, activeTenantId: tenantId, updatedAt: Date.now() });
    return { userId, tenantId, memberId };
  });
  const asOwner = t.withIdentity({ subject: base.userId });
  const pending = await asOwner.mutation(api.iaSolutionHub.createPendingChannel, { displayName: "Piloto" });
  const token = await encryptSecret("hub-token");
  const hook = await encryptSecret("hub-secret");
  await t.mutation(internal.iaSolutionHub._configureConnection, {
    tenantId: base.tenantId,
    memberId: base.memberId,
    channelId: pending.channelId,
    externalChannelId: "hub-fu",
    displayName: "Piloto",
    phoneNumber: "258840000001",
    wabaId: "waba-fu",
    outboundAllowlist: [PATIENT],
    accessTokenCiphertext: token.ciphertext,
    accessTokenKeyVersion: token.keyVersion,
    webhookSecretCiphertext: hook.ciphertext,
    webhookSecretKeyVersion: hook.keyVersion,
    encryptedAt: Date.now(),
    healthStatus: "GREEN",
  });
  const now = Date.now();
  const threadId = await t.run(async (ctx) => {
    await ctx.db.patch(pending.channelId, { status: "active", webhookStatus: "verified", sendMode: "allowlist", connectionState: "allowlist_only" });
    const identityId = await ctx.db.insert("channelIdentities", {
      tenantId: base.tenantId,
      channelId: pending.channelId,
      providerScopedId: PATIENT,
      phone: PATIENT,
      displayName: "Ana",
      createdAt: now,
      updatedAt: now,
    });
    const threadId = await ctx.db.insert("channelThreads", {
      tenantId: base.tenantId,
      channelId: pending.channelId,
      threadKey: PATIENT,
      identityId,
      lastEventAt: now,
      lastEventKind: "message.text",
      unreadCount: 0,
      leadStatus: "interested",
      serviceWindowExpiresAt: opts.windowOpen === false ? now - 1 : now + 6 * 60 * 60_000,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("channelEvents", {
      tenantId: base.tenantId,
      channelId: pending.channelId,
      eventKey: "in:1",
      eventKind: "message.text",
      direction: "incoming",
      threadKey: PATIENT,
      payload: { text: "Olá" },
      rawPayload: "{}",
      rawBodySha256: "sha",
      status: "processed",
      attempts: 1,
      receivedAt: now,
    });
    return threadId;
  });
  const ruleId = await asOwner.mutation(api.clinic.createFollowUpRule, {
    name: "Sem resposta",
    trigger: "no_reply",
    delayMinutes: 5,
    message: "Olá, ainda posso ajudar?",
  });
  return { ...base, asOwner, channelId: pending.channelId, threadId, ruleId };
}

function stubHub(onSend: (path: string, body: unknown) => Response | Promise<Response>) {
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = input.toString();
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (url.includes("/messages/")) return await onSend(url, body);
    return Response.json({ success: false, message: "unexpected" });
  });
}

describe("follow-up executor", () => {
  it("claims due tasks, sends text inside the window and settles as sent", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    const { taskId } = await s.asOwner.mutation(api.clinic.scheduleFollowUp, { ruleId: s.ruleId, threadId: s.threadId, dueAt: Date.now() - 1 });

    const claimed = await t.mutation(internal.followUps.runDue, {});
    expect(claimed).toEqual({ claimed: 1, failed: 0, skipped: 0 });
    expect(await t.mutation(internal.followUps.runDue, {})).toEqual({ claimed: 0, failed: 0, skipped: 0 });
    const target = await t.query(internal.outboundJobs.loadJob, { job: { kind: "follow_up", taskId } });
    expect(target).toMatchObject({ threadKey: PATIENT, messageKind: "text", payload: { text: "Olá, ainda posso ajudar?" }, clientNonce: `followup:${taskId}:a1` });

    let sends = 0;
    stubHub((path) => {
      expect(path.endsWith("/messages/text")).toBe(true);
      sends += 1;
      return Response.json({ success: true, data: { messageId: "wamid.fu.1" } });
    });
    await t.action(internal.iaSolutionHub.dispatchOutboundJob, { job: { kind: "follow_up", taskId } });
    await t.action(internal.iaSolutionHub.dispatchOutboundJob, { job: { kind: "follow_up", taskId } });
    expect(sends).toBe(1);
    const state = await t.run(async (ctx) => ({
      task: (await ctx.db.get(taskId)) as Doc<"followUpTasks">,
      outbox: await ctx.db.query("channelOutbox").collect(),
      thread: (await ctx.db.get(s.threadId)) as Doc<"channelThreads">,
      events: (await ctx.db.query("threadSystemEvents").collect()).map((e) => e.kind),
    }));
    expect(state.task).toMatchObject({ status: "sent", providerMessageId: "wamid.fu.1", attempts: 1 });
    expect(state.outbox[0].businessKey).toBe(`hub:text:followup:${taskId}:a1`);
    expect(state.events).toContain("followup.sent");
    expect(state.thread.nextStep).toContain("Follow-up enviado");
    const rows = await s.asOwner.query(api.followUps.listForThread, { threadId: s.threadId });
    expect(rows[0]).toMatchObject({ status: "sent", ruleName: "Sem resposta" });
  });

  it("uses the configured template outside the window and fails definitively without one", async () => {
    const t = convexTest(schema);
    const s = await seed(t, { windowOpen: false });
    const first = await s.asOwner.mutation(api.clinic.scheduleFollowUp, { ruleId: s.ruleId, threadId: s.threadId, dueAt: Date.now() - 1 });
    expect(await t.mutation(internal.followUps.runDue, {})).toEqual({ claimed: 0, failed: 1, skipped: 0 });
    const failed = await t.run(async (ctx) => ({
      task: (await ctx.db.get(first.taskId)) as Doc<"followUpTasks">,
      thread: (await ctx.db.get(s.threadId)) as Doc<"channelThreads">,
    }));
    expect(failed.task).toMatchObject({ status: "failed", failureCode: "SERVICE_WINDOW_EXPIRED" });
    expect(failed.thread.nextStep).toContain("janela de 24h");
    await expect(s.asOwner.mutation(api.followUps.retryTask, { taskId: first.taskId })).resolves.toBeNull();

    // With a reminder template configured, notices go out as templates.
    await s.asOwner.mutation(api.clinic.saveSettings, { reminderTemplateName: "lembrete", reminderTemplateLanguage: "pt_PT" });
    await t.run(async (ctx) => {
      await ctx.db.insert("channelTemplates", {
        tenantId: s.tenantId,
        channelId: s.channelId,
        name: "lembrete",
        languageCode: "pt_PT",
        status: "APPROVED",
        components: [{ type: "BODY", text: "Lembrete da sua consulta." }],
        syncedAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    const serviceId = await s.asOwner.mutation(api.clinic.createService, { name: "Consulta", durationMinutes: 30 });
    const startAt = (() => {
      const d = new Date(Date.now() + 3 * 24 * 60 * 60_000);
      while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
      d.setUTCHours(8, 0, 0, 0); // 10:00 Maputo
      return d.getTime();
    })();
    const booking = await s.asOwner.mutation(api.clinic.reserveSlot, { serviceId, threadId: s.threadId, startAt });
    const notice = await s.asOwner.mutation(api.clinic.sendAppointmentNotice, { appointmentId: booking.appointmentId, kind: "appointment_reminder" });
    // The rule task was retried too: expect 2 due, one fails again (no template for rules), the notice is claimed.
    const run = await t.mutation(internal.followUps.runDue, {});
    expect(run.claimed).toBe(1);
    const target = await t.query(internal.outboundJobs.loadJob, { job: { kind: "follow_up", taskId: notice.taskId } });
    expect(target).toMatchObject({ messageKind: "template", payload: { templateName: "lembrete", languageCode: "pt_PT" } });
  });

  it("retries rate limits and transient errors, never retries unknown, and stops on reply/DND", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    const { taskId } = await s.asOwner.mutation(api.clinic.scheduleFollowUp, { ruleId: s.ruleId, threadId: s.threadId, dueAt: Date.now() - 1 });
    await t.mutation(internal.followUps.runDue, {});

    await t.mutation(internal.outboundJobs.settleJob, { job: { kind: "follow_up", taskId }, status: "failed", failureReason: JSON.stringify({ code: "CHANNEL_RATE_LIMITED", retryAfterMs: 2000 }) });
    let task = await t.run(async (ctx) => (await ctx.db.get(taskId)) as Doc<"followUpTasks">);
    expect(task).toMatchObject({ status: "scheduled", attempts: 0 });
    expect(task.nextAttemptAt).toBeGreaterThan(Date.now());
    expect(await t.mutation(internal.followUps.runDue, {})).toEqual({ claimed: 0, failed: 0, skipped: 0 });
    vi.setSystemTime(Date.now() + 5_000);
    expect((await t.mutation(internal.followUps.runDue, {})).claimed).toBe(1);

    await t.mutation(internal.outboundJobs.settleJob, { job: { kind: "follow_up", taskId }, status: "failed", failureReason: "fetch failed: socket hang up" });
    task = await t.run(async (ctx) => (await ctx.db.get(taskId)) as Doc<"followUpTasks">);
    expect(task).toMatchObject({ status: "scheduled", attempts: 1 });
    expect(task.nextAttemptAt).toBeGreaterThanOrEqual(Date.now() + 60_000);

    vi.setSystemTime(Date.now() + 61_000);
    await t.mutation(internal.followUps.runDue, {});
    await t.mutation(internal.outboundJobs.settleJob, { job: { kind: "follow_up", taskId }, status: "unknown", failureReason: "Outbox status: unknown" });
    task = await t.run(async (ctx) => (await ctx.db.get(taskId)) as Doc<"followUpTasks">);
    expect(task).toMatchObject({ status: "failed", failureCode: "OUTBOX_UNKNOWN" });
    await expect(s.asOwner.mutation(api.followUps.retryTask, { taskId })).rejects.toThrow(/FOLLOW_UP_NOT_RETRYABLE/);

    // Stop triggers: patient reply and DND.
    const second = await s.asOwner.mutation(api.clinic.scheduleFollowUp, { ruleId: s.ruleId, threadId: s.threadId, businessKey: "second", dueAt: Date.now() + 60_000 });
    const payload = {
      contacts: [{ profile: { name: "Ana" }, wa_id: PATIENT }],
      messages: [{ from: PATIENT, id: "wamid.reply.fu", timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: "Sim" } }],
    };
    await t.mutation(internal.iaSolutionHub.ingestWebhookEvents, {
      channelId: s.channelId,
      rawPayload: JSON.stringify(payload),
      rawBodySha256: "sha-fu-reply",
      events: normalizeWebhook(payload, "sha-fu-reply"),
    });
    expect((await t.run(async (ctx) => (await ctx.db.get(second.taskId)) as Doc<"followUpTasks">)).stoppedReason).toBe("patient_replied");

    const third = await s.asOwner.mutation(api.clinic.scheduleFollowUp, { ruleId: s.ruleId, threadId: s.threadId, businessKey: "third", dueAt: Date.now() + 60_000 });
    await s.asOwner.mutation(api.inboxOperations.updateThread, { threadId: s.threadId, dnd: true });
    expect((await t.run(async (ctx) => (await ctx.db.get(third.taskId)) as Doc<"followUpTasks">)).stoppedReason).toBe("dnd");

    // A due task on a DND thread is stopped at claim time, never sent.
    await t.run(async (ctx) => {
      await ctx.db.patch(third.taskId as Id<"followUpTasks">, { status: "scheduled", stoppedReason: undefined, dueAt: Date.now() - 1 });
    });
    expect(await t.mutation(internal.followUps.runDue, {})).toEqual({ claimed: 0, failed: 0, skipped: 1 });
  });

  it("requeues stale claims and caps claims while a campaign is running", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    for (let i = 0; i < 7; i += 1) {
      await s.asOwner.mutation(api.clinic.scheduleFollowUp, { ruleId: s.ruleId, threadId: s.threadId, businessKey: `k${i}`, dueAt: Date.now() - 1 });
    }
    await t.run(async (ctx) => {
      await ctx.db.insert("campaigns", { tenantId: s.tenantId, name: "Running", kind: "channel_text", status: "running", channelId: s.channelId, createdAt: Date.now(), updatedAt: Date.now() });
    });
    const run = await t.mutation(internal.followUps.runDue, {});
    expect(run.claimed).toBe(5);
    expect(run.skipped).toBe(2);

    vi.setSystemTime(Date.now() + 16 * 60_000);
    expect(await t.mutation(internal.followUps.sweepStaleClaims, {})).toEqual({ released: 5 });
    const statuses = await t.run(async (ctx) => (await ctx.db.query("followUpTasks").collect()).map((r) => r.status));
    expect(statuses.filter((v) => v === "scheduled")).toHaveLength(7);
  });
});
