import { v } from "convex/values";

/**
 * What the patient asked for in their last message. Orthogonal to
 * `leadStatus` (where they are in the funnel): a booked patient can still
 * have intent `reschedule` or `complaint`. Keys are stable identifiers (URLs,
 * tests, the AI router); labels live in the i18n dictionary (`intent.*`).
 */
export const THREAD_INTENTS = [
  "greeting",
  "info_request",
  "price_request",
  "booking_request",
  "reschedule",
  "cancel",
  "confirm_attendance",
  "complaint",
  "support",
  "human_request",
  "opt_out",
  "clinical_question",
  "out_of_scope",
  "other",
] as const;

export type ThreadIntent = (typeof THREAD_INTENTS)[number];

export const threadIntentValidator = v.union(
  ...(THREAD_INTENTS.map((intent) => v.literal(intent)) as [
    ReturnType<typeof v.literal<ThreadIntent>>,
    ...ReturnType<typeof v.literal<ThreadIntent>>[],
  ]),
);

export const intentSourceValidator = v.union(
  v.literal("inferred"),
  v.literal("manual"),
);

export type ChannelLeadStatus =
  | "new"
  | "interested"
  | "asked_price"
  | "wants_booking"
  | "awaiting_human"
  | "booked"
  | "confirmed"
  | "attended"
  | "no_show"
  | "lost";

export type InboundClassification = {
  leadStatus?: ChannelLeadStatus;
  intent?: ThreadIntent;
};

export function normalizeIntentText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");
}

const OPT_OUT = /\b(nao quero mais (mensagens|receber)|nao quero|sem interesse|parar|sair|stop|remover|remove-me)\b/;
const CONFIRM = /\b(confirmo|confirmado|confirmada|esta confirmado|vou comparecer|estarei la|ok confirmado|confirmar presenca)\b/;
const RESCHEDULE = /\b(remarcar|reagendar|mudar (a |o )?(data|hora|horario)|adiar (a )?consulta|outra data|outro dia|outro horario)\b/;
const CANCEL = /\b(cancelar|desmarcar|anular)( a| o)?( minha| a)? ?(consulta|marcacao|agendamento|sessao)?\b/;
const BOOKING = /\b(marcar|agendar|marcacao|agendamento|consulta|slot|horario|horario disponivel|disponibilidade|vaga)\b/;
const PRICE = /\b(preco|precos|valor|valores|quanto custa|custa quanto|custo|plano|tabela)\b/;
const HUMAN = /\b(humano|atendente|pessoa|equipa|equipe|falar com alguem|assistente|responsavel|rececao|recepcao)\b/;
const CLINICAL = /\b(sintoma|sintomas|dor|dores|doi|febre|receita|medicament\w*|remedio|diagnostic\w*|exame|exames|resultado|resultados|tratamento|dose|dosagem|alergia|gravid\w*|infec\w*)\b/;
const COMPLAINT = /\b(reclama\w*|queixa|pessimo|pessima|horrivel|mal atendid\w*|insatisfeit\w*|nao gostei|demora\w* muito|ninguem responde)\b/;
const SUPPORT = /\b(problema|nao consigo|erro|ajuda com|suporte|nao funciona|nao recebi)\b/;
const GREETING = /^(ola|oi|bom dia|boa tarde|boa noite|hello|hi|hey|boas)\b[!.,\s]*$/;
const INFO = /(\?|\b(informac\w*|saber|gostaria de saber|como funciona|onde fica|onde e|horario de funcionamento|endereco|morada|localizacao|abrem|fecham|aceitam)\b)/;

/**
 * Deterministic, zero-cost classification of an inbound message. Used by the
 * projection (lead stage + intent) and, later, as the first pass before the
 * AI router. Order matters: explicit opt-outs and confirmations win, then
 * concrete requests, then softer signals.
 */
export function classifyInbound(rawText: string): InboundClassification {
  const text = normalizeIntentText(rawText);
  if (!text) return { leadStatus: "interested" };
  if (OPT_OUT.test(text)) return { leadStatus: "lost", intent: "opt_out" };
  if (CONFIRM.test(text)) return { leadStatus: "confirmed", intent: "confirm_attendance" };
  if (RESCHEDULE.test(text)) return { leadStatus: "wants_booking", intent: "reschedule" };
  if (CANCEL.test(text)) return { intent: "cancel" };
  // "Quanto custa a consulta?" is a price question, not a booking request.
  if (PRICE.test(text)) return { leadStatus: "asked_price", intent: "price_request" };
  if (BOOKING.test(text)) return { leadStatus: "wants_booking", intent: "booking_request" };
  if (HUMAN.test(text)) return { leadStatus: "awaiting_human", intent: "human_request" };
  if (COMPLAINT.test(text)) return { leadStatus: "interested", intent: "complaint" };
  if (CLINICAL.test(text)) return { leadStatus: "interested", intent: "clinical_question" };
  if (SUPPORT.test(text)) return { leadStatus: "interested", intent: "support" };
  if (GREETING.test(text)) return { leadStatus: "interested", intent: "greeting" };
  if (INFO.test(text)) return { leadStatus: "interested", intent: "info_request" };
  return { leadStatus: "interested", intent: "other" };
}
