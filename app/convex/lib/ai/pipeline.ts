import type { ThreadIntent } from "../channels/intents";
import { applyDisclosure, bookingFooter, clampReply, runGuards, type GuardViolation } from "./guards";
import { createToolBreaker } from "./toolBreaker";
import { preroute, type PrerouteDecision } from "./prerouter";
import { costUsdMicros } from "./pricing";
import { buildRepairPrompt, buildRouterSystem, buildSpecialistSystem, ROUTE_TOOL_NAME, ROUTE_TOOL_SPEC, wrapPatientText, type SpecialistContext } from "./prompts";
import type { AiMessage, AiToolCall, AiUsage, FetchLike } from "./provider";
import { AiProviderError } from "./provider";
import { completeWithResilience, type ProviderAttempt, type ProviderCandidate } from "./resilience";
import type { EffectiveAiSettings } from "./settings";
import type { ToolEffects, ToolOutcome } from "./tools";
import { READ_ONLY_TOOLS, toolSpecsFor } from "./toolRegistry";
import { parseRouteDecision, type RouteDecision } from "./validators";

export type PipelineAgent = {
  name: string;
  objective: SpecialistContext["objective"];
  config: {
    instructions: string;
    tone: SpecialistContext["tone"];
    tools: string[];
    handoff: { keywords: string[]; onLowConfidence: boolean; onClinicalQuestion: boolean; message: string };
    fallbackMessage: string;
    greeting?: string;
  };
  knowledge: Array<{ kind: string; title: string; body: string }>;
  examples?: Array<{ patient: string; reply: string }>;
};

export type PipelineInput = {
  candidates: { router: ProviderCandidate[]; specialist: ProviderCandidate[] };
  settings: Pick<EffectiveAiSettings, "effort" | "extendedThinking" | "maxToolCallsPerTurn" | "replyLanguage">;
  agent: PipelineAgent;
  clinic: Pick<SpecialistContext, "clinicName" | "services" | "templates" | "localNow" | "timeZone"> & { allowedHosts: string[] };
  thread: { firstName?: string; leadStatus?: string; serviceWindowOpen: boolean; firstOutbound?: boolean };
  /** Honest hand-off expectation, derived from real team availability. */
  teamExpectation?: string;
  /** The last next-action proposal the team decided on this conversation. */
  lastDecision?: { action: string; decision: string };
  history: AiMessage[];
  inboundText: string;
  hasMedia?: boolean;
  executeTool: (call: AiToolCall) => Promise<ToolOutcome>;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  skipRouter?: boolean;
};

export type PipelineToolRecord = { name: string; input: unknown; status: ToolOutcome["status"]; output: unknown; errorCode?: string };

export type PipelineResult = {
  outcome: "reply" | "template" | "handoff" | "skip" | "fallback" | "failed";
  text?: string;
  template?: { templateName: string; languageCode: string; bodyVariables: string[] };
  reason?: string;
  preroute: PrerouteDecision;
  routerDecision?: RouteDecision;
  handoff?: { reason: string; urgency: "low" | "normal" | "high" | "urgent"; question: string };
  toolCalls: PipelineToolRecord[];
  attempts: ProviderAttempt[];
  usage: AiUsage;
  costUsdMicros: number;
  violations: string[];
  stages: string[];
  effects: ToolEffects;
};

const LOW_CONFIDENCE = 0.4;
const HISTORY_LIMIT = 12;

function containsHandoffKeyword(text: string, keywords: string[]): string | null {
  const lower = text.toLowerCase();
  return keywords.find((keyword) => keyword && lower.includes(keyword.toLowerCase())) ?? null;
}

function base(input: PipelineInput, pre: PrerouteDecision): PipelineResult {
  return { outcome: "skip", preroute: pre, toolCalls: [], attempts: [], usage: { inputTokens: 0, outputTokens: 0 }, costUsdMicros: 0, violations: [], stages: [], effects: {} };
}

function addUsage(result: PipelineResult, model: string, usage: AiUsage) {
  result.usage = { inputTokens: result.usage.inputTokens + usage.inputTokens, outputTokens: result.usage.outputTokens + usage.outputTokens };
  result.costUsdMicros += costUsdMicros(model, usage);
}

function handoffResult(result: PipelineResult, input: PipelineInput, reason: string, urgency: PipelineResult["handoff"] extends infer H ? (H extends { urgency: infer U } ? U : never) : never, question: string, text?: string): PipelineResult {
  result.outcome = "handoff";
  result.reason = reason;
  result.handoff = { reason, urgency, question: question.slice(0, 500) };
  result.text = text ?? input.agent.config.handoff.message;
  return result;
}

