"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { CheckCircle2, Loader2, UsersRound, X } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import { convexErrorMessage } from "@/lib/convexErrorMessage";

function formatDuration(ms: number, locale: "pt" | "en"): string {
  const minutes = Math.max(1, Math.round(Math.abs(ms) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest ? `${hours}h ${rest}min` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return locale === "pt" ? `${days} d` : `${days}d`;
}

/**
 * Header chip for the open human case: SLA countdown (amber), overdue in
 * coral, click to resolve. Reads the case table directly so it is right even
 * if the thread cache lags.
 */
export function HumanCaseChip({
  threadId,
  currentMemberId,
  compact = false,
}: {
  threadId: Id<"channelThreads">;
  currentMemberId?: Id<"members">;
  compact?: boolean;
}) {
  const { locale, t } = useI18n();
  const ops = useQuery(api.inboxOperations.getThreadOps, { threadId });
  const resolveCase = useMutation(api.clinic.resolveHumanCase);
  const assignCase = useMutation(api.clinic.assignHumanCase);
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState("");
  const [returnToAi, setReturnToAi] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const openCase = ops?.openCase;
  if (!openCase) return null;
  const remaining = openCase.slaDueAt - now;
  const overdue = remaining < 0;
  const slaLabel = (overdue ? t("handoff.slaOverdue") : t("handoff.slaIn")).replace(
    "{time}",
    formatDuration(remaining, locale),
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!openCase || busy) return;
    setBusy(true);
    setError(null);
    try {
      await resolveCase({ caseId: openCase._id, decision: decision.trim(), returnToAi });
      setOpen(false);
      setDecision("");
    } catch (cause) {
      setError(convexErrorMessage(cause, locale));
    } finally {
      setBusy(false);
    }
  }

  async function takeIt() {
    if (!openCase || !currentMemberId || busy) return;
    setBusy(true);
    try {
      await assignCase({ caseId: openCase._id, responsibleMemberId: currentMemberId });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex items-center gap-1 rounded-md border font-semibold",
          compact ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-1 text-[10px]",
          overdue
            ? "border-[#f5c2b8] bg-[#fff1ee] text-[#8a2a1b]"
            : "border-amber-200 bg-amber-50 text-amber-800",
        )}
        title={`${openCase.reason} · ${openCase.responsibleName ?? t("handoff.unassigned")}`}
        data-human-case-chip
      >
        <UsersRound size={compact ? 9 : 11} />
        {t("handoff.caseOpen")} · {slaLabel}
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 sm:items-center sm:p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
          role="dialog"
          aria-modal="true"
        >
          <form onSubmit={submit} className="w-full max-w-lg rounded-t-2xl bg-surface p-5 shadow-2xl sm:rounded-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-bold text-ink">{t("handoff.resolveTitle")}</h2>
                <p className="mt-0.5 text-[12px] text-muted">
                  {openCase.reason} · {slaLabel}
                  {openCase.responsibleName ? ` · ${openCase.responsibleName}` : ""}
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-md p-1.5 text-faint hover:bg-surface-3" aria-label={t("inbox.cancel")}>
                <X size={16} />
              </button>
            </div>
            <p className="mt-3 rounded-md bg-surface-2 px-3 py-2 text-[12px] leading-relaxed text-ink">{openCase.question}</p>
            {!openCase.responsibleMemberId && currentMemberId && (
              <button type="button" onClick={() => void takeIt()} disabled={busy} className="mt-2 text-[11px] font-semibold text-[#0d6b61] hover:underline">
                {t("handoff.assignMe")}
              </button>
            )}
            <label className="mt-3 block text-[11px] font-semibold text-muted">
              {t("handoff.decision")}
              <textarea
                value={decision}
                onChange={(event) => setDecision(event.target.value)}
                rows={3}
                minLength={2}
                maxLength={2000}
                required
                placeholder={t("handoff.decisionPlaceholder")}
                className="mt-1 w-full rounded-md border border-line px-2.5 py-2 text-[12px] leading-relaxed outline-none focus:border-brand-solid/40"
              />
            </label>
            <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
              {[true, false].map((value) => (
                <button
                  key={String(value)}
                  type="button"
                  onClick={() => setReturnToAi(value)}
                  className={cn(
                    "rounded-md border px-3 py-2 text-left text-[11px] font-semibold transition-colors",
                    returnToAi === value ? "border-brand-solid bg-brand-solid text-white" : "border-line bg-surface text-body hover:border-line",
                  )}
                >
                  {value ? t("handoff.returnToAi") : t("handoff.keepHuman")}
                  {value && (
                    <span className={cn("mt-0.5 block text-[10px] font-normal", returnToAi ? "text-white/70" : "text-faint")}>
                      {t("handoff.returnToAiHint")}
                    </span>
                  )}
                </button>
              ))}
            </div>
            {error && <div className="mt-2 text-[11px] text-[#b3261e]">{error}</div>}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="h-9 rounded-md px-3 text-[12px] font-semibold text-muted hover:bg-surface-3">
                {t("inbox.cancel")}
              </button>
              <button type="submit" disabled={busy || decision.trim().length < 2} className="inline-flex h-9 items-center gap-2 rounded-md bg-[#0d6b61] px-4 text-[12px] font-bold text-white disabled:opacity-50">
                {busy ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                {t("handoff.resolve")}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
