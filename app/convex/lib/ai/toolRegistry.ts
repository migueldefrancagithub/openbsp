import type { AiToolSpec } from "./provider";

/**
 * Tools the specialist may call. Specs are provider-neutral JSON Schema;
 * execution (C3) validates input again server-side and is idempotent per
 * turn + tool + input hash. Names are Portuguese on purpose: they are what
 * the clinic sees in the audit trail.
 */
export const AI_TOOL_NAMES = [
  "consultar_agenda",
  "reservar_slot",
  "confirmar_consulta",
  "atualizar_lead",
  "criar_lembrete_equipa",
  "agendar_follow_up",
  "enviar_template",
  "aplicar_tag",
  "abrir_caso_humano",
] as const;

export type AiToolName = (typeof AI_TOOL_NAMES)[number];

export type AiObjective = "reception" | "sales" | "confirmation" | "support" | "audit";

export const TOOL_SPECS: Record<AiToolName, AiToolSpec> = {
  consultar_agenda: {
    name: "consultar_agenda",
    description: "Lista horários livres de um serviço num dia (formato AAAA-MM-DD). Use antes de propor horas.",
    inputSchema: {
      type: "object",
      properties: {
        serviceId: { type: "string", description: "Id do serviço (ver lista de serviços)." },
        date: { type: "string", description: "Dia local AAAA-MM-DD." },
        professionalId: { type: "string", description: "Id do profissional, opcional." },
      },
      required: ["serviceId", "date"],
      additionalProperties: false,
    },
  },
  reservar_slot: {
    name: "reservar_slot",
    description: "Reserva um horário livre para o paciente desta conversa. Só depois de o paciente escolher a hora. Devolve o id da marcação.",
    inputSchema: {
      type: "object",
      properties: {
        serviceId: { type: "string" },
        startAt: { type: "number", description: "Início em milissegundos epoch, obtido de consultar_agenda." },
        professionalId: { type: "string" },
        patientName: { type: "string" },
        notes: { type: "string" },
      },
      required: ["serviceId", "startAt"],
      additionalProperties: false,
    },
  },
  confirmar_consulta: {
    name: "confirmar_consulta",
    description: "Confirma a marcação futura desta conversa quando o paciente confirma presença.",
    inputSchema: { type: "object", properties: { appointmentId: { type: "string" } }, additionalProperties: false },
  },
  atualizar_lead: {
    name: "atualizar_lead",
    description: "Atualiza a etapa do lead (nunca para trás) e a intenção detetada.",
    inputSchema: {
      type: "object",
      properties: {
        leadStatus: { type: "string", enum: ["interested", "asked_price", "wants_booking", "awaiting_human", "booked", "confirmed", "lost"] },
        intent: { type: "string" },
        nextStep: { type: "string", description: "Próximo passo curto para a equipa." },
      },
      additionalProperties: false,
    },
  },
  criar_lembrete_equipa: {
    name: "criar_lembrete_equipa",
    description: "Cria um lembrete interno para a equipa nesta conversa.",
    inputSchema: {
      type: "object",
      properties: { note: { type: "string" }, dueInMinutes: { type: "number" } },
      required: ["note"],
      additionalProperties: false,
    },
  },
  agendar_follow_up: {
    name: "agendar_follow_up",
    description: "Agenda um follow-up automático (regra ativa) se o paciente não responder.",
    inputSchema: {
      type: "object",
      properties: { trigger: { type: "string", enum: ["no_reply", "proposal_no_response", "appointment_unconfirmed"] }, delayMinutes: { type: "number" } },
      required: ["trigger"],
      additionalProperties: false,
    },
  },
  enviar_template: {
    name: "enviar_template",
    description: "Envia um template aprovado quando a janela de 24h está fechada. Só nomes de templates listados.",
    inputSchema: {
      type: "object",
      properties: { templateName: { type: "string" }, languageCode: { type: "string" }, bodyVariables: { type: "array", items: { type: "string" } } },
      required: ["templateName", "languageCode"],
      additionalProperties: false,
    },
  },
  aplicar_tag: {
    name: "aplicar_tag",
    description: "Aplica uma etiqueta à conversa (ex.: ortodontia, urgente).",
    inputSchema: { type: "object", properties: { tag: { type: "string" } }, required: ["tag"], additionalProperties: false },
  },
  abrir_caso_humano: {
    name: "abrir_caso_humano",
    description: "Passa a conversa à equipa humana com motivo e urgência. Pára a IA nesta conversa.",
    inputSchema: {
      type: "object",
      properties: {
        reason: { type: "string" },
        urgency: { type: "string", enum: ["low", "normal", "high", "urgent"] },
        question: { type: "string" },
      },
      required: ["reason", "urgency"],
      additionalProperties: false,
    },
  },
};

/** Tools an objective must have to be publishable; the rest are optional. */
export const REQUIRED_TOOLS_BY_OBJECTIVE: Record<AiObjective, AiToolName[]> = {
  reception: ["consultar_agenda", "reservar_slot", "abrir_caso_humano"],
  sales: ["atualizar_lead", "abrir_caso_humano"],
  confirmation: ["confirmar_consulta", "abrir_caso_humano"],
  support: ["abrir_caso_humano"],
  audit: [],
};

/** Tools an objective may never use (audit agents are read-only in v1). */
export const FORBIDDEN_TOOLS_BY_OBJECTIVE: Record<AiObjective, AiToolName[]> = {
  reception: [],
  sales: [],
  confirmation: [],
  support: [],
  audit: ["reservar_slot", "confirmar_consulta", "enviar_template", "agendar_follow_up", "abrir_caso_humano", "atualizar_lead", "criar_lembrete_equipa", "aplicar_tag"],
};

export function isAiToolName(value: string): value is AiToolName {
  return (AI_TOOL_NAMES as readonly string[]).includes(value);
}

export function toolSpecsFor(names: string[]): AiToolSpec[] {
  return names.filter(isAiToolName).map((name) => TOOL_SPECS[name]);
}

/** Deskcomm-style risk labels shown to the clinic; writes are proposed in copilot. */
export type AiToolRisk = "safe" | "attention" | "critical";
export const TOOL_RISK: Record<AiToolName, AiToolRisk> = {
  consultar_agenda: "safe",
  aplicar_tag: "safe",
  criar_lembrete_equipa: "safe",
  atualizar_lead: "attention",
  agendar_follow_up: "attention",
  abrir_caso_humano: "attention",
  reservar_slot: "critical",
  confirmar_consulta: "critical",
  enviar_template: "critical",
};
export const READ_ONLY_TOOLS: AiToolName[] = ["consultar_agenda"];
export function isWriteTool(name: string): boolean {
  return isAiToolName(name) && !READ_ONLY_TOOLS.includes(name);
}