/**
 * One inbound → one decision. Pure orchestration: providers via the
 * resilience layer, tools via the injected executor, guards on the way out.
 * Never sends; the caller (runtime or sandbox) decides what to do with it.
 */
export async function runTurnPipeline(input: PipelineInput): Promise<PipelineResult> {
  const pre = preroute({ text: input.inboundText, hasMedia: input.hasMedia });
  const result = base(input, pre);
  const inbound = input.inboundText.trim();

  if (pre.action === "skip") {
    result.reason = pre.reason;
    result.stages.push("preroute");
    return result;
  }
  const keyword = containsHandoffKeyword(inbound, input.agent.config.handoff.keywords);
  if (keyword) {
    result.stages.push("preroute");
    return handoffResult(result, input, `keyword:${keyword}`, "high", inbound);
  }
  if (pre.action === "handoff") {
    result.stages.push("preroute");
    return handoffResult(result, input, pre.reason, pre.reason === "complaint" ? "high" : "normal", inbound);
  }
  if (pre.action === "clinical" && input.agent.config.handoff.onClinicalQuestion) {
    result.stages.push("preroute");
    return handoffResult(result, input, "clinical_question", "normal", inbound);
  }

  // Router (structured output via a forced tool call).
  let decision: RouteDecision | undefined;
  if (!input.skipRouter) {
    result.stages.push("router");
    try {
      const routed = await completeWithResilience(
        input.candidates.router,
        {
          model: input.candidates.router[0]?.model ?? "",
          system: buildRouterSystem(input.clinic.clinicName),
          messages: [...input.history.slice(-4), { role: "user", content: wrapPatientText(inbound) }],
          tools: [ROUTE_TOOL_SPEC],
          toolChoice: { name: ROUTE_TOOL_NAME },
          maxTokens: 200,
          temperature: 0,
          timeoutMs: 20_000,
        },
        { stage: "router", fetchImpl: input.fetchImpl, sleep: input.sleep },
      );
      result.attempts.push(...routed.attempts);
      addUsage(result, routed.response.model, routed.response.usage);
      const call = routed.response.toolCalls.find((c) => c.name === ROUTE_TOOL_NAME);
      decision = parseRouteDecision(call?.input) ?? undefined;
    } catch (error) {
      if (error instanceof AiProviderError) result.attempts.push(...(((error as unknown as { attempts?: ProviderAttempt[] }).attempts) ?? []));
      result.outcome = "failed";
      result.reason = error instanceof AiProviderError ? `provider:${error.kind}` : "router_failed";
      return result;
    }
    result.routerDecision = decision;
    if (decision) {
      if (decision.intent === "opt_out") {
        result.reason = "opt_out";
        return result;
      }
      if (decision.intent === "clinical_question" && input.agent.config.handoff.onClinicalQuestion) {
        return handoffResult(result, input, "clinical_question", "normal", inbound);
      }
      if (decision.needsHuman || decision.intent === "human_request" || decision.intent === "complaint") {
        return handoffResult(result, input, decision.intent === "complaint" ? "complaint" : "needs_human", decision.intent === "complaint" ? "high" : "normal", decision.summary ?? inbound);
      }
      if (decision.confidence < LOW_CONFIDENCE && input.agent.config.handoff.onLowConfidence) {
        return handoffResult(result, input, "low_confidence", "normal", decision.summary ?? inbound);
      }
    }
  }

  // Specialist with a bounded tool loop.
  result.stages.push("specialist");
  const system = buildSpecialistSystem({
    clinicName: input.clinic.clinicName,
    objective: input.agent.objective,
    tone: input.agent.config.tone,
    instructions: input.agent.config.instructions,
    knowledge: input.agent.knowledge,
    services: input.clinic.services,
    templates: input.clinic.templates,
    patientFirstName: input.thread.firstName,
    leadStatus: input.thread.leadStatus,
    serviceWindowOpen: input.thread.serviceWindowOpen,
    localNow: input.clinic.localNow,
    timeZone: input.clinic.timeZone,
    language: decision?.language === "en" ? "en" : input.settings.replyLanguage,
    handoffKeywords: input.agent.config.handoff.keywords,
    fallbackMessage: input.agent.config.fallbackMessage,
    examples: input.agent.examples,
    teamExpectation: input.teamExpectation,
    lastDecision: input.lastDecision,
  });
  const tools = toolSpecsFor(input.agent.config.tools);
  const messages: AiMessage[] = [...input.history.slice(-HISTORY_LIMIT), { role: "user", content: wrapPatientText(inbound) }];
  const breaker = createToolBreaker({ readOnlyTools: READ_ONLY_TOOLS });
  let text = "";
  let handedOff = false;
  let repaired = false;

  for (let step = 0; step <= input.settings.maxToolCallsPerTurn; step += 1) {
    let response;
    try {
      response = await completeWithResilience(
        input.candidates.specialist,
        {
          model: input.candidates.specialist[0]?.model ?? "",
          system,
          messages,
          tools: tools.length > 0 ? tools : undefined,
          toolChoice: tools.length > 0 ? "auto" : undefined,
          maxTokens: 700,
          temperature: 0.3,
          effort: input.settings.effort,
          extendedThinking: input.settings.extendedThinking,
          timeoutMs: 45_000,
        },
        { stage: repaired ? "repair" : "specialist", fetchImpl: input.fetchImpl, sleep: input.sleep },
      );
    } catch (error) {
      if (error instanceof AiProviderError) result.attempts.push(...(((error as unknown as { attempts?: ProviderAttempt[] }).attempts) ?? []));
      result.outcome = "failed";
      result.reason = error instanceof AiProviderError ? `provider:${error.kind}` : "specialist_failed";
      return result;
    }
    result.attempts.push(...response.attempts);
    addUsage(result, response.response.model, response.response.usage);
    const { toolCalls } = response.response;

    if (toolCalls.length > 0 && step < input.settings.maxToolCallsPerTurn) {
      messages.push({ role: "assistant", content: response.response.text, toolCalls });
      const results = [];
      for (const call of toolCalls) {
        // A repetition loop is the failure mode that costs most in an
        // unattended agent, and the model cannot see it from inside.
        const blocked = breaker.check(call.name, call.input);
        const outcome = blocked
          ? ({ status: "error", output: { error: blocked.code, detail: blocked.message }, errorCode: blocked.code } as ToolOutcome)
          : await input.executeTool(call);
        breaker.record(call.name, call.input, outcome);
        result.toolCalls.push({ name: call.name, input: call.input, status: outcome.status, output: outcome.output, errorCode: outcome.errorCode });
        if (outcome.effects) result.effects = { ...result.effects, ...outcome.effects };
        if (outcome.effects?.handedOff) handedOff = true;
        results.push({ callId: call.id, name: call.name, output: outcome.output, isError: outcome.status === "error" || outcome.status === "denied" });
      }
      messages.push({ role: "tool", results });
      if (handedOff) {
        result.stages.push("handoff_tool");
        return handoffResult(result, input, "tool:abrir_caso_humano", "normal", inbound, response.response.text || undefined);
      }
      if (result.effects.templateQueued && !input.thread.serviceWindowOpen) {
        result.outcome = "template";
        result.template = result.effects.templateQueued;
        result.stages.push("template");
        return result;
      }
      continue;
    }

    text = response.response.text;
    if (response.response.finishReason === "length") text = clampReply(text);
    text = applyDisclosure(text, {
      firstOutbound: input.thread.firstOutbound,
      clinicName: input.clinic.clinicName,
      locale: input.settings.replyLanguage === "en" ? "en" : "pt",
    });
    const violations = runGuards({
      text,
      verified: { booked: !!result.effects.booked, confirmed: !!result.effects.confirmed },
      allowedHosts: input.clinic.allowedHosts,
      firstOutbound: input.thread.firstOutbound,
    });
    if (violations.length === 0) break;
    result.violations.push(...violations.map((v: GuardViolation) => `${v.code}:${v.detail}`));
    if (!repaired) {
      repaired = true;
      result.stages.push("repair");
      messages.push({ role: "assistant", content: text });
      messages.push({ role: "user", content: buildRepairPrompt(violations.map((v) => `${v.code}: ${v.detail}`)) });
      continue;
    }
    // Still violating after one repair: never send model text.
    result.outcome = "fallback";
    result.reason = violations.map((v) => v.code).join(",");
    result.text = input.agent.config.fallbackMessage;
    result.stages.push("fallback");
    return result;
  }

  if (!text.trim()) {
    result.outcome = "fallback";
    result.reason = "empty";
    result.text = input.agent.config.fallbackMessage;
    return result;
  }
  if (result.effects.booked) {
    text = `${text.trim()}\n\n${bookingFooter({ serviceName: result.effects.booked.serviceName, when: result.effects.booked.when, professionalName: result.effects.booked.professionalName, locale: input.settings.replyLanguage })}`;
  }
  if (!input.thread.serviceWindowOpen) {
    result.outcome = "fallback";
    result.reason = "SERVICE_WINDOW_EXPIRED";
    result.text = undefined;
    return result;
  }
  result.outcome = "reply";
  result.text = clampReply(text, 1_400);
  return result;
}

export type { ThreadIntent };
