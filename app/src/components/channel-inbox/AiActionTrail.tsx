"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { Bot, ChevronDown, ShieldAlert, Sparkles, Wrench } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { toolLabel } from "@/components/agents/agentLabels";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import { relativeTime } from "@/lib/relativeTime";

const INTENT_PT: Record<string, string> = {
  booking_request: "agendamento",
  price_request: "preço",
  info_request: "informação",
  reschedule: "remarcação",
  cancel: "cancelamento",
  confirm_attendance: "confirmação",
  complaint: "reclamação",
  human_request: "pedido de pessoa",
  clinical_question: "pergunta clínica",
  opt_out: "pedido de saída",
};

function statusTone(status: string): string {
  if (status === "ok") return "bg-[#edf8f6] text-[#0d6b61]";
  if (status === "dry_run") return "bg-[#eef3fb] text-[#2b4f8a]";
  if (status === "denied") return "bg-surface-3 text-muted";
  return "bg-[#fdf1ef] text-[#b3261e]";
}

/**
 * What the assistant did, inside the conversation where it did it.
 *
 * Collapsed by default: the operator is here to read the patient, not an audit
 * log. Open, it answers the two questions a silent AI raises — what did it
 * understand, and what did it actually touch.
 */
export function AiActionTrail({ threadId }: { threadId: Id<"channelThreads"> }) {
  const { locale, tr } = useI18n();
  const [open, setOpen] = useState(false);
  const actions = useQuery(api.aiRuntime.listThreadActions, { threadId, limit: 10 });
  if (!actions || actions.length === 0) return null;
  const now = Date.now();
  const toolCount = actions.reduce((sum, turn) => sum + turn.tools.length, 0);

  return (
    <div className="mx-auto my-2 w-full max-w-3xl">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="mx-auto flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 py-1 text-[10px] font-semibold text-muted transition-colors hover:text-ink"
        aria-expanded={open}
      >
        <Bot size={11} />
        {tr(
          `${actions.length} passo(s) da IA${toolCount > 0 ? ` · ${toolCount} ferramenta(s)` : ""}`,
          `${actions.length} AI step(s)${toolCount > 0 ? ` · ${toolCount} tool call(s)` : ""}`,
        )}
        <ChevronDown size={11} className={cn("transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <ol className="animate-rise-in mt-2 space-y-1.5">
          {actions.map((turn) => (
            <li key={turn.turnId} className="rounded-lg border border-line bg-surface-2/70 px-2.5 py-1.5">
              <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                <span className="text-faint">{relativeTime(turn.createdAt, now, locale)}</span>
                {turn.intent && (
                  <span className="inline-flex items-center gap-1 rounded bg-surface-3 px-1.5 py-0.5 font-semibold text-body">
                    <Sparkles size={9} />
                    {tr(
                      `intenção: ${INTENT_PT[turn.intent] ?? turn.intent}`,
                      `intent: ${turn.intent.replace(/_/g, " ")}`,
                    )}
                  </span>
                )}
                {turn.mode === "copilot" && (
                  <span className="rounded bg-[#eef3fb] px-1.5 py-0.5 font-semibold text-[#2b4f8a]">
                    {tr("sugerido", "suggested")}
                  </span>
                )}
                {turn.failureCode && (
                  <span className="inline-flex items-center gap-1 rounded bg-[#fdf1ef] px-1.5 py-0.5 font-semibold text-[#b3261e]">
                    <ShieldAlert size={9} />
                    {turn.failureCode === "TOOL_BREAKER_BLOCKED"
                      ? tr("ferramenta travada em ciclo", "tool stopped looping")
                      : turn.failureCode}
                  </span>
                )}
                {turn.violations.length > 0 && (
                  <span className="rounded bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-800">
                    {tr("corrigido antes de enviar", "corrected before sending")}
                  </span>
                )}
                {turn.costUsdMicros > 0 && (
                  <span className="ml-auto tabular-nums text-faint">
                    {(turn.costUsdMicros / 1000).toFixed(2)} m$
                  </span>
                )}
              </div>
              {turn.tools.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {turn.tools.map((tool, index) => (
                    <span
                      key={`${turn.turnId}-${index}`}
                      className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold", statusTone(tool.status))}
                    >
                      <Wrench size={9} />
                      {toolLabel(tool.name, locale)}
                      {tool.summary ? ` · ${tool.summary}` : ""}
                      {tool.status === "dry_run" ? ` · ${tr("por aprovar", "pending approval")}` : ""}
                      {tool.errorCode ? ` · ${tool.errorCode}` : ""}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
