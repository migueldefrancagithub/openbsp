"use client";

import Link from "next/link";
import { useState } from "react";
import { usePaginatedQuery, useQuery } from "convex/react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { toolLabel } from "@/components/agents/agentLabels";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import { relativeTime } from "@/lib/relativeTime";

function statusTone(status: string): string {
  if (status === "completed") return "bg-chip-success text-chip-success-fg";
  if (status === "failed") return "bg-chip-danger text-chip-danger-fg";
  if (status === "skipped") return "bg-surface-3 text-muted";
  return "bg-chip-warn text-chip-warn-fg";
}

export function AgentRunsPanel({ agentId }: { agentId: Id<"aiAgents"> }) {
  const { locale, tr } = useI18n();
  const stats = useQuery(api.aiRuntime.stats, { agentId, days: 7 });
  const turns = usePaginatedQuery(api.aiRuntime.listTurns, { agentId }, { initialNumItems: 20 });
  const [open, setOpen] = useState<Id<"aiTurns"> | null>(null);
  const now = Date.now();
  return (
    <div className="space-y-3">
      {stats && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
          {[
            { label: tr("Turnos (7d)", "Turns (7d)"), value: String(stats.turns) },
            { label: tr("Respondidos", "Replied"), value: String(stats.completed), tone: "text-chip-success-fg" },
            { label: tr("Passados à equipa", "Handed off"), value: String(stats.handoffs), tone: "text-chip-info-fg" },
            { label: tr("Falhas", "Failures"), value: String(stats.failed), tone: stats.failed > 0 ? "text-chip-danger-fg" : undefined },
            { label: tr("Ferramentas", "Tool calls"), value: String(stats.toolCalls) },
            { label: tr("Latência média", "Avg latency"), value: `${(stats.avgLatencyMs / 1000).toFixed(1)} s` },
            { label: tr("Custo (7d)", "Cost (7d)"), value: `$${(stats.costUsdMicros / 1_000_000).toFixed(3)}` },
          ].map((item) => (
            <div key={item.label} className="rounded-lg border border-line-soft bg-surface-2 px-3 py-2">
              <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-faint">{item.label}</div>
              <div className={cn("mt-0.5 font-[var(--font-outfit)] text-[18px] font-medium", item.tone ?? "text-ink")}>{item.value}</div>
            </div>
          ))}
        </div>
      )}
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        {turns.status === "LoadingFirstPage" ? (
          <div className="flex items-center gap-2 px-4 py-6 text-sm text-faint"><Loader2 size={14} className="animate-spin" /> {tr("A carregar…", "Loading…")}</div>
        ) : turns.results.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-muted">{tr("Ainda sem turnos. Assim que o agente responder a uma mensagem real, aparece aqui.", "No turns yet. Once the agent answers a real message it shows up here.")}</p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {turns.results.map((turn) => (
              <li key={turn._id}>
                <button type="button" onClick={() => setOpen(open === turn._id ? null : turn._id)} className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-surface-2">
                  {open === turn._id ? <ChevronDown size={14} className="mt-0.5 shrink-0 text-faint" /> : <ChevronRight size={14} className="mt-0.5 shrink-0 text-faint" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
                      <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-semibold", statusTone(turn.status))}>{turn.status}{turn.stage ? ` · ${turn.stage}` : ""}</span>
                      {turn.routerIntent && <span className="text-[10px] text-faint">{turn.routerIntent}</span>}
                      {turn.failureCode && <span className="text-[10px] text-chip-danger-fg">{turn.failureCode}</span>}
                      <span className="ml-auto text-[10px] text-faint">{relativeTime(turn.createdAt, now, locale)}</span>
                    </div>
                    <p className="mt-0.5 truncate text-[12px] text-ink">{turn.replyText ?? "—"}</p>
                    <div className="mt-0.5 text-[10px] text-faint">
                      …{turn.threadKey.slice(-4)} · {turn.toolCallCount} {tr("ferramentas", "tools")} · {turn.inputTokens + turn.outputTokens} tokens · ${(turn.costUsdMicros / 1_000_000).toFixed(4)} · {(turn.latencyMs / 1000).toFixed(1)} s · {turn.attempts.map((a) => `${a.provider}/${a.model}:${a.ok ? "ok" : a.kind}`).join(", ")}
                    </div>
                  </div>
                </button>
                {open === turn._id && <TurnDetail turnId={turn._id} threadKey={turn.threadKey} />}
              </li>
            ))}
          </ul>
        )}
        {turns.status === "CanLoadMore" && (
          <div className="border-t border-line-soft px-4 py-2"><button type="button" onClick={() => turns.loadMore(20)} className="text-[12px] font-semibold text-chip-info-fg hover:underline">{tr("Carregar mais", "Load more")}</button></div>
        )}
      </div>
    </div>
  );
}

function TurnDetail({ turnId, threadKey }: { turnId: Id<"aiTurns">; threadKey: string }) {
  const { locale, tr } = useI18n();
  const invocations = useQuery(api.aiTools.listForTurn, { turnId });
  return (
    <div className="border-t border-line-soft bg-surface-2 px-4 py-2 text-[11px]">
      {invocations === undefined ? <Loader2 size={12} className="animate-spin text-faint" /> : invocations.length === 0 ? <span className="text-faint">{tr("Sem ferramentas neste turno.", "No tools in this turn.")}</span> : (
        <ul className="space-y-1">
          {invocations.map((call) => (
            <li key={call._id} className="rounded-md border border-line-soft bg-surface px-2 py-1">
              <span className={cn("font-semibold", call.status === "error" || call.status === "denied" ? "text-chip-danger-fg" : "text-chip-info-fg")}>{toolLabel(call.name, locale)}</span> <span className="text-faint">{call.status}{call.errorCode ? ` · ${call.errorCode}` : ""} · {call.durationMs} ms</span>
              <pre className="mt-0.5 max-h-20 overflow-auto whitespace-pre-wrap text-[10px] text-muted">{JSON.stringify({ input: call.input, output: call.output }).slice(0, 500)}</pre>
            </li>
          ))}
        </ul>
      )}
      <Link href={`/app/channel-inbox/${threadKey}`} className="mt-1 inline-block text-[11px] font-semibold text-chip-info-fg hover:underline">{tr("Abrir conversa", "Open conversation")}</Link>
    </div>
  );
}
