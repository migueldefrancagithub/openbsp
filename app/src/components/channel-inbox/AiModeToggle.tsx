"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { Loader2, Rocket, UserCheck } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { cn } from "@/lib/cn";
import { convexErrorMessage } from "@/lib/convexErrorMessage";
import { useI18n } from "@/lib/i18n";

/** Conversation-level [Co-Piloto | Automático] switch; "agent default" is one click away. */
export function AiModeToggle({ threadId, mode, overridden, canChange, onNotice }: { threadId: Id<"channelThreads">; mode: string; overridden: boolean; canChange: boolean; onNotice: (text: string | null) => void }) {
  const { locale, tr } = useI18n();
  const setThreadMode = useMutation(api.aiCopilot.setThreadMode);
  const [busy, setBusy] = useState(false);
  if (mode === "sandbox") return null;

  async function change(next: "copilot" | "autopilot" | null) {
    if (!canChange) return;
    if (next === "autopilot" && !window.confirm(tr("A IA vai responder e marcar consultas sozinha nesta conversa. Confirmar?", "The AI will reply and book on its own in this conversation. Confirm?"))) return;
    setBusy(true);
    onNotice(null);
    try {
      await setThreadMode({ threadId, mode: next });
    } catch (err) {
      onNotice(convexErrorMessage(err, locale));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-1" data-ai-mode-toggle title={overridden ? tr("Modo definido nesta conversa (clique para voltar ao modo do agente)", "Mode set on this conversation (click to follow the agent)") : tr("Modo do agente", "Agent mode")}>
      <span className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5 text-[10px] font-bold">
        {(["copilot", "autopilot"] as const).map((key) => {
          const active = mode === key;
          const Icon = key === "copilot" ? UserCheck : Rocket;
          return (
            <button key={key} type="button" disabled={busy || !canChange} onClick={() => void change(key)} className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5", active ? (key === "copilot" ? "bg-[#2b4f8a] text-white" : "bg-[#0d6b61] text-white") : "text-slate-500 hover:text-[#0a1b33]", !canChange && "cursor-default")}>
              {busy && active ? <Loader2 size={10} className="animate-spin" /> : <Icon size={10} />}
              <span className="hidden sm:inline">{key === "copilot" ? tr("Co-Piloto", "Copilot") : tr("Automático", "Autopilot")}</span>
            </button>
          );
        })}
      </span>
      {overridden && canChange && (
        <button type="button" disabled={busy} onClick={() => void change(null)} className="text-[9px] font-semibold text-slate-400 hover:text-[#0a1b33]">{tr("agente", "agent")}</button>
      )}
    </span>
  );
}
