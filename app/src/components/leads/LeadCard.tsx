"use client";

import Link from "next/link";
import { Bot, Clock3, Megaphone, ShieldAlert, UserRound } from "lucide-react";
import type { Id } from "../../../convex/_generated/dataModel";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/relativeTime";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { LEAD_STATUSES } from "@/components/leads/leadStatuses";

export type LeadCardData = {
  _id: Id<"channelThreads">;
  channelId: Id<"channels">;
  threadKey: string;
  displayName?: string;
  phone?: string;
  leadStatus: string;
  leadSource?: string;
  intent?: string;
  nextStep?: string;
  nextStepDueAt?: number;
  responsibleName?: string;
  unreadCount: number;
  lastEventAt: number;
  lastPreview?: string;
  serviceWindowExpiresAt?: number;
  originCampaignName?: string;
  automationMode?: string;
  pilotBlocked: boolean;
};

export function LeadCard({
  lead,
  onMove,
  moving,
}: {
  lead: LeadCardData;
  onMove: (leadStatus: string) => void;
  moving: boolean;
}) {
  const { locale, t } = useI18n();
  const now = Date.now();
  const label = lead.displayName ?? lead.phone ?? lead.threadKey;
  const windowOpen = !!lead.serviceWindowExpiresAt && lead.serviceWindowExpiresAt > now;
  const overdue = !!lead.nextStepDueAt && lead.nextStepDueAt < now;
  const intentKey = lead.intent ? (`intent.${lead.intent}` as TranslationKey) : null;
  const href = `/app/channel-inbox/${encodeURIComponent(lead.threadKey)}?channel=${lead.channelId}`;

  return (
    <article
      draggable={!moving}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/openbsp-lead", lead._id);
        event.dataTransfer.effectAllowed = "move";
      }}
      className={cn(
        "rounded-lg border border-slate-200 bg-white p-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-opacity",
        moving && "opacity-50",
      )}
      data-lead-card={lead._id}
    >
      <div className="flex items-start justify-between gap-2">
        <Link href={href} className="min-w-0 flex-1" title={t("leads.openChat")}>
          <div className={cn("truncate text-[12px]", lead.unreadCount > 0 ? "font-bold text-[#0a1b33]" : "font-semibold text-slate-700")}>
            {label}
          </div>
          {lead.lastPreview && (
            <div className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-slate-500">{lead.lastPreview}</div>
          )}
        </Link>
        <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", windowOpen ? "bg-emerald-500" : "bg-slate-300")} title={t("leads.window")} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {intentKey && (
          <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] font-semibold text-slate-600">
            {t(intentKey) === intentKey ? lead.intent : t(intentKey)}
          </span>
        )}
        {lead.originCampaignName && (
          <span className="inline-flex max-w-[140px] items-center gap-1 truncate rounded border border-[#cfe0f5] bg-[#eef4fc] px-1.5 py-0.5 text-[9px] font-semibold text-[#2b4f8a]" title={lead.originCampaignName}>
            <Megaphone size={9} />
            <span className="truncate">{lead.originCampaignName}</span>
          </span>
        )}
        {lead.pilotBlocked && (
          <span className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold text-amber-800">
            <ShieldAlert size={9} />
            {t("inbox.pilotBlockedShort")}
          </span>
        )}
        {lead.automationMode === "bot" && <Bot size={11} className="text-blue-500" />}
        {lead.unreadCount > 0 && (
          <span className="ml-auto min-w-5 rounded-full bg-[#0d6b61] px-1.5 py-0.5 text-center text-[9px] font-bold text-white">
            {lead.unreadCount}
          </span>
        )}
      </div>
      {lead.nextStep && (
        <div className="mt-2 flex items-start gap-1 text-[10px] text-slate-600">
          <Clock3 size={10} className={cn("mt-0.5 shrink-0", overdue ? "text-[#b3261e]" : "text-slate-400")} />
          <span className="line-clamp-2">
            {lead.nextStep}
            {lead.nextStepDueAt && (
              <span className={cn("ml-1", overdue ? "font-semibold text-[#b3261e]" : "text-slate-400")}>
                · {relativeTime(lead.nextStepDueAt, now, locale)}
              </span>
            )}
          </span>
        </div>
      )}
      <div className="mt-2 flex items-center justify-between gap-2 text-[9px] text-slate-400">
        <span className="inline-flex min-w-0 items-center gap-1">
          <UserRound size={10} />
          <span className="truncate">{lead.responsibleName ?? t("inbox.unassignedShort")}</span>
        </span>
        <span>{relativeTime(lead.lastEventAt, now, locale)}</span>
      </div>
      <select
        value=""
        onChange={(event) => {
          if (event.target.value) onMove(event.target.value);
        }}
        disabled={moving}
        aria-label={t("leads.moveTo")}
        className="mt-2 h-7 w-full rounded-md border border-slate-200 bg-white px-1.5 text-[10px] font-semibold text-slate-600 outline-none focus:border-slate-400"
      >
        <option value="">{t("leads.moveTo")}</option>
        {LEAD_STATUSES.filter((status) => status !== lead.leadStatus).map((status) => (
          <option key={status} value={status}>{t(`status.${status}` as TranslationKey)}</option>
        ))}
      </select>
    </article>
  );
}
