"use client";

import { useState } from "react";
import { useMutation, usePaginatedQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { cn } from "@/lib/cn";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { convexErrorMessage } from "@/lib/convexErrorMessage";
import { LeadCard, type LeadCardData } from "@/components/leads/LeadCard";
import { LEAD_STATUSES, leadColumnTone, type LeadStatus } from "@/components/leads/leadStatuses";

type Counts = Array<{ status: string; count: number; capped: boolean }>;

export function LeadsKanban({
  channelId,
  counts,
}: {
  channelId?: Id<"channels">;
  counts: Counts | undefined;
}) {
  const { locale, t } = useI18n();
  const updateThread = useMutation(api.inboxOperations.updateThread);
  const [moving, setMoving] = useState<Id<"channelThreads"> | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function move(threadId: Id<"channelThreads">, leadStatus: string) {
    setMoving(threadId);
    setError(null);
    try {
      await updateThread({ threadId, leadStatus: leadStatus as LeadStatus });
    } catch (cause) {
      setError(convexErrorMessage(cause, locale));
    } finally {
      setMoving(null);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {error && (
        <div className="mx-4 mb-2 rounded-lg border border-[#f5c2b8] bg-[#fff1ee] px-3 py-2 text-[12px] text-[#8a2a1b] sm:mx-6">
          {error}
        </div>
      )}
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-4 pb-4 sm:px-6" data-leads-kanban>
        {LEAD_STATUSES.map((status) => (
          <KanbanColumn
            key={status}
            status={status}
            channelId={channelId}
            count={counts?.find((row) => row.status === status)}
            movingId={moving}
            onMove={move}
          />
        ))}
      </div>
    </div>
  );
}

function KanbanColumn({
  status,
  channelId,
  count,
  movingId,
  onMove,
}: {
  status: LeadStatus;
  channelId?: Id<"channels">;
  count?: { count: number; capped: boolean };
  movingId: Id<"channelThreads"> | null;
  onMove: (threadId: Id<"channelThreads">, leadStatus: string) => void;
}) {
  const { t } = useI18n();
  const [over, setOver] = useState(false);
  const { results, status: loadStatus, loadMore } = usePaginatedQuery(
    api.leads.listByStatus,
    { leadStatus: status, channelId },
    { initialNumItems: 20 },
  );
  const tone = leadColumnTone(status);
  const leads = results as LeadCardData[];

  return (
    <section
      className={cn(
        "flex h-full w-[272px] shrink-0 snap-start flex-col overflow-hidden rounded-xl border bg-surface-2 transition-colors",
        over ? "border-[#0d6b61] bg-[#edf8f6] dark:bg-[#123029]" : "border-line",
      )}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("text/openbsp-lead")) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          if (!over) setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        const threadId = event.dataTransfer.getData("text/openbsp-lead");
        if (threadId) onMove(threadId as Id<"channelThreads">, status);
      }}
      data-lead-column={status}
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line-soft px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn("h-2 w-2 shrink-0 rounded-full", tone.accent)} />
          <h2 className={cn("truncate text-[12px] font-bold uppercase tracking-[0.08em]", tone.header)}>
            {t(`status.${status}` as TranslationKey)}
          </h2>
        </div>
        <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold text-muted">
          {count ? (count.capped ? t("leads.capped") : count.count) : "–"}
        </span>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2 pt-2">
        {loadStatus === "LoadingFirstPage" ? (
          <div className="flex items-center justify-center py-6 text-faint">
            <Loader2 size={14} className="animate-spin" />
          </div>
        ) : leads.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-[11px] text-faint">
            {over ? t("leads.dropHere") : t("leads.emptyColumn")}
          </div>
        ) : (
          leads.map((lead) => (
            <LeadCard
              key={lead._id}
              lead={lead}
              moving={movingId === lead._id}
              onMove={(next) => onMove(lead._id, next)}
            />
          ))
        )}
        {loadStatus === "CanLoadMore" && (
          <button
            type="button"
            onClick={() => loadMore(20)}
            className="mt-1 rounded-md border border-line bg-surface px-3 py-1.5 text-[11px] font-semibold text-body hover:bg-surface-2"
          >
            {t("leads.loadMore")}
          </button>
        )}
        {loadStatus === "LoadingMore" && (
          <Loader2 size={14} className="mx-auto mt-1 animate-spin text-faint" />
        )}
      </div>
    </section>
  );
}
