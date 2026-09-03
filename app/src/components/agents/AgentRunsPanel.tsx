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
  if (status === "completed") return "bg-[#edf8f6] text-[#0d6b61]";
  if (status === "failed") return "bg-[#fdf1ef] text-[#b3261e]";
  if (status === "skipped") return "bg-slate-100 text-slate-500";
  return "bg-amber-50 text-amber-800";
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
            { label: tr("Respondidos", "Replied"), value: String(stats.completed), tone: "text-[#0d6b61]" },
            { label: tr("Passados à equipa", "Handed off"), value: String(stats.handoffs), tone: "text-[#2b4f8a]" },
            { label: tr("Falhas", "Failures"), value: String(stats.failed), tone: stats.failed > 0 ? "text-[#b3261e]" : undefined },
            { label: tr("Ferramentas", "Tool calls"), value: String(stats.toolCalls) },
            { label: tr("Latência média", "Avg latency"), value: `${(stats.avgLatencyMs / 1000).toFixed(1)} s` },
            { label: tr("Custo (7d)", "Cost (7d)"), value: `$${(stats.costUsdMicros / 1_000_000).toFixed(3)}` },
          ].map((item) => (
            <div key={item.label} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
              <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-slate-400">{item.label}</div>
              <div className={cn("mt-0.5 font-[var(--font-outfit)] text-[18px] font-medium", item.tone ?? "text-[#0a1b33]")}>{item.value}</div>
            </div>
          ))}
        </div>
      )}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        {turns.status === "LoadingFirstPage" ? (
          <div className="flex items-center gap-2 px-4 py-6 text-sm text-slate-400"><Loader2 size={14} className="animate-spin" /> {tr("A carregar…", "Loading…")}</div>
        ) : turns.results.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-slate-500">{tr("Ainda sem turnos. Assim que o agente responder a uma mensagem real, aparece aqui.", "No turns yet. Once the agent answers a real message it shows up here.")}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {turns.results.map((turn) => (
              <li key={turn._id}>
                <button type="button" onClick={() => setOpen(open === turn._id ? null : turn._id)} className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-slate-50">
                  {open === turn._id ? <ChevronDown size={14} className="mt-0.5 shrink-0 text-slate-400" /> : <ChevronRight size={14} className="mt-0.5 shrink-0 text-slate-400" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
                      <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-semibold", statusTone(turn.status))}>{turn.status}{turn.stage ? ` · ${turn.stage}` : ""}</span>
                      {turn.routerIntent && <span className="text-[10px] text-slate-400">{turn.routerIntent}</span>}
                      {turn.failureCode && <span className="text-[10px] text-[#b3261e]">{turn.failureCode}</span>}
                      <span className="ml-auto text-[10px] text-slate-400">{relativeTime(turn.createdAt, now, locale)}</span>
                    </div>
                    <p className="mt-0.5 truncate text-[12px] text-[#0a1b33]">{turn.replyText ?? "—"}</p>
                    <div className="mt-0.5 text-[10px] text-slate-400">
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
          <div className="border-t border-slate-100 px-4 py-2"><button type="button" onClick={() => turns.loadMore(20)} className="text-[12px] font-semibold text-[#2b4f8a] hover:underline">{tr("Carregar mais", "Load more")}</button></div>
        )}
      </div>
    </div>
  );
}

function TurnDetail({ turnId, threadKey }: { turnId: Id<"aiTurns">; threadKey: string }) {
  const { locale, tr } = useI18n();
  const invocations = useQuery(api.aiTools.listForTurn, { turnId });
  return (
    <div className="border-t border-slate-100 bg-slate-50 px-4 py-2 text-[11px]">
      {invocations === undefined ? <Loader2 size={12} className="animate-spin text-slate-300" /> : invocations.length === 0 ? <span className="text-slate-400">{tr("Sem ferramentas neste turno.", "No tools in this turn.")}</span> : (
        <ul className="space-y-1">
          {invocations.map((call) => (
            <li key={call._id} className="rounded-md border border-slate-100 bg-white px-2 py-1">
              <span className={cn("font-semibold", call.status === "error" || call.status === "denied" ? "text-[#b3261e]" : "text-[#2b4f8a]")}>{toolLabel(call.name, locale)}</span> <span className="text-slate-400">{call.status}{call.errorCode ? ` · ${call.errorCode}` : ""} · {call.durationMs} ms</span>
              <pre className="mt-0.5 max-h-20 overflow-auto whitespace-pre-wrap text-[10px] text-slate-500">{JSON.stringify({ input: call.input, output: call.output }).slice(0, 500)}</pre>
            </li>
          ))}
        </ul>
      )}
      <Link href={`/app/channel-inbox/${threadKey}`} className="mt-1 inline-block text-[11px] font-semibold text-[#2b4f8a] hover:underline">{tr("Abrir conversa", "Open conversation")}</Link>
    </div>
  );
}
