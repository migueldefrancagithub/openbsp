"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import {
  AlertTriangle,
  BarChart3,
  Calendar,
  CheckCircle2,
  CircleDollarSign,
  Download,
  MessageCircle,
  RefreshCcw,
  Search,
  ShieldAlert,
  Table2,
  Users,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/app/EmptyState";
import { api } from "../../../../convex/_generated/api";

type RangeKey = "today" | "7d" | "30d";
type Granularity = "hour" | "day";
type Risk = "low" | "watch" | "high";
type Category = "marketing" | "utility" | "authentication" | "service";

type ReportRow = {
  bucketStart: number;
  bucketLabel: string;
  sent: number;
  delivered: number;
  failed: number;
  deliveryRate: number;
  costMinor: number;
  costCurrency: string;
  category: Category;
  country: string;
  retrySafety: "safe" | "review" | "unsafe";
  qualityRisk: Risk;
};

type SeriesRow = {
  bucketStart: number;
  bucketLabel: string;
  sent: number;
  delivered: number;
  failed: number;
  costMinor: number;
  costCurrency: string;
};

const REPORT_NAV = [
  { label: "Analytics Report", icon: BarChart3, active: true },
  { label: "Staff Conversation Reports", icon: Users, active: false },
  { label: "Contact Reports", icon: MessageCircle, active: false },
] as const;

const RANGE_LABELS: Record<RangeKey, string> = {
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
};

const CATEGORY_STYLES: Record<Category, string> = {
  marketing: "bg-red-50 text-red-700 border-red-100",
  utility: "bg-blue-50 text-blue-700 border-blue-100",
  authentication: "bg-amber-50 text-amber-700 border-amber-100",
  service: "bg-emerald-50 text-emerald-700 border-emerald-100",
};

const RISK_STYLES: Record<Risk, string> = {
  low: "bg-emerald-50 text-emerald-700 border-emerald-100",
  watch: "bg-amber-50 text-amber-700 border-amber-100",
  high: "bg-red-50 text-red-700 border-red-100",
};

