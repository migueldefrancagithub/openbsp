"use client";

import { AlertTriangle, Bot, Info, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatTime } from "@/lib/relativeTime";
import { useI18n, type TranslationKey } from "@/lib/i18n";

export type TimelineSystemItem = {
  id: string;
  kind: string;
  severity: "info" | "warning" | "error";
  code?: string;
  botName?: string;
  actorName?: string;
  detail?: string;
  at: number;
};

/**
 * Centered "system" pill inside the message timeline. Explains outcomes the
 * patient never sees: a blocked automatic reply, a handoff, a rejected send.
 */
export function SystemEventRow({ item }: { item: TimelineSystemItem }) {
  const { locale, t } = useI18n();
  const titleKey = `systemEvent.${item.kind}` as TranslationKey;
  const rawTitle = t(titleKey);
  const title = (rawTitle === titleKey ? item.kind : rawTitle)
    .replace("{bot}", item.botName ?? "")
    .replace("{actor}", item.actorName ?? t("inbox.team"))
    .replace(/\s{2,}/g, " ")
    .trim();
  const codeKey = item.code
    ? (`systemEvent.code.${item.code}` as TranslationKey)
    : null;
  const codeLabel = codeKey
    ? t(codeKey) === codeKey
      ? item.code
      : t(codeKey)
    : undefined;
  const Icon =
    item.severity === "error"
      ? AlertTriangle
      : item.severity === "warning"
        ? ShieldAlert
        : item.kind.startsWith("automation.")
          ? Bot
          : Info;

  return (
    <div className="flex justify-center px-2 py-1" data-system-event={item.kind}>
      <div
        className={cn(
          "flex max-w-[520px] items-start gap-2 rounded-lg border px-3 py-1.5 text-[11px] leading-4",
          item.severity === "error"
            ? "border-[#f5c2b8] bg-chip-danger text-chip-danger-fg"
            : item.severity === "warning"
              ? "border-chip-warn-fg/25 bg-chip-warn text-chip-warn-fg"
              : "border-line bg-surface text-body",
        )}
      >
        <Icon size={13} className="mt-0.5 shrink-0" />
        <div className="min-w-0">
          <span className="font-semibold">{title}</span>
          {codeLabel && (
            <span className="text-muted"> · {codeLabel}</span>
          )}
          {item.detail && (
            <div className="mt-0.5 truncate text-[10px] text-muted" title={item.detail}>
              {item.detail}
            </div>
          )}
          <div className="mt-0.5 text-[9px] uppercase tracking-wide text-faint">
            {formatTime(item.at, locale)}
          </div>
        </div>
      </div>
    </div>
  );
}
