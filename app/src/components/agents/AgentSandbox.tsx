"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { Bot, FlaskConical, Loader2, Play, Wrench } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { toolLabel } from "@/components/agents/agentLabels";
import { cn } from "@/lib/cn";
import { convexErrorMessage } from "@/lib/convexErrorMessage";
import { useI18n } from "@/lib/i18n";

type ToolCall = { name: string; status: string; input: unknown; output: unknown; errorCode?: string };

type Turn = {
  inbound: string;
  outcome: string;
  text?: string;
  reason?: string;
  routerIntent?: string;
  toolCalls: ToolCall[];
  violations: string[];
  attempts: Array<{ provider: string; model: string; stage: string; ok: boolean; kind?: string; latencyMs: number }>;
  costUsdMicros: number;
};

const SCENARIOS: Record<string, string[]> = {
  booking: ["Olá, queria marcar uma consulta de avaliação", "Pode ser na próxima terça de manhã?", "Sim, às 9h está ótimo"],
  price: ["Quanto custa a limpeza dentária?", "E têm desconto para estudantes?"],
  clinical: ["Tenho dor de dente há 3 dias, posso tomar ibuprofeno?"],
  human: ["Quero falar com uma pessoa, isto é urgente"],
};

function outcomeTone(outcome: string): string {
  if (outcome === "reply") return "bg-[#edf8f6] text-[#0d6b61]";
  if (outcome === "handoff") return "bg-amber-50 text-amber-800";
  if (outcome === "failed") return "bg-[#fdf1ef] text-[#b3261e]";
  return "bg-surface-3 text-body";
}

function toolTone(status: string): string {
  if (status === "ok") return "text-[#0d6b61]";
  if (status === "dry_run") return "text-[#2b4f8a]";
  return "text-[#b3261e]";
}

/**
 * Two halves, on purpose. Left is the conversation as the patient would see it;
 * right is the machinery — router verdict, every tool call with its real
 * arguments, provider latency and what the turn cost. Reading a transcript with
 * JSON interleaved in it is how you stop noticing either one.
 */
