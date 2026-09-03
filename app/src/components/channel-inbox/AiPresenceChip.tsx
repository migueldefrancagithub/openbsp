"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { Bot, Loader2 } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { cn } from "@/lib/cn";
import { convexErrorMessage } from "@/lib/convexErrorMessage";
import { useI18n } from "@/lib/i18n";
import { relativeTime } from "@/lib/relativeTime";

export type AiPresence =
  | {
      agentName: string;
      status: "responding" | "paused" | "handed_off" | "off";
      turns: number;
      lastTurnAt?: number;
      pausedReason?: string;
      /** What the AI has spent on this conversation, in micro-dollars. */
      costUsdMicros?: number;
      turnsCharged?: number;
    }
  | null
  | undefined;

/**
 * Cost, in the unit that makes it legible.
 *
 * Cents would round almost every conversation to zero and teach the clinic that
 * the AI is free; dollars with four decimals is unreadable. Micro-dollars keep
 * a real number on screen, and it only appears once something was actually
 * charged.
 */
function costLabel(costUsdMicros: number, locale: "pt" | "en"): string {
  if (costUsdMicros >= 10_000) return `$${(costUsdMicros / 1_000_000).toFixed(2)}`;
  const milli = costUsdMicros / 1000;
  return locale === "pt" ? `${milli.toFixed(1)} m$` : `${milli.toFixed(1)} m$`;
}

export function AiPresenceChip({ threadId, ai, canResume, onNotice }: { threadId: Id<"channelThreads">; ai: AiPresence; canResume: boolean; onNotice: (text: string | null) => void }) {
  const { locale, tr } = useI18n();
  const resume = useMutation(api.aiRuntime.resumeThread);
  const [busy, setBusy] = useState(false);
  if (!ai) return null;
  const label =
    ai.status === "responding" ? tr("IA a responder", "AI responding") : ai.status === "paused" ? tr("IA em pausa", "AI paused") : ai.status === "handed_off" ? tr("IA passou à equipa", "AI handed off") : tr("IA desligada", "AI off");
  const tone =
    ai.status === "responding" ? "border-[#0d6b61]/30 bg-chip-success text-chip-success-fg" : ai.status === "paused" ? "border-chip-warn-fg/25 bg-chip-warn text-chip-warn-fg" : ai.status === "handed_off" ? "border-[#2b4f8a]/30 bg-chip-info text-chip-info-fg" : "border-line bg-surface-2 text-muted";
  const cost = ai.costUsdMicros ?? 0;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-semibold", tone)} title={`${ai.agentName} · ${ai.turns} ${tr("respostas", "replies")}${ai.lastTurnAt ? ` · ${relativeTime(ai.lastTurnAt, Date.now(), locale)}` : ""}${ai.pausedReason ? ` · ${ai.pausedReason}` : ""}`}>
      <Bot size={12} />
      <span className="hidden sm:inline">{label}</span>
      {cost > 0 && (
        <span
          className="rounded bg-surface/70 px-1 py-0.5 tabular-nums text-[9px] font-bold"
          title={tr(
            `Esta conversa consumiu ${costLabel(cost, locale)} em ${ai.turnsCharged ?? 0} resposta(s) da IA.`,
            `This conversation used ${costLabel(cost, locale)} across ${ai.turnsCharged ?? 0} AI repl(ies).`,
          )}
        >
          {costLabel(cost, locale)}
        </span>
      )}
      {(ai.status === "paused" || ai.status === "handed_off") && canResume && (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            onNotice(null);
            try {
              const result = await resume({ threadId });
              if (!result.resumed) onNotice(tr("O agente não está ativo; publique-o ou retome nas definições do agente.", "The agent is not active; publish it or resume it in the agent settings."));
            } catch (err) {
              onNotice(convexErrorMessage(err, locale));
            } finally {
              setBusy(false);
            }
          }}
          className="ml-0.5 rounded bg-white/70 px-1.5 py-0.5 text-[10px] font-bold text-ink hover:bg-surface"
        >
          {busy ? <Loader2 size={10} className="animate-spin" /> : tr("Retomar", "Resume")}
        </button>
      )}
    </span>
  );
}
