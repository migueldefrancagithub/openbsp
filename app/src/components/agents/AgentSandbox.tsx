"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { FlaskConical, Loader2, Play } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { toolLabel } from "@/components/agents/agentLabels";
import { cn } from "@/lib/cn";
import { convexErrorMessage } from "@/lib/convexErrorMessage";
import { useI18n } from "@/lib/i18n";

type Transcript = Array<{
  inbound: string;
  outcome: string;
  text?: string;
  reason?: string;
  routerIntent?: string;
  toolCalls: Array<{ name: string; status: string; input: unknown; output: unknown; errorCode?: string }>;
  violations: string[];
  attempts: Array<{ provider: string; model: string; stage: string; ok: boolean; kind?: string; latencyMs: number }>;
  costUsdMicros: number;
}>;

const SCENARIOS: Record<string, string[]> = {
  booking: ["Olá, queria marcar uma consulta de avaliação", "Pode ser na próxima terça de manhã?", "Sim, às 9h está ótimo"],
  price: ["Quanto custa a limpeza dentária?", "E têm desconto para estudantes?"],
  clinical: ["Tenho dor de dente há 3 dias, posso tomar ibuprofeno?"],
  human: ["Quero falar com uma pessoa, isto é urgente"],
};

export function AgentSandbox({ agentId }: { agentId: Id<"aiAgents"> }) {
  const { locale, tr } = useI18n();
  const simulate = useAction(api.aiSandbox.simulate);
  const [messages, setMessages] = useState(SCENARIOS.booking.join("\n"));
  const [windowOpen, setWindowOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ transcript: Transcript; totalCostUsdMicros: number } | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const lines = messages.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 8);
      setResult(await simulate({ agentId, messages: lines, serviceWindowOpen: windowOpen }));
    } catch (err) {
      setError(convexErrorMessage(err, locale));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_1.3fr]">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(SCENARIOS).map(([key, lines]) => (
            <button key={key} type="button" onClick={() => setMessages(lines.join("\n"))} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:border-slate-300">
              {key === "booking" ? tr("Marcação", "Booking") : key === "price" ? tr("Preço", "Price") : key === "clinical" ? tr("Pergunta clínica", "Clinical question") : tr("Pede pessoa", "Asks for a human")}
            </button>
          ))}
        </div>
        <label className="block text-[11px] font-medium text-slate-500">
          {tr("Mensagens do paciente (uma por linha, máx. 8)", "Patient messages (one per line, max 8)")}
          <textarea value={messages} onChange={(e) => setMessages(e.target.value)} rows={6} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-[#0a1b33] outline-none focus:border-slate-400" />
        </label>
        <label className="flex items-center gap-2 text-[12px] text-[#0a1b33]"><input type="checkbox" checked={windowOpen} onChange={(e) => setWindowOpen(e.target.checked)} className="h-4 w-4 accent-[#0a1b33]" />{tr("Janela de 24h aberta", "24h window open")}</label>
        <button type="button" disabled={busy} onClick={() => void run()} className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#0a1b33] px-4 text-[13px] font-semibold text-white disabled:opacity-50">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} {tr("Simular (nada é enviado)", "Simulate (nothing is sent)")}
        </button>
        {error && <p className="rounded-lg border border-[#e0533d]/30 bg-[#fdf1ef] px-3 py-2 text-[12px] text-[#b3261e]">{error}</p>}
        <p className="text-[11px] text-slate-400">{tr("Usa a configuração do rascunho, o provedor de Definições › IA e ferramentas em modo simulação (a agenda é lida, nunca reservada).", "Uses the draft configuration, the provider from Settings › AI and tools in simulation mode (the agenda is read, never booked).")}</p>
      </div>
      <div className="space-y-2">
        {!result ? (
          <div className="flex items-center gap-2 rounded-lg border border-dashed border-slate-200 px-4 py-8 text-[12px] text-slate-400"><FlaskConical size={14} /> {tr("O transcrito aparece aqui.", "The transcript shows up here.")}</div>
        ) : (
          <>
            {result.transcript.map((turn, index) => (
              <div key={index} className="rounded-lg border border-slate-200 bg-white p-3 text-[12px]">
                <div className="mb-1.5 rounded-md bg-slate-50 px-2 py-1 text-[#0a1b33]"><span className="text-[10px] uppercase tracking-[0.12em] text-slate-400">{tr("Paciente", "Patient")}</span><br />{turn.inbound}</div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-semibold", turn.outcome === "reply" ? "bg-[#edf8f6] text-[#0d6b61]" : turn.outcome === "handoff" ? "bg-amber-50 text-amber-800" : turn.outcome === "failed" ? "bg-[#fdf1ef] text-[#b3261e]" : "bg-slate-100 text-slate-600")}>{turn.outcome}{turn.reason ? ` · ${turn.reason}` : ""}</span>
                  {turn.routerIntent && <span className="text-[10px] text-slate-400">router: {turn.routerIntent}</span>}
                  {turn.attempts.map((a, i) => <span key={i} className={cn("text-[10px]", a.ok ? "text-slate-400" : "text-[#b3261e]")}>{a.provider}/{a.model} {a.stage} {a.ok ? `${a.latencyMs}ms` : a.kind}</span>)}
                </div>
                {turn.toolCalls.length > 0 && (
                  <ul className="mt-1.5 space-y-1">
                    {turn.toolCalls.map((call, i) => (
                      <li key={i} className="rounded-md border border-slate-100 px-2 py-1">
                        <span className={cn("font-semibold", call.status === "error" || call.status === "denied" ? "text-[#b3261e]" : "text-[#2b4f8a]")}>{toolLabel(call.name, locale)}</span> <span className="text-[10px] text-slate-400">{call.status}{call.errorCode ? ` · ${call.errorCode}` : ""}</span>
                        <pre className="mt-0.5 max-h-24 overflow-auto whitespace-pre-wrap text-[10px] text-slate-500">{JSON.stringify({ input: call.input, output: call.output }, null, 0).slice(0, 400)}</pre>
                      </li>
                    ))}
                  </ul>
                )}
                {turn.text && <div className="mt-1.5 whitespace-pre-wrap rounded-md border border-[#0d6b61]/20 bg-[#edf8f6] px-2 py-1 text-[#0a1b33]"><span className="text-[10px] uppercase tracking-[0.12em] text-[#0d6b61]">{tr("Agente", "Agent")}</span><br />{turn.text}</div>}
                {turn.violations.length > 0 && <p className="mt-1 text-[10px] text-[#b3261e]">{tr("Guards", "Guards")}: {turn.violations.join(" · ")}</p>}
              </div>
            ))}
            <p className="text-[11px] text-slate-400">{tr("Custo estimado", "Estimated cost")}: ${(result.totalCostUsdMicros / 1_000_000).toFixed(4)}</p>
          </>
        )}
      </div>
    </div>
  );
}
