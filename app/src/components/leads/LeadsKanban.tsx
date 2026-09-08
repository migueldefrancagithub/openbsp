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
import type { CrmStage } from "@/components/leads/leadStatuses";

type Counts = Array<{ stageId: Id<"crmStages">; count: number; capped: boolean }>;

export function LeadsKanban({
  channelId,
  originCampaignId,
  counts,
  stages,
  now,
}: {
  channelId?: Id<"channels">;
  originCampaignId?: Id<"campaigns">;
  counts: Counts | undefined;
  stages: CrmStage[];
  now: number;
}) {
  const { locale, t } = useI18n();
  const moveLead = useMutation(api.crmPipelines.moveLead);
  const [moving, setMoving] = useState<Id<"channelThreads"> | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function move(threadId: Id<"channelThreads">, stageId: string) {
    setMoving(threadId);
    setError(null);
    try {
      await moveLead({ threadId, stageId: stageId as Id<"crmStages"> });
    } catch (cause) {
      setError(convexErrorMessage(cause, locale));
    } finally {
      setMoving(null);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {error && (
        <div className="mx-4 mb-2 rounded-lg border border-[#f5c2b8] bg-chip-danger px-3 py-2 text-[12px] text-chip-danger-fg sm:mx-6">
          {error}
        </div>
      )}
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-4 pb-4 sm:px-6" data-leads-kanban>
        {stages.map((stage) => (
          <KanbanColumn
            key={stage._id}
            stage={stage}
            stages={stages}
            channelId={channelId}
            originCampaignId={originCampaignId}
            now={now}
            count={counts?.find((row) => row.stageId === stage._id)}
            movingId={moving}
            onMove={move}
          />
        ))}
      </div>
    </div>
  );
}

function KanbanColumn({
  stage,
  stages,
  channelId,
  originCampaignId,
  now,
  count,
  movingId,
  onMove,
}: {
  stage: CrmStage;
  stages: CrmStage[];
  channelId?: Id<"channels">;
  originCampaignId?: Id<"campaigns">;
  now: number;
  count?: { count: number; capped: boolean };
  movingId: Id<"channelThreads"> | null;
  onMove: (threadId: Id<"channelThreads">, stageId: string) => void;
}) {
  const { t } = useI18n();
  const [over, setOver] = useState(false);
  const stageQuery = usePaginatedQuery(
    api.leads.listByStage,
    { stageId: stage._id as Id<"crmStages">, channelId, originCampaignId, now },
    { initialNumItems: 20 },
  );
  const { results: stageResults, status: stageLoadStatus, loadMore: loadMoreStage } = stageQuery;
  const stageLeads = stageResults as LeadCardData[];
  const label = stage.useSystemLabel && stage.legacyStatus
    ? t(`status.${stage.legacyStatus}` as TranslationKey)
    : stage.name;

  return (
    <section
      className={cn(
        "flex h-full w-[272px] shrink-0 snap-start flex-col overflow-hidden rounded-xl border bg-surface-2 transition-colors",
        over ? "border-[#0d6b61] bg-chip-success dark:bg-[#123029]" : "border-line",
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
        if (threadId) onMove(threadId as Id<"channelThreads">, stage._id);
      }}
      data-lead-column={stage._id}
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line-soft px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: stage.color }} />
          <h2 className="truncate text-[12px] font-bold uppercase tracking-[0.08em] text-ink">
            {label}
          </h2>
        </div>
        <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold text-muted">
          {count ? (count.capped ? t("leads.capped") : count.count) : "–"}
        </span>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2 pt-2">
        {stageLoadStatus === "LoadingFirstPage" ? (
          <div className="flex items-center justify-center py-6 text-faint">
            <Loader2 size={14} className="animate-spin" />
          </div>
        ) : stageLeads.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-[11px] text-faint">
            {over ? t("leads.dropHere") : t("leads.emptyColumn")}
          </div>
        ) : (
          stageLeads.map((lead) => (
            <LeadCard
              key={lead._id}
              lead={lead}
              currentStageId={stage._id}
              stages={stages}
              moving={movingId === lead._id}
              onMove={(next) => onMove(lead._id, next)}
            />
          ))
        )}
        {stageLoadStatus === "CanLoadMore" && (
          <button
            type="button"
            onClick={() => loadMoreStage(20)}
            className="mt-1 rounded-md border border-line bg-surface px-3 py-1.5 text-[11px] font-semibold text-body hover:bg-surface-2"
          >
            {t("leads.loadMore")}
          </button>
        )}
        {stageLoadStatus === "LoadingMore" && (
          <Loader2 size={14} className="mx-auto mt-1 animate-spin text-faint" />
        )}
      </div>
    </section>
  );
}
