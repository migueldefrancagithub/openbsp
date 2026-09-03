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

/**
 * How much damage a capability can do, in the clinic's words. It drives the
 * ceremony on screen: "só consulta" needs none, "não dá para desfazer" is
 * enabled one at a time.
 */
export const TOOL_RISK_COPY: Record<string, { pt: [string, string]; en: [string, string] }> = {
  safe: {
    pt: ["Só consulta", "O agente apenas lê. Nada muda no sistema."],
    en: ["Read only", "The agent only reads. Nothing changes in the system."],
  },
  attention: {
    pt: ["Altera dados", "O agente muda algo no sistema. Você vê o que mudou e pode desfazer."],
    en: ["Changes data", "The agent changes something. You can see it and undo it."],
  },
  critical: {
    pt: ["Efeito que não dá para desfazer", "Sai do sistema ou não volta atrás — como falar mesmo com o paciente. Ligue uma a uma."],
    en: ["Effect that cannot be undone", "It leaves the system or does not come back — like really talking to the patient. Enable one at a time."],
  },
};

export const BUNDLE_COPY: Record<string, { pt: [string, string]; en: [string, string] }> = {
  atender: {
    pt: ["Atender e responder", "Lê a conversa, consulta horários e organiza a ficha, sem marcar nada."],
    en: ["Answer and organise", "Reads the conversation, checks slots and tidies the record, without booking."],
  },
  marcar: {
    pt: ["Marcar consultas", "Consulta a agenda real, reserva e confirma presença."],
    en: ["Book appointments", "Checks the real agenda, books and confirms attendance."],
  },
  vender: {
    pt: ["Acompanhar o funil", "Move a etapa do lead e propõe à equipa o próximo passo e os dados que ouviu."],
    en: ["Follow the funnel", "Moves the lead stage and proposes next steps and details it heard."],
  },
  reter: {
    pt: ["Não perder o paciente", "Agenda retornos e usa templates aprovados fora da janela de 24h."],
    en: ["Do not lose the patient", "Schedules returns and uses approved templates outside the 24h window."],
  },
  escalar: {
    pt: ["Passar à equipa", "Reconhece quando não é caso dele e entrega o resumo a uma pessoa."],
    en: ["Hand to the team", "Recognises when it is not its call and hands a summary to a person."],
  },
};

export function riskCopy(risk: string, locale: Locale): [string, string] {
  const entry = TOOL_RISK_COPY[risk] ?? TOOL_RISK_COPY.attention;
  return locale === "en" ? entry.en : entry.pt;
}

export function bundleCopy(bundle: string, locale: Locale): [string, string] {
  const entry = BUNDLE_COPY[bundle] ?? ["", ""] as unknown as { pt: [string, string]; en: [string, string] };
  const value = (entry as { pt: [string, string]; en: [string, string] })[locale === "en" ? "en" : "pt"];
  return value ?? [bundle, ""];
}
