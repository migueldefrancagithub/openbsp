import { classifyInbound, type ThreadIntent } from "../channels/intents";

/**
 * Deterministic pre-router: cheap, auditable decisions that never need a
 * model. Anything else goes to the LLM router.
 */
export type PrerouteDecision =
  | { action: "skip"; reason: "opt_out" | "empty" | "media_only" | "stop_word" }
  | { action: "handoff"; reason: "human_request" | "complaint"; intent: ThreadIntent }
  | { action: "clinical"; intent: "clinical_question" }
  | { action: "route"; hint?: ThreadIntent };

const STOP_WORDS = /^\s*(stop|parar|sair|cancelar subscri[çc][aã]o|n[aã]o quero (mais )?mensagens)\s*[.!]?\s*$/i;

export function preroute(args: { text: string; hasMedia?: boolean }): PrerouteDecision {
  const text = args.text.trim();
  if (!text) return { action: "skip", reason: args.hasMedia ? "media_only" : "empty" };
  if (STOP_WORDS.test(text)) return { action: "skip", reason: "stop_word" };
  const classified = classifyInbound(text);
  if (classified.intent === "opt_out") return { action: "skip", reason: "opt_out" };
  if (classified.intent === "human_request") return { action: "handoff", reason: "human_request", intent: "human_request" };
  if (classified.intent === "complaint") return { action: "handoff", reason: "complaint", intent: "complaint" };
  if (classified.intent === "clinical_question") return { action: "clinical", intent: "clinical_question" };
  return { action: "route", hint: classified.intent };
}
