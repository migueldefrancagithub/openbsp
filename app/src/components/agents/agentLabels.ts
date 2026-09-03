import type { Locale } from "@/lib/i18n";

export const OBJECTIVES = ["reception", "sales", "confirmation", "support", "audit"] as const;
export type Objective = (typeof OBJECTIVES)[number];

export function objectiveLabel(objective: string, locale: Locale): string {
  const pt: Record<string, string> = { reception: "Recepção", sales: "Vendas", confirmation: "Confirmação", support: "Apoio", audit: "Auditoria (só lê)" };
  const en: Record<string, string> = { reception: "Reception", sales: "Sales", confirmation: "Confirmation", support: "Support", audit: "Audit (read-only)" };
  return (locale === "pt" ? pt : en)[objective] ?? objective;
}

export function toneLabel(tone: string, locale: Locale): string {
  const pt: Record<string, string> = { formal: "Formal", friendly: "Próximo", direct: "Directo" };
  const en: Record<string, string> = { formal: "Formal", friendly: "Friendly", direct: "Direct" };
  return (locale === "pt" ? pt : en)[tone] ?? tone;
}

export function toolLabel(tool: string, locale: Locale): string {
  const pt: Record<string, string> = {
    consultar_agenda: "Consultar horários livres",
    reservar_slot: "Reservar consulta",
    confirmar_consulta: "Confirmar presença",
    atualizar_lead: "Atualizar etapa do lead",
    criar_lembrete_equipa: "Criar lembrete para a equipa",
    agendar_follow_up: "Agendar follow-up",
    enviar_template: "Enviar template aprovado",
    aplicar_tag: "Aplicar etiqueta",
    abrir_caso_humano: "Passar à equipa",
  };
  const en: Record<string, string> = {
    consultar_agenda: "Check free slots",
    reservar_slot: "Book appointment",
    confirmar_consulta: "Confirm attendance",
    atualizar_lead: "Update lead stage",
    criar_lembrete_equipa: "Create team reminder",
    agendar_follow_up: "Schedule follow-up",
    enviar_template: "Send approved template",
    aplicar_tag: "Apply tag",
    abrir_caso_humano: "Hand off to the team",
  };
  return (locale === "pt" ? pt : en)[tool] ?? tool;
}

export function issueLabel(code: string, detail: string | undefined, locale: Locale): string {
  const pt: Record<string, string> = {
    CHANNEL_REQUIRED: "Escolha o canal WhatsApp do agente.",
    CHANNEL_NOT_SUPPORTED: "O canal escolhido não é o canal Hub da clínica.",
    CHANNEL_NOT_READY: "O canal não está pronto para enviar (verificado + allowlist).",
    KNOWLEDGE_REQUIRED: "Selecione pelo menos um item de conhecimento ativo.",
    KNOWLEDGE_STALE: `${detail ?? ""} item(ns) de conhecimento com mais de 90 dias.`,
    TOOL_REQUIRED: `Ferramenta obrigatória para este objetivo: ${detail ?? ""}.`,
    TOOL_FORBIDDEN: `Ferramenta não permitida para este objetivo: ${detail ?? ""}.`,
    TOOL_UNKNOWN: "Há ferramentas desconhecidas na configuração.",
    FALLBACK_REQUIRED: "Escreva a mensagem de recurso (mín. 10 caracteres).",
    HANDOFF_MESSAGE_REQUIRED: "Escreva a mensagem de passagem à equipa (mín. 10 caracteres).",
    HANDOFF_CLINICAL_REQUIRED: "Perguntas clínicas têm de passar à equipa.",
    INSTRUCTIONS_TOO_SHORT: "As instruções são muito curtas.",
    INSTRUCTIONS_HEALTHCARE: `As instruções contêm linguagem clínica (“${detail ?? ""}”).`,
    PROVIDER_NOT_CONFIGURED: "Configure uma chave de IA em Definições › IA.",
    PROVIDER_NOT_TESTED: "Teste a ligação ao provedor em Definições › IA.",
    BUDGET_REQUIRED: "Defina um orçamento diário maior que zero.",
    AGENT_CONFLICT: `Já existe um agente ativo com este objetivo neste canal (${detail ?? ""}).`,
    SANDBOX_NOT_RUN: "Ainda não experimentou o agente no sandbox.",
    DPIA_PROVIDER: "Lembrete: o provedor de IA é subcontratante de dados; registe-o na DPIA.",
  };
  const en: Record<string, string> = {
    CHANNEL_REQUIRED: "Pick the agent's WhatsApp channel.",
    CHANNEL_NOT_SUPPORTED: "The chosen channel is not the clinic's Hub channel.",
    CHANNEL_NOT_READY: "The channel is not ready to send (verified + allowlist).",
    KNOWLEDGE_REQUIRED: "Select at least one active knowledge item.",
    KNOWLEDGE_STALE: `${detail ?? ""} knowledge item(s) older than 90 days.`,
    TOOL_REQUIRED: `Required tool for this objective: ${detail ?? ""}.`,
    TOOL_FORBIDDEN: `Tool not allowed for this objective: ${detail ?? ""}.`,
    TOOL_UNKNOWN: "Unknown tools in the configuration.",
    FALLBACK_REQUIRED: "Write the fallback message (min 10 characters).",
    HANDOFF_MESSAGE_REQUIRED: "Write the handoff message (min 10 characters).",
    HANDOFF_CLINICAL_REQUIRED: "Clinical questions must hand off to the team.",
    INSTRUCTIONS_TOO_SHORT: "Instructions are very short.",
    INSTRUCTIONS_HEALTHCARE: `Instructions contain clinical language (“${detail ?? ""}”).`,
    PROVIDER_NOT_CONFIGURED: "Configure an AI key in Settings › AI.",
    PROVIDER_NOT_TESTED: "Test the provider connection in Settings › AI.",
    BUDGET_REQUIRED: "Set a daily budget above zero.",
    AGENT_CONFLICT: `Another active agent has this objective on this channel (${detail ?? ""}).`,
    SANDBOX_NOT_RUN: "You have not tried the agent in the sandbox yet.",
    DPIA_PROVIDER: "Reminder: the AI provider is a data processor; record it in the DPIA.",
  };
  return (locale === "pt" ? pt : en)[code] ?? code;
}
