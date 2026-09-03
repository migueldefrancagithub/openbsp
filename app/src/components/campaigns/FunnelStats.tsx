"use client";

import { useI18n } from "@/lib/i18n";
import { percent } from "./campaignLabels";

export type Rates = {
  attempted: number;
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  clicked: number;
  converted: number;
  failed: number;
  skipped: number;
  unknown: number;
  pending: number;
  deliveryRate: number;
  readRate: number;
  replyRate: number;
  clickRate: number;
  conversionRate: number;
  failureRate: number;
};

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "teal" | "blue" | "coral" | "amber" }) {
  const color =
    tone === "teal" ? "text-[#0d6b61]" : tone === "blue" ? "text-[#2b4f8a]" : tone === "coral" ? "text-[#b3261e]" : tone === "amber" ? "text-amber-700" : "text-[#0a1b33]";
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
      <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-400">{label}</div>
      <div className={`mt-1 font-[var(--font-outfit)] text-[20px] font-medium tracking-tight ${color}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

export function FunnelStats({ rates, compact = false }: { rates: Rates; compact?: boolean }) {
  const { tr } = useI18n();
  const items = [
    { label: tr("Enviadas", "Sent"), value: String(rates.sent), sub: rates.pending > 0 ? tr(`${rates.pending} na fila`, `${rates.pending} queued`) : undefined, tone: "blue" as const },
    { label: tr("Entregues", "Delivered"), value: percent(rates.deliveryRate), sub: String(rates.delivered), tone: "blue" as const },
    { label: tr("Lidas", "Read"), value: percent(rates.readRate), sub: String(rates.read) },
    { label: tr("Responderam", "Replied"), value: percent(rates.replyRate), sub: String(rates.replied), tone: "teal" as const },
    { label: tr("Cliques", "Clicks"), value: percent(rates.clickRate), sub: String(rates.clicked), tone: "teal" as const },
    { label: tr("Conversões", "Conversions"), value: String(rates.converted), sub: percent(rates.conversionRate), tone: "teal" as const },
    { label: tr("Falhas", "Failed"), value: String(rates.failed), sub: percent(rates.failureRate), tone: "coral" as const },
    { label: tr("Bloqueadas", "Blocked"), value: String(rates.skipped), sub: rates.unknown > 0 ? tr(`${rates.unknown} sem confirmação`, `${rates.unknown} unconfirmed`) : undefined, tone: "amber" as const },
  ];
  const visible = compact ? items.slice(0, 4) : items;
  return (
    <div className={`grid gap-2 ${compact ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-4 xl:grid-cols-8"}`}>
      {visible.map((item) => (
        <Stat key={item.label} {...item} />
      ))}
    </div>
  );
}
