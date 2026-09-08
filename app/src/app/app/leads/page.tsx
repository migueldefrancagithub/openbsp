"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Columns3, Loader2, Settings2 } from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { EmptyState, PageHeader } from "@/components/app/EmptyState";
import { LeadsKanban } from "@/components/leads/LeadsKanban";
import { StageManager } from "@/components/leads/StageManager";
import type { CrmStage } from "@/components/leads/leadStatuses";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import { useMinuteNow } from "@/lib/useMinuteNow";

/**
 * Leads = open conversations grouped by `channelThreads.leadStatus` — the
 * same conversation records the inbox edits. Pipeline stages are tenant-owned
 * configuration; moving a card remains an audited update on that conversation.
 */
export default function LeadsPage() {
  const now = useMinuteNow();
  const { t, tr } = useI18n();
  const ensureDefault = useMutation(api.crmPipelines.ensureDefault);
  const pipeline = useQuery(api.crmPipelines.getDefault);
  const channels = useQuery(api.channels.list);
  const productChannels = useMemo(
    () =>
      (channels ?? []).filter(
        (channel) =>
          channel.provider === "iasolution_hub" && channel.operationalTerritory === "openbsp",
      ),
    [channels],
  );
  const [channelId, setChannelId] = useState<Id<"channels"> | "">("");
  const [campaignId, setCampaignId] = useState<Id<"campaigns"> | "">("");
  const [view, setView] = useState<"board" | "stages">("board");
  // Only campaigns that actually produced leads are worth offering as a filter.
  const campaigns = useQuery(api.channelCampaigns.list, { paginationOpts: { numItems: 50, cursor: null } });
  useEffect(() => {
    if (!channelId && productChannels.length === 1) setChannelId(productChannels[0]._id);
  }, [channelId, productChannels]);
  useEffect(() => {
    if (pipeline === null) void ensureDefault({});
  }, [ensureDefault, pipeline]);
  const counts = useQuery(
    api.leads.countsByPipeline,
    channels === undefined || !pipeline
      ? "skip"
      : { pipelineId: pipeline.pipeline._id, channelId: channelId || undefined, originCampaignId: campaignId || undefined },
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        eyebrow={tr("CRM", "CRM")}
        title={tr("Funil de oportunidades", "Opportunity pipeline")}
        description={t("leads.subtitle")}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={campaignId}
              onChange={(event) => setCampaignId(event.target.value as Id<"campaigns"> | "")}
              aria-label={t("leads.filterCampaign")}
              className="h-9 rounded-lg border border-line bg-surface px-3 text-[13px] font-medium text-ink outline-none"
            >
              <option value="">{t("leads.allCampaigns")}</option>
              {(campaigns?.page ?? []).map((campaign) => (
                <option key={campaign._id} value={campaign._id}>{campaign.name}</option>
              ))}
            </select>
            {productChannels.length > 1 ? (
            <select
              value={channelId}
              onChange={(event) => setChannelId(event.target.value as Id<"channels"> | "")}
              className="h-9 rounded-lg border border-line bg-surface px-3 text-[13px] font-medium text-ink outline-none"
            >
              <option value="">{t("leads.allChannels")}</option>
              {productChannels.map((channel) => (
                <option key={channel._id} value={channel._id}>{channel.displayName}</option>
              ))}
            </select>
            ) : null}
          </div>
        }
      />
      <div className="flex items-center gap-1 border-b border-line bg-surface px-4 py-2 sm:px-6">
        <button type="button" onClick={() => setView("board")} className={cn("inline-flex h-8 items-center gap-2 rounded-md px-3 text-[12px] font-semibold", view === "board" ? "bg-brand-solid text-white" : "text-muted hover:bg-surface-2 hover:text-ink")}>
          <Columns3 size={14} /> {tr("Quadro", "Board")}
        </button>
        <button type="button" onClick={() => setView("stages")} className={cn("inline-flex h-8 items-center gap-2 rounded-md px-3 text-[12px] font-semibold", view === "stages" ? "bg-brand-solid text-white" : "text-muted hover:bg-surface-2 hover:text-ink")}>
          <Settings2 size={14} /> {tr("Configurar etapas", "Configure stages")}
        </button>
      </div>
      {channels === undefined ? (
        <div className="px-4 py-6 text-sm text-faint sm:px-6">{t("leads.loading")}</div>
      ) : channels.length === 0 ? (
        <EmptyState icon={Columns3} title={tr("Funil CRM", "CRM pipeline")} description={t("leads.noChannel")} />
      ) : pipeline === undefined || pipeline === null ? (
        <div className="flex items-center gap-2 px-4 py-6 text-sm text-faint sm:px-6"><Loader2 size={14} className="animate-spin" /> {tr("A preparar o funil…", "Preparing pipeline…")}</div>
      ) : view === "stages" ? (
        <div className="min-h-0 flex-1 overflow-y-auto pt-4">
          <StageManager pipelineId={pipeline.pipeline._id} stages={pipeline.stages as CrmStage[]} />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col pt-4">
          {now !== null ? (
            <LeadsKanban
              channelId={channelId || undefined}
              originCampaignId={campaignId || undefined}
              counts={counts}
              stages={pipeline.stages as CrmStage[]}
              now={now}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
