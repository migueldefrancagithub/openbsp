"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { RefreshCcw } from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import { ActivityTable } from "@/components/analytics/ActivityTable";
import { TrendChart } from "@/components/analytics/TrendChart";
import {
  AnalyticsEmptyState,
  KpiStrip,
  Module,
  RiskBadge,
  StatLine,
  TabPanel,
  Tabs,
} from "@/components/analytics/ui";
import {
  dateWindow,
  formatNumber,
  formatPercent,
  formatUpdatedAt,
  rangeLabel,
  useAnalyticsParams,
  type Granularity,
  type RangeKey,
} from "@/components/analytics/lib";
import { useI18n } from "@/lib/i18n";
import { OperationRollups } from "@/components/analytics/OperationRollups";

export default function AnalyticsPage() {
  const { locale, tr } = useI18n();
  const { tab, range, granularity, setParam } = useAnalyticsParams();
  const [snapshotAt, setSnapshotAt] = useState(() => Date.now());

  const window = useMemo(() => dateWindow(range, snapshotAt), [range, snapshotAt]);
  const report = useQuery(api.analytics.reports, {
    dateFrom: window.dateFrom,
    dateTo: window.dateTo,
    granularity,
  });

  const loading = report === undefined;
  const summary = report?.summary;
  const hasTraffic = (summary?.totalMessages ?? 0) > 0;

  return (
    <div className="@container flex min-w-0 flex-col">
      <header className="min-w-0 border-b border-slate-200 bg-white px-4 pt-4 sm:px-6">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 pb-3">
          <div className="min-w-0">
            <h1 className="truncate font-[var(--font-display)] text-[19px] font-medium tracking-tight text-[#0a1b33]">
              {tr("Desempenho", "Analytics")}
            </h1>
            <p className="truncate text-[11px] text-slate-400">
              {loading
                ? tr("A carregar...", "Loading...")
                : `${rangeLabel(range, locale)} · ${tr("atualizado às", "updated at")} ${formatUpdatedAt(snapshotAt, locale)}`}
            </p>
          </div>

          <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1.5">
            <Select
              label={tr("Período", "Period")}
              value={range}
              onChange={(value) => setParam("range", value)}
              options={[
                { value: "today", label: rangeLabel("today", locale) },
                { value: "7d", label: rangeLabel("7d", locale) },
                { value: "30d", label: rangeLabel("30d", locale) },
              ]}
            />
            <Select
              label={tr("Agrupamento", "Granularity")}
              value={granularity}
              onChange={(value) => setParam("granularity", value)}
              options={[
                { value: "hour", label: tr("Por hora", "Hourly") },
                { value: "day", label: tr("Por dia", "Daily") },
              ]}
            />
            <button
              type="button"
              onClick={() => setSnapshotAt(Date.now())}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[12px] font-medium text-[#0a1b33] outline-none hover:border-slate-300 focus-visible:ring-2 focus-visible:ring-[#3d52d5]"
            >
              <RefreshCcw size={13} />
              {tr("Atualizar", "Refresh")}
            </button>
          </div>
        </div>

        <Tabs active={tab} onChange={(next) => setParam("tab", next)} />
      </header>

      <div className="min-w-0 flex-1 bg-[#fafbfc] p-4 sm:p-6">
        {loading ? (
          <LoadingState />
        ) : !report ? (
          <ErrorState onRetry={() => setSnapshotAt(Date.now())} />
        ) : !hasTraffic ? (
          <AnalyticsEmptyState />
        ) : (
          <div className="mx-auto min-w-0 max-w-[1400px]">
            <TabPanel id="overview" active={tab}>
              <div className="flex min-w-0 flex-col gap-4">
                <KpiStrip
                  items={[
                    {
                      label: tr("Enviadas", "Sent"),
                      value: formatNumber(summary!.sent, locale),
                    },
                    {
                      label: tr("Entregues", "Delivered"),
                      value: formatNumber(summary!.delivered, locale),
                      foot: (
                        <RiskBadge
                          risk={report.health.deliveryRisk}
                          hasTraffic={summary!.sent > 0}
                        />
                      ),
                    },
                    {
                      label: tr("Taxa de entrega", "Delivery rate"),
                      value: formatPercent(
                        summary!.deliveryRate,
                        summary!.sent > 0,
                      ),
                    },
                    {
                      label: tr("Falharam", "Failed"),
                      value: formatNumber(summary!.failed, locale),
                    },
                  ]}
                />

                <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 @4xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                  <Module title={tr("Tendência de mensagens", "Messaging trend")} hint={rangeLabel(range, locale)}>
                    <TrendChart series={report.series} />
                  </Module>

                  <Module title={tr("Saúde do canal", "Channel health")}>
                    <div className="divide-y divide-slate-50">
                      <StatLine
                        label={tr("Falharam", "Failed")}
                        value={formatNumber(summary!.failed, locale)}
                      />
                      <StatLine
                        label={tr("Taxa de falha", "Failure rate")}
                        value={formatPercent(
                          summary!.failureRate,
                          summary!.sent > 0,
                        )}
                      />
                      <StatLine
                        label={tr("Estado", "Readiness")}
                        value={summary!.failed === 0 ? tr("Estável", "Stable") : tr("Precisa de revisão", "Needs review")}
                      />
                      <div className="flex items-center justify-between gap-3 px-4 py-2">
                        <span className="text-[13px] text-slate-500">
                          {tr("Saúde da entrega", "Delivery health")}
                        </span>
                        <RiskBadge
                          risk={report.health.deliveryRisk}
                          hasTraffic={summary!.sent > 0}
                        />
                      </div>
                    </div>
                  </Module>
                </div>
              </div>
            </TabPanel>

            <TabPanel id="delivery" active={tab}>
              <div className="flex min-w-0 flex-col gap-4">
                <KpiStrip
                  items={[
                    { label: tr("Enviadas", "Sent"), value: formatNumber(summary!.sent, locale) },
                    {
                      label: tr("Entregues", "Delivered"),
                      value: formatNumber(summary!.delivered, locale),
                    },
                    { label: tr("Falharam", "Failed"), value: formatNumber(summary!.failed, locale) },
                    {
                      label: tr("Taxa de falha", "Failure rate"),
                      value: formatPercent(
                        summary!.failureRate,
                        summary!.sent > 0,
                      ),
                    },
                  ]}
                />
                <Module title={tr("Entregues e falhadas", "Delivered vs failed")} hint={rangeLabel(range, locale)}>
                  <TrendChart
                    series={report.series}
                    only={["delivered", "failed"]}
                  />
                </Module>
              </div>
            </TabPanel>

            <TabPanel id="audience" active={tab}>
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 @3xl:grid-cols-2">
                <Breakdown
                  title={tr("Por país", "By country")}
                  rows={report.countryBreakdown.map((row) => ({
                    key: row.key,
                    label: row.key,
                    sent: row.sent,
                    value: formatPercent(row.deliveryRate, row.sent > 0),
                  }))}
                />
                <Breakdown
                  title={tr("Por categoria", "By category")}
                  rows={report.categoryBreakdown.map((row) => ({
                    key: row.category,
                    label: localizeCategory(row.category, locale),
                    sent: row.sent,
                    value: formatPercent(row.deliveryRate, row.sent > 0),
                  }))}
                />
              </div>
            </TabPanel>

            <TabPanel id="activity" active={tab}>
              <ActivityTable rows={report.details} />
            </TabPanel>

            <TabPanel id="operation" active={tab}>
              <OperationRollups days={range === "today" ? 7 : range === "7d" ? 7 : 30} />
            </TabPanel>
          </div>
        )}
      </div>
    </div>
  );
}

function Breakdown({
  title,
  rows,
}: {
  title: string;
  rows: { key: string; label: string; sent: number; value: string }[];
}) {
  const { locale } = useI18n();
  const peak = Math.max(1, ...rows.map((row) => row.sent));
  return (
    <Module title={title}>
      {rows.length === 0 ? (
        <div className="px-4 py-10 text-center text-[13px] text-slate-400">
          {locale === "pt" ? "Sem dados neste período" : "No data for this period"}
        </div>
      ) : (
        <div className="divide-y divide-slate-50">
          {rows.map((row) => (
            <div key={row.key} className="min-w-0 px-4 py-2.5">
              <div className="flex min-w-0 items-baseline justify-between gap-3">
                <span className="truncate text-[13px] capitalize text-[#0a1b33]">
                  {row.label}
                </span>
                <span className="shrink-0 text-[13px] font-medium tabular-nums text-slate-600">
                  {row.value}
                </span>
              </div>
              <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-[#3d52d5]"
                  style={{ width: `${Math.round((row.sent / peak) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </Module>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="min-w-0">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 max-w-[9.5rem] truncate rounded-lg border border-slate-200 bg-white px-2 text-[12px] font-medium text-[#0a1b33] outline-none focus-visible:ring-2 focus-visible:ring-[#3d52d5]"
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

function LoadingState() {
  return (
    <div className="mx-auto flex min-w-0 max-w-[1400px] flex-col gap-4">
      <div className="h-[76px] animate-pulse rounded-lg border border-slate-200/80 bg-white" />
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 @4xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="h-[280px] animate-pulse rounded-lg border border-slate-200/80 bg-white" />
        <div className="h-[280px] animate-pulse rounded-lg border border-slate-200/80 bg-white" />
      </div>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  const { tr } = useI18n();
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center px-6 text-center">
      <h2 className="font-[var(--font-display)] text-[17px] font-medium text-[#0a1b33]">
        {tr("Não foi possível carregar os indicadores", "Analytics could not be loaded")}
      </h2>
      <p className="mt-1.5 max-w-sm text-sm text-slate-500">
        {tr("O pedido do relatório não terminou. Nenhum dado foi alterado.", "The report request did not complete. Nothing was changed.")}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-4 text-[13px] font-medium text-[#0a1b33] outline-none hover:border-slate-300 focus-visible:ring-2 focus-visible:ring-[#3d52d5]"
      >
        {tr("Tentar novamente", "Try again")}
      </button>
    </div>
  );
}

function localizeCategory(category: string, locale: "pt" | "en") {
  if (locale !== "pt") return category;
  const labels: Record<string, string> = {
    marketing: "marketing",
    utility: "utilidade",
    authentication: "autenticação",
    service: "atendimento",
  };
  return labels[category.toLowerCase()] ?? category;
}

export type { Granularity, RangeKey };
