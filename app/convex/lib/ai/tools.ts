import { ConvexError } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import { nextStepFor, shouldAdvanceLeadStatus } from "../channels/projection";
import { recordThreadSystemEvent } from "../channels/systemEvents";
import { confirmInternal, listSlotsInternal, reserveSlotInternal, scheduleRuleFollowUp, tenantTimeZone } from "../clinicAgenda";
import { formatLocalDateTime } from "../clinicTime";
import { openHumanCaseInternal, type HumanCaseUrgency } from "../humanCases";
import {
  currentValue,
  normalizeValue,
  proposalBusinessKey,
  PROPOSAL_TTL_MS,
  valueAcceptable,
  type ProposalField,
} from "./proposals";
import { findOrCreateContactForThread } from "../channels/contactBridge";
import { TOOL_SPECS, type AiToolName } from "./toolRegistry";
import { validateAgainstSchema } from "./validators";

export type ToolEffects = {
  booked?: { appointmentId: Id<"clinicAppointments">; serviceName: string; when: string; professionalName?: string };
  confirmed?: boolean;
  handedOff?: boolean;
  templateQueued?: { templateName: string; languageCode: string; bodyVariables: string[] };
};

export type ToolOutcome = {
  status: "ok" | "error" | "denied" | "dry_run";
  output: unknown;
  errorCode?: string;
  effects?: ToolEffects;
};

export type ToolContext = {
  db: any;
  scheduler?: any;
  tenantId: Id<"tenants">;
  /** Member the effects are attributed to (the agent's publisher). */
  memberId: Id<"members">;
  thread: Doc<"channelThreads">;
  turnId?: Id<"aiTurns">;
  dryRun: boolean;
  allowedTools: string[];
  approvedTemplates: Array<{ name: string; languageCode: string }>;
  now: number;
};

function fail(code: string, detail?: string): ToolOutcome {
  return { status: "error", output: { error: code, detail }, errorCode: code };
}

async function serviceLabel(ctx: ToolContext, serviceId: Id<"clinicServices">) {
  const service = (await ctx.db.get(serviceId)) as Doc<"clinicServices"> | null;
  return service && service.tenantId === ctx.tenantId ? service : null;
}

/**
 * Execute one tool for one turn. Input is validated again server-side, the
 * tool must be on the version's allow-list, and every branch returns a
 * structured verdict the model (and the audit trail) can read. `dryRun`
 * performs reads but never writes (sandbox).
 */