export function AgentSandbox({ agentId }: { agentId: Id<"aiAgents"> }) {
  const { locale, tr } = useI18n();
  const simulate = useAction(api.aiSandbox.simulate);
  const [messages, setMessages] = useState(SCENARIOS.booking.join("\n"));
  const [windowOpen, setWindowOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ transcript: Turn[]; totalCostUsdMicros: number } | null>(null);
  const [selected, setSelected] = useState(0);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const lines = messages.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 8);
      const outcome = await simulate({ agentId, messages: lines, serviceWindowOpen: windowOpen });
      setResult(outcome as { transcript: Turn[]; totalCostUsdMicros: number });
      setSelected(0);
    } catch (err) {
      setError(convexErrorMessage(err, locale));
    } finally {
      setBusy(false);
    }
  }

  const turn = result?.transcript[selected];
  const toolTotal = result?.transcript.reduce((sum, item) => sum + item.toolCalls.length, 0) ?? 0;

  return (
    <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-2">
      {/* Left: the conversation. */}
      <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-surface">
        <header className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-2">
          {Object.entries(SCENARIOS).map(([key, lines]) => (
            <button
              key={key}
              type="button"
              onClick={() => setMessages(lines.join("\n"))}
              className="rounded-full border border-line px-2.5 py-1 text-[11px] font-semibold text-body transition-colors hover:bg-surface-2 hover:text-ink"
            >
              {key === "booking"
                ? tr("Marcação", "Booking")
                : key === "price"
                  ? tr("Preço", "Price")
                  : key === "clinical"
                    ? tr("Pergunta clínica", "Clinical question")
                    : tr("Pede pessoa", "Asks for a human")}
            </button>
          ))}
        </header>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
          {!result ? (
            <div className="flex h-full items-center justify-center gap-2 rounded-lg border border-dashed border-line text-[12px] text-faint">
              <FlaskConical size={14} /> {tr("A conversa simulada aparece aqui.", "The simulated conversation shows up here.")}
            </div>
          ) : (
            result.transcript.map((item, index) => (
              <button
                key={index}
                type="button"
                onClick={() => setSelected(index)}
                className={cn(
                  "block w-full space-y-1.5 rounded-lg p-1.5 text-left transition-colors",
                  selected === index ? "bg-surface-2 ring-1 ring-[#2b4f8a]/30" : "hover:bg-surface-2/60",
                )}
              >
                <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-surface-3 px-3 py-1.5 text-[12px] text-ink">
                  {item.inbound}
                </div>
                {item.text ? (
                  <div className="mr-auto max-w-[85%] rounded-2xl rounded-bl-sm bg-[#edf8f6] px-3 py-1.5 text-[12px] text-ink dark:bg-[#123029]">
                    {item.text}
                  </div>
                ) : (
                  <div className={cn("mr-auto inline-flex rounded-md px-2 py-1 text-[10px] font-semibold", outcomeTone(item.outcome))}>
                    {item.outcome}
                    {item.reason ? ` · ${item.reason}` : ""}
                  </div>
                )}
              </button>
            ))
          )}
        </div>

        <footer className="space-y-2 border-t border-line px-3 py-2">
          <textarea
            value={messages}
            onChange={(event) => setMessages(event.target.value)}
            rows={3}
            placeholder={tr("Uma mensagem por linha, máx. 8", "One message per line, max 8")}
            className="w-full resize-none rounded-lg border border-line bg-surface-2 px-3 py-2 text-[12px] text-ink outline-none focus:border-brand-solid/40"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void run()}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand-solid px-3.5 text-[12px] font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-50"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              {tr("Simular", "Simulate")}
            </button>
            <label className="flex items-center gap-1.5 text-[11px] text-body">
              <input type="checkbox" checked={windowOpen} onChange={(event) => setWindowOpen(event.target.checked)} className="h-3.5 w-3.5 accent-[#0a1b33]" />
              {tr("Janela de 24h aberta", "24h window open")}
            </label>
            <span className="ml-auto text-[10px] text-faint">{tr("Nada é enviado.", "Nothing is sent.")}</span>
          </div>
          {error && <p className="rounded-lg border border-[#e0533d]/30 bg-[#fdf1ef] px-3 py-2 text-[11px] text-[#b3261e]">{error}</p>}
        </footer>
      </section>

      {/* Right: the machinery. */}
      <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-surface">
        <header className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
          <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-ink">
            <Wrench size={13} /> {tr("Inspector de ferramentas", "Tool inspector")}
          </span>
          {result && (
            <span className="flex items-center gap-2 text-[10px] text-faint">
              <span>{toolTotal} {tr("chamadas", "calls")}</span>
              <span className="tabular-nums">
                {(result.totalCostUsdMicros / 1000).toFixed(2)} m$ · ${(result.totalCostUsdMicros / 1_000_000).toFixed(4)}
              </span>
            </span>
          )}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {!turn ? (
            <p className="text-[12px] text-faint">
              {tr("Corre uma simulação e escolhe um turno à esquerda.", "Run a simulation and pick a turn on the left.")}
            </p>
          ) : (
            <div className="space-y-3 text-[12px]">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-bold", outcomeTone(turn.outcome))}>{turn.outcome}</span>
                {turn.routerIntent && (
                  <span className="rounded-md bg-surface-3 px-1.5 py-0.5 text-[10px] font-semibold text-body">
                    {tr("intenção", "intent")}: {turn.routerIntent}
                  </span>
                )}
                <span className="ml-auto tabular-nums text-[10px] text-faint">{(turn.costUsdMicros / 1000).toFixed(2)} m$</span>
              </div>

              <div>
                <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-faint">{tr("Provedores", "Providers")}</p>
                <ul className="space-y-0.5">
                  {turn.attempts.map((attempt, index) => (
                    <li key={index} className={cn("flex items-center justify-between gap-2 rounded-md bg-surface-2 px-2 py-1 text-[11px]", !attempt.ok && "text-[#b3261e]")}>
                      <span className="truncate">
                        {attempt.provider}/{attempt.model} <span className="text-faint">· {attempt.stage}</span>
                      </span>
                      <span className="shrink-0 tabular-nums text-faint">{attempt.ok ? `${attempt.latencyMs}ms` : attempt.kind}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-faint">
                  {tr("Chamadas às ferramentas", "Tool calls")}
                </p>
                {turn.toolCalls.length === 0 ? (
                  <p className="text-[11px] text-faint">{tr("Nenhuma neste turno.", "None in this turn.")}</p>
                ) : (
                  <ul className="space-y-1.5">
                    {turn.toolCalls.map((call, index) => (
                      <li key={index} className="rounded-lg border border-line-soft bg-surface-2 p-2">
                        <div className="flex items-center gap-1.5">
                          <Bot size={11} className={toolTone(call.status)} />
                          <span className={cn("text-[11px] font-semibold", toolTone(call.status))}>{toolLabel(call.name, locale)}</span>
                          <span className="text-[10px] text-faint">
                            {call.status}
                            {call.errorCode ? ` · ${call.errorCode}` : ""}
                          </span>
                        </div>
                        <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-surface px-2 py-1 font-mono text-[10px] leading-4 text-body">
{JSON.stringify({ input: call.input, output: call.output }, null, 2).slice(0, 1200)}
                        </pre>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {turn.violations.length > 0 && (
                <div>
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-faint">{tr("Guards", "Guards")}</p>
                  <ul className="space-y-0.5">
                    {turn.violations.map((violation, index) => (
                      <li key={index} className="rounded-md bg-[#fdf1ef] px-2 py-1 text-[11px] text-[#b3261e]">{violation}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
