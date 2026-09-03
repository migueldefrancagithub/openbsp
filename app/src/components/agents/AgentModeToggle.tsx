"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { FlaskConical, Loader2, Rocket, UserCheck } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { cn } from "@/lib/cn";
import { convexErrorMessage } from "@/lib/convexErrorMessage";
import { useI18n } from "@/lib/i18n";

export type AgentMode = "sandbox" | "copilot" | "autopilot";

export function modeLabel(mode: string, locale: "pt" | "en"): string {
  const pt: Record<string, string> = { sandbox: "Sandbox", copilot: "Co-Piloto", autopilot: "Automático" };
  const en: Record<string, string> = { sandbox: "Sandbox", copilot: "Copilot", autopilot: "Autopilot" };
  return (locale === "pt" ? pt : en)[mode] ?? mode;
}

export function modeHint(mode: string, locale: "pt" | "en"): string {
  const pt: Record<string, string> = {
    sandbox: "Só responde no separador Sandbox. Não toca em conversas reais.",
    copilot: "Sugere resposta e acções no inbox; a equipa aprova ou edita antes de enviar.",
    autopilot: "Responde e marca consultas sozinho, dentro das regras e do orçamento.",
  };
  const en: Record<string, string> = {
    sandbox: "Only answers in the Sandbox tab. Never touches real conversations.",
    copilot: "Suggests replies and actions in the inbox; the team approves or edits before sending.",
    autopilot: "Replies and books on its own, within the rules and the budget.",
  };
  return (locale === "pt" ? pt : en)[mode] ?? "";
}

const ICONS = { sandbox: FlaskConical, copilot: UserCheck, autopilot: Rocket } as const;

export function AgentModeToggle({ agentId, mode, published, onNotice }: { agentId: Id<"aiAgents">; mode: AgentMode; published: boolean; onNotice: (text: { tone: "ok" | "error"; text: string } | null) => void }) {
  const { locale, tr } = useI18n();
  const setMode = useMutation(api.aiAgents.setMode);
  const [busy, setBusy] = useState<AgentMode | null>(null);

  async function change(next: AgentMode) {
    if (next === mode) return;
    if (next === "autopilot" && !window.confirm(tr("Em Automático a IA responde e marca consultas sem aprovação. Confirmar?", "In Autopilot the AI replies and books without approval. Confirm?"))) return;
    setBusy(next);
    onNotice(null);
    try {
      await setMode({ agentId, mode: next });
      onNotice({ tone: "ok", text: tr(`Modo alterado para ${modeLabel(next, locale)}.`, `Mode changed to ${modeLabel(next, locale)}.`) });
    } catch (err) {
      onNotice({ tone: "error", text: convexErrorMessage(err, locale) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-1" data-agent-mode-toggle>
      <div className="inline-flex rounded-lg border border-line bg-surface-2 p-1 text-[12px] font-semibold" role="radiogroup" aria-label={tr("Modo do agente", "Agent mode")}>
        {(["sandbox", "copilot", "autopilot"] as const).map((key) => {
          const Icon = ICONS[key];
          const active = mode === key;
          const disabled = busy !== null || (!published && key !== "sandbox");
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => void change(key)}
              title={modeHint(key, locale)}
              className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors", active ? (key === "autopilot" ? "bg-[#0d6b61] text-white" : key === "copilot" ? "bg-[#2b4f8a] text-white" : "bg-brand-solid text-white") : "text-muted hover:text-ink", disabled && !active && "opacity-40")}
            >
              {busy === key ? <Loader2 size={12} className="animate-spin" /> : <Icon size={12} />} {modeLabel(key, locale)}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-muted">{modeHint(mode, locale)}{!published ? ` ${tr("Publique para sair do Sandbox.", "Publish to leave the Sandbox.")}` : ""}</p>
    </div>
  );
}
