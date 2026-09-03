"use client";

import { MessageCircleMore } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export default function ChannelInboxIndexPage() {
  const { t } = useI18n();
  return (
    <div className="hidden flex-1 flex-col items-center justify-center bg-background px-6 text-center sm:flex">
      <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-line bg-surface text-chip-success-fg shadow-sm">
        <MessageCircleMore size={21} />
      </div>
      <h2 className="mt-4 text-[18px] font-semibold text-ink">
        {t("inbox.pickThread")}
      </h2>
      <p className="mt-1.5 max-w-sm text-[12px] leading-5 text-muted">
        {t("inbox.pickThreadBody")}
      </p>
    </div>
  );
}
