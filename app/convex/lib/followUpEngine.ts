import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { extractErrorCode } from "./channels/systemEvents";
import { recordThreadSystemEvent } from "./channels/systemEvents";
import { loadClinicSettings } from "./clinicAgenda";

/** ≤10 per minute normally; ≤5 while a campaign is sending on the tenant. */
export const CLAIM_LIMIT = 10;
export const CLAIM_LIMIT_WITH_CAMPAIGN = 5;
export const CLAIM_SCAN = 40;
export const SEND_SPACING_MS = 3_000;
export const MAX_ATTEMPTS = 3;
export const STALE_CLAIM_MS = 15 * 60_000;

function isTransient(code: string | undefined, reason: string | undefined): boolean {
  if (code === "HUB_PILOT_KILL_SWITCH_ACTIVE") return true;
  if (code) return false;
  return /fetch|network|timeout|timed out|unavailable|5\d\d|ECONN|socket/i.test(reason ?? "");
}

function retryAfterMsFrom(reason: string | undefined): number | undefined {
  const match = reason?.match(/"retryAfterMs"\s*:\s*(\d+)/);
  return match ? Number(match[1]) : undefined;
}

export function serviceWindowOpen(thread: Doc<"channelThreads">, now: number): boolean {
  return !!thread.serviceWindowExpiresAt && thread.serviceWindowExpiresAt > now;
}

/**
 * Decide how a task will be sent *now*: text inside the 24h window,
 * template outside it, or nothing (definitive failure with a next step for
 * the team). Decided at claim time so a job is only scheduled when sendable.
 */
export function resolveDelivery(args: {
  task: Doc<"followUpTasks">;
  thread: Doc<"channelThreads">;
  settings: Doc<"clinicSettings"> | null;
  now: number;
}): { messageKind: "text"; text: string } | { messageKind: "template"; templateName: string; languageCode: string } | null {
  const text = (args.task.message ?? "").trim();
  if (serviceWindowOpen(args.thread, args.now) && text) {
    return { messageKind: "text", text: text.slice(0, 4096) };
  }
  const templateName =
    args.task.templateName ??
    (args.task.kind === "appointment_reminder"
      ? args.settings?.reminderTemplateName
      : args.task.kind === "appointment_confirmation"
        ? args.settings?.confirmationTemplateName
        : undefined);
  const languageCode =
    args.task.templateLanguage ??
    (args.task.kind === "appointment_reminder"
      ? args.settings?.reminderTemplateLanguage
      : args.task.kind === "appointment_confirmation"
        ? args.settings?.confirmationTemplateLanguage
        : undefined);
  if (templateName && languageCode) return { messageKind: "template", templateName, languageCode };
  return null;
}

async function failTask(
  ctx: { db: any },
  task: Doc<"followUpTasks">,
  thread: Doc<"channelThreads"> | null,
  code: string,
  reason: string | undefined,
  now: number,
) {
  await ctx.db.patch(task._id, {
    status: "failed",
    failureCode: code,
    failureReason: reason?.slice(0, 500),
    updatedAt: now,
  });
  if (thread) {
    await recordThreadSystemEvent(ctx, {
      thread,
      kind: "followup.failed",
      severity: "warning",
      code,
      actorType: "system",
      payload: { taskId: task._id, kind: task.kind ?? "rule", reason: reason?.slice(0, 160) },
      dedupeKey: `followup:${task._id}:failed`,
      now,
    });
    await ctx.db.patch(thread._id, {
      nextStep:
        code === "SERVICE_WINDOW_EXPIRED"
          ? "Follow-up não enviado: janela de 24h fechada. Enviar template aprovado manualmente."
          : code === "RECIPIENT_NOT_ALLOWLISTED"
            ? "Follow-up bloqueado pelo piloto. Pedir inclusão do número na allowlist."
            : "Follow-up não enviado. Contactar o paciente manualmente.",
      nextStepDueAt: now,
      updatedAt: now,
    });
  }
}

/**
 * Claim due tasks: validates the thread state, resolves delivery and either
 * fails definitively (no template outside the window) or moves the task to
 * `claimed` and schedules one dispatch job. Idempotent per sweep because a
 * claimed task is no longer `scheduled`.
 */
