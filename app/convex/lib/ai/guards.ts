/**
 * Output guards. The model never talks to a patient unchecked: clinical
 * advice is blocked, invented bookings are caught, links are restricted,
 * and confirmed bookings get a deterministic footer the model cannot alter.
 */
export const MAX_REPLY_CHARS = 1_200;

const HEALTHCARE_DENYLIST: RegExp[] = [
  /\b(diagn[oó]stic[oa]|diagnostic[oa]r)\b/i,
  /\b(dosagem|dose de|mg\s+de|miligramas?|tomar\s+\d+)\b/i,
  /\b(receit[ao]|prescri[çc][aã]o|prescrever|prescrevo)\b/i,
  /\b(antibi[oó]tico|ibuprofeno|paracetamol|amoxicilina|corticoide|insulina)\b/i,
  /\b(tratamento recomendado|recomendo que tome|deve tomar|pode tomar)\b/i,
  /\b(sintomas? (indicam|sugerem)|tem (uma )?infe[çc][aã]o|é (uma )?infe[çc][aã]o)\b/i,
  /\b(resultado do exame|interpretar (o )?exame|análises? (indicam|mostram))\b/i,
];

export type GuardViolation =
  | { code: "HEALTHCARE_ADVICE"; detail: string }
  | { code: "DISCLOSURE_REQUIRED"; detail: string }
  | { code: "INTERNAL_VOCABULARY"; detail: string }
  | { code: "UNVERIFIED_BOOKING"; detail: string }
  | { code: "TOO_LONG"; detail: string }
  | { code: "UNTRUSTED_LINK"; detail: string }
  | { code: "EMPTY"; detail: string };

export function findHealthcareAdvice(text: string): string | null {
  for (const pattern of HEALTHCARE_DENYLIST) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return null;
}

const BOOKING_CLAIMS: RegExp[] = [
  /\b(fica|ficou|está|esta)\s+(marcad[ao]|agendad[ao]|reservad[ao]|confirmad[ao])\b/i,
  /\b(marquei|agendei|reservei|confirmei)\b/i,
  /\b(a sua consulta|sua marca[çc][aã]o)\s+(é|foi|está|esta)\b/i,
  /\b(booked|scheduled|reserved|confirmed)\s+(for|on|at)\b/i,
];

/** A booking claim is only allowed when a tool actually created/confirmed one this turn. */
export function findUnverifiedBookingClaim(text: string, verified: { booked: boolean; confirmed: boolean }): string | null {
  if (verified.booked || verified.confirmed) return null;
  for (const pattern of BOOKING_CLAIMS) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return null;
}

const URL_PATTERN = /https?:\/\/[^\s)]+/gi;

export function findUntrustedLink(text: string, allowedHosts: string[]): string | null {
  for (const match of text.matchAll(URL_PATTERN)) {
    try {
      const host = new URL(match[0]).host.toLowerCase();
      if (!allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) return match[0];
    } catch {
      return match[0];
    }
  }
  return null;
}

/**
 * Words that belong to the inside of the system and never to a patient.
 *
 * Measured in the reference product at 30% leak when the same model is asked to
 * both talk and operate: it says "vou atualizar o teu lead_status" because the
 * tool vocabulary is in its context. The guard is the only version of this rule
 * that does not depend on the model behaving.
 */
const INTERNAL_VOCABULARY: RegExp[] = [
  /\b(lead[_ ]?status|thread|outbox|tenant|payload|webhook|endpoint)\b/i,
  /\b(reservar_slot|consultar_agenda|abrir_caso_humano|atualizar_lead|aplicar_tag|agendar_follow_up|enviar_template|criar_lembrete_equipa|confirmar_consulta)\b/i,
  /\b(handoff|hand-?off|caso humano|human case)\b/i,
  /\b(prompt|system prompt|modelo de linguagem|LLM|token[s]? de contexto)\b/i,
  /\b(businessKey|business key|idempot[êe]ncia|convex)\b/i,
];

