import type { Locale } from "@/lib/i18n";

/**
 * Why a reply did not go out, in words the clinic can act on.
 *
 * The engine already recorded the code; what was missing was the sentence. A
 * conversation where the AI went quiet and nothing on screen says why is
 * indistinguishable from a broken product — the operator re-sends, or worse,
 * assumes the patient was answered.
 *
 * Three families, because the ACTION differs: protection means wait, the system
 * will send it; compliance means do not send, ever; quality means the assistant
 * is correcting itself. Adapted from DeskcommCRM's `lib/inbox/retention-copy.ts`.
 */
export type RetentionFamily = "protection" | "compliance" | "quality";

export type RetentionCopy = {
  family: RetentionFamily;
  title: string;
  description: string;
};

const TITLES: Record<RetentionFamily, [string, string]> = {
  protection: ["Envio retido pela protecção do canal", "Send held by channel protection"],
  compliance: ["Envio bloqueado por conformidade", "Send blocked for compliance"],
  quality: ["Resposta retida para correcção", "Reply held for correction"],
};

const ENTRIES: Record<string, { family: RetentionFamily; pt: string; en: string }> = {
  RECIPIENT_NOT_ALLOWLISTED: {
    family: "protection",
    pt: "Este número está fora da lista do piloto, por isso nenhuma resposta automática sai daqui. Um administrador pode adicioná-lo em Definições › Canais.",
    en: "This number is outside the pilot allowlist, so no automatic reply goes out. An administrator can add it in Settings › Channels.",
  },
  SERVICE_WINDOW_EXPIRED: {
    family: "protection",
    pt: "Passaram mais de 24 horas desde a última mensagem do paciente. Só um template aprovado pode ser enviado até ele responder.",
    en: "More than 24 hours have passed since the patient's last message. Only an approved template can be sent until they reply.",
  },
  TEMPLATE_NOT_APPROVED: {
    family: "protection",
    pt: "O template escolhido não está aprovado para este canal. Escolha um aprovado ou espere que o paciente responda.",
    en: "The chosen template is not approved for this channel. Pick an approved one or wait for the patient to reply.",
  },
  RATE_LIMITED: {
    family: "protection",
    pt: "O canal atingiu o limite de envios por minuto. A mensagem sai na próxima janela, sem duplicar.",
    en: "The channel hit its per-minute send limit. The message goes out in the next window, without duplicating.",
  },
  BUDGET_EXCEEDED: {
    family: "protection",
    pt: "O orçamento diário de IA esgotou. Os agentes voltam a responder amanhã, ou depois de aumentar o limite em Definições › IA.",
    en: "The daily AI budget is spent. Agents resume tomorrow, or after raising the limit in Settings › AI.",
  },
  DND: {
    family: "compliance",
    pt: "O paciente pediu para não receber mensagens. Nada será enviado para este contacto.",
    en: "The patient asked not to be messaged. Nothing will be sent to this contact.",
  },
  AI_OPT_OUT: {
    family: "compliance",
    pt: "O paciente pediu para parar. A automação foi desligada nesta conversa.",
    en: "The patient asked to stop. Automation is off in this conversation.",
  },
  HEALTHCARE_ADVICE: {
    family: "quality",
    pt: "A resposta continha orientação clínica. O assistente foi instruído a reescrever antes de enviar.",
    en: "The reply contained clinical advice. The assistant was told to rewrite before sending.",
  },
  UNVERIFIED_BOOKING: {
    family: "quality",
    pt: "A resposta afirmava uma marcação que a agenda não confirmou. O assistente foi instruído a corrigir.",
    en: "The reply claimed a booking the agenda never confirmed. The assistant was told to fix it.",
  },
  DISCLOSURE_REQUIRED: {
    family: "quality",
    pt: "A primeira mensagem a um paciente novo tem de se apresentar como assistente virtual. O assistente foi instruído a corrigir.",
    en: "The first message to a new patient must introduce itself as a virtual assistant. The assistant was told to fix it.",
  },
  INTERNAL_VOCABULARY: {
    family: "quality",
    pt: "A resposta usava palavras internas do sistema. O assistente foi instruído a reescrever como a recepção falaria.",
    en: "The reply used internal system words. The assistant was told to rewrite it the way reception would speak.",
  },
  TOO_LONG: {
    family: "quality",
    pt: "A resposta era demasiado longa para WhatsApp e foi retida para encurtar.",
    en: "The reply was too long for WhatsApp and was held to be shortened.",
  },
  UNTRUSTED_LINK: {
    family: "quality",
    pt: "A resposta continha um link fora dos domínios permitidos.",
    en: "The reply contained a link outside the allowed domains.",
  },
  PROVIDER_UNAVAILABLE: {
    family: "protection",
    pt: "Nenhum provedor de IA respondeu. A conversa está com a equipa até o serviço voltar.",
    en: "No AI provider answered. The conversation is with the team until the service returns.",
  },
};

export function retentionCopy(code: string | undefined | null, locale: Locale): RetentionCopy | null {
  if (!code) return null;
  const entry = ENTRIES[code.toUpperCase()];
  if (!entry) return null;
  return {
    family: entry.family,
    title: TITLES[entry.family][locale === "en" ? 1 : 0],
    description: locale === "en" ? entry.en : entry.pt,
  };
}

export function isRetentionCode(code: string | undefined | null): boolean {
  return !!code && !!ENTRIES[code.toUpperCase()];
}
