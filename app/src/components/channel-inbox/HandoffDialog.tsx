"use client";

import { useState, type FormEvent } from "react";
import { useMutation } from "convex/react";
import { Loader2, UsersRound, X } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { cn } from "@/lib/cn";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { convexErrorMessage } from "@/lib/convexErrorMessage";

const URGENCIES = ["low", "normal", "high", "urgent"] as const;
type Urgency = (typeof URGENCIES)[number];

const REASON_INTENTS = [
  "clinical_question",
  "price_request",
  "reschedule",
  "cancel",
  "complaint",
  "human_request",
  "support",
  "other",
] as const;

type Member = { _id: Id<"members">; email?: string; status: string; role: string };

/**
 * One-click handoff: defaults (reason from the thread intent, normal urgency,
 * the current member as owner, last patient message as the question) already
 * make a valid case; the operator only edits what differs.
 */
export function HandoffDialog({
  threadId,
  intent,
  lastPreview,
  members,
  currentMemberId,
  onClose,
  onCreated,
}: {
  threadId: Id<"channelThreads">;
  intent?: string;
  lastPreview?: string;
  members: Member[] | undefined;
  currentMemberId?: Id<"members">;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { locale, t } = useI18n();
  const createHumanCase = useMutation(api.clinic.createHumanCase);
  const defaultReason = REASON_INTENTS.includes(intent as never) ? (intent as string) : "other";
  const [reasonKey, setReasonKey] = useState<string>(defaultReason);
  const [customReason, setCustomReason] = useState("");
  const [urgency, setUrgency] = useState<Urgency>("normal");
  const [question, setQuestion] = useState(lastPreview ?? "");
  const [responsible, setResponsible] = useState<string>(currentMemberId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reasonLabel =
    reasonKey === "other"
      ? customReason.trim() || t("handoff.reasonOther")
      : t(`intent.${reasonKey}` as TranslationKey);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await createHumanCase({
        threadId,
        reason: reasonLabel.slice(0, 80),
        urgency,
        question: question.trim().length >= 3 ? question.trim() : reasonLabel,
        responsibleMemberId: responsible ? (responsible as Id<"members">) : undefined,
        openedFrom: "inbox",
      });
      onCreated();
    } catch (cause) {
      setError(convexErrorMessage(cause, locale));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      data-handoff-dialog
    >
      <form
        onSubmit={submit}
        className="w-full max-w-lg rounded-t-2xl bg-surface p-5 shadow-2xl sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
              <UsersRound size={17} />
            </span>
            <div>
              <h2 className="text-[15px] font-bold text-ink">{t("handoff.title")}</h2>
              <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{t("handoff.subtitle")}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-faint hover:bg-surface-3" aria-label={t("inbox.cancel")}>
            <X size={16} />
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-[11px] font-semibold text-muted">
            {t("handoff.reason")}
            <select
              value={reasonKey}
              onChange={(event) => setReasonKey(event.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-line bg-surface px-2 text-[12px] font-semibold text-ink outline-none focus:border-brand-solid/40"
            >
              {REASON_INTENTS.map((key) => (
                <option key={key} value={key}>
                  {key === "other" ? t("handoff.reasonOther") : t(`intent.${key}` as TranslationKey)}
                </option>
              ))}
            </select>
            {reasonKey === "other" && (
              <input
                value={customReason}
                onChange={(event) => setCustomReason(event.target.value)}
                maxLength={80}
                placeholder={t("handoff.reasonOther")}
                className="mt-1.5 h-9 w-full rounded-md border border-line px-2 text-[12px] outline-none focus:border-brand-solid/40"
              />
            )}
          </label>
          <label className="text-[11px] font-semibold text-muted">
            {t("handoff.responsible")}
            <select
              value={responsible}
              onChange={(event) => setResponsible(event.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-line bg-surface px-2 text-[12px] font-semibold text-ink outline-none focus:border-brand-solid/40"
            >
              <option value="">{t("handoff.unassigned")}</option>
              {(members ?? [])
                .filter((member) => member.status === "active")
                .map((member) => (
                  <option key={member._id} value={member._id}>
                    {member._id === currentMemberId ? `${t("inbox.me")} · ` : ""}
                    {member.email ?? member.role}
                  </option>
                ))}
            </select>
          </label>
        </div>

        <div className="mt-3">
          <div className="text-[11px] font-semibold text-muted">{t("handoff.urgency")}</div>
          <div className="mt-1 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {URGENCIES.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setUrgency(value)}
                className={cn(
                  "h-9 rounded-md border px-2 text-[11px] font-semibold transition-colors",
                  urgency === value
                    ? value === "urgent"
                      ? "border-[#e0533d] bg-[#fff1ee] text-[#8a2a1b]"
                      : "border-brand-solid bg-brand-solid text-white"
                    : "border-line bg-surface text-body hover:border-line",
                )}
              >
                {t(`handoff.urgency.${value}` as TranslationKey)}
              </button>
            ))}
          </div>
        </div>

        <label className="mt-3 block text-[11px] font-semibold text-muted">
          {t("handoff.question")}
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            rows={3}
            maxLength={2000}
            placeholder={t("handoff.questionPlaceholder")}
            className="mt-1 w-full rounded-md border border-line px-2.5 py-2 text-[12px] leading-relaxed outline-none focus:border-brand-solid/40"
          />
        </label>

        {error && <div className="mt-2 text-[11px] text-[#b3261e]">{error}</div>}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 rounded-md px-3 text-[12px] font-semibold text-muted hover:bg-surface-3">
            {t("inbox.cancel")}
          </button>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-nav-active px-4 text-[12px] font-bold text-white disabled:opacity-50"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <UsersRound size={13} />}
            {t("handoff.submit")}
          </button>
        </div>
      </form>
    </div>
  );
}
