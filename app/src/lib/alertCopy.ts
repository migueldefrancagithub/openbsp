import type { Locale } from "@/lib/i18n";

/**
 * Every alert kind, in words a clinic owner can act on.
 *
 * The rule for writing these: say what happened TO THE PATIENT or to the
 * clinic's work, never what failed inside. "A resposta ficou presa e não chegou
 * ao paciente" makes someone act; "outbox row stuck in queued" does not. The
 * technical detail stays in the alert payload, for whoever investigates.
 *
 * The map is exhaustive over the kinds we emit, and `alertLabel` still falls
 * back for a kind a newer deploy might introduce — a generic line is better
 * than an alert that announces itself with a code.
 */
const LABELS: Record<string, [string, string]> = {
  "outbox.unknown": [
    "Envios sem confirmação do canal — não são reenviados automaticamente",
    "Sends the channel never confirmed — never retried automatically",
  ],
  "outbox.stuck": [
    "Uma resposta ficou presa e não chegou ao paciente",
    "A reply got stuck and never reached the patient",
  ],
  "sla.first_response": [
    "Pacientes à espera da primeira resposta além do prazo",
    "Patients waiting past the first-response deadline",
  ],
  "sla.human_case": ["Casos humanos fora do prazo", "Human cases past their deadline"],
  "followup.failed": ["Um follow-up desistiu de tentar", "A follow-up stopped trying"],
  "followup.sent": ["Follow-ups enviados", "Follow-ups sent"],
  "ai.budget_exceeded": [
    "O orçamento de IA do dia esgotou e os agentes pararam de responder",
    "The day's AI budget is spent and agents stopped replying",
  ],
  "ai.provider_down": [
    "Nenhum provedor de IA respondeu; as conversas ficaram com a equipa",
    "No AI provider answered; conversations went to the team",
  ],
  "ai.failed": ["A IA não conseguiu responder a um paciente", "The AI could not reply to a patient"],
  "ai.handoff": ["A IA passou um atendimento para a equipa", "The AI handed a conversation to the team"],
  "ai.skipped": ["A IA não respondeu a uma mensagem", "The AI skipped a message"],
  "ai.suggestion_stale": [
    "Sugestões da IA à espera de aprovação há demasiado tempo",
    "AI suggestions waiting too long for approval",
  ],
  "ai.promise_unfulfilled": [
    "A IA prometeu algo a um paciente e ninguém ficou responsável",
    "The AI promised something to a patient and nobody took responsibility",
  ],
  "snooze.expired": [
    "Conversas adiadas cujo prazo passou sem ninguém voltar a elas",
    "Snoozed conversations whose time is up and nobody came back",
  ],
  "proposal.expired": [
    "Uma informação que a IA ouviu de um paciente venceu sem ninguém confirmar",
    "Information the AI heard from a patient expired with nobody confirming it",
  ],
  "agent.graduation_ready": [
    "Um agente está a ser aprovado sem edições e pode passar a Automático",
    "An agent is being approved without edits and could move to Autopilot",
  ],
  "campaign.auto_paused": ["Uma campanha pausou sozinha por falhas", "A campaign paused itself after failures"],
  "campaign.unknown_delivery": [
    "Uma campanha tem envios sem confirmação do canal",
    "A campaign has sends the channel never confirmed",
  ],
  "webhook.paused": [
    "Uma integração foi pausada depois de falhar demasiadas vezes",
    "An integration was paused after failing too many times",
  ],
  "retention.candidates": [
    "Há dados a passar do prazo de retenção",
    "There is data past its retention window",
  ],
};

const SEVERITY: Record<string, [string, string]> = {
  info: ["informativo", "info"],
  warn: ["atenção", "attention"],
  critical: ["crítico", "critical"],
};

export function alertLabel(kind: string, locale: Locale): string {
  const entry = LABELS[kind];
  if (!entry) return locale === "en" ? "Alert from the assistant" : "Aviso do assistente";
  return entry[locale === "en" ? 1 : 0];
}

export function severityLabel(severity: string, locale: Locale): string {
  const entry = SEVERITY[severity];
  return entry ? entry[locale === "en" ? 1 : 0] : severity;
}

export function severityTone(severity: string): string {
  if (severity === "critical") return "bg-[#fdf1ef] text-[#b3261e]";
  if (severity === "warn") return "bg-amber-50 text-amber-800";
  return "bg-[#eef3fb] text-[#2b4f8a]";
}
