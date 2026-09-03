import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { runTurnPipeline, type PipelineResult } from "./lib/ai/pipeline";
import type { AiMessage } from "./lib/ai/provider";
import type { ToolOutcome } from "./lib/ai/tools";
import { candidatesFor, effectiveSettings } from "./lib/ai/settings";
import { usdCentsToMicros } from "./lib/ai/pricing";
import { derivePreview } from "./lib/channels/projection";
import { recordThreadSystemEvent } from "./lib/channels/systemEvents";
import { setThreadAutomationMode } from "./lib/channels/automationControl";
import { formatLocalDateTime, localDateOf } from "./lib/clinicTime";
import { openHumanCaseInternal } from "./lib/humanCases";
import { effectiveAiMode, type AiMode } from "./lib/ai/control";
import { teamAvailability } from "./lib/escalation/availability";
import { expectationInstruction, handoffNoticeText } from "./lib/escalation/handoffNotice";
import { isWriteTool } from "./lib/ai/toolRegistry";
import { detectPromises, promiseAlertTitle, promiseOwnership, promiseSummary, type DetectedPromise } from "./lib/ai/promises";
import { upsertOpsAlert } from "./lib/opsAlerts";
import { emitWebhookEvent } from "./lib/webhooks";

const OBJECTIVE_PRIORITY = ["reception", "sales", "confirmation", "support"] as const;
const STALE_TURN_MS = 10 * 60_000;
const HISTORY_EVENTS = 24;

async function pickActiveAgent(ctx: { db: any }, tenantId: Id<"tenants">, channelId: Id<"channels">): Promise<Doc<"aiAgents"> | null> {
  const specific = (await ctx.db
    .query("aiAgents")
    .withIndex("by_tenant_channel_status", (q: any) => q.eq("tenantId", tenantId).eq("channelId", channelId).eq("status", "active"))
    .take(10)) as Doc<"aiAgents">[];
  const any = (await ctx.db
    .query("aiAgents")
    .withIndex("by_tenant_channel_status", (q: any) => q.eq("tenantId", tenantId).eq("channelId", undefined).eq("status", "active"))
    .take(10)) as Doc<"aiAgents">[];
  const pool = [...specific, ...any].filter((agent) => agent.publishedVersionId && agent.objective !== "audit");
  pool.sort((a, b) => OBJECTIVE_PRIORITY.indexOf(a.objective as never) - OBJECTIVE_PRIORITY.indexOf(b.objective as never));
  return pool[0] ?? null;
}

async function spentTodayMicros(ctx: { db: any }, tenantId: Id<"tenants">, day: string): Promise<number> {
  const rows = (await ctx.db
    .query("aiCostLedger")
    .withIndex("by_tenant_day", (q: any) => q.eq("tenantId", tenantId).eq("day", day))
    .take(50)) as Doc<"aiCostLedger">[];
  return rows.reduce((sum, row) => sum + row.costUsdMicros, 0);
}

/**
 * Decide whether an inbound message gets an AI turn. Cheap checks first
 * (mode, human case, pilot allowlist, active published agent), then caps and
 * budget. Idempotent per source event; concurrent turns coalesce.
 */
