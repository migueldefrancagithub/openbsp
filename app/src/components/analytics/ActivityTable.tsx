"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Columns3, Download } from "lucide-react";
import { cn } from "@/lib/cn";
import { Module, EmptyRow, RiskBadge } from "./ui";
import {
  downloadCsv,
  formatNumber,
  formatPercent,
  toCsv,
} from "./lib";

export type DetailRow = {
  bucketStart: number;
  bucketLabel: string;
  category: string;
  country: string;
  sent: number;
  delivered: number;
  failed: number;
  deliveryRate: number;
  qualityRisk: "low" | "watch" | "high";
  retrySafety: string;
};

type ColumnId =
  | "bucketLabel"
  | "category"
  | "country"
  | "sent"
  | "delivered"
  | "failed"
  | "deliveryRate"
  | "qualityRisk"
  | "retrySafety";

const COLUMNS: { id: ColumnId; label: string; numeric?: boolean }[] = [
  { id: "bucketLabel", label: "Interval" },
  { id: "category", label: "Category" },
  { id: "country", label: "Country" },
  { id: "sent", label: "Sent", numeric: true },
  { id: "delivered", label: "Delivered", numeric: true },
  { id: "failed", label: "Failed", numeric: true },
  { id: "deliveryRate", label: "Delivery rate", numeric: true },
  { id: "qualityRisk", label: "Quality" },
  { id: "retrySafety", label: "Retry" },
];

const DEFAULT_HIDDEN: ColumnId[] = ["retrySafety"];
const PAGE_SIZE = 25;

export function ActivityTable({ rows }: { rows: DetailRow[] }) {
  const [hidden, setHidden] = useState<ColumnId[]>(DEFAULT_HIDDEN);
  const [page, setPage] = useState(0);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const chooserRef = useRef<HTMLDivElement>(null);

  const visible = COLUMNS.filter((column) => !hidden.includes(column.id));
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const slice = rows.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  useEffect(() => setPage(0), [rows.length]);

  useEffect(() => {
    if (!chooserOpen) return;
    function onClick(event: MouseEvent) {
      if (!chooserRef.current?.contains(event.target as Node)) {
        setChooserOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [chooserOpen]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 2600);
    return () => clearTimeout(timer);
  }, [notice]);

  function cell(row: DetailRow, id: ColumnId) {
    const hasTraffic = row.sent > 0;
    switch (id) {
      case "bucketLabel":
        return row.bucketLabel;
      case "category":
        return <span className="capitalize">{row.category}</span>;
      case "country":
        return row.country;
      case "sent":
        return formatNumber(row.sent);
      case "delivered":
        return formatNumber(row.delivered);
      case "failed":
        return formatNumber(row.failed);
      case "deliveryRate":
        return formatPercent(row.deliveryRate, hasTraffic);
      case "qualityRisk":
        return <RiskBadge risk={row.qualityRisk} hasTraffic={hasTraffic} />;
      case "retrySafety":
        return <span className="capitalize text-slate-500">{row.retrySafety}</span>;
    }
  }

  function exportCsv() {
    const csv = toCsv(
      visible.map((column) => column.label),
      rows.map((row) =>
        visible.map((column) => {
          switch (column.id) {
            case "deliveryRate":
              return row.sent > 0 ? row.deliveryRate.toFixed(4) : "";
            case "qualityRisk":
              return row.sent > 0 ? row.qualityRisk : "";
            default:
              return String(row[column.id as keyof DetailRow] ?? "");
          }
        }),
      ),
    );
    downloadCsv(`openbsp-analytics-${rows.length}-rows.csv`, csv);
    setNotice(`Downloaded ${rows.length} rows`);
  }

  return (
    <Module
      title="Activity"
      hint={`${formatNumber(rows.length)} intervals`}
      action={
        <div className="flex items-center gap-1.5">
          {notice && (
            <span role="status" className="text-[11px] text-emerald-700">
              {notice}
            </span>
          )}
          <div className="relative" ref={chooserRef}>
            <button
              type="button"
              onClick={() => setChooserOpen((open) => !open)}
              aria-expanded={chooserOpen}
              aria-haspopup="true"
              className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-slate-200 px-2 text-[12px] font-medium text-slate-600 outline-none hover:border-slate-300 focus-visible:ring-2 focus-visible:ring-[#3d52d5]"
            >
              <Columns3 size={13} />
              Columns
            </button>
            {chooserOpen && (
              <div className="absolute right-0 z-20 mt-1 w-48 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                {COLUMNS.map((column) => (
                  <label
                    key={column.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[12px] text-slate-600 hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={!hidden.includes(column.id)}
                      onChange={() =>
                        setHidden((list) =>
                          list.includes(column.id)
                            ? list.filter((id) => id !== column.id)
                            : [...list, column.id],
                        )
                      }
                      className="h-3.5 w-3.5 accent-[#0a152d]"
                    />
                    {column.label}
                  </label>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={exportCsv}
            disabled={rows.length === 0}
            className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-slate-200 px-2 text-[12px] font-medium text-slate-600 outline-none hover:border-slate-300 disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-[#3d52d5]"
          >
            <Download size={13} />
            Export CSV
          </button>
        </div>
      }
    >
      {rows.length === 0 ? (
        <EmptyRow />
      ) : (
        <>
          {/* The table is the one thing allowed to scroll sideways, and it
              does so inside its own container so the document never does. */}
          <div className="min-w-0 overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] uppercase tracking-[0.08em] text-slate-400">
                  {visible.map((column) => (
                    <th
                      key={column.id}
                      scope="col"
                      className={cn(
                        "whitespace-nowrap px-4 py-2 font-medium",
                        column.numeric && "text-right",
                      )}
                    >
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {slice.map((row) => (
                  <tr key={rowKey(row)} className="hover:bg-slate-50/60">
                    {visible.map((column) => (
                      <td
                        key={column.id}
                        className={cn(
                          "whitespace-nowrap px-4 py-2.5 text-[#0a1b33]",
                          column.numeric && "text-right tabular-nums",
                        )}
                      >
                        {cell(row, column.id)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex min-w-0 items-center gap-3 border-t border-slate-100 px-4 py-2">
            <span className="truncate text-[11px] text-slate-400">
              {current * PAGE_SIZE + 1}–
              {Math.min((current + 1) * PAGE_SIZE, rows.length)} of{" "}
              {formatNumber(rows.length)}
            </span>
            <div className="ml-auto flex shrink-0 items-center gap-1">
              <PageButton
                label="Previous"
                disabled={current === 0}
                onClick={() => setPage(current - 1)}
              />
              <span className="px-1 text-[11px] tabular-nums text-slate-500">
                {current + 1} / {pageCount}
              </span>
              <PageButton
                label="Next"
                disabled={current >= pageCount - 1}
                onClick={() => setPage(current + 1)}
              />
            </div>
          </div>
        </>
      )}
    </Module>
  );
}

/** The query returns no id, so identity is the bucket plus its dimensions. */
function rowKey(row: DetailRow) {
  return `${row.bucketStart}:${row.category}:${row.country}`;
}

function PageButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-7 rounded-lg border border-slate-200 px-2 text-[12px] font-medium text-slate-600 outline-none hover:border-slate-300 disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-[#3d52d5]"
    >
      {label}
    </button>
  );
}
