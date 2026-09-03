/**
 * The sentence the patient reads when the AI steps out.
 *
 * Both hand-off paths (the runtime's own, and a member opening a case from the
 * inbox) silence the AI correctly and both used to do the same thing wrong:
 * say nothing to the person on the other side. From outside, a hand-off and a
 * crash look identical — someone wrote and nobody answered.
 *
 * The text lives here, alone and pure, because there are two senders and one
 * message; letting each path write its own is how two wordings drift and the
 * second one ages in silence. Adapted from DeskcommCRM's
 * `lib/escalacao/aviso-ao-lead.ts` (MIT).
 *
 * Why the text changes with the REASON: "I'm calling a colleague" is right for
 * someone who asked for a person and wrong for someone who asked to be left
 * alone. Why it changes with AVAILABILITY: promising "someone will be with you"
 * on a clinic with nobody configured is the worst possible first impression,
 * and it is the real state of every fresh install.
 */

export type NoticeReason =
  /** The patient asked for a person, in so many words. */
  | "asked_human"
  /** We suspect the patient asked to stop receiving messages. */
  | "suspected_opt_out"
  /** The daily AI budget stopped the automatic service. */
  | "ai_budget"
  /** The system escalated (clinical question, low confidence, provider down…). */
  | "other";

/**
 * Maps the open vocabulary of hand-off reasons to the four that change the
 * sentence. `other` is not laziness: reasons are free text (a member writes one
 * when escalating), and an exhaustive map would force this file to learn every
 * new reason to avoid breaking. The default is the honest generic line — never
 * silence.
 */
export function noticeReason(reason: string | undefined | null): NoticeReason {
  const value = (reason ?? "").toLowerCase();
  if (/human_request|pediu_humano|asked_human|falar com|atendente/.test(value)) return "asked_human";
  if (/opt_out|optout|stop_word|descadastr/.test(value)) return "suspected_opt_out";
  if (/budget/.test(value)) return "ai_budget";
  return "other";
}

export type TeamAvailability = {
  /** Members who could take it right now: online and under their load ceiling. */
  available: number;
  /** Members of the tenant who can handle conversations at all. */
  total: number;
};

/**
 * Three variants per reason, picked by a hash of the conversation.
 *
 * A fixed text vetoes itself: the channel's anti-repetition protection counts
 * how many of the last messages from this number are near-identical to the
 * candidate. In a clinic with movement, the third patient to ask for a person
 * would get exactly the silence this file exists to end. Same conversation
 * always gets the same wording (the patient never sees the sentence change
 * between attempts); different conversations get different ones. No state, no
 * clock.
 */
const OPENINGS_PT: Record<NoticeReason, readonly string[]> = {
  suspected_opt_out: [
    "Entendido. Vou parar de lhe enviar mensagens automáticas por aqui.",
    "Certo, fica registado: não envio mais nada automático para este número.",
    "Está bem. Encerro agora os envios automáticos deste canal.",
  ],
  asked_human: [
    "Claro! Já estou a chamar alguém da equipa para falar consigo.",
    "Sem problema. Acabei de accionar uma pessoa da equipa para continuar daqui.",
    "Perfeito. Passei a sua conversa para uma pessoa da clínica.",
  ],
  ai_budget: [
    "Vou passar o seu atendimento para uma pessoa da equipa.",
    "A partir daqui continua com uma pessoa da clínica.",
    "Deixo a sua conversa com a equipa da clínica.",
  ],
  other: [
    "Para responder bem a isto, vou passar a sua conversa a uma pessoa da equipa.",
    "Este caso é melhor tratado por uma pessoa da clínica, e é para lá que o encaminho.",
    "Prefiro não arriscar uma resposta errada: passo a sua conversa à equipa.",
  ],
};

const OPENINGS_EN: Record<NoticeReason, readonly string[]> = {
  suspected_opt_out: [
    "Understood. I'll stop sending you automatic messages here.",
    "Noted: no more automatic messages to this number.",
    "All right. I'm ending the automatic messages on this channel now.",
  ],
  asked_human: [
    "Of course. I'm calling someone from the team to talk to you.",
    "No problem. I've just brought in a colleague to carry on from here.",
    "Done. I've passed your conversation to someone at the clinic.",
  ],
  ai_budget: [
    "I'll pass your conversation to someone from the team.",
    "From here on you'll be with someone from the clinic.",
    "I'm leaving your conversation with the clinic team.",
  ],
  other: [
    "To answer this properly, I'll pass your conversation to someone from the team.",
    "This is better handled by someone at the clinic, so that's where I'm sending it.",
    "I'd rather not risk a wrong answer, so I'm passing your conversation to the team.",
  ],
};

/** What we can honestly promise about when a person will show up. */
function expectationSentence(
  reason: NoticeReason,
  availability: TeamAvailability,
  locale: "pt" | "en",
): string {
  // Someone asking to be left alone does not want to hear about waiting times.
  if (reason === "suspected_opt_out") {
    return locale === "pt"
      ? "Uma pessoa da equipa vai confirmar isto."
      : "Someone from the team will confirm this.";
  }
  if (availability.total === 0 || availability.available === 0) {
    return locale === "pt"
      ? "O seu pedido ficou registado e a equipa responde assim que possível."
      : "Your request is logged and the team will reply as soon as possible.";
  }
  return locale === "pt" ? "Vai ser atendido a seguir." : "You'll be helped shortly.";
}

/** Stable, cheap variant pick — same conversation, same sentence. */
function variantIndex(key: string, size: number): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) % 2_147_483_647;
  return hash % size;
}

export function handoffNoticeText(args: {
  reason: string | undefined | null;
  availability: TeamAvailability;
  /** Anything stable per conversation — the thread key or id. */
  conversationKey: string;
  locale: "pt" | "en";
}): string {
  const reason = noticeReason(args.reason);
  const openings = args.locale === "pt" ? OPENINGS_PT[reason] : OPENINGS_EN[reason];
  const opening = openings[variantIndex(args.conversationKey, openings.length)];
  return `${opening} ${expectationSentence(reason, args.availability, args.locale)}`;
}

/**
 * The line that goes to the MODEL, not to the patient.
 *
 * A capability the model has to remember to call is a capability that does not
 * exist half the time, so the escalation path reads availability itself and
 * tells the specialist what it may promise. Same source as the patient notice;
 * different audience.
 */
export function expectationInstruction(availability: TeamAvailability, locale: "pt" | "en"): string {
  if (availability.total === 0) {
    return locale === "pt"
      ? "ATENÇÃO: esta clínica ainda não tem ninguém configurado para receber atendimento. NÃO prometas que alguém entra em contacto — diz que o pedido ficou registado."
      : "WARNING: this clinic has nobody configured to take over. Do NOT promise that someone will get in touch — say the request has been logged.";
  }
  if (availability.available === 0) {
    return locale === "pt"
      ? "ATENÇÃO: não há ninguém da equipa disponível neste momento. NÃO prometas contacto imediato nem dês prazo curto — diz que o pedido ficou registado."
      : "WARNING: nobody from the team is available right now. Do NOT promise immediate contact or a short deadline — say the request has been logged.";
  }
  const people = availability.available === 1 ? "1" : String(availability.available);
  return locale === "pt"
    ? `Há ${people} pessoa(s) da equipa a poder assumir agora — podes dizer ao paciente que alguém continua o atendimento a seguir.`
    : `There are ${people} team member(s) able to take over now — you may tell the patient someone will carry on shortly.`;
}