export function findInternalVocabulary(text: string): string | null {
  for (const pattern of INTERNAL_VOCABULARY) {
    const match = pattern.exec(text);
    if (match) return match[0];
  }
  return null;
}

/**
 * Does this reply introduce itself as an assistant?
 *
 * Only asked of the FIRST message the clinic ever sends to someone. Saying it
 * every time would be noise; never saying it lets a patient believe they are
 * talking to a person, which is the one thing an assistant must not allow.
 */
export function missesDisclosure(text: string): boolean {
  return !/\b(assistente|assistant|virtual|autom[áa]tic[oa]|automated)\b/i.test(text);
}

export type GuardInput = {
  text: string;
  verified: { booked: boolean; confirmed: boolean };
  allowedHosts: string[];
  maxChars?: number;
  /** No accepted outbound to this patient yet: the reply must identify itself. */
  firstOutbound?: boolean;
  /**
   * What to do when that first reply does not introduce itself. Default is to
   * inject the sentence (see `applyDisclosure`) — blocking a reply over a
   * missing greeting would cost the patient an answer for a fixable defect.
   */
  disclosureMode?: "inject" | "veto";
};

/**
 * Prepends the assistant disclosure when the clinic's first reply to someone
 * lacks it. Deterministic, so it does not depend on the model complying.
 */
export function applyDisclosure(
  text: string,
  args: { firstOutbound?: boolean; clinicName: string; locale: "pt" | "en" },
): string {
  const trimmed = text.trim();
  if (!trimmed || !args.firstOutbound || !missesDisclosure(trimmed)) return trimmed;
  const intro =
    args.locale === "en"
      ? `I'm the virtual assistant at ${args.clinicName}.`
      : `Sou o assistente virtual da ${args.clinicName}.`;
  return `${intro} ${trimmed}`;
}

export function runGuards(input: GuardInput): GuardViolation[] {
  const violations: GuardViolation[] = [];
  const text = input.text.trim();
  if (!text) violations.push({ code: "EMPTY", detail: "empty reply" });
  const advice = findHealthcareAdvice(text);
  if (advice) violations.push({ code: "HEALTHCARE_ADVICE", detail: advice });
  const claim = findUnverifiedBookingClaim(text, input.verified);
  if (claim) violations.push({ code: "UNVERIFIED_BOOKING", detail: claim });
  if (text.length > (input.maxChars ?? MAX_REPLY_CHARS)) violations.push({ code: "TOO_LONG", detail: `${text.length} chars` });
  const link = findUntrustedLink(text, input.allowedHosts);
  if (link) violations.push({ code: "UNTRUSTED_LINK", detail: link });
  const internal = findInternalVocabulary(text);
  if (internal) violations.push({ code: "INTERNAL_VOCABULARY", detail: internal });
  if (input.disclosureMode === "veto" && input.firstOutbound && text && missesDisclosure(text)) {
    violations.push({ code: "DISCLOSURE_REQUIRED", detail: "first reply without assistant disclosure" });
  }
  return violations;
}

/** Deterministic footer for a booking the tools really made. */
export function bookingFooter(args: { serviceName: string; when: string; professionalName?: string; locale: "pt" | "en" }): string {
  if (args.locale === "en") {
    return `📅 Booked: ${args.serviceName}${args.professionalName ? ` with ${args.professionalName}` : ""} · ${args.when}. Reply CONFIRMO to confirm or REMARCAR to change.`;
  }
  return `📅 Marcado: ${args.serviceName}${args.professionalName ? ` com ${args.professionalName}` : ""} · ${args.when}. Responda CONFIRMO para confirmar ou REMARCAR para alterar.`;
}

/** Trim to the limit at a sentence boundary when possible. */
export function clampReply(text: string, maxChars = MAX_REPLY_CHARS): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const cut = trimmed.slice(0, maxChars);
  const boundary = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "), cut.lastIndexOf("\n"));
  return (boundary > maxChars * 0.5 ? cut.slice(0, boundary + 1) : cut).trim();
}