export const claimTurn = internalMutation({
  args: { eventId: v.id("channelEvents") },
  returns: v.object({ claimed: v.boolean(), reason: v.optional(v.string()), turnId: v.optional(v.id("aiTurns")) }),
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (!event || event.direction !== "incoming" || !event.threadKey) return { claimed: false, reason: "not_inbound" };
    const channel = await ctx.db.get(event.channelId);
    if (!channel || channel.provider !== "iasolution_hub" || channel.operationalTerritory !== "openbsp") return { claimed: false, reason: "channel" };
    const thread = await ctx.db
      .query("channelThreads")
      .withIndex("by_channel_thread", (q) => q.eq("channelId", channel._id).eq("threadKey", event.threadKey!))
      .unique();
    if (!thread || thread.tenantId !== channel.tenantId) return { claimed: false, reason: "thread" };
    if (thread.automationMode === "stopped") return { claimed: false, reason: "mode" };
    if (thread.openHumanCaseId) return { claimed: false, reason: "human_case_open" };
    if (thread.dnd) return { claimed: false, reason: "dnd" };
    const identity = thread.identityId ? await ctx.db.get(thread.identityId) : null;
    const digits = (identity?.phone ?? thread.threadKey).replace(/\D/g, "");
    if (channel.sendMode !== "live" && !channel.outboundAllowlist.includes(digits)) return { claimed: false, reason: "RECIPIENT_NOT_ALLOWLISTED" };

    const agent = await pickActiveAgent(ctx, channel.tenantId, channel._id);
    if (!agent || !agent.publishedVersionId) return { claimed: false, reason: "no_agent" };
    const version = await ctx.db.get(agent.publishedVersionId);
    if (!version) return { claimed: false, reason: "no_version" };
    const mode: AiMode = effectiveAiMode(thread, agent);
    if (mode === "sandbox") return { claimed: false, reason: "AGENT_SANDBOX" };
    // Autopilot never talks over a human; copilot exists precisely for that.
    if (mode === "autopilot" && thread.automationMode === "human") return { claimed: false, reason: "mode" };

    const now = Date.now();
    let run = await ctx.db
      .query("aiRuns")
      .withIndex("by_thread_status", (q) => q.eq("threadId", thread._id).eq("status", "active"))
      .first();
    if (!run) {
      for (const status of ["paused", "handed_off"] as const) {
        const blocked = await ctx.db
          .query("aiRuns")
          .withIndex("by_thread_status", (q) => q.eq("threadId", thread._id).eq("status", status))
          .first();
        if (blocked && blocked.agentId === agent._id) return { claimed: false, reason: `run_${status}` };
      }
      const runId = await ctx.db.insert("aiRuns", {
        tenantId: channel.tenantId,
        agentId: agent._id,
        versionId: agent.publishedVersionId,
        channelId: channel._id,
        threadId: thread._id,
        threadKey: thread.threadKey,
        status: "active",
        turnsCount: 0,
        costUsdMicros: 0,
        createdAt: now,
        updatedAt: now,
      });
      run = (await ctx.db.get(runId))!;
    } else if (run.versionId !== agent.publishedVersionId) {
      await ctx.db.patch(run._id, { versionId: agent.publishedVersionId, agentId: agent._id, updatedAt: now });
    }

    const businessKey = `event:${event._id}`;
    const existing = await ctx.db
      .query("aiTurns")
      .withIndex("by_run_business_key", (q) => q.eq("runId", run!._id).eq("businessKey", businessKey))
      .unique();
    if (existing) return { claimed: false, reason: "duplicate", turnId: existing._id };

    const settingsRow = await ctx.db
      .query("aiSettings")
      .withIndex("by_tenant", (q) => q.eq("tenantId", channel.tenantId))
      .unique();
    const settings = effectiveSettings(settingsRow);
    const tenant = await ctx.db.get(channel.tenantId);
    const day = localDateOf(now, tenant?.settings.timezone ?? "Africa/Maputo");
    const spent = await spentTodayMicros(ctx, channel.tenantId, day);
    if (spent >= usdCentsToMicros(settings.dailyBudgetUsdCents)) {
      await upsertOpsAlert(ctx, {
        tenantId: channel.tenantId,
        kind: "ai.budget_exceeded",
        businessKey: `ai:budget:${day}`,
        severity: "warn",
        title: "Orçamento diário de IA esgotado; os agentes pararam de responder até amanhã.",
        payload: { day, spentUsdMicros: spent },
        href: "/app/settings?tab=ai",
        now,
      });
      await recordThreadSystemEvent(ctx, { thread, kind: "ai.skipped", severity: "warning", code: "BUDGET_EXCEEDED", actorType: "system", dedupeKey: `ai:budget:${thread._id}:${day}`, now });
      return { claimed: false, reason: "BUDGET_EXCEEDED" };
    }
    const recent = await ctx.db
      .query("aiTurns")
      .withIndex("by_run", (q) => q.eq("runId", run!._id))
      .order("desc")
      .take(Math.max(settings.maxTurnsPerThreadPerDay, version.config.maxRepliesPerThread) + 1);
    const inFlight = recent.find((turn) => turn.status === "queued" || turn.status === "processing" || turn.status === "awaiting_send");
    // A suggestion nobody approved yet is retired by the newer message.
    for (const stale of recent.filter((turn) => turn.status === "awaiting_approval")) {
      await ctx.db.patch(stale._id, { status: "skipped", failureCode: "COALESCED", updatedAt: now });
    }
    const completedToday = recent.filter((turn) => turn.status === "completed" && turn.createdAt >= now - 24 * 60 * 60_000).length;
    const completedTotal = recent.filter((turn) => turn.status === "completed").length;
    if (completedToday >= settings.maxTurnsPerThreadPerDay || completedTotal >= version.config.maxRepliesPerThread) {
      await recordThreadSystemEvent(ctx, { thread, kind: "ai.skipped", severity: "info", code: "TURN_CAP", actorType: "system", dedupeKey: `ai:cap:${thread._id}:${day}`, now });
      return { claimed: false, reason: "TURN_CAP" };
    }
    if (inFlight) {
      // The in-flight turn re-reads the thread on completion (see _finishTurn).
      await ctx.db.insert("aiTurns", {
        tenantId: channel.tenantId,
        runId: run._id,
        threadId: thread._id,
        sourceEventId: event._id,
        businessKey,
        status: "skipped",
        stage: "coalesced",
        providerAttempts: [],
        inputTokens: 0,
        outputTokens: 0,
        costUsdMicros: 0,
        toolCallCount: 0,
        failureCode: "COALESCED",
        createdAt: now,
        updatedAt: now,
      });
      return { claimed: false, reason: "coalesced" };
    }
    const turnId = await ctx.db.insert("aiTurns", {
      tenantId: channel.tenantId,
      runId: run._id,
      threadId: thread._id,
      sourceEventId: event._id,
      businessKey,
      status: "queued",
      mode,
      providerAttempts: [],
      inputTokens: 0,
      outputTokens: 0,
      costUsdMicros: 0,
      toolCallCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    if (mode === "autopilot" && thread.automationMode !== "bot") await setThreadAutomationMode(ctx, thread, "bot", "ai_agent_active", now);
    await ctx.scheduler.runAfter(0, internal.aiRuntime.processTurn, { turnId });
    return { claimed: true, turnId };
  },
});

function eventText(event: Doc<"channelEvents">): string {
  const payload = event.payload as Record<string, unknown> | null;
  const preview = derivePreview(event.payload);
  if (preview) return preview;
  const text = payload && typeof payload.text === "string" ? payload.text : undefined;
  return text ?? "";
}

export const _loadTurnContext = internalQuery({
  args: { turnId: v.id("aiTurns") },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => {
    const turn = await ctx.db.get(args.turnId);
    if (!turn || turn.status !== "processing") return null;
    const run = await ctx.db.get(turn.runId);
    const thread = await ctx.db.get(turn.threadId);
    if (!run || !thread || run.status !== "active") return null;
    const version = await ctx.db.get(run.versionId);
    const agent = await ctx.db.get(run.agentId);
    if (!version || !agent) return null;
    const tenant = await ctx.db.get(turn.tenantId);
    const settingsRow = await ctx.db
      .query("aiSettings")
      .withIndex("by_tenant", (q) => q.eq("tenantId", turn.tenantId))
      .unique();
    const clinicSettings = await ctx.db
      .query("clinicSettings")
      .withIndex("by_tenant", (q) => q.eq("tenantId", turn.tenantId))
      .unique();
    const timeZone = clinicSettings?.timezone ?? tenant?.settings.timezone ?? "Africa/Maputo";
    const identity = thread.identityId ? await ctx.db.get(thread.identityId) : null;
    const sourceEvent = turn.sourceEventId ? await ctx.db.get(turn.sourceEventId) : null;
    const events = await ctx.db
      .query("channelEvents")
      .withIndex("by_channel_thread", (q) => q.eq("channelId", thread.channelId).eq("threadKey", thread.threadKey))
      .order("desc")
      .take(HISTORY_EVENTS);
    const newestInbound = events.find((e) => e.direction === "incoming" && e.eventKind.startsWith("message."));
    const currentId = sourceEvent?._id ?? newestInbound?._id;
    const history: AiMessage[] = [];
    for (const event of [...events].reverse()) {
      if (currentId && event._id === currentId) continue;
      if (!event.eventKind.startsWith("message.")) continue;
      const text = eventText(event);
      if (!text) continue;
      history.push(event.direction === "incoming" ? { role: "user", content: text.slice(0, 1_500) } : { role: "assistant", content: text.slice(0, 1_500) });
    }
    const services = (await ctx.db
      .query("clinicServices")
      .withIndex("by_tenant_status", (q) => q.eq("tenantId", turn.tenantId).eq("status", "active"))
      .take(40)) as Doc<"clinicServices">[];
    const professionals = (await ctx.db
      .query("clinicProfessionals")
      .withIndex("by_tenant_status", (q) => q.eq("tenantId", turn.tenantId).eq("status", "active"))
      .take(50)) as Doc<"clinicProfessionals">[];
    const templates = ((await ctx.db
      .query("channelTemplates")
      .withIndex("by_channel", (q) => q.eq("channelId", thread.channelId))
      .take(100)) as Doc<"channelTemplates">[]).filter((t) => ["approved", "active"].includes(t.status.toLowerCase()));
    const now = Date.now();
    // Coalesced follow-ups answer the newest message, not the one that started the turn.
    const inboundText = sourceEvent ? eventText(sourceEvent) : newestInbound ? eventText(newestInbound) : "";
    const siteHost = (() => { try { return process.env.SITE_URL ? new URL(process.env.SITE_URL).host : undefined; } catch { return undefined; } })();
    const feedback = (await ctx.db
      .query("aiFeedback")
      .withIndex("by_agent_created", (q) => q.eq("agentId", run.agentId))
      .order("desc")
      .take(8)) as Doc<"aiFeedback">[];
    const examples = feedback.filter((row) => row.outcome !== "discarded" && row.finalText.trim()).map((row) => ({ patient: row.patientText, reply: row.finalText }));
    return {
      turn,
      run,
      mode: turn.mode ?? "autopilot",
      // Read once per turn, here, instead of hoping the model calls a tool for
      // it: what we may promise the patient is a fact of the tenant, not a
      // choice of the model.
      teamExpectation: expectationInstruction(await teamAvailability(ctx, turn.tenantId, now), "pt"),
      thread: {
        firstName: identity?.displayName?.trim().split(/\s+/)[0],
        leadStatus: thread.leadStatus,
        serviceWindowOpen: !!thread.serviceWindowExpiresAt && thread.serviceWindowExpiresAt > now,
        // No accepted outbound yet means this is the clinic's first word to
        // this person, and the reply has to say who is speaking.
        firstOutbound: !thread.lastOutboundAt,
      },
      agent: { name: agent.name, objective: agent.objective, config: version.config, knowledge: version.knowledgeSnapshot.map((k) => ({ kind: k.kind, title: k.title, body: k.body })), examples },
      settingsRow,
      clinic: {
        clinicName: tenant?.name ?? "Clínica",
        timeZone,
        localNow: formatLocalDateTime(now, timeZone),
        services: services.map((s) => ({ id: s._id, name: s.name, durationMinutes: s.durationMinutes, professionalNames: professionals.filter((p) => s.professionalIds?.includes(p._id)).map((p) => p.name) })),
        templates: templates.map((t) => ({ name: t.name, languageCode: t.languageCode })),
        allowedHosts: siteHost ? [siteHost] : [],
      },
      history,
      inboundText,
      hasMedia: sourceEvent ? sourceEvent.eventKind !== "message.text" && !inboundText : false,
    };
  },
});

export const _startTurn = internalMutation({
  args: { turnId: v.id("aiTurns") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const turn = await ctx.db.get(args.turnId);
    if (!turn || turn.status !== "queued") return false;
    await ctx.db.patch(turn._id, { status: "processing", stage: "started", startedAt: Date.now(), updatedAt: Date.now() });
    return true;
  },
});

/**
 * Does anything own the promises this reply makes?
 *
 * Reads the three places responsibility can live — a tool that really ran, a
 * live follow-up, a person holding the conversation — and raises one alert when
 * none of them do. It never claims the promise was broken: the system cannot
 * know that, and saying it would be a verdict nobody measured.
 */
async function checkPromiseOwnership(
  ctx: { db: any; scheduler?: unknown },
  args: {
    turn: Doc<"aiTurns">;
    thread: Doc<"channelThreads">;
    text: string;
    appointmentTouched: boolean;
    now: number;
  },
): Promise<{ promises: DetectedPromise[]; owned: boolean }> {
  const promises = detectPromises(args.text);
  if (promises.length === 0) return { promises, owned: true };
  const invocations = (await ctx.db
    .query("aiToolInvocations")
    .withIndex("by_turn", (q: any) => q.eq("turnId", args.turn._id))
    .take(20)) as Doc<"aiToolInvocations">[];
  const followUps = (await ctx.db
    .query("followUpTasks")
    .withIndex("by_thread", (q: any) => q.eq("threadId", args.thread._id))
    .take(10)) as Doc<"followUpTasks">[];
  const verdict = promiseOwnership(promises, {
    // A dry run committed nothing: in copilot the actions only exist after a
    // person approves them.
    toolsRan: invocations.some((row) => row.status === "ok"),
    followUpAlive: followUps.some((row) => row.status === "scheduled" || row.status === "claimed"),
    appointmentTouched: args.appointmentTouched,
    humanCaseOpen: !!args.thread.openHumanCaseId,
    memberOwns: !!args.thread.responsibleMemberId,
  });
  await ctx.db.patch(args.turn._id, { promises, promiseOwned: verdict.owned, updatedAt: args.now });
  if (!verdict.owned) {
    await upsertOpsAlert(ctx, {
      tenantId: args.turn.tenantId,
      kind: "ai.promise_unfulfilled",
      businessKey: `ai:promise:${args.turn._id}`,
      severity: "warn",
      title: promiseAlertTitle(promises, "pt"),
      payload: { turnId: args.turn._id, threadKey: args.thread.threadKey, promises: promises.map((item) => item.kind) },
      href: `/app/channel-inbox/${args.thread.threadKey}?channel=${args.thread.channelId}`,
      now: args.now,
    });
    await recordThreadSystemEvent(ctx, {
      thread: args.thread,
      kind: "ai.promise_unowned",
      severity: "warning",
      actorType: "automation",
      payload: { turnId: args.turn._id, promises: promises.map((item) => item.kind).join(",") },
      dedupeKey: `aiturn:${args.turn._id}:promise`,
      now: args.now,
    });
    // Somebody has to be able to pick this up from the inbox.
    if (!args.thread.nextStep) {
      await ctx.db.patch(args.thread._id, {
        nextStep: `Cumprir o que a IA prometeu: ${promiseSummary(promises, "pt")}.`,
        nextStepDueAt: args.now,
        updatedAt: args.now,
      });
    }
  }
  return { promises, owned: verdict.owned };
}

const resultValidator = v.object({
  outcome: v.string(),
  text: v.optional(v.string()),
  template: v.optional(v.object({ templateName: v.string(), languageCode: v.string(), bodyVariables: v.array(v.string()) })),
  reason: v.optional(v.string()),
  routerIntent: v.optional(v.string()),
  handoff: v.optional(v.object({ reason: v.string(), urgency: v.string(), question: v.string() })),
  handedOffByTool: v.boolean(),
  attempts: v.array(v.object({ provider: v.string(), model: v.string(), stage: v.string(), attempt: v.number(), ok: v.boolean(), kind: v.optional(v.string()), status: v.optional(v.number()), latencyMs: v.number() })),
  inputTokens: v.number(),
  outputTokens: v.number(),
  costUsdMicros: v.number(),
  violations: v.array(v.string()),
  stages: v.array(v.string()),
  usedModel: v.optional(v.string()),
  usedProvider: v.optional(v.string()),
  proposedActions: v.optional(v.array(v.object({ name: v.string(), input: v.any(), output: v.any() }))),
  /** Did the tools really touch the agenda in this turn? */
  appointmentTouched: v.optional(v.boolean()),
});

/**
 * Record the pipeline verdict: queue the reply (outboundJobs), open the
 * human case on handoff, or park the thread for the team. Also charges the
 * daily ledger and re-checks for messages that arrived during processing.
 */
export const _finishTurn = internalMutation({
  args: { turnId: v.id("aiTurns"), result: resultValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const turn = await ctx.db.get(args.turnId);
    if (!turn || turn.status !== "processing") return null;
    const run = await ctx.db.get(turn.runId);
    const thread = await ctx.db.get(turn.threadId);
    if (!run || !thread) return null;
    const version = await ctx.db.get(run.versionId);
    const now = Date.now();
    const r = args.result;
    const tenant = await ctx.db.get(turn.tenantId);
    const day = localDateOf(now, tenant?.settings.timezone ?? "Africa/Maputo");

    // Ledger (per provider/model actually used).
    if (r.costUsdMicros > 0 || r.inputTokens > 0) {
      const provider = r.usedProvider ?? "unknown";
      const model = r.usedModel ?? "unknown";
      const rows = (await ctx.db
        .query("aiCostLedger")
        .withIndex("by_tenant_day", (q) => q.eq("tenantId", turn.tenantId).eq("day", day))
        .take(50)) as Doc<"aiCostLedger">[];
      const existing = rows.find((row) => row.provider === provider && row.model === model);
      if (existing) {
        await ctx.db.patch(existing._id, { inputTokens: existing.inputTokens + r.inputTokens, outputTokens: existing.outputTokens + r.outputTokens, costUsdMicros: existing.costUsdMicros + r.costUsdMicros, turns: existing.turns + 1, updatedAt: now });
      } else {
        await ctx.db.insert("aiCostLedger", { tenantId: turn.tenantId, day, provider, model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, costUsdMicros: r.costUsdMicros, turns: 1, updatedAt: now });
      }
      await ctx.db.patch(run._id, { costUsdMicros: run.costUsdMicros + r.costUsdMicros, updatedAt: now });
    }

    const common = {
      providerAttempts: r.attempts.map((a) => ({ provider: a.provider, model: a.model, stage: a.stage, attempt: a.attempt, ok: a.ok, kind: a.kind, status: a.status, latencyMs: a.latencyMs })),
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      costUsdMicros: r.costUsdMicros,
      updatedAt: now,
    };

    if ((turn.mode ?? "autopilot") === "copilot" && (r.outcome === "reply" || r.outcome === "template" || r.outcome === "handoff" || r.outcome === "fallback")) {
      const actions = [...(r.proposedActions ?? [])];
      if (r.outcome === "handoff" && !r.handedOffByTool && r.handoff) {
        actions.push({ name: "abrir_caso_humano", input: { reason: r.handoff.reason.slice(0, 80), urgency: r.handoff.urgency, question: r.handoff.question }, output: { proposed: true } });
      }
      if (r.outcome === "template" && r.template) {
        actions.push({ name: "enviar_template", input: r.template, output: { proposed: true } });
      }
      const suggestedText = r.text ?? "";
      await ctx.db.patch(turn._id, {
        ...common,
        status: "awaiting_approval",
        stage: r.outcome === "handoff" ? "handoff" : r.outcome === "fallback" ? "fallback" : "reply",
        routerDecision: { intent: r.routerIntent, reason: r.reason, violations: r.violations, stages: r.stages },
        suggestedText,
        proposedActions: actions,
      });
      // The suggestion has not reached anyone yet, so nothing is owed. What the
      // card needs is the WARNING, so the operator sees the commitment before
      // approving it.
      await ctx.db.patch(turn._id, { promises: detectPromises(suggestedText), updatedAt: now });
      await recordThreadSystemEvent(ctx, { thread, kind: "ai.suggested", severity: "info", actorType: "automation", payload: { turnId: turn._id, actions: actions.length, outcome: r.outcome }, dedupeKey: `aiturn:${turn._id}:suggested`, now });
      await ctx.db.patch(thread._id, { nextStep: "Sugestão da IA a aguardar aprovação no inbox.", nextStepDueAt: now, updatedAt: now });
      return null;
    }

    const queueReply = async (stage: string, reply: { kind: "text"; text: string } | { kind: "template"; templateName: string; languageCode: string; bodyVariables: string[] }) => {
      await ctx.db.patch(turn._id, {
        ...common,
        status: "awaiting_send",
        stage,
        routerDecision: { intent: r.routerIntent, reason: r.reason, violations: r.violations, stages: r.stages, reply },
        replyText: reply.kind === "text" ? reply.text : undefined,
      });
      await ctx.scheduler.runAfter(0, internal.iaSolutionHub.dispatchOutboundJob, { job: { kind: "ai_reply", turnId: turn._id } });
    };

    if (r.outcome === "reply" && r.text) {
      await queueReply("reply", { kind: "text", text: r.text });
      await checkPromiseOwnership(ctx, { turn, thread, text: r.text, appointmentTouched: !!r.appointmentTouched, now });
    } else if (r.outcome === "template" && r.template) {
      await queueReply("template", { kind: "template", ...r.template });
    } else if (r.outcome === "handoff") {
      if (!r.handedOffByTool) {
        await openHumanCaseInternal(
          { db: ctx.db, tenantId: turn.tenantId, memberId: version?.publishedBy ?? run.tenantId as unknown as Id<"members">, role: "ai" },
          { thread, reason: (r.handoff?.reason ?? "ai_handoff").slice(0, 80), urgency: (r.handoff?.urgency as "low" | "normal" | "high" | "urgent") ?? "normal", question: r.handoff?.question || "Passagem à equipa pela IA.", openedFrom: "automation", actorKind: "ai", now },
        );
      }
      await ctx.db.patch(run._id, { status: "handed_off", pausedReason: r.handoff?.reason ?? r.reason, updatedAt: now });
      await recordThreadSystemEvent(ctx, { thread, kind: "ai.handoff", severity: "warning", actorType: "automation", payload: { turnId: turn._id, reason: r.handoff?.reason ?? r.reason }, dedupeKey: `aiturn:${turn._id}:handoff`, now });
      await emitWebhookEvent(ctx, { tenantId: turn.tenantId, type: "ai.handoff", eventId: `ai_turn:${turn._id}:handoff`, payload: { turnId: turn._id, threadId: thread._id, threadKey: thread.threadKey, reason: r.handoff?.reason ?? r.reason }, now });
      // The notice is DETERMINISTIC and goes out before the AI goes quiet.
      // Relying on the model having written a goodbye is how a patient ends up
      // talking to nobody: the hand-off itself is what must speak.
      const notice = handoffNoticeText({
        reason: r.handoff?.reason ?? r.reason,
        availability: await teamAvailability(ctx, turn.tenantId, now),
        conversationKey: thread.threadKey,
        locale: "pt",
      });
      if (thread.serviceWindowExpiresAt && thread.serviceWindowExpiresAt > now) {
        await queueReply("handoff", { kind: "text", text: notice });
      } else {
        await ctx.db.patch(turn._id, { ...common, status: "completed", stage: "handoff", routerDecision: { intent: r.routerIntent, reason: r.reason, stages: r.stages }, completedAt: now });
      }
    } else if (r.outcome === "fallback" && r.text) {
      await queueReply("fallback", { kind: "text", text: r.text });
    } else if (r.outcome === "skip") {
      await ctx.db.patch(turn._id, { ...common, status: "skipped", stage: "preroute", failureCode: r.reason, routerDecision: { intent: r.routerIntent, reason: r.reason, stages: r.stages }, completedAt: now });
      if (r.reason === "opt_out" || r.reason === "stop_word") {
        await ctx.db.patch(run._id, { status: "completed", pausedReason: r.reason, updatedAt: now });
        await setThreadAutomationMode(ctx, thread, "stopped", `ai_${r.reason}`, now);
      }
    } else {
      // failed, or fallback without a sendable text (window closed).
      const code = r.reason ?? "AI_TURN_FAILED";
      await ctx.db.patch(turn._id, { ...common, status: "failed", stage: r.outcome, failureCode: code, routerDecision: { intent: r.routerIntent, reason: r.reason, stages: r.stages, violations: r.violations }, completedAt: now });
      await recordThreadSystemEvent(ctx, { thread, kind: "ai.failed", severity: "error", code, actorType: "automation", payload: { turnId: turn._id, stages: r.stages.join(",") }, dedupeKey: `aiturn:${turn._id}:failed`, now });
      const copilot = (turn.mode ?? "autopilot") === "copilot";
      if (code.startsWith("provider:") && !copilot) {
        await ctx.db.patch(run._id, { status: "paused", pausedReason: code, updatedAt: now });
        await upsertOpsAlert(ctx, {
          tenantId: turn.tenantId,
          kind: "ai.provider_down",
          businessKey: `ai:provider_down:${day}`,
          severity: "critical",
          title: "O provedor de IA não respondeu; as conversas estão a ser passadas à equipa.",
          payload: { turnId: turn._id, code, attempts: r.attempts.length },
          href: "/app/settings?tab=ai",
          reopen: true,
          now,
        });
      }
      if (!thread.openHumanCaseId && !copilot) {
        await openHumanCaseInternal(
          { db: ctx.db, tenantId: turn.tenantId, memberId: version?.publishedBy ?? run.tenantId as unknown as Id<"members">, role: "ai" },
          { thread, reason: code === "SERVICE_WINDOW_EXPIRED" ? "Janela fechada: IA não pôde responder" : "IA indisponível", urgency: "normal", question: `A IA não conseguiu responder (${code}). Última mensagem precisa de resposta humana.`, openedFrom: "automation", actorKind: "system", now },
        );
      }
    }

    // Messages that arrived while we were thinking get their own turn.
    const fresh = await ctx.db.get(thread._id);
    const runNow = await ctx.db.get(run._id);
    if (fresh && runNow?.status === "active" && fresh.lastInboundAt && turn.startedAt && fresh.lastInboundAt > turn.startedAt) {
      const businessKey = `coalesce:${run._id}:${fresh.lastInboundAt}`;
      const dup = await ctx.db
        .query("aiTurns")
        .withIndex("by_run_business_key", (q) => q.eq("runId", run._id).eq("businessKey", businessKey))
        .unique();
      if (!dup) {
        const turnId = await ctx.db.insert("aiTurns", { tenantId: turn.tenantId, runId: run._id, threadId: thread._id, businessKey, status: "queued", providerAttempts: [], inputTokens: 0, outputTokens: 0, costUsdMicros: 0, toolCallCount: 0, createdAt: now, updatedAt: now });
        await ctx.scheduler.runAfter(1_000, internal.aiRuntime.processTurn, { turnId });
      }
    }
    return null;
  },
});

export const _failTurn = internalMutation({
  args: { turnId: v.id("aiTurns"), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const turn = await ctx.db.get(args.turnId);
    if (!turn || (turn.status !== "processing" && turn.status !== "queued")) return null;
    await ctx.db.patch(turn._id, { status: "failed", failureCode: "RUNTIME_ERROR", failureReason: args.reason.slice(0, 500), completedAt: Date.now(), updatedAt: Date.now() });
    return null;
  },
});

/** The only place model calls happen for live conversations. */
export const processTurn = internalAction({
  args: { turnId: v.id("aiTurns") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const started = await ctx.runMutation(internal.aiRuntime._startTurn, { turnId: args.turnId });
    if (!started) return null;
    const context = (await ctx.runQuery(internal.aiRuntime._loadTurnContext, { turnId: args.turnId })) as Awaited<ReturnType<typeof loadContextType>> | null;
    if (!context) {
      await ctx.runMutation(internal.aiRuntime._failTurn, { turnId: args.turnId, reason: "context unavailable (run paused or thread taken over)" });
      return null;
    }
    try {
      const settings = effectiveSettings(context.settingsRow);
      const candidates = {
        router: await candidatesFor(context.settingsRow, "router"),
        specialist: await candidatesFor(context.settingsRow, "specialist"),
      };
      const result: PipelineResult = await runTurnPipeline({
        candidates,
        settings,
        agent: context.agent,
        clinic: context.clinic,
        thread: context.thread,
        teamExpectation: context.teamExpectation,
        history: context.history,
        inboundText: context.inboundText,
        hasMedia: context.hasMedia,
        executeTool: async (call) =>
          (await ctx.runMutation(internal.aiTools.invoke, {
            turnId: args.turnId,
            name: call.name,
            input: call.input ?? {},
            dryRun: context.mode === "copilot" && isWriteTool(call.name),
          })) as ToolOutcome,
      });
      const used = result.attempts.find((a) => a.ok && a.stage !== "router") ?? result.attempts.find((a) => a.ok);
      await ctx.runMutation(internal.aiRuntime._finishTurn, {
        turnId: args.turnId,
        result: {
          outcome: result.outcome,
          text: result.text,
          template: result.template,
          reason: result.reason,
          routerIntent: result.routerDecision?.intent,
          handoff: result.handoff,
          handedOffByTool: !!result.effects.handedOff,
          attempts: result.attempts,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          costUsdMicros: result.costUsdMicros,
          violations: result.violations,
          stages: result.stages,
          usedModel: used?.model,
          usedProvider: used?.provider,
          proposedActions: result.toolCalls.filter((c) => c.status === "dry_run").map((c) => ({ name: c.name, input: c.input, output: c.output })),
          appointmentTouched: !!result.effects.booked || !!result.effects.confirmed,
        },
      });
    } catch (error) {
      await ctx.runMutation(internal.aiRuntime._failTurn, { turnId: args.turnId, reason: error instanceof Error ? error.message : String(error) });
    }
    return null;
  },
});

// Type helper for the context shape returned by `_loadTurnContext`.
async function loadContextType() {
  return null as unknown as {
    turn: Doc<"aiTurns">;
    run: Doc<"aiRuns">;
    thread: { firstName?: string; leadStatus?: string; serviceWindowOpen: boolean; firstOutbound: boolean };
    mode: AiMode;
    teamExpectation: string;
    agent: { name: string; objective: Doc<"aiAgents">["objective"]; config: Doc<"aiAgentVersions">["config"]; knowledge: Array<{ kind: string; title: string; body: string }>; examples: Array<{ patient: string; reply: string }> };
    settingsRow: Doc<"aiSettings"> | null;
    clinic: { clinicName: string; timeZone: string; localNow: string; services: Array<{ id: string; name: string; durationMinutes: number; professionalNames?: string[] }>; templates: Array<{ name: string; languageCode: string }>; allowedHosts: string[] };
    history: AiMessage[];
    inboundText: string;
    hasMedia: boolean;
  };
}

/** Cron: turns whose action died stay "processing" forever otherwise. */
export const sweepStaleTurns = internalMutation({
  args: {},
  returns: v.object({ failed: v.number() }),
  handler: async (ctx) => {
    const now = Date.now();
    const stale = (await ctx.db
      .query("aiTurns")
      .withIndex("by_status_created", (q) => q.eq("status", "processing").lt("createdAt", now - STALE_TURN_MS))
      .take(50)) as Doc<"aiTurns">[];
    for (const turn of stale) {
      await ctx.db.patch(turn._id, { status: "failed", failureCode: "STALE_TURN", completedAt: now, updatedAt: now });
      const thread = await ctx.db.get(turn.threadId);
      if (thread) {
        await recordThreadSystemEvent(ctx, { thread, kind: "ai.failed", severity: "error", code: "STALE_TURN", actorType: "system", dedupeKey: `aiturn:${turn._id}:stale`, now });
        await ctx.db.patch(thread._id, { nextStep: "A IA não terminou a resposta. Responder manualmente.", nextStepDueAt: now, updatedAt: now });
      }
    }
    return { failed: stale.length };
  },
});

// ---------------------------------------------------------------------------
// Telemetry (C5)
// ---------------------------------------------------------------------------

import { paginationOptsValidator } from "convex/server";
import { requireCapability, tenantMutation, tenantQuery, loadByIdInTenant } from "./lib/customFunctions";
import { resumeAiRun } from "./lib/ai/control";

const turnRowValidator = v.object({
  _id: v.id("aiTurns"),
  runId: v.id("aiRuns"),
  threadId: v.id("channelThreads"),
  threadKey: v.string(),
  agentName: v.string(),
  status: v.string(),
  stage: v.optional(v.string()),
  routerIntent: v.optional(v.string()),
  replyText: v.optional(v.string()),
  failureCode: v.optional(v.string()),
  toolCallCount: v.number(),
  inputTokens: v.number(),
  outputTokens: v.number(),
  costUsdMicros: v.number(),
  latencyMs: v.number(),
  attempts: v.array(v.object({ provider: v.string(), model: v.string(), stage: v.string(), ok: v.boolean(), kind: v.optional(v.string()), latencyMs: v.number() })),
  createdAt: v.number(),
  completedAt: v.optional(v.number()),
});

export const listTurns = tenantQuery({
  args: { agentId: v.optional(v.id("aiAgents")), threadId: v.optional(v.id("channelThreads")), paginationOpts: paginationOptsValidator },
  returns: v.object({ page: v.array(turnRowValidator), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "ai.view_runs");
    const result = await ctx.db
      .query("aiTurns")
      .withIndex("by_tenant_created", (q) => q.eq("tenantId", ctx.tenantId))
      .order("desc")
      .filter((q) => (args.threadId ? q.eq(q.field("threadId"), args.threadId) : q.eq(q.field("tenantId"), ctx.tenantId)))
      .paginate({ cursor: args.paginationOpts.cursor, numItems: Math.min(Math.max(args.paginationOpts.numItems, 1), 50) });
    const runs = new Map<string, Doc<"aiRuns"> | null>();
    const agents = new Map<string, Doc<"aiAgents"> | null>();
    const page = [];
    for (const turn of result.page) {
      let run = runs.get(turn.runId);
      if (run === undefined) {
        run = (await ctx.db.get(turn.runId)) as Doc<"aiRuns"> | null;
        runs.set(turn.runId, run);
      }
      if (!run) continue;
      if (args.agentId && run.agentId !== args.agentId) continue;
      let agent = agents.get(run.agentId);
      if (agent === undefined) {
        agent = (await ctx.db.get(run.agentId)) as Doc<"aiAgents"> | null;
        agents.set(run.agentId, agent);
      }
      const decision = turn.routerDecision as { intent?: string } | undefined;
      page.push({
        _id: turn._id,
        runId: turn.runId,
        threadId: turn.threadId,
        threadKey: run.threadKey,
        agentName: agent?.name ?? "—",
        status: turn.status,
        stage: turn.stage,
        routerIntent: decision?.intent,
        replyText: turn.replyText,
        failureCode: turn.failureCode,
        toolCallCount: turn.toolCallCount,
        inputTokens: turn.inputTokens,
        outputTokens: turn.outputTokens,
        costUsdMicros: turn.costUsdMicros,
        latencyMs: turn.providerAttempts.reduce((sum, a) => sum + a.latencyMs, 0),
        attempts: turn.providerAttempts.map((a) => ({ provider: a.provider, model: a.model, stage: a.stage, ok: a.ok, kind: a.kind, latencyMs: a.latencyMs })),
        createdAt: turn.createdAt,
        completedAt: turn.completedAt,
      });
    }
    return { page, isDone: result.isDone, continueCursor: result.continueCursor };
  },
});

export const stats = tenantQuery({
  args: { agentId: v.optional(v.id("aiAgents")), days: v.optional(v.number()) },
  returns: v.object({
    turns: v.number(),
    completed: v.number(),
    failed: v.number(),
    skipped: v.number(),
    handoffs: v.number(),
    toolCalls: v.number(),
    avgLatencyMs: v.number(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    costUsdMicros: v.number(),
    activeRuns: v.number(),
    sampled: v.boolean(),
  }),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "ai.view_runs");
    const since = Date.now() - Math.min(90, Math.max(1, args.days ?? 7)) * 24 * 60 * 60_000;
    const rows = (await ctx.db
      .query("aiTurns")
      .withIndex("by_tenant_created", (q) => q.eq("tenantId", ctx.tenantId).gte("createdAt", since))
      .order("desc")
      .take(1_001)) as Doc<"aiTurns">[];
    const runs = new Map<string, Doc<"aiRuns"> | null>();
    let turns = 0, completed = 0, failed = 0, skipped = 0, handoffs = 0, toolCalls = 0, latency = 0, latencyCount = 0, inputTokens = 0, outputTokens = 0, cost = 0;
    for (const turn of rows.slice(0, 1_000)) {
      if (args.agentId) {
        let run = runs.get(turn.runId);
        if (run === undefined) {
          run = (await ctx.db.get(turn.runId)) as Doc<"aiRuns"> | null;
          runs.set(turn.runId, run);
        }
        if (run?.agentId !== args.agentId) continue;
      }
      turns += 1;
      if (turn.status === "completed") completed += 1;
      if (turn.status === "failed") failed += 1;
      if (turn.status === "skipped") skipped += 1;
      if (turn.stage === "handoff") handoffs += 1;
      toolCalls += turn.toolCallCount;
      const l = turn.providerAttempts.reduce((sum, a) => sum + a.latencyMs, 0);
      if (l > 0) { latency += l; latencyCount += 1; }
      inputTokens += turn.inputTokens;
      outputTokens += turn.outputTokens;
      cost += turn.costUsdMicros;
    }
    const activeRuns = (await ctx.db
      .query("aiRuns")
      .withIndex("by_tenant_status_last", (q) => q.eq("tenantId", ctx.tenantId).eq("status", "active"))
      .take(201)).filter((run) => !args.agentId || run.agentId === args.agentId).length;
    return { turns, completed, failed, skipped, handoffs, toolCalls, avgLatencyMs: latencyCount > 0 ? Math.round(latency / latencyCount) : 0, inputTokens, outputTokens, costUsdMicros: cost, activeRuns, sampled: rows.length > 1_000 };
  },
});

/** Inbox "Retomar IA" when the run is paused/handed off (case must be resolved). */
export const resumeThread = tenantMutation({
  args: { threadId: v.id("channelThreads") },
  returns: v.object({ resumed: v.boolean() }),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "inbox.handoff");
    const thread = await loadByIdInTenant(ctx, "channelThreads", args.threadId);
    const now = Date.now();
    const result = await resumeAiRun(ctx, { thread, now });
    if (result.resumed) await setThreadAutomationMode(ctx, thread, "bot", "ai_resumed_by_operator", now);
    return { resumed: result.resumed };
  },
});
