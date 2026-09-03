"use client";

import type { Id } from "../../../convex/_generated/dataModel";
import { useI18n } from "@/lib/i18n";

/** Replaced in C5 by the runs/turns telemetry panel. */
export function AgentRunsPanel({ agentId }: { agentId: Id<"aiAgents"> }) {
  const { tr } = useI18n();
  void agentId;
  return <p className="text-[12px] text-slate-500">{tr("Execuções disponíveis quando o agente estiver ativo.", "Runs appear once the agent is active.")}</p>;
}