export default function AnalyticsPage() {
  const [range, setRange] = useState<RangeKey>("today");
  const [granularity, setGranularity] = useState<Granularity>("hour");
  const [search, setSearch] = useState("");
  const [snapshotAt, setSnapshotAt] = useState(() => Date.now());

  const windowArgs = useMemo(
    () => dateWindow(range, snapshotAt),
    [range, snapshotAt],
  );
  const report = useQuery(api.analytics.reports, {
    ...windowArgs,
    granularity,
  });

  const details = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (report?.details ?? []).filter((row) => {
      if (!term) return true;
      return (
        row.bucketLabel.toLowerCase().includes(term) ||
        row.category.toLowerCase().includes(term) ||
        row.country.toLowerCase().includes(term)
      );
    });
  }, [report?.details, search]);

  if (!report) {
    return (
      <>
        <PageHeader
          eyebrow="Meta"
          title="Analytics Reports"
          description="Messaging, pricing, country, and category reporting."
        />
        <div className="p-8">
          <div className="h-64 rounded-2xl border border-slate-200 bg-white animate-pulse" />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Meta"
        title="Analytics Reports"
        description="Messaging, pricing, country, and category reporting."
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <SelectControl
              icon={Calendar}
              value={range}
              onChange={(value) => setRange(value as RangeKey)}
              options={[
                { value: "today", label: RANGE_LABELS.today },
                { value: "7d", label: RANGE_LABELS["7d"] },
                { value: "30d", label: RANGE_LABELS["30d"] },
              ]}
            />
            <SelectControl
              icon={BarChart3}
              value={granularity}
              onChange={(value) => setGranularity(value as Granularity)}
              options={[
                { value: "hour", label: "Hourly" },
                { value: "day", label: "Daily" },
              ]}
            />
            <button
              type="button"
              onClick={() => setSnapshotAt(Date.now())}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-[#0a1b33] hover:border-slate-300"
            >
              <RefreshCcw size={15} />
              Refresh
            </button>
          </div>
        }
      />

      <div className="grid min-h-[calc(100vh-89px)] bg-[#f6f8fb] lg:grid-cols-[260px_1fr]">
        <aside className="border-b border-slate-200 bg-white p-4 lg:border-b-0 lg:border-r">
          <div className="space-y-6">
            <ReportSection title="Meta" items={[REPORT_NAV[0]]} />
            <ReportSection title="Teams" items={[REPORT_NAV[1]]} />
            <ReportSection title="Contacts" items={[REPORT_NAV[2]]} />
          </div>
        </aside>

        <main className="min-w-0 space-y-5 p-5 lg:p-8">
          <section className="grid gap-4 xl:grid-cols-4">
            <MetricCard
              icon={MessageCircle}
              label="Messages Sent"
              value={formatNumber(report.summary.sent)}
              note="Total sent"
            />
            <MetricCard
              icon={CheckCircle2}
              label="Messages Delivered"
              value={formatNumber(report.summary.delivered)}
              note={`${formatPercent(report.summary.deliveryRate)} delivery rate`}
              accent="emerald"
            />
            <MetricCard
              icon={XCircle}
              label="Messages Failed"
              value={formatNumber(report.summary.failed)}
              note={`${formatPercent(report.summary.failureRate)} failure rate`}
              accent={report.health.failureRisk === "high" ? "red" : "amber"}
            />
            <MetricCard
              icon={CircleDollarSign}
              label="Total Cost"
              value={formatMoney(
                report.summary.totalCostMinor,
                report.summary.costCurrency,
              )}
              note={`${formatMoney(
                report.summary.costPerDeliveredMinor,
                report.summary.costCurrency,
              )} per delivered`}
              accent="orange"
            />
          </section>

          <section className="grid gap-5 xl:grid-cols-[1fr_280px]">
            <div className="rounded-2xl border border-slate-200 bg-white">
              <PanelHeader
                title="Messaging Analytics"
                subtitle="Sent vs delivered vs failed over time"
              />
              <LineChart rows={report.series} />
            </div>

            <aside className="grid gap-4 sm:grid-cols-3 xl:grid-cols-1">
              <HealthCard
                icon={CheckCircle2}
                label="Delivery Rate"
                value={formatPercent(report.summary.deliveryRate)}
                risk={report.health.deliveryRisk}
              />
              <HealthCard
                icon={CircleDollarSign}
                label="Cost per Message"
                value={formatMoney(
                  report.summary.costPerDeliveredMinor,
                  report.summary.costCurrency,
                )}
                risk={report.health.spendRisk}
              />
              <HealthCard
                icon={ShieldAlert}
                label="Failed Messages"
                value={formatNumber(report.summary.failed)}
                risk={report.health.failureRisk}
              />
            </aside>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white">
            <PanelHeader
              title="Detailed Analytics"
              subtitle="Interval totals by category and country"
              action={
                <button
                  type="button"
                  onClick={() => copyRows(details)}
                  className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-[#0a1b33] hover:border-slate-300"
                >
                  <Download size={15} />
                  Export CSV
                </button>
              }
            />
            <div className="border-b border-slate-100 px-5 pb-5">
              <label className="relative block max-w-2xl">
                <Search
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by date, category or country..."
                  className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-3 text-sm text-[#0a1b33] outline-none placeholder:text-slate-400 focus:border-slate-400"
                />
              </label>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-xs uppercase text-slate-400">
                    <th className="px-5 py-3 font-semibold">Date</th>
                    <th className="px-5 py-3 font-semibold">Sent</th>
                    <th className="px-5 py-3 font-semibold">Delivered</th>
                    <th className="px-5 py-3 font-semibold">Delivery Rate</th>
                    <th className="px-5 py-3 font-semibold">Cost</th>
                    <th className="px-5 py-3 font-semibold">Category</th>
                    <th className="px-5 py-3 font-semibold">Country</th>
                    <th className="px-5 py-3 font-semibold">Risk</th>
                    <th className="px-5 py-3 font-semibold">Retry</th>
                  </tr>
                </thead>
                <tbody>
                  {details.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-5 py-10 text-center text-slate-400">
                        No analytics rows match this filter.
                      </td>
                    </tr>
                  ) : (
                    details.map((row) => (
                      <tr
                        key={`${row.bucketStart}-${row.category}-${row.country}`}
                        className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50"
                      >
                        <td className="px-5 py-4 font-semibold text-[#0a1b33]">
                          {row.bucketLabel}
                        </td>
                        <td className="px-5 py-4 text-[#0a1b33]">{row.sent}</td>
                        <td className="px-5 py-4 text-[#0a1b33]">
                          {row.delivered}
                        </td>
                        <td className="px-5 py-4">
                          <span className="inline-flex items-center gap-2 font-semibold text-[#0a1b33]">
                            {formatPercent(row.deliveryRate)}
                            {row.deliveryRate >= 0.9 ? (
                              <CheckCircle2 size={14} className="text-emerald-500" />
                            ) : row.deliveryRate >= 0.75 ? (
                              <AlertTriangle size={14} className="text-amber-500" />
                            ) : (
                              <XCircle size={14} className="text-red-500" />
                            )}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-[#0a1b33]">
                          {formatMoney(row.costMinor, row.costCurrency)}
                        </td>
                        <td className="px-5 py-4">
                          <span
                            className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${CATEGORY_STYLES[row.category]}`}
                          >
                            {row.category.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-5 py-4 font-semibold text-[#0a1b33]">
                          {row.country}
                        </td>
                        <td className="px-5 py-4">
                          <RiskPill risk={row.qualityRisk} />
                        </td>
                        <td className="px-5 py-4">
                          <span className="text-xs font-semibold capitalize text-slate-600">
                            {row.retrySafety}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="grid gap-5 xl:grid-cols-2">
            <BreakdownPanel
              title="Category Breakdown"
              rows={report.categoryBreakdown.map((row) => ({
                label: row.category,
                sent: row.sent,
                delivered: row.delivered,
                failed: row.failed,
                deliveryRate: row.deliveryRate,
                costMinor: row.costMinor,
                costCurrency: row.costCurrency,
              }))}
            />
            <BreakdownPanel
              title="Country Breakdown"
              rows={report.countryBreakdown.map((row) => ({
                label: row.key,
                sent: row.sent,
                delivered: row.delivered,
                failed: row.failed,
                deliveryRate: row.deliveryRate,
                costMinor: row.costMinor,
                costCurrency: row.costCurrency,
              }))}
            />
          </section>
        </main>
      </div>
    </>
  );
}

function ReportSection({
  title,
  items,
}: {
  title: string;
  items: typeof REPORT_NAV[number][];
}) {
  return (
    <div>
      <p className="px-2 text-xs font-semibold uppercase text-slate-500">
        {title}
      </p>
      <div className="mt-2 space-y-1">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.label}
              type="button"
              disabled={!item.active}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-semibold transition-colors ${
                item.active
                  ? "bg-violet-50 text-violet-700"
                  : "text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
              }`}
            >
              <Icon size={17} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PanelHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="font-[var(--font-outfit)] text-xl font-semibold text-[#0a1b33]">
          {title}
        </h2>
        <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  note,
  accent = "blue",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  note: string;
  accent?: "blue" | "emerald" | "amber" | "red" | "orange";
}) {
  const accentClass = {
    blue: "text-blue-500 bg-blue-50",
    emerald: "text-emerald-600 bg-emerald-50",
    amber: "text-amber-600 bg-amber-50",
    red: "text-red-600 bg-red-50",
    orange: "text-orange-500 bg-orange-50",
  }[accent];
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-[#0a1b33]">{label}</p>
          <p className="mt-4 font-[var(--font-outfit)] text-3xl font-semibold text-[#0a1b33]">
            {value}
          </p>
          <p className="mt-3 text-sm text-slate-500">{note}</p>
        </div>
        <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${accentClass}`}>
          <Icon size={20} />
        </span>
      </div>
    </div>
  );
}

function HealthCard({
  icon: Icon,
  label,
  value,
  risk,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  risk: Risk;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-slate-500">{label}</p>
          <p className="mt-2 font-[var(--font-outfit)] text-3xl font-semibold text-[#0a1b33]">
            {value}
          </p>
        </div>
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-[#0a1b33]">
          <Icon size={22} />
        </span>
      </div>
      <div className="mt-5">
        <RiskPill risk={risk} />
      </div>
    </div>
  );
}

function RiskPill({ risk }: { risk: Risk }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${RISK_STYLES[risk]}`}
    >
      {risk}
    </span>
  );
}

function SelectControl({
  icon: Icon,
  value,
  onChange,
  options,
}: {
  icon: LucideIcon;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="relative inline-flex h-10 items-center">
      <Icon
        size={15}
        className="pointer-events-none absolute left-3 text-slate-500"
      />
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 min-w-40 rounded-lg border border-slate-200 bg-white pl-9 pr-8 text-sm font-semibold text-[#0a1b33] outline-none focus:border-slate-400"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function LineChart({ rows }: { rows: SeriesRow[] }) {
  const chartRows = rows.length > 0 ? rows : [];
  const maxValue = Math.max(
    1,
    ...chartRows.flatMap((row) => [row.sent, row.delivered, row.failed]),
  );
  const width = 760;
  const height = 260;
  const padding = 34;
  const sentPath = polyline(chartRows, width, height, padding, maxValue, "sent");
  const deliveredPath = polyline(
    chartRows,
    width,
    height,
    padding,
    maxValue,
    "delivered",
  );
  const failedPath = polyline(chartRows, width, height, padding, maxValue, "failed");

  return (
    <div className="px-5 py-6">
      <div className="mb-4 flex flex-wrap justify-center gap-4 text-xs font-semibold text-slate-600">
        <Legend color="#3b82f6" label="Messages Sent" />
        <Legend color="#10b981" label="Messages Delivered" />
        <Legend color="#ef4444" label="Messages Failed" />
      </div>
      <div className="overflow-x-auto">
        <svg
          role="img"
          aria-label="Messaging analytics line chart"
          viewBox={`0 0 ${width} ${height}`}
          className="h-[280px] min-w-[760px] w-full"
        >
          {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
            const y = padding + (height - padding * 2) * tick;
            return (
              <g key={tick}>
                <line
                  x1={padding}
                  x2={width - padding}
                  y1={y}
                  y2={y}
                  stroke="#e2e8f0"
                  strokeDasharray="4 6"
                />
                <text
                  x={padding - 10}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-slate-400 text-[11px]"
                >
                  {Math.round(maxValue * (1 - tick))}
                </text>
              </g>
            );
          })}
          <path d={sentPath} fill="none" stroke="#3b82f6" strokeWidth="3" />
          <path d={deliveredPath} fill="none" stroke="#10b981" strokeWidth="3" />
          <path d={failedPath} fill="none" stroke="#ef4444" strokeWidth="3" />
          {chartRows.map((row, index) => {
            const x = pointX(index, chartRows.length, width, padding);
            return (
              <text
                key={`${row.bucketStart}-label`}
                x={x}
                y={height - 8}
                textAnchor="middle"
                className="fill-slate-400 text-[10px]"
              >
                {row.bucketLabel}
              </text>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}

function BreakdownPanel({
  title,
  rows,
}: {
  title: string;
  rows: Array<{
    label: string;
    sent: number;
    delivered: number;
    failed: number;
    deliveryRate: number;
    costMinor: number;
    costCurrency: string;
  }>;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white">
      <PanelHeader title={title} subtitle="Delivery and spend concentration" />
      <div className="divide-y divide-slate-100">
        {rows.length === 0 ? (
          <div className="px-5 py-8 text-sm text-slate-400">
            No report data in this window.
          </div>
        ) : (
          rows.map((row) => (
            <div key={row.label} className="px-5 py-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-semibold text-[#0a1b33]">{row.label}</p>
                  <p className="mt-1 text-sm text-slate-500">
                    {row.sent} sent · {row.delivered} delivered · {row.failed} failed
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-[#0a1b33]">
                    {formatPercent(row.deliveryRate)}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    {formatMoney(row.costMinor, row.costCurrency)}
                  </p>
                </div>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-[#10b981]"
                  style={{ width: `${Math.min(100, row.deliveryRate * 100)}%` }}
                />
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function dateWindow(range: RangeKey, now: number) {
  const end = now;
  if (range === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { dateFrom: start.getTime(), dateTo: end };
  }
  const days = range === "7d" ? 7 : 30;
  return { dateFrom: end - days * 24 * 60 * 60 * 1000, dateTo: end };
}

function pointX(index: number, total: number, width: number, padding: number) {
  if (total <= 1) return padding;
  return padding + (index / (total - 1)) * (width - padding * 2);
}

function pointY(value: number, height: number, padding: number, maxValue: number) {
  return height - padding - (value / maxValue) * (height - padding * 2);
}

function polyline(
  rows: SeriesRow[],
  width: number,
  height: number,
  padding: number,
  maxValue: number,
  key: "sent" | "delivered" | "failed",
) {
  if (rows.length === 0) return "";
  return rows
    .map((row, index) => {
      const x = pointX(index, rows.length, width, padding);
      const y = pointY(row[key], height, padding, maxValue);
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(value >= 1 || value === 0 ? 1 : 1)}%`;
}

function formatMoney(valueMinor: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: valueMinor === 0 ? 2 : 4,
    maximumFractionDigits: 4,
  }).format(valueMinor / 100);
}

async function copyRows(rows: ReportRow[]) {
  const csv = [
    [
      "date",
      "sent",
      "delivered",
      "failed",
      "delivery_rate",
      "cost_minor",
      "category",
      "country",
      "quality_risk",
      "retry_safety",
    ],
    ...rows.map((row) => [
      row.bucketLabel,
      row.sent,
      row.delivered,
      row.failed,
      row.deliveryRate,
      row.costMinor,
      row.category,
      row.country,
      row.qualityRisk,
      row.retrySafety,
    ]),
  ]
    .map((line) => line.map(escapeCsv).join(","))
    .join("\n");
  await navigator.clipboard.writeText(csv);
}

function escapeCsv(value: string | number) {
  const text = String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replaceAll("\"", "\"\"")}"`;
}
