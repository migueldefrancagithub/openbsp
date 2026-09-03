"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { MousePointerClick } from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { EmptyState, PageHeader } from "@/components/app/EmptyState";
import { LeadsKanban } from "@/components/leads/LeadsKanban";
import { useI18n } from "@/lib/i18n";

/**
 * Leads = open conversations grouped by `channelThreads.leadStatus` — the
 * same 10 stages the inbox edits. No separate lead table, no second
 * vocabulary; moving a card is the same audited mutation as the inbox.
 */
export default function LeadsPage() {
  const { t } = useI18n();
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
  // Only campaigns that actually produced leads are worth offering as a filter.
  const campaigns = useQuery(api.channelCampaigns.list, { paginationOpts: { numItems: 50, cursor: null } });
  useEffect(() => {
    if (!channelId && productChannels.length === 1) setChannelId(productChannels[0]._id);
  }, [channelId, productChannels]);
  const counts = useQuery(
    api.leads.counts,
    channels === undefined ? "skip" : { channelId: channelId || undefined, originCampaignId: campaignId || undefined },
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        eyebrow={t("leads.eyebrow")}
        title={t("leads.title")}
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
      {channels === undefined ? (
        <div className="px-4 py-6 text-sm text-faint sm:px-6">{t("leads.loading")}</div>
      ) : channels.length === 0 ? (
        <EmptyState icon={MousePointerClick} title={t("leads.title")} description={t("leads.noChannel")} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col pt-4">
          <LeadsKanban channelId={channelId || undefined} originCampaignId={campaignId || undefined} counts={counts} />
        </div>
      )}
    </div>
  );
}
