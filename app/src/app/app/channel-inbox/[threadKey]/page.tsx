"use client";

import { use } from "react";
import { useSearchParams } from "next/navigation";
import { ChannelThreadView } from "@/components/channel-inbox/ChannelThreadView";
import { useI18n } from "@/lib/i18n";
import type { Id } from "../../../../../convex/_generated/dataModel";

export default function ChannelThreadPage({
  params,
}: {
  params: Promise<{ threadKey: string }>;
}) {
  const { threadKey } = use(params);
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const channelId = searchParams.get("channel") as Id<"channels"> | null;

  if (!channelId) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
        {t("inbox.pickChannel")}
      </div>
    );
  }

  return (
    <ChannelThreadView
      channelId={channelId}
      threadKey={decodeURIComponent(threadKey)}
    />
  );
}
