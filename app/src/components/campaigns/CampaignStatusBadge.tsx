"use client";

import { useI18n } from "@/lib/i18n";
import { campaignStatusLabel, campaignStatusTone } from "./campaignLabels";

export function CampaignStatusBadge({ status }: { status: string }) {
  const { locale } = useI18n();
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${campaignStatusTone(status)}`}
    >
      {status === "running" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
      {campaignStatusLabel(status, locale)}
    </span>
  );
}