export async function claimDueFollowUps(
  ctx: { db: any; scheduler: any },
  now: number,
): Promise<{ claimed: number; failed: number; skipped: number }> {
  const candidates = (await ctx.db
    .query("followUpTasks")
    .withIndex("by_status_due", (q: any) => q.eq("status", "scheduled").lte("dueAt", now))
    .take(CLAIM_SCAN)) as Doc<"followUpTasks">[];
  const due = candidates.filter((task) => task.nextAttemptAt === undefined || task.nextAttemptAt <= now);
  let claimed = 0;
  let failed = 0;
  let skipped = 0;
  const limitByTenant = new Map<string, number>();
  const settingsByTenant = new Map<string, Doc<"clinicSettings"> | null>();
  let index = 0;

  for (const task of due) {
    if (claimed >= CLAIM_LIMIT) break;
    let limit = limitByTenant.get(task.tenantId);
    if (limit === undefined) {
      const running = await ctx.db
        .query("campaigns")
        .withIndex("by_tenant_status", (q: any) => q.eq("tenantId", task.tenantId).eq("status", "running"))
        .first();
      limit = running ? CLAIM_LIMIT_WITH_CAMPAIGN : CLAIM_LIMIT;
      limitByTenant.set(task.tenantId, limit);
    }
    if (limit <= 0) {
      skipped += 1;
      continue;
    }
    const thread = task.threadId
      ? ((await ctx.db.get(task.threadId)) as Doc<"channelThreads"> | null)
      : null;
    if (!thread || thread.tenantId !== task.tenantId) {
      await ctx.db.patch(task._id, { status: "failed", failureCode: "THREAD_NOT_FOUND", updatedAt: now });
      failed += 1;
      continue;
    }
    if (thread.dnd || thread.intent === "opt_out" || thread.leadStatus === "lost") {
      await ctx.db.patch(task._id, {
        status: "stopped",
        stoppedReason: thread.dnd ? "dnd" : "opt_out",
        updatedAt: now,
      });
      skipped += 1;
      continue;
    }
    if (thread.openHumanCaseId && task.kind !== "appointment_confirmation" && task.kind !== "appointment_reminder") {
      await ctx.db.patch(task._id, { status: "stopped", stoppedReason: "human_case_open", updatedAt: now });
      skipped += 1;
      continue;
    }
    if (task.appointmentId) {
      const appointment = (await ctx.db.get(task.appointmentId)) as Doc<"clinicAppointments"> | null;
      if (!appointment || (appointment.status !== "scheduled" && appointment.status !== "confirmed")) {
        await ctx.db.patch(task._id, { status: "stopped", stoppedReason: "cancelled", updatedAt: now });
        skipped += 1;
        continue;
      }
      if (task.kind === "appointment_confirmation" && appointment.status === "confirmed") {
        await ctx.db.patch(task._id, { status: "stopped", stoppedReason: "confirmed", updatedAt: now });
        skipped += 1;
        continue;
      }
    }
    let settings = settingsByTenant.get(task.tenantId);
    if (settings === undefined) {
      settings = await loadClinicSettings(ctx, task.tenantId);
      settingsByTenant.set(task.tenantId, settings);
    }
    const delivery = resolveDelivery({ task, thread, settings, now });
    if (!delivery) {
      await failTask(ctx, task, thread, "SERVICE_WINDOW_EXPIRED", "No approved template configured for out-of-window follow-ups.", now);
      failed += 1;
      continue;
    }
    await ctx.db.patch(task._id, {
      status: "claimed",
      attempts: task.attempts + 1,
      lastAttemptAt: now,
      nextAttemptAt: undefined,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(index * SEND_SPACING_MS, internal.iaSolutionHub.dispatchOutboundJob, {
      job: { kind: "follow_up", taskId: task._id },
    });
    index += 1;
    claimed += 1;
    limitByTenant.set(task.tenantId, limit - 1);
  }
  return { claimed, failed, skipped };
}

export async function loadFollowUpDispatchTarget(
  ctx: { db: any },
  taskId: Id<"followUpTasks">,
): Promise<{
  tenantId: Id<"tenants">;
  memberId: Id<"members">;
  channelId: Id<"channels">;
  threadKey: string;
  clientNonce: string;
  messageKind: "text" | "template";
  payload: unknown;
} | null> {
  const task = (await ctx.db.get(taskId)) as Doc<"followUpTasks"> | null;
  if (!task || task.status !== "claimed" || !task.threadId) return null;
  const thread = (await ctx.db.get(task.threadId)) as Doc<"channelThreads"> | null;
  if (!thread || thread.tenantId !== task.tenantId) return null;
  const settings = await loadClinicSettings(ctx, task.tenantId);
  const delivery = resolveDelivery({ task, thread, settings, now: Date.now() });
  if (!delivery) return null;
  const memberId = await senderMember(ctx, task);
  if (!memberId) return null;
  return {
    tenantId: task.tenantId,
    memberId,
    channelId: thread.channelId,
    threadKey: thread.threadKey,
    clientNonce: `followup:${task._id}:a${task.attempts}`,
    messageKind: delivery.messageKind,
    payload:
      delivery.messageKind === "text"
        ? { text: delivery.text }
        : { templateName: delivery.templateName, languageCode: delivery.languageCode, bodyVariables: [] },
  };
}

/** Outbox rows need a member: the rule's creator, else the appointment's. */
async function senderMember(ctx: { db: any }, task: Doc<"followUpTasks">): Promise<Id<"members"> | null> {
  if (task.ruleId) {
    const rule = (await ctx.db.get(task.ruleId)) as Doc<"followUpRules"> | null;
    if (rule) return rule.createdBy;
  }
  if (task.appointmentId) {
    const appointment = (await ctx.db.get(task.appointmentId)) as Doc<"clinicAppointments"> | null;
    if (appointment) return appointment.createdBy;
  }
  const settings = await loadClinicSettings(ctx, task.tenantId);
  return settings?.updatedBy ?? null;
}

export async function settleFollowUpDispatch(
  ctx: { db: any },
  args: {
    taskId: Id<"followUpTasks">;
    status: "accepted" | "failed" | "unknown";
    outboxId?: Id<"channelOutbox">;
    providerMessageId?: string;
    failureReason?: string;
  },
): Promise<void> {
  const task = (await ctx.db.get(args.taskId)) as Doc<"followUpTasks"> | null;
  if (!task || task.status !== "claimed") return;
  const thread = task.threadId ? ((await ctx.db.get(task.threadId)) as Doc<"channelThreads"> | null) : null;
  const now = Date.now();
  const reason = args.failureReason?.slice(0, 500);

  if (args.status === "accepted") {
    await ctx.db.patch(task._id, {
      status: "sent",
      sentAt: now,
      outboxId: args.outboxId,
      providerMessageId: args.providerMessageId,
      failureCode: undefined,
      failureReason: undefined,
      updatedAt: now,
    });
    if (thread) {
      await recordThreadSystemEvent(ctx, {
        thread,
        kind: "followup.sent",
        severity: "info",
        actorType: "automation",
        payload: { taskId: task._id, kind: task.kind ?? "rule", attempt: task.attempts },
        dedupeKey: `followup:${task._id}:sent`,
        now,
      });
      await ctx.db.patch(thread._id, {
        nextStep:
          task.kind === "appointment_confirmation"
            ? "Pedido de confirmação enviado. Aguardar resposta do paciente."
            : task.kind === "appointment_reminder"
              ? "Lembrete enviado."
              : "Follow-up enviado. Aguardar resposta do paciente.",
        nextStepDueAt: now + 24 * 60 * 60_000,
        updatedAt: now,
      });
    }
    return;
  }

  if (args.status === "unknown") {
    // Maybe delivered: never resend automatically.
    await ctx.db.patch(task._id, {
      status: "failed",
      failureCode: "OUTBOX_UNKNOWN",
      failureReason: reason,
      outboxId: args.outboxId,
      updatedAt: now,
    });
    if (thread) {
      await recordThreadSystemEvent(ctx, {
        thread,
        kind: "followup.failed",
        severity: "warning",
        code: "OUTBOX_UNKNOWN",
        actorType: "system",
        payload: { taskId: task._id, kind: task.kind ?? "rule" },
        dedupeKey: `followup:${task._id}:unknown`,
        now,
      });
    }
    return;
  }

  const code = extractErrorCode(reason);
  if (code === "CHANNEL_RATE_LIMITED") {
    const retryAfter = retryAfterMsFrom(reason) ?? 60_000;
    await ctx.db.patch(task._id, {
      status: "scheduled",
      attempts: Math.max(0, task.attempts - 1),
      nextAttemptAt: now + retryAfter + 1_000,
      updatedAt: now,
    });
    return;
  }
  if (isTransient(code, reason) && task.attempts < MAX_ATTEMPTS) {
    const backoff = code === "HUB_PILOT_KILL_SWITCH_ACTIVE" ? 10 * 60_000 : 60_000 * 2 ** (task.attempts - 1);
    await ctx.db.patch(task._id, {
      status: "scheduled",
      nextAttemptAt: now + backoff,
      failureReason: reason,
      updatedAt: now,
    });
    return;
  }
  await failTask(ctx, task, thread, code ?? "SEND_FAILED", reason, now);
}

/** Claims whose job never settled go back to the queue (or fail after 3). */
export async function releaseStaleClaims(ctx: { db: any }, now: number): Promise<number> {
  const stale = (await ctx.db
    .query("followUpTasks")
    .withIndex("by_status_due", (q: any) => q.eq("status", "claimed"))
    .take(100)) as Doc<"followUpTasks">[];
  let released = 0;
  for (const task of stale) {
    if ((task.lastAttemptAt ?? 0) > now - STALE_CLAIM_MS) continue;
    if (task.attempts >= MAX_ATTEMPTS) {
      await ctx.db.patch(task._id, { status: "failed", failureCode: "STALE_CLAIM", updatedAt: now });
    } else {
      await ctx.db.patch(task._id, { status: "scheduled", nextAttemptAt: now, updatedAt: now });
    }
    released += 1;
  }
  return released;
}
