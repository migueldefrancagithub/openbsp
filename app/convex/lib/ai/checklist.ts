import type { Doc } from "../../_generated/dataModel";
import { findHealthcareAdvice } from "./guards";
import { FORBIDDEN_TOOLS_BY_OBJECTIVE, REQUIRED_TOOLS_BY_OBJECTIVE, isAiToolName, type AiObjective } from "./toolRegistry";

export type ChecklistIssue = {
  code: string;
  severity: "blocker" | "warning";
  detail?: string;
};

export type ChecklistInput = {
  agent: Pick<Doc<"aiAgents">, "objective" | "config" | "channelId" | "name">;
  channel: Doc<"channels"> | null;
  knowledge: Array<Pick<Doc<"clinicKnowledgeItems">, "_id" | "status" | "updatedAt">>;
  providerReady: boolean;
  providerConfigured: boolean;
  dailyBudgetUsdCents: number;
  conflictingAgentName?: string;
  lastSandboxAt?: number;
  now: number;
};

const KNOWLEDGE_STALE_MS = 90 * 24 * 60 * 60_000;

/**
 * Publish gate. Blockers stop `publish`; warnings are shown but do not.
 * Pure so the UI can preview it and tests can pin every rule.
 */
export function runChecklist(input: ChecklistInput): ChecklistIssue[] {
  const issues: ChecklistIssue[] = [];
  const { agent, channel } = input;
  const config = agent.config;

  if (!channel) issues.push({ code: "CHANNEL_REQUIRED", severity: "blocker" });
  else if (channel.provider !== "iasolution_hub" || channel.operationalTerritory !== "openbsp") {
    issues.push({ code: "CHANNEL_NOT_SUPPORTED", severity: "blocker" });
  } else if (channel.status !== "active" || channel.webhookStatus !== "verified" || channel.sendMode === "disabled") {
    issues.push({ code: "CHANNEL_NOT_READY", severity: "blocker", detail: `${channel.status}/${channel.webhookStatus}/${channel.sendMode}` });
  }

  const activeKnowledge = input.knowledge.filter((item) => item.status === "active");
  const selected = config.knowledgeItemIds.filter((id) => activeKnowledge.some((item) => item._id === id));
  if (agent.objective !== "audit" && selected.length === 0) issues.push({ code: "KNOWLEDGE_REQUIRED", severity: "blocker" });
  const stale = input.knowledge.filter((item) => selected.includes(item._id) && input.now - item.updatedAt > KNOWLEDGE_STALE_MS);
  if (stale.length > 0) issues.push({ code: "KNOWLEDGE_STALE", severity: "warning", detail: `${stale.length}` });

  const objective = agent.objective as AiObjective;
  const tools = config.tools.filter(isAiToolName);
  for (const required of REQUIRED_TOOLS_BY_OBJECTIVE[objective]) {
    if (!tools.includes(required)) issues.push({ code: "TOOL_REQUIRED", severity: "blocker", detail: required });
  }
  for (const forbidden of FORBIDDEN_TOOLS_BY_OBJECTIVE[objective]) {
    if (tools.includes(forbidden)) issues.push({ code: "TOOL_FORBIDDEN", severity: "blocker", detail: forbidden });
  }
  if (config.tools.some((tool) => !isAiToolName(tool))) issues.push({ code: "TOOL_UNKNOWN", severity: "blocker" });

  if (config.fallbackMessage.trim().length < 10) issues.push({ code: "FALLBACK_REQUIRED", severity: "blocker" });
  if (config.handoff.message.trim().length < 10) issues.push({ code: "HANDOFF_MESSAGE_REQUIRED", severity: "blocker" });
  if (objective !== "audit" && !config.handoff.onClinicalQuestion) issues.push({ code: "HANDOFF_CLINICAL_REQUIRED", severity: "blocker" });
  if (config.instructions.trim().length < 20) issues.push({ code: "INSTRUCTIONS_TOO_SHORT", severity: "warning" });
  const advice = findHealthcareAdvice(config.instructions);
  if (advice) issues.push({ code: "INSTRUCTIONS_HEALTHCARE", severity: "warning", detail: advice });

  if (!input.providerConfigured) issues.push({ code: "PROVIDER_NOT_CONFIGURED", severity: "blocker" });
  else if (!input.providerReady) issues.push({ code: "PROVIDER_NOT_TESTED", severity: "blocker" });
  if (input.dailyBudgetUsdCents <= 0) issues.push({ code: "BUDGET_REQUIRED", severity: "blocker" });
  if (input.conflictingAgentName) issues.push({ code: "AGENT_CONFLICT", severity: "blocker", detail: input.conflictingAgentName });
  if (!input.lastSandboxAt) issues.push({ code: "SANDBOX_NOT_RUN", severity: "warning" });
  issues.push({ code: "DPIA_PROVIDER", severity: "warning" });
  return issues;
}

