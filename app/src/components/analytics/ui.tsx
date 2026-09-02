"use client";

import { useRef, type ReactNode } from "react";
import { MessageSquarePlus } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import { NO_DATA, TABS, tabLabel, type TabId } from "./lib";

/**
 * A single surface. Modules never nest — a module inside a module was the main
 * source of the doubled borders in the previous layout.
 */
export function Module({
  title,
  hint,
  action,
  children,
  className,
}: {
  title?: string;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "min-w-0 rounded-lg border border-slate-200/80 bg-white",
        className,
      )}
    >
      {(title || action) && (
        <header className="flex min-w-0 items-center gap-3 border-b border-slate-100 px-4 py-2.5">
          <div className="min-w-0">
            {title && (
              <h2 className="truncate font-[var(--font-display)] text-[13px] font-medium text-[#0a1b33]">
                {title}
              </h2>
            )}
            {hint && (
              <p className="truncate text-[11px] text-slate-400">{hint}</p>
            )}
          </div>
          {action && <div className="ml-auto shrink-0">{action}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

/**
 * Health verdict. Renders nothing but an em dash when there is no traffic:
 * a delivery rate of 0% out of 0 messages is not a "high" risk, it is an
 * absence of evidence.
 */
export function RiskBadge({
  risk,
  hasTraffic,
}: {
  risk: "low" | "watch" | "high";
  hasTraffic: boolean;
}) {
  const { tr } = useI18n();
  if (!hasTraffic) {
    return (
      <span className="text-[11px] font-medium text-slate-400">
        {tr("Sem dados", "No data")}
      </span>
    );
  }
  const tone =
    risk === "low"
      ? "text-emerald-700"
      : risk === "watch"
        ? "text-amber-700"
        : "text-red-700";
  const dot =
    risk === "low"
      ? "bg-emerald-500"
      : risk === "watch"
        ? "bg-amber-500"
        : "bg-red-500";
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[11px] font-medium", tone)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />
      {risk === "low"
        ? tr("Saudável", "Healthy")
        : risk === "watch"
          ? tr("Atenção", "Watch")
          : tr("Em risco", "At risk")}
    </span>
  );
}

/**
 * One unified band rather than four bordered cards, so the KPIs read as a
 * single row of facts with one border instead of four.
 */
export function KpiStrip({
  items,
}: {
  items: { label: string; value: string; foot?: ReactNode }[];
}) {
  return (
    <div className="grid min-w-0 grid-cols-2 overflow-hidden rounded-lg border border-slate-200/80 bg-white @2xl:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="min-w-0 border-b border-r border-slate-100 px-4 py-3 last:border-r-0 @2xl:border-b-0">
          <div className="truncate text-[11px] font-medium uppercase tracking-[0.1em] text-slate-400">
            {item.label}
          </div>
          <div className="mt-1 truncate font-[var(--font-display)] text-[22px] font-medium leading-none tracking-tight text-[#0a1b33] tabular-nums">
            {item.value}
          </div>
          {item.foot && <div className="mt-1.5 truncate">{item.foot}</div>}
        </div>
      ))}
    </div>
  );
}

export function Tabs({
  active,
  onChange,
}: {
  active: TabId;
  onChange: (tab: TabId) => void;
}) {
  const { locale, tr } = useI18n();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  function onKeyDown(event: React.KeyboardEvent) {
    const index = TABS.findIndex((t) => t.id === active);
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % TABS.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = TABS.length - 1;
    else return;
    event.preventDefault();
    const id = TABS[next].id;
    onChange(id);
    refs.current[id]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label={tr("Secções de análise", "Analytics sections")}
      onKeyDown={onKeyDown}
      className="grid min-w-0 grid-cols-2 gap-1 border-b border-slate-200 px-4 sm:grid-cols-4 sm:px-6"
    >
      {TABS.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            ref={(node) => {
              refs.current[tab.id] = node;
            }}
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`panel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={cn(
              "-mb-px min-w-0 border-b-2 px-2 py-2 text-[13px] font-medium transition-colors outline-none",
              "focus-visible:ring-2 focus-visible:ring-[#3d52d5] focus-visible:ring-offset-1",
              selected
                ? "border-[#0a1b33] text-[#0a1b33]"
                : "border-transparent text-slate-500 hover:text-slate-700",
            )}
          >
            <span className="block truncate">{tabLabel(tab.id, locale)}</span>
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({
  id,
  active,
  children,
}: {
  id: TabId;
  active: TabId;
  children: ReactNode;
}) {
  if (id !== active) return null;
  return (
    <div
      role="tabpanel"
      id={`panel-${id}`}
      aria-labelledby={`tab-${id}`}
      tabIndex={0}
      className="min-w-0 outline-none"
    >
      {children}
    </div>
  );
}

/** Replaces the entire dashboard. Showing an empty dashboard teaches nothing. */
export function AnalyticsEmptyState() {
  const { tr } = useI18n();
  return (
    <div className="flex min-h-[60vh] min-w-0 flex-col items-center justify-center px-6 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 bg-white">
        <MessageSquarePlus size={19} className="text-[#0a1b33]" />
      </div>
      <h2 className="mt-4 font-[var(--font-display)] text-[19px] font-medium tracking-tight text-[#0a1b33]">
        {tr("Ainda não há dados de atendimento", "No messaging data yet")}
      </h2>
      <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-slate-500">
        {tr(
          "Os indicadores aparecem quando um canal ligado começa a enviar e receber mensagens. Nenhum valor é estimado ou simulado.",
          "Analytics fill in once a connected channel starts sending and receiving. Nothing here is estimated or sampled.",
        )}
      </p>
      <Link
        href="/app/settings"
        className="mt-5 inline-flex h-9 items-center rounded-lg bg-[#0a152d] px-4 text-[13px] font-medium text-white outline-none hover:bg-[#132145] focus-visible:ring-2 focus-visible:ring-[#3d52d5] focus-visible:ring-offset-2"
      >
        {tr("Ligar canal WhatsApp", "Connect WhatsApp channel")}
      </Link>
    </div>
  );
}

export function EmptyRow({ label }: { label?: string }) {
  const { tr } = useI18n();
  return (
    <div className="px-4 py-10 text-center text-[13px] text-slate-400">
      {label ?? tr("Sem dados neste período", "No data for this period")}
    </div>
  );
}

export function StatLine({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "muted";
}) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3 px-4 py-2">
      <span className="truncate text-[13px] text-slate-500">{label}</span>
      <span
        className={cn(
          "shrink-0 text-[13px] font-medium tabular-nums",
          tone === "muted" || value === NO_DATA
            ? "text-slate-400"
            : "text-[#0a1b33]",
        )}
      >
        {value}
      </span>
    </div>
  );
}
