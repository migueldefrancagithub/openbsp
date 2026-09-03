"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { Check, Loader2, X } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { cn } from "@/lib/cn";
import { convexErrorMessage } from "@/lib/convexErrorMessage";
import { useI18n } from "@/lib/i18n";
import { relativeTime } from "@/lib/relativeTime";

const FIELD_PT: Record<string, string> = { name: "nome", email: "email" };
const FIELD_EN: Record<string, string> = { name: "name", email: "email" };

/**
 * The AI heard something; a person decides. Approving and ignoring are both
 * decisions and both are recorded — the refusal is the signal that feeds the
 * next prompt, so it cannot be a silent absence.
 */
export function ProposalsPanel({ threadId, compact = false }: { threadId?: Id<"channelThreads">; compact?: boolean }) {
  const { locale, tr } = useI18n();
  const pending = useQuery(api.aiProposals.listPending, threadId ? { threadId } : {});
  const decide = useMutation(api.aiProposals.decide);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = Date.now();

  if (!pending || pending.length === 0) {
    if (compact || threadId) return null;
    return (
      <div className="rounded-lg border border-slate-200 bg-white px-4 py-8 text-center">
        <p className="text-[13px] font-medium text-[#0a1b33]">{tr("Nenhuma proposta à sua espera", "No proposals waiting for you")}</p>
        <p className="mt-0.5 text-[12px] text-slate-500">
          {tr(
            "Quando o assistente ouvir um dado novo ou sugerir um próximo passo, aparece aqui — e sai daqui assim que decidir.",
            "When the assistant hears a new detail or suggests a next step, it shows up here — and leaves as soon as you decide.",
          )}
        </p>
      </div>
    );
  }

  async function act(id: Id<"aiProposals">, decision: "approve" | "dismiss") {
    setBusy(id);
    setError(null);
    try {
      await decide({ proposalId: id, decision });
    } catch (err) {
      setError(convexErrorMessage(err, locale));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={cn("rounded-lg border border-slate-200 bg-white", compact && "border-[#2b4f8a]/25 bg-[#f7f9fd]")}>
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
        <span className="text-[12px] font-semibold text-[#0a1b33]">
          {tr("A IA ouviu, você decide", "The AI heard it, you decide")} ({pending.length})
        </span>
      </div>
      {error && <p className="px-3 pt-2 text-[11px] text-[#b3261e]">{error}</p>}
      <ul className="divide-y divide-slate-100">
        {pending.map((proposal) => (
          <li key={proposal._id} className="px-3 py-2.5 text-[12px]">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              {!threadId && (
                <Link
                  href={`/app/channel-inbox/${encodeURIComponent(proposal.threadKey)}?channel=${proposal.channelId}`}
                  className="font-semibold text-[#2b4f8a] hover:underline"
                >
                  {proposal.patientName ?? proposal.threadKey}
                </Link>
              )}
              <span className="text-[10px] uppercase tracking-[0.12em] text-slate-400">
                {proposal.kind === "next_action"
                  ? tr("próxima acção", "next action")
                  : (locale === "pt" ? FIELD_PT : FIELD_EN)[proposal.field ?? ""] ?? proposal.field}
              </span>
              <span className="text-[10px] text-slate-400">{relativeTime(proposal.createdAt, now, locale)}</span>
            </div>
            {proposal.kind === "next_action" ? (
              <p className="mt-0.5 text-[#0a1b33]">{proposal.action}</p>
            ) : (
              <p className="mt-0.5 text-[#0a1b33]">
                {proposal.previousValue && <span className="text-slate-400 line-through">{proposal.previousValue} </span>}
                <span className="font-semibold">{proposal.value}</span>
              </p>
            )}
            {proposal.excerpt && (
              <p className="mt-0.5 rounded bg-slate-50 px-1.5 py-1 text-[11px] italic text-slate-500">“{proposal.excerpt}”</p>
            )}
            <div className="mt-1.5 flex items-center gap-1.5">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void act(proposal._id, "approve")}
                className="inline-flex h-7 items-center gap-1 rounded-md bg-[#0d6b61] px-2 text-[11px] font-bold text-white disabled:opacity-50"
              >
                {busy === proposal._id ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                {tr("Aprovar", "Approve")}
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void act(proposal._id, "dismiss")}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 px-2 text-[11px] font-semibold text-slate-600 disabled:opacity-50"
              >
                <X size={11} />
                {tr("Ignorar", "Ignore")}
              </button>
              <span className="text-[10px] text-slate-400">
                {tr("vence", "expires")} {relativeTime(proposal.expiresAt, now, locale)}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