export function hasBlockers(issues: ChecklistIssue[]): boolean {
  return issues.some((issue) => issue.severity === "blocker");
}

export const DEFAULT_CONFIG_BY_OBJECTIVE: Record<AiObjective, { instructions: string; tools: string[]; fallbackMessage: string; handoffMessage: string; greeting: string }> = {
  reception: {
    instructions: "Acolhe o paciente, explica os serviços e horários da clínica e ajuda a marcar consulta com as ferramentas de agenda. Confirma sempre o serviço e a hora antes de reservar.",
    tools: ["consultar_agenda", "reservar_slot", "atualizar_lead", "abrir_caso_humano", "aplicar_tag"],
    fallbackMessage: "Vou confirmar essa informação com a equipa e respondo em breve.",
    handoffMessage: "Vou passar a sua mensagem à nossa equipa, que responde em breve.",
    greeting: "Olá! Sou o assistente da clínica. Em que posso ajudar?",
  },
  sales: {
    instructions: "Qualifica o interesse do paciente, explica o valor dos tratamentos com os preços conhecidos e conduz à marcação de uma consulta de avaliação.",
    tools: ["atualizar_lead", "consultar_agenda", "reservar_slot", "agendar_follow_up", "abrir_caso_humano", "aplicar_tag"],
    fallbackMessage: "Deixe-me confirmar esse detalhe com a equipa; respondo já a seguir.",
    handoffMessage: "Vou pedir a um colega da clínica para continuar esta conversa consigo.",
    greeting: "Olá! Posso ajudar a escolher o tratamento certo e marcar a sua avaliação.",
  },
  confirmation: {
    instructions: "Confirma a presença do paciente nas consultas marcadas e trata remarcações com as ferramentas de agenda. Sê breve e claro.",
    tools: ["confirmar_consulta", "consultar_agenda", "reservar_slot", "abrir_caso_humano"],
    fallbackMessage: "A equipa vai confirmar e responde em breve.",
    handoffMessage: "Vou passar à equipa para ajustar a sua marcação.",
    greeting: "Olá! Estou aqui para confirmar a sua consulta.",
  },
  support: {
    instructions: "Responde a dúvidas práticas (morada, horários, documentos, preparação para consultas) com base no conhecimento da clínica e encaminha o resto para a equipa.",
    tools: ["abrir_caso_humano", "criar_lembrete_equipa", "aplicar_tag"],
    fallbackMessage: "Não tenho essa informação; vou pedir à equipa que responda.",
    handoffMessage: "A nossa equipa vai continuar esta conversa consigo.",
    greeting: "Olá! Em que posso ajudar hoje?",
  },
  audit: {
    instructions: "Lê a conversa e resume para a equipa. Não respondes ao paciente nem executas acções.",
    tools: [],
    fallbackMessage: "Sem resumo disponível.",
    handoffMessage: "Sem acção automática.",
    greeting: "",
  },
};
