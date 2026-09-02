"use client";

import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { Check, Clock3 } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { cn } from "@/lib/cn";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { convexErrorMessage } from "@/lib/convexErrorMessage";
import { formatTime } from "@/lib/relativeTime";

const LEAD_STATUSES = [
  "new",
  "interested",
  "asked_price",
  "wants_booking",
  "awaiting_human",
  "booked",
  "confirmed",
  "attended",
  "no_show",
  "lost",
] as const;

const INTENTS = [
  "greeting",
  "info_request",
  "price_request",
  "booking_request",
  "reschedule",
  "cancel",
  "confirm_attendance",
  "complaint",
  "support",
  "human_request",
  "opt_out",
  "clinical_question",
  "out_of_scope",
  "other",
] as const;

type LeadThread = {
  _id: Id<"channelThreads">;
  leadSource?: string;
  leadStatus?: string;
  intent?: string;
  intentSource?: string;
  originCampaignName?: string;
  responsibleMemberId?: Id<"members">;
  nextStep?: string;
  nextStepDueAt?: number;
  automationMode?: string;
};

type Member = { _id: Id<"members">; email?: string; status: string; role: string };

function tomorrowAtNine(): number {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return date.getTime();
}

function toLocalInputValue(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * "Fluxo do paciente" — the editable strip at the top of a conversation:
 * origin (read-only), stage, intent, owner, next action and deadline. Every
 * change autosaves through `inboxOperations.updateThread` (audited).
 */
export function LeadHeaderBar({
  thread,
  members,
  currentMemberId,
}: {
  thread: LeadThread;
  members: Member[] | undefined;
  currentMemberId?: Id<"members">;
}) {
  const { locale, t } = useI18n();
  const updateThread = useMutation(api.inboxOperations.updateThread);
  const [nextStep, setNextStep] = useState(thread.nextStep ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setNextStep(thread.nextStep ?? "");
  }, [thread._id, thread.nextStep]);

  async function save(patch: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    try {
      await updateThread({ threadId: thread._id, ...patch });
    } catch (cause) {
      setError(convexErrorMessage(cause, locale));
    } finally {
      setSaving(false);
    }
  }

  const now = Date.now();
  const overdue = !!thread.nextStepDueAt && thread.nextStepDueAt < now;
  const originKey = `origin.${thread.leadSource ?? "unknown"}` as TranslationKey;
  const originLabel = t(originKey) === originKey ? (thread.leadSource ?? "WhatsApp") : t(originKey);
  const selectClass =
    "mt-0.5 h-7 w-full min-w-0 rounded-md border border-transparent bg-transparent px-1 text-[11px] font-semibold text-slate-700 outline-none hover:border-slate-200 hover:bg-white focus:border-slate-400 focus:bg-white";

  return (
    <div className="border-t border-slate-100 bg-[#fbfcfd]" data-lead-header>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        <div className="min-w-0 px-3 py-2">
          <div className="text-[8px] font-bold uppercase tracking-[0.12em] text-slate-400">{t("inbox.source")}</div>
          <div className="mt-1 truncate text-[11px] font-semibold text-slate-700" title={thread.originCampaignName}>
            {originLabel}
            {thread.originCampaignName ? ` · ${thread.originCampaignName}` : ""}
          </div>
        </div>
        <label className="min-w-0 border-l border-slate-100 px-3 py-2">
          <div className="text-[8px] font-bold uppercase tracking-[0.12em] text-slate-400">{t("inbox.stage")}</div>
          <select
            value={thread.leadStatus ?? "new"}
            disabled={saving}
            onChange={(event) => void save({ leadStatus: event.target.value })}
            className={selectClass}
          >
            {LEAD_STATUSES.map((status) => (
              <option key={status} value={status}>{t(`status.${status}` as TranslationKey)}</option>
            ))}
          </select>
        </label>
        <label className="min-w-0 border-t border-slate-100 px-3 py-2 sm:border-l sm:border-t-0">
          <div className="text-[8px] font-bold uppercase tracking-[0.12em] text-slate-400">
            {t("inbox.intent")}
            {thread.intent && (
              <span className="ml-1 font-medium normal-case tracking-normal text-slate-300">
                · {thread.intentSource === "manual" ? t("inbox.manual") : t("inbox.inferred")}
              </span>
            )}
          </div>
          <select
            value={thread.intent ?? ""}
            disabled={saving}
            onChange={(event) =>
              void save(event.target.value ? { intent: event.target.value } : { clearIntent: true })
            }
            className={selectClass}
          >
            <option value="">{t("inbox.noIntent")}</option>
            {INTENTS.map((intent) => (
              <option key={intent} value={intent}>{t(`intent.${intent}` as TranslationKey)}</option>
            ))}
          </select>
        </label>
        <label className="min-w-0 border-l border-t border-slate-100 px-3 py-2 lg:border-t-0">
          <div className="flex items-center justify-between text-[8px] font-bold uppercase tracking-[0.12em] text-slate-400">
            <span>{t("inbox.owner")}</span>
            {currentMemberId && thread.responsibleMemberId !== currentMemberId && (
              <button
                type="button"
                onClick={() => void save({ responsibleMemberId: currentMemberId })}
                className="normal-case tracking-normal text-[#0d6b61] hover:underline"
              >
                {t("inbox.me")}
              </button>
            )}
          </div>
          <select
            value={thread.responsibleMemberId ?? ""}
            disabled={saving}
            onChange={(event) =>
              void save(
                event.target.value
                  ? { responsibleMemberId: event.target.value }
                  : { clearResponsible: true },
              )
            }
            className={selectClass}
          >
            <option value="">{t("inbox.unassignedShort")}</option>
            {(members ?? [])
              .filter((member) => member.status === "active")
              .map((member) => (
                <option key={member._id} value={member._id}>{member.email ?? member.role}</option>
              ))}
          </select>
        </label>
        <div className="min-w-0 border-t border-slate-100 px-3 py-2 sm:border-l lg:border-t-0">
          <div className="text-[8px] font-bold uppercase tracking-[0.12em] text-slate-400">{t("inbox.nextAction")}</div>
          <div className="mt-0.5 flex items-center gap-1">
            <input
              value={nextStep}
              onChange={(event) => setNextStep(event.target.value)}
              onBlur={() => {
                if (nextStep.trim() !== (thread.nextStep ?? "")) void save({ nextStep });
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void save({ nextStep });
                }
              }}
              placeholder="-"
              maxLength={240}
              className="h-7 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 text-[11px] font-semibold text-slate-700 outline-none hover:border-slate-200 hover:bg-white focus:border-slate-400 focus:bg-white"
            />
            {nextStep.trim() !== (thread.nextStep ?? "") && (
              <button
                type="button"
                onClick={() => void save({ nextStep })}
                className="rounded-md bg-[#0a1b33] p-1 text-white"
                title={t("inbox.save")}
              >
                <Check size={11} />
              </button>
            )}
          </div>
        </div>
        <div className="min-w-0 border-l border-t border-slate-100 px-3 py-2 lg:border-t-0">
          <div className="text-[8px] font-bold uppercase tracking-[0.12em] text-slate-400">{t("inbox.due")}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            <span
              className={cn(
                "inline-flex items-center gap-1 text-[11px] font-semibold",
                overdue ? "text-[#b3261e]" : thread.nextStepDueAt ? "text-slate-700" : "text-slate-400",
              )}
              title={overdue ? t("inbox.overdue") : undefined}
            >
              <Clock3 size={11} />
              {thread.nextStepDueAt ? formatTime(thread.nextStepDueAt, locale) : t("inbox.noDue")}
            </span>
            <input
              type="datetime-local"
              value={thread.nextStepDueAt ? toLocalInputValue(thread.nextStepDueAt) : ""}
              onChange={(event) => {
                const value = event.target.value ? new Date(event.target.value).getTime() : NaN;
                if (Number.isFinite(value)) void save({ nextStepDueAt: value });
              }}
              className="h-6 w-[26px] cursor-pointer rounded border border-slate-200 bg-white text-[10px] text-transparent"
              aria-label={t("inbox.due")}
            />
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {[
              [t("inbox.dueIn1h"), now + 60 * 60 * 1000],
              [t("inbox.dueIn4h"), now + 4 * 60 * 60 * 1000],
              [t("inbox.dueTomorrow"), tomorrowAtNine()],
            ].map(([label, value]) => (
              <button
                key={String(label)}
                type="button"
                onClick={() => void save({ nextStepDueAt: value })}
                className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[9px] font-semibold text-slate-600 hover:border-slate-300"
              >
                {label}
              </button>
            ))}
            {thread.nextStepDueAt && (
              <button
                type="button"
                onClick={() => void save({ clearNextStepDueAt: true })}
                className="rounded px-1.5 py-0.5 text-[9px] font-semibold text-slate-400 hover:text-slate-700"
              >
                {t("inbox.clearDue")}
              </button>
            )}
          </div>
        </div>
      </div>
      {error && <div className="px-3 pb-2 text-[11px] text-[#b3261e]">{error}</div>}
    </div>
  );
}
