"use client";

import { useMemo } from "react";
import { EmptyRow } from "./ui";
import { formatNumber } from "./lib";
import { useI18n } from "@/lib/i18n";

export type SeriesPoint = {
  bucketStart: number;
  bucketLabel: string;
  sent: number;
  delivered: number;
  failed: number;
};

type Line = { key: "sent" | "delivered" | "failed"; color: string };

const LINES: Line[] = [
  { key: "sent", color: "#3d52d5" },
  { key: "delivered", color: "#0f9d7a" },
  { key: "failed", color: "#d1495b" },
];

// Internal coordinate space. The SVG stretches to its container with
// preserveAspectRatio="none", and strokes are kept honest with
// vector-effect="non-scaling-stroke". Labels are HTML, not SVG text, so they
// never distort — which is what let the old chart get away with a 760px floor.
const VW = 1000;
const VH = 260;

export function TrendChart({
  series,
  only,
}: {
  series: SeriesPoint[];
  /** Restrict to one metric, e.g. on the Delivery tab. */
  only?: Line["key"][];
}) {
  const { locale, tr } = useI18n();
  const lines = only ? LINES.filter((l) => only.includes(l.key)) : LINES;

  const { paths, max, labels } = useMemo(() => {
    const peak = Math.max(
      1,
      ...series.flatMap((row) => lines.map((line) => row[line.key])),
    );
    const step = series.length > 1 ? VW / (series.length - 1) : 0;
    const toY = (value: number) => VH - (value / peak) * VH;

    const built = lines.map((line) => ({
      ...line,
      d: series
        .map((row, index) => {
          const x = series.length === 1 ? VW / 2 : index * step;
          return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${toY(row[line.key]).toFixed(2)}`;
        })
        .join(" "),
    }));

    // At most six x labels, so a narrow container never crowds them.
    const stride = Math.max(1, Math.ceil(series.length / 6));
    return {
      paths: built,
      max: peak,
      labels: series.filter((_, index) => index % stride === 0),
    };
  }, [series, lines]);

  if (series.length === 0) return <EmptyRow />;

  return (
    <div className="min-w-0 px-4 pb-3 pt-4">
      <div className="flex min-w-0 gap-3">
        <div className="flex w-10 shrink-0 flex-col justify-between py-0.5 text-right text-[10px] tabular-nums text-slate-400">
          <span>{formatNumber(max, locale)}</span>
          <span>{formatNumber(Math.round(max / 2), locale)}</span>
          <span>0</span>
        </div>

        <div className="relative min-w-0 flex-1">
          <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
            <span className="border-t border-slate-100" />
            <span className="border-t border-slate-100" />
            <span className="border-t border-slate-100" />
          </div>
          <svg
            viewBox={`0 0 ${VW} ${VH}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={`${tr("Tendência de mensagens", "Messaging trend")}: ${lines.map((line) => lineLabel(line.key, locale)).join(", ")}`}
            className="block h-[180px] w-full @lg:h-[220px]"
          >
            {paths.map((line) => (
              <path
                key={line.key}
                d={line.d}
                fill="none"
                stroke={line.color}
                strokeWidth={1.75}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
        </div>
      </div>

      <div className="mt-2 flex min-w-0 gap-3">
        <span className="w-10 shrink-0" />
        <div className="flex min-w-0 flex-1 justify-between gap-2 overflow-hidden">
          {labels.map((row) => (
            <span
              key={row.bucketStart}
              className="truncate text-[10px] text-slate-400"
            >
              {row.bucketLabel}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 pt-2.5">
        {lines.map((line) => (
          <span
            key={line.key}
            className="inline-flex items-center gap-1.5 text-[11px] text-slate-500"
          >
            <span
              className="h-0.5 w-3 rounded-full"
              style={{ background: line.color }}
            />
            {lineLabel(line.key, locale)}
          </span>
        ))}
      </div>
    </div>
  );
}

function lineLabel(key: Line["key"], locale: "pt" | "en") {
  const labels: Record<Line["key"], [string, string]> = {
    sent: ["Enviadas", "Sent"],
    delivered: ["Entregues", "Delivered"],
    failed: ["Falharam", "Failed"],
  };
  return labels[key][locale === "pt" ? 0 : 1];
}
