"use client";

import type { Id } from "../../../convex/_generated/dataModel";
import { useI18n } from "@/lib/i18n";

/** Replaced in C3 by the dry-run simulator. */
export function AgentSandbox({ agentId }: { agentId: Id<"aiAgents"> }) {
  const { tr } = useI18n();
  void agentId;
  return <p className="text-[12px] text-slate-500">{tr("Sandbox disponível na próxima atualização.", "Sandbox available in the next update.")}</p>;
}