export async function executeAiTool(ctx: ToolContext, name: string, rawInput: unknown): Promise<ToolOutcome> {
  if (!(name in TOOL_SPECS)) return { status: "denied", output: { error: "TOOL_UNKNOWN" }, errorCode: "TOOL_UNKNOWN" };
  if (!ctx.allowedTools.includes(name)) return { status: "denied", output: { error: "TOOL_NOT_ALLOWED", tool: name }, errorCode: "TOOL_NOT_ALLOWED" };
  const toolName = name as AiToolName;
  const input = (rawInput && typeof rawInput === "object" ? rawInput : {}) as Record<string, unknown>;
  const problems = validateAgainstSchema(TOOL_SPECS[toolName].inputSchema, input);
  if (problems.length > 0) return fail("TOOL_INPUT_INVALID", problems.join("; "));
  const thread = ctx.thread;

  try {
    switch (toolName) {
      case "consultar_agenda": {
        const service = await serviceLabel(ctx, input.serviceId as Id<"clinicServices">);
        if (!service) return fail("SERVICE_NOT_FOUND");
        const slots = await listSlotsInternal(ctx, {
          tenantId: ctx.tenantId,
          serviceId: service._id,
          date: String(input.date),
          professionalId: input.professionalId ? (String(input.professionalId) as Id<"clinicProfessionals">) : undefined,
          now: ctx.now,
          limit: 96,
        });
        const free = slots.filter((s) => s.available).slice(0, 12);
        return { status: ctx.dryRun ? "dry_run" : "ok", output: { date: input.date, service: service.name, free: free.map((s) => ({ startAt: s.startAt, label: s.label })), total: free.length } };
      }
      case "reservar_slot": {
        const service = await serviceLabel(ctx, input.serviceId as Id<"clinicServices">);
        if (!service) return fail("SERVICE_NOT_FOUND");
        const startAt = Number(input.startAt);
        const timeZone = await tenantTimeZone(ctx, ctx.tenantId);
        const when = formatLocalDateTime(startAt, timeZone);
        const professionalId = input.professionalId ? (String(input.professionalId) as Id<"clinicProfessionals">) : undefined;
        const professional = professionalId ? ((await ctx.db.get(professionalId)) as Doc<"clinicProfessionals"> | null) : null;
        if (ctx.dryRun) {
          return { status: "dry_run", output: { wouldBook: true, service: service.name, when }, effects: { booked: { appointmentId: "dry-run" as Id<"clinicAppointments">, serviceName: service.name, when, professionalName: professional?.name } } };
        }
        const result = await reserveSlotInternal(
          { db: ctx.db, tenantId: ctx.tenantId, memberId: ctx.memberId, role: "ai" },
          {
            serviceId: service._id,
            professionalId,
            threadId: thread._id,
            patientName: input.patientName ? String(input.patientName) : undefined,
            startAt,
            businessKey: `ai:${ctx.turnId ?? "turn"}:reservar:${service._id}:${startAt}`,
            source: "ai",
            notes: input.notes ? String(input.notes) : undefined,
          },
        );
        return {
          status: "ok",
          output: { appointmentId: result.appointmentId, created: result.created, service: service.name, when, professional: professional?.name },
          effects: { booked: { appointmentId: result.appointmentId, serviceName: service.name, when, professionalName: professional?.name } },
        };
      }
      case "confirmar_consulta": {
        let appointmentId = input.appointmentId ? (String(input.appointmentId) as Id<"clinicAppointments">) : undefined;
        if (!appointmentId) {
          const upcoming = (await ctx.db
            .query("clinicAppointments")
            .withIndex("by_thread", (q: any) => q.eq("tenantId", ctx.tenantId).eq("threadId", thread._id).gte("startAt", ctx.now - 60 * 60_000))
            .take(10)) as Doc<"clinicAppointments">[];
          appointmentId = upcoming.find((row) => row.status === "scheduled")?._id;
        }
        if (!appointmentId) return fail("APPOINTMENT_NOT_FOUND");
        if (ctx.dryRun) return { status: "dry_run", output: { wouldConfirm: appointmentId }, effects: { confirmed: true } };
        const result = await confirmInternal({ db: ctx.db, tenantId: ctx.tenantId, memberId: ctx.memberId, role: "ai" }, { appointmentId, via: "ai", at: ctx.now });
        return { status: "ok", output: { appointmentId, confirmed: result.confirmed, idempotent: result.idempotent ?? false }, effects: { confirmed: true } };
      }
      case "atualizar_lead": {
        const patch: Record<string, unknown> = { updatedAt: ctx.now };
        const leadStatus = input.leadStatus ? String(input.leadStatus) : undefined;
        if (leadStatus && shouldAdvanceLeadStatus(thread.leadStatus, leadStatus as never)) {
          patch.leadStatus = leadStatus;
          // Stamp the author and where it came from: a human undoing this later
          // is only a signal about the assistant if the assistant moved it last.
          patch.leadStatusActor = "ai";
          patch.leadStatusPrevious = thread.leadStatus;
          patch.nextStep = input.nextStep ? String(input.nextStep).slice(0, 200) : nextStepFor(leadStatus as never);
        } else if (input.nextStep) {
          patch.nextStep = String(input.nextStep).slice(0, 200);
        }
        if (input.intent) {
          patch.intent = String(input.intent);
          patch.intentSource = "inferred";
          patch.intentUpdatedAt = ctx.now;
        }
        if (ctx.dryRun) return { status: "dry_run", output: { wouldPatch: patch } };
        await ctx.db.patch(thread._id, patch);
        if (patch.leadStatus) {
          await recordThreadSystemEvent(ctx, {
            thread,
            kind: "lead.status_changed",
            severity: "info",
            actorType: "automation",
            payload: { from: thread.leadStatus, to: String(patch.leadStatus), by: "ai" },
            dedupeKey: `ai:${ctx.turnId ?? "turn"}:lead:${patch.leadStatus}`,
            now: ctx.now,
          });
        }
        return { status: "ok", output: { leadStatus: patch.leadStatus ?? thread.leadStatus, nextStep: patch.nextStep } };
      }
      case "criar_lembrete_equipa": {
        const dueAt = ctx.now + Math.min(7 * 24 * 60, Math.max(5, Number(input.dueInMinutes ?? 60))) * 60_000;
        if (ctx.dryRun) return { status: "dry_run", output: { wouldRemind: { note: input.note, dueAt } } };
        const reminderId = await ctx.db.insert("threadReminders", {
          tenantId: ctx.tenantId,
          threadId: thread._id,
          note: String(input.note).slice(0, 500),
          dueAt,
          status: "scheduled",
          assignedMemberId: thread.responsibleMemberId ?? ctx.memberId,
          createdBy: ctx.memberId,
          createdAt: ctx.now,
          updatedAt: ctx.now,
        });
        return { status: "ok", output: { reminderId, dueAt } };
      }
      case "agendar_follow_up": {
        if (ctx.dryRun) return { status: "dry_run", output: { wouldSchedule: input.trigger } };
        const taskId = await scheduleRuleFollowUp({ db: ctx.db, tenantId: ctx.tenantId }, { trigger: String(input.trigger) as Doc<"followUpRules">["trigger"], thread, now: ctx.now });
        if (!taskId) return fail("FOLLOW_UP_RULE_MISSING", String(input.trigger));
        return { status: "ok", output: { taskId } };
      }
      case "enviar_template": {
        const templateName = String(input.templateName);
        const languageCode = String(input.languageCode);
        const approved = ctx.approvedTemplates.some((t) => t.name === templateName && t.languageCode === languageCode);
        if (!approved) return fail("CHANNEL_TEMPLATE_NOT_APPROVED", templateName);
        const bodyVariables = Array.isArray(input.bodyVariables) ? (input.bodyVariables as unknown[]).map(String).slice(0, 10) : [];
        return { status: ctx.dryRun ? "dry_run" : "ok", output: { queued: true, templateName, languageCode }, effects: { templateQueued: { templateName, languageCode, bodyVariables } } };
      }
      case "aplicar_tag": {
        const tag = String(input.tag).trim().toLowerCase().slice(0, 40);
        if (!tag) return fail("TOOL_INPUT_INVALID", "tag");
        const tags = Array.from(new Set([...(thread.tags ?? []), tag])).slice(0, 30);
        if (ctx.dryRun) return { status: "dry_run", output: { wouldTag: tag } };
        await ctx.db.patch(thread._id, { tags, updatedAt: ctx.now });
        return { status: "ok", output: { tags } };
      }
      case "propor_dado_paciente": {
        const field = String(input.field) as ProposalField;
        if (field !== "name" && field !== "email") return fail("TOOL_INPUT_INVALID", "field");
        const excerpt = String(input.excerpt ?? "").trim().slice(0, 300);
        if (!excerpt) return fail("TOOL_INPUT_INVALID", "excerpt");
        if (!valueAcceptable(field, String(input.value))) return fail("PROPOSAL_VALUE_INVALID", field);
        const value = normalizeValue(field, String(input.value));
        const contact = await findOrCreateContactForThread(
          { db: ctx.db, tenantId: ctx.tenantId },
          thread,
          thread.identityId ? ((await ctx.db.get(thread.identityId)) as Doc<"channelIdentities"> | null) : null,
        );
        // Someone who exercised erasure does not get their data back through
        // the side door.
        if (contact.erasedAt) return fail("PROPOSAL_CONTACT_ANONYMISED", field);
        const previous = currentValue(contact, field);
        // Nothing to decide: a patient repeating their own email would fill the
        // queue with proposals that confirm what is already true.
        if (previous !== null && normalizeValue(field, previous) === value) {
          return fail("PROPOSAL_VALUE_UNCHANGED", field);
        }
        const businessKey = proposalBusinessKey(thread._id, "contact_field", field);
        const existing = await ctx.db
          .query("aiProposals")
          .withIndex("by_tenant_business_key", (q: any) => q.eq("tenantId", ctx.tenantId).eq("businessKey", businessKey))
          .filter((q: any) => q.eq(q.field("status"), "pending"))
          .first();
        if (existing) return fail("PROPOSAL_ALREADY_PENDING", field);
        if (ctx.dryRun) return { status: "dry_run", output: { wouldPropose: { field, value } } };
        const proposalId = await ctx.db.insert("aiProposals", {
          tenantId: ctx.tenantId,
          threadId: thread._id,
          turnId: ctx.turnId,
          kind: "contact_field",
          businessKey,
          field,
          value,
          previousValue: previous ?? undefined,
          excerpt,
          status: "pending",
          expiresAt: ctx.now + PROPOSAL_TTL_MS,
          createdAt: ctx.now,
          updatedAt: ctx.now,
        });
        return { status: "ok", output: { proposalId, awaitingHuman: true } };
      }
      case "propor_proxima_acao": {
        const action = String(input.action ?? "").trim().slice(0, 200);
        if (action.length < 4) return fail("TOOL_INPUT_INVALID", "action");
        const businessKey = proposalBusinessKey(thread._id, "next_action");
        const existing = await ctx.db
          .query("aiProposals")
          .withIndex("by_tenant_business_key", (q: any) => q.eq("tenantId", ctx.tenantId).eq("businessKey", businessKey))
          .filter((q: any) => q.eq(q.field("status"), "pending"))
          .first();
        if (ctx.dryRun) return { status: "dry_run", output: { wouldPropose: { action } } };
        if (existing) {
          // The newest reading of the conversation replaces the older one:
          // two pending "next actions" for one conversation is two buttons for
          // one decision.
          await ctx.db.patch(existing._id, { action, turnId: ctx.turnId, expiresAt: ctx.now + PROPOSAL_TTL_MS, updatedAt: ctx.now });
          return { status: "ok", output: { proposalId: existing._id, replaced: true } };
        }
        const proposalId = await ctx.db.insert("aiProposals", {
          tenantId: ctx.tenantId,
          threadId: thread._id,
          turnId: ctx.turnId,
          kind: "next_action",
          businessKey,
          action,
          status: "pending",
          expiresAt: ctx.now + PROPOSAL_TTL_MS,
          createdAt: ctx.now,
          updatedAt: ctx.now,
        });
        return { status: "ok", output: { proposalId, awaitingHuman: true } };
      }
      case "abrir_caso_humano": {
        const urgency = String(input.urgency) as HumanCaseUrgency;
        const reason = String(input.reason).slice(0, 80);
        const question = String(input.question ?? reason).slice(0, 2000);
        if (ctx.dryRun) return { status: "dry_run", output: { wouldOpenCase: { reason, urgency } }, effects: { handedOff: true } };
        const result = await openHumanCaseInternal(
          { db: ctx.db, tenantId: ctx.tenantId, memberId: ctx.memberId, role: "ai" },
          { thread, reason, urgency, question: question.length >= 3 ? question : `${reason} (IA)`, openedFrom: "automation", actorKind: "ai", now: ctx.now },
        );
        return { status: "ok", output: { caseId: result.caseId, created: result.created }, effects: { handedOff: true } };
      }
    }
  } catch (error) {
    if (error instanceof ConvexError) {
      const code = typeof error.data === "object" && error.data && "code" in error.data ? String((error.data as { code: string }).code) : "TOOL_FAILED";
      return fail(code);
    }
    return fail("TOOL_FAILED", error instanceof Error ? error.message.slice(0, 200) : undefined);
  }
  return fail("TOOL_FAILED");
}
