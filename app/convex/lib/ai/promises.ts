/**
 * A promise made to a patient, and whether anyone owns it.
 *
 * The system cannot know whether a promise was KEPT — scheduling a follow-up is
 * not keeping it, and sending a message later is not either. What it can
 * establish is whether anybody took responsibility: did a tool run in this
 * turn, is there a follow-up alive, was a case opened. If none of that
 * happened, the reply committed the clinic to something and nothing in the
 * system is carrying it.
 *
 * That distinction is the whole point. "Nobody kept it" is a verdict no line of
 * code can reach; "nobody is responsible" is exactly what this measures, and it
 * is the sentence that makes a clinic owner act.
 *
 * Deterministic on purpose: a model asked to declare its own promises forgets
 * precisely in the turn where it matters, and a second model call to check the
 * first is a cost per message with no ceiling.
 */

export type PromiseKind =
  /** "I'll get back to you", "we'll call you". */
  | "callback"
  /** "I'll check and tell you", "I'll confirm the price". */
  | "check_info"
  /** "I'll book you", "I'll hold that slot". */
  | "booking"
  /** "someone from the team will contact you". */
  | "team_contact";

export type DetectedPromise = { kind: PromiseKind; phrase: string };

const PATTERNS: Array<{ kind: PromiseKind; pattern: RegExp }> = [
  { kind: "callback", pattern: /\b(volto a (contactar|falar)|entro em contacto|retorno( o)? contacto|ligo-lhe|ligamos|telefonamos|damos not[íi]cias|dou not[íi]cias)\b/i },
  { kind: "callback", pattern: /\b(vou|vamos) (avisar|informar|dizer)\b/i },
  { kind: "check_info", pattern: /\b(vou|vamos) (confirmar|verificar|ver|perguntar|consultar)\b/i },
  { kind: "check_info", pattern: /\b(assim que (souber|tiver|confirmar)|logo que (souber|tiver))\b/i },
  { kind: "booking", pattern: /\b(vou|vamos) (marcar|agendar|reservar|guardar (o|esse) hor[áa]rio)\b/i },
  { kind: "booking", pattern: /\b(fica|deixo) (a marca[çc][ãa]o|o hor[áa]rio) (feita|reservad[oa]|garantid[oa])\b/i },
  { kind: "team_contact", pattern: /\b(a equipa|algu[ée]m da (equipa|cl[íi]nica)|a recep[çc][ãa]o) (vai|ir[áa]) (entrar em contacto|contact[áa]-l[oa]|falar|ligar|responder)\b/i },
  { kind: "team_contact", pattern: /\b(passo|encaminho|vou passar) (o seu caso|a sua (conversa|mensagem)|isto) (à|a|para a) equipa\b/i },
];

export function detectPromises(text: string): DetectedPromise[] {
  const found: DetectedPromise[] = [];
  for (const { kind, pattern } of PATTERNS) {
    const match = pattern.exec(text);
    // One per kind: three phrasings of "I'll check" is one commitment, and
    // counting them separately would inflate an indicator until it is ignored.
    if (match && !found.some((item) => item.kind === kind)) {
      found.push({ kind, phrase: match[0] });
    }
  }
  return found;
}

export type OwnershipFacts = {
  /** Any tool actually executed (not a dry run) in this turn. */
  toolsRan: boolean;
  /** A follow-up task is alive for this conversation. */
  followUpAlive: boolean;
  /** The turn booked or confirmed an appointment. */
  appointmentTouched: boolean;
  /** A human case is open, so a person owns the conversation. */
  humanCaseOpen: boolean;
  /** The conversation is with a member, who owns it by definition. */
  memberOwns: boolean;
};

export type OwnershipVerdict =
  | { owned: true }
  | { owned: false; why: "no_action_taken"; promises: DetectedPromise[] };

export function promiseOwnership(
  promises: DetectedPromise[],
  facts: OwnershipFacts,
): OwnershipVerdict {
  if (promises.length === 0) return { owned: true };
  // A team-contact promise is owned by a case or by a member holding the
  // conversation; the others need something scheduled or recorded.
  const covered =
    facts.humanCaseOpen ||
    facts.memberOwns ||
    facts.followUpAlive ||
    facts.appointmentTouched ||
    facts.toolsRan;
  return covered ? { owned: true } : { owned: false, why: "no_action_taken", promises };
}

const KIND_PT: Record<PromiseKind, string> = {
  callback: "voltar a contactar o paciente",
  check_info: "confirmar uma informação e responder",
  booking: "marcar ou reservar um horário",
  team_contact: "alguém da equipa entrar em contacto",
};

const KIND_EN: Record<PromiseKind, string> = {
  callback: "get back to the patient",
  check_info: "check something and reply",
  booking: "book or hold a slot",
  team_contact: "have someone from the team make contact",
};

export function promiseSummary(promises: DetectedPromise[], locale: "pt" | "en"): string {
  const map = locale === "en" ? KIND_EN : KIND_PT;
  return promises.map((promise) => map[promise.kind]).join("; ");
}

/** The alert line. It says what is owed, never that anyone failed to keep it. */
export function promiseAlertTitle(promises: DetectedPromise[], locale: "pt" | "en"): string {
  const summary = promiseSummary(promises, locale);
  return locale === "en"
    ? `The assistant committed to ${summary}, and nothing in the system is carrying it.`
    : `O assistente comprometeu-se a ${summary}, e nada no sistema está a garantir isso.`;
}
