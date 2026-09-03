"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Check, Loader2, RefreshCw, Sparkles, X } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { toolLabel } from "@/components/agents/agentLabels";
import { cn } from "@/lib/cn";
import { convexErrorMessage } from "@/lib/convexErrorMessage";
import { useI18n } from "@/lib/i18n";
import { relativeTime } from "@/lib/relativeTime";

function actionSummary(name: string, input: unknown, output: unknown, locale: "pt" | "en"): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const o = (output ?? {}) as Record<string, unknown>;
  if (name === "reservar_slot") return `${o.service ?? ""} · ${o.when ?? new Date(Number(i.startAt)).toLocaleString(locale === "pt" ? "pt-PT" : "en-GB")}`;
  if (name === "abrir_caso_humano") return `${i.reason ?? ""} (${i.urgency ?? "normal"})`;
  if (name === "atualizar_lead") return String(i.leadStatus ?? i.intent ?? "");
  if (name === "aplicar_tag") return String(i.tag ?? "");
  if (name === "agendar_follow_up") return String(i.trigger ?? "");
  if (name === "criar_lembrete_equipa") return String(i.note ?? "");
  if (name === "enviar_template") return `${i.templateName ?? ""} (${i.languageCode ?? ""})`;
  return "";
}

/**
 * Copilot: the agent's proposal for this conversation. Nothing here has been
 * sent or written; the operator edits, approves (text + selected actions) or
 * discards. Edits feed the agent's examples.
 */
export function AiSuggestionCard({ threadId, onUseDraft, windowOpen }: { threadId: Id<"channelThreads">; onUseDraft: (text: string) => void; windowOpen: boolean }) {
  const { locale, tr } = useI18n();
  const pending = useQuery(api.aiCopilot.pendingForThread, { threadId });
  const approve = useMutation(api.aiCopilot.approve);
  const discard = useMutation(api.aiCopilot.discard);
  const regenerate = useMutation(api.aiCopilot.regenerate);
  const [text, setText] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [loadedTurn, setLoadedTurn] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!pending) {
      setLoadedTurn(null);
      return;
    }
    if (loadedTurn === pending.turnId) return;
    setText(pending.text);
    setSelected(pending.actions.map((a) => a.index));
    setLoadedTurn(pending.turnId);
    setEditing(false);
    setError(null);
  }, [pending, loadedTurn]);

  if (!pending) return null;

  async function run(key: string, action: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(convexErrorMessage(err, locale));
    } finally {
      setBusy(null);
    }
  }

  const edited = text.trim() !== pending.text.trim();
  return (
    <div className="mb-2 rounded-lg border border-[#2b4f8a]/30 bg-[#eef3fb] p-3" data-ai-suggestion>
      <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[11px]">
        <span className="inline-flex items-center gap-1 rounded-md bg-[#2b4f8a] px-1.5 py-0.5 font-bold text-white"><Sparkles size={11} /> {tr("Sugestão da IA", "AI suggestion")}</span>
        <span className="text-muted">{pending.agentName} · {relativeTime(pending.createdAt, Date.now(), locale)}{pending.routerIntent ? ` · ${pending.routerIntent}` : ""}</span>
        {pending.stage === "handoff" && <span className="rounded-md bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800">{tr("sugere passar à equipa", "suggests a handoff")}</span>}
        <span className="ml-auto text-[10px] text-faint">{tr("Nada foi enviado ainda.", "Nothing has been sent yet.")}</span>
      </div>
      {editing ? (
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} className="w-full rounded-md border border-[#2b4f8a]/40 bg-surface p-2 text-[12px] leading-5 text-ink outline-none" autoFocus />
      ) : (
        <button type="button" onClick={() => setEditing(true)} className="w-full whitespace-pre-wrap rounded-md border border-transparent bg-white/70 p-2 text-left text-[12px] leading-5 text-ink hover:border-[#2b4f8a]/40" title={tr("Clique para editar", "Click to edit")}>{text}</button>
      )}
      {pending.violations.length > 0 && <p className="mt-1 text-[10px] font-semibold text-[#b3261e]">{tr("Guards", "Guards")}: {pending.violations.map((v) => v.split(":")[0]).join(", ")}</p>}
      {pending.promiseWarning && (
        <p className="mt-1 rounded bg-amber-50 px-1.5 py-1 text-[11px] text-amber-900">
          {tr(
            `Esta resposta compromete a clínica a ${pending.promiseWarning}, e nada está agendado para isso. Aprove uma acção ou assuma a conversa.`,
            `This reply commits the clinic to ${pending.promiseWarning}, and nothing is scheduled for it. Approve an action or take the conversation.`,
          )}
        </p>
      )}
      {pending.actions.length > 0 && (
        <ul className="mt-2 space-y-1">
          {pending.actions.map((action) => {
            const on = selected.includes(action.index);
            return (
              <li key={action.index}>
                <label className="flex items-start gap-2 text-[12px] text-ink">
                  <input type="checkbox" checked={on} onChange={(e) => setSelected(e.target.checked ? [...selected, action.index] : selected.filter((i) => i !== action.index))} className="mt-0.5 h-4 w-4 accent-[#2b4f8a]" />
                  <span><span className="font-semibold">{toolLabel(action.name, locale)}</span> <span className="text-muted">{actionSummary(action.name, action.input, action.output, locale)}</span></span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {!windowOpen && <p className="mt-1 text-[10px] text-amber-800">{tr("Janela de 24h fechada: só um template aprovado pode ser enviado.", "24h window closed: only an approved template can be sent.")}</p>}
      {error && <p className="mt-1 text-[11px] text-[#b3261e]">{error}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button type="button" disabled={busy !== null || !text.trim()} onClick={() => void run("approve", () => approve({ turnId: pending.turnId, text, approvedActionIndexes: selected }))} className={cn("inline-flex h-8 items-center gap-1 rounded-md px-3 text-[11px] font-bold text-white disabled:opacity-50", edited ? "bg-[#2b4f8a]" : "bg-[#0d6b61]")}>
          {busy === "approve" ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} {edited ? tr("Aprovar editada e enviar", "Approve edited and send") : tr("Aprovar e enviar", "Approve and send")}
        </button>
        <button type="button" disabled={busy !== null} onClick={() => { onUseDraft(text); void run("discard", () => discard({ turnId: pending.turnId, reason: "moved_to_composer" })); }} className="h-8 rounded-md border border-line bg-surface px-2 text-[11px] font-semibold text-body">{tr("Editar no composer", "Edit in composer")}</button>
        <button type="button" disabled={busy !== null} onClick={() => void run("regen", () => regenerate({ turnId: pending.turnId }))} className="inline-flex h-8 items-center gap-1 rounded-md border border-line bg-surface px-2 text-[11px] font-semibold text-body"><RefreshCw size={11} /> {tr("Gerar de novo", "Regenerate")}</button>
        <button type="button" disabled={busy !== null} onClick={() => void run("discard", () => discard({ turnId: pending.turnId }))} className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[11px] font-semibold text-muted hover:text-[#b3261e]"><X size={11} /> {tr("Descartar", "Discard")}</button>
      </div>
    </div>
  );
}
