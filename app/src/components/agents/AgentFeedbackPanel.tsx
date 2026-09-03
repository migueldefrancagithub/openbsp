"use client";

import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { GraduationCap, Loader2, Trash2 } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { toolLabel } from "@/components/agents/agentLabels";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import { relativeTime } from "@/lib/relativeTime";

/** "Evolução": what the team approved, edited or discarded in copilot mode. */
export function AgentFeedbackPanel({ agentId }: { agentId: Id<"aiAgents"> }) {
  const { locale, tr } = useI18n();
  const stats = useQuery(api.aiCopilot.feedbackStats, { agentId });
  const feedback = usePaginatedQuery(api.aiCopilot.listFeedback, { agentId }, { initialNumItems: 20 });
  const remove = useMutation(api.aiCopilot.removeFeedback);
  const now = Date.now();
  const total = stats ? stats.approved + stats.edited + stats.discarded : 0;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: tr("Aprovadas sem editar", "Approved as-is"), value: stats?.approved ?? 0, tone: "text-[#0d6b61]" },
          { label: tr("Editadas pela equipa", "Edited by the team"), value: stats?.edited ?? 0, tone: "text-[#2b4f8a]" },
          { label: tr("Descartadas", "Discarded"), value: stats?.discarded ?? 0, tone: "text-[#b3261e]" },
          { label: tr("Exemplos em uso", "Examples in use"), value: stats?.examples ?? 0 },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
            <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-slate-400">{item.label}</div>
            <div className={cn("mt-0.5 font-[var(--font-outfit)] text-[18px] font-medium", item.tone ?? "text-[#0a1b33]")}>{item.value}</div>
          </div>
        ))}
      </div>
      {stats?.graduation.ready && (
        <div className="rounded-lg border border-[#0d6b61]/30 bg-[#edf8f6] px-3 py-2 text-[12px] text-[#0d6b61]">
          <span className="font-semibold">{tr("Pronto para Automático.", "Ready for Autopilot.")}</span>{" "}
          {tr(
            `A equipa aprovou ${Math.round(stats.graduation.approvalRate * 100)}% das sugestões sem editar, em ${stats.graduation.decided} decisões, e quase não corrigiu movimentos de etapa. A decisão continua sua.`,
            `The team approved ${Math.round(stats.graduation.approvalRate * 100)}% of suggestions without editing, across ${stats.graduation.decided} decisions, and barely corrected any stage moves. The call is still yours.`,
          )}
        </div>
      )}
      {stats && (stats.corrections.reverted > 0 || stats.corrections.redirected > 0) && (
        <p className="text-[11px] text-slate-500">
          {tr(
            `A equipa desfez ${stats.corrections.reverted + stats.corrections.redirected} movimento(s) de etapa deste agente (${stats.corrections.reverted} devolvido(s), ${stats.corrections.redirected} redireccionado(s)). É onde ele ainda lê a conversa de forma diferente da equipa.`,
            `The team undid ${stats.corrections.reverted + stats.corrections.redirected} stage move(s) by this agent (${stats.corrections.reverted} reverted, ${stats.corrections.redirected} redirected). That is where it still reads the conversation differently from the team.`,
          )}
        </p>
      )}
      <p className="flex items-center gap-1.5 text-[11px] text-slate-500"><GraduationCap size={12} /> {total > 0 ? tr(`Taxa de aprovação sem edição: ${Math.round(((stats?.approved ?? 0) / total) * 100)}%. As últimas 8 respostas aprovadas/editadas entram no prompt como exemplos.`, `Approval-as-is rate: ${Math.round(((stats?.approved ?? 0) / total) * 100)}%. The last 8 approved/edited replies are fed to the prompt as examples.`) : tr("Ainda sem feedback. Em Co-Piloto, cada aprovação ou edição ensina o agente.", "No feedback yet. In Copilot, every approval or edit teaches the agent.")}</p>
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        {feedback.status === "LoadingFirstPage" ? (
          <div className="px-4 py-6 text-sm text-slate-400"><Loader2 size={14} className="animate-spin" /></div>
        ) : feedback.results.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-slate-500">{tr("Sem exemplos ainda.", "No examples yet.")}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {feedback.results.map((row) => (
              <li key={row._id} className="px-4 py-2.5 text-[12px]">
                <div className="flex items-center justify-between gap-2">
                  <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-semibold", row.outcome === "approved" ? "bg-[#edf8f6] text-[#0d6b61]" : row.outcome === "edited" ? "bg-[#eef3fb] text-[#2b4f8a]" : "bg-[#fdf1ef] text-[#b3261e]")}>{row.outcome === "approved" ? tr("aprovada", "approved") : row.outcome === "edited" ? tr("editada", "edited") : tr("descartada", "discarded")}</span>
                  <span className="text-[10px] text-slate-400">{relativeTime(row.createdAt, now, locale)}</span>
                  <button type="button" onClick={() => void remove({ feedbackId: row._id })} className="text-slate-400 hover:text-[#b3261e]" title={tr("Remover exemplo", "Remove example")}><Trash2 size={12} /></button>
                </div>
                <p className="mt-1 text-slate-500"><span className="text-[10px] uppercase tracking-[0.12em]">{tr("Paciente", "Patient")}</span> {row.patientText}</p>
                {row.outcome === "edited" && <p className="mt-0.5 text-slate-400 line-through">{row.suggestedText}</p>}
                {row.finalText && <p className="mt-0.5 text-[#0a1b33]"><span className="text-[10px] uppercase tracking-[0.12em] text-[#0d6b61]">{tr("Equipa", "Team")}</span> {row.finalText}</p>}
                {(row.approvedActions.length > 0 || row.rejectedActions.length > 0) && (
                  <p className="mt-0.5 text-[10px] text-slate-400">
                    {row.approvedActions.length > 0 && `✓ ${row.approvedActions.map((a) => toolLabel(a, locale)).join(", ")}`}
                    {row.rejectedActions.length > 0 && ` ✗ ${row.rejectedActions.map((a) => toolLabel(a, locale)).join(", ")}`}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
        {feedback.status === "CanLoadMore" && <div className="border-t border-slate-100 px-4 py-2"><button type="button" onClick={() => feedback.loadMore(20)} className="text-[12px] font-semibold text-[#2b4f8a] hover:underline">{tr("Carregar mais", "Load more")}</button></div>}
      </div>
    </div>
  );
}
