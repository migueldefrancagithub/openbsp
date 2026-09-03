"use client";

import { useEffect, useRef, useState } from "react";
import { Clock, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import { formatTime } from "@/lib/relativeTime";

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
 * Snooze presets (1h / 4h / tomorrow 9am / custom) and, while snoozed, the
 * "until" label with a one-click resume.
 */
export function SnoozeMenu({
  snoozedUntil,
  onSnooze,
  onUnsnooze,
}: {
  snoozedUntil?: number;
  onSnooze: (until: number) => void;
  onUnsnooze: () => void;
}) {
  const { locale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(() => toLocalInputValue(Date.now() + 4 * 60 * 60 * 1000));
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (snoozedUntil && snoozedUntil > Date.now()) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-line bg-surface-2 px-2 py-1 text-[10px] font-semibold text-body" data-snoozed>
        <Clock size={11} />
        {t("inbox.snoozeUntil").replace("{time}", formatTime(snoozedUntil, locale))}
        <button type="button" onClick={onUnsnooze} className="ml-1 rounded px-1 text-chip-success-fg hover:underline">
          {t("inbox.unsnooze")}
        </button>
      </span>
    );
  }

  const now = Date.now();
  const presets: Array<[string, number]> = [
    [t("inbox.snooze1h"), now + 60 * 60 * 1000],
    [t("inbox.snooze4h"), now + 4 * 60 * 60 * 1000],
    [t("inbox.snoozeTomorrow"), tomorrowAtNine()],
  ];

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "rounded-md p-2 text-faint transition-colors hover:bg-surface-3 hover:text-ink",
          open && "bg-surface-3 text-ink",
        )}
        title={t("inbox.snooze")}
        aria-expanded={open}
        data-snooze-button
      >
        <Clock size={15} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-56 rounded-lg border border-line bg-surface p-2 shadow-[0_18px_50px_-30px_rgba(15,23,42,0.6)]">
          <div className="flex items-center justify-between px-1 pb-1">
            <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-faint">{t("inbox.snooze")}</span>
            <button type="button" onClick={() => setOpen(false)} className="rounded p-0.5 text-faint hover:bg-surface-3" aria-label={t("inbox.cancel")}>
              <X size={12} />
            </button>
          </div>
          {presets.map(([label, until]) => (
            <button
              key={label}
              type="button"
              onClick={() => {
                onSnooze(until);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[11px] font-semibold text-ink hover:bg-surface-2"
            >
              <span>{label}</span>
              <span className="text-[10px] font-normal text-faint">{formatTime(until, locale)}</span>
            </button>
          ))}
          <div className="mt-1 border-t border-line-soft pt-2">
            <div className="px-1 text-[10px] font-semibold text-muted">{t("inbox.snoozeCustom")}</div>
            <div className="mt-1 flex items-center gap-1">
              <input
                type="datetime-local"
                value={custom}
                onChange={(event) => setCustom(event.target.value)}
                className="h-8 min-w-0 flex-1 rounded-md border border-line px-2 text-[11px] outline-none focus:border-brand-solid/40"
              />
              <button
                type="button"
                onClick={() => {
                  const until = new Date(custom).getTime();
                  if (Number.isFinite(until) && until > Date.now()) {
                    onSnooze(until);
                    setOpen(false);
                  }
                }}
                className="h-8 rounded-md bg-brand-solid px-2 text-[11px] font-semibold text-white"
              >
                {t("inbox.snooze")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
