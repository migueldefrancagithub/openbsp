"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { Languages, Loader2, Sparkles, Wand2 } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { cn } from "@/lib/cn";
import { convexErrorMessage } from "@/lib/convexErrorMessage";
import { useI18n } from "@/lib/i18n";

export function AiComposerTools({ threadId, draft, onUse, disabled }: { threadId: Id<"channelThreads">; draft: string; onUse: (text: string) => void; disabled?: boolean }) {
  const { locale, tr } = useI18n();
  const suggest = useAction(api.aiComposer.suggestReply);
  const translate = useAction(api.aiComposer.translate);
  const rewrite = useAction(api.aiComposer.rewriteTone);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ text: string; flagged: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(key: string, action: () => Promise<{ text: string; flagged: string[] }>) {
    setBusy(key);
    setError(null);
    try {
      setResult(await action());
    } catch (err) {
      setError(convexErrorMessage(err, locale));
    } finally {
      setBusy(null);
    }
  }

  const button = "inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-600 hover:border-[#2b4f8a] hover:text-[#2b4f8a] disabled:opacity-50";
  const hasDraft = draft.trim().length > 0;

  return (
    <div className="space-y-1.5" data-ai-composer>
      <div className="flex flex-wrap gap-1">
        <button type="button" disabled={disabled || busy !== null} onClick={() => void run("suggest", () => suggest({ threadId, hint: hasDraft ? draft : undefined }))} className={button}>{busy === "suggest" ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} {tr("Sugerir resposta", "Suggest reply")}</button>
        <button type="button" disabled={disabled || busy !== null || !hasDraft} onClick={() => void run("shorter", () => rewrite({ text: draft, tone: "shorter", threadId }))} className={button}>{busy === "shorter" ? <Loader2 size={11} className="animate-spin" /> : <Wand2 size={11} />} {tr("Encurtar", "Shorten")}</button>
        <button type="button" disabled={disabled || busy !== null || !hasDraft} onClick={() => void run("formal", () => rewrite({ text: draft, tone: "formal", threadId }))} className={button}><Wand2 size={11} /> {tr("Mais formal", "More formal")}</button>
        <button type="button" disabled={disabled || busy !== null || !hasDraft} onClick={() => void run("friendly", () => rewrite({ text: draft, tone: "friendly", threadId }))} className={button}><Wand2 size={11} /> {tr("Mais próximo", "Warmer")}</button>
        <button type="button" disabled={disabled || busy !== null || !hasDraft} onClick={() => void run("translate", () => translate({ text: draft, to: locale === "pt" ? "en" : "pt", threadId }))} className={button}>{busy === "translate" ? <Loader2 size={11} className="animate-spin" /> : <Languages size={11} />} {locale === "pt" ? tr("Traduzir para inglês", "Translate to English") : tr("Traduzir para português", "Translate to Portuguese")}</button>
      </div>
      {error && <p className="text-[11px] text-[#b3261e]">{error}</p>}
      {result && (
        <div className={cn("rounded-lg border px-3 py-2", result.flagged.length > 0 ? "border-[#e0533d]/40 bg-[#fdf1ef]" : "border-amber-200 bg-amber-50")}>
          <div className="mb-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-800">
            <span>{tr("Rascunho da IA · revê antes de enviar", "AI draft · review before sending")}</span>
            <span className="flex gap-2">
              <button type="button" onClick={() => { onUse(result.text); setResult(null); }} className="rounded bg-[#0a1b33] px-2 py-0.5 text-[10px] font-bold text-white">{tr("Usar", "Use")}</button>
              <button type="button" onClick={() => setResult(null)} className="text-[10px] font-bold text-slate-500">{tr("Descartar", "Discard")}</button>
            </span>
          </div>
          <p className="whitespace-pre-wrap text-[12px] leading-5 text-[#0a1b33]">{result.text}</p>
          {result.flagged.length > 0 && <p className="mt-1 text-[10px] font-semibold text-[#b3261e]">{tr("Atenção: ", "Warning: ")}{result.flagged.map((f) => f.split(":")[0]).join(", ")} — {tr("corrija antes de enviar.", "fix before sending.")}</p>}
        </div>
      )}
    </div>
  );
}
