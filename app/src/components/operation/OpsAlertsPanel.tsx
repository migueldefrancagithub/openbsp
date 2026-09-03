"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { AlertTriangle, BellRing, Check, ChevronRight, Loader2, ShieldAlert } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { cn } from "@/lib/cn";
import { convexErrorMessage } from "@/lib/convexErrorMessage";
import { useI18n } from "@/lib/i18n";
import { relativeTime } from "@/lib/relativeTime";

function kindLabel(kind: string, locale: "pt" | "en"): string {
  const pt: Record<string, string> = {
    "campaign.auto_paused": "Campanha pausada",
    "ai.provider_down": "IA sem resposta do provedor",
    "ai.budget_exceeded": "Orçamento diário de IA esgotado",
    "campaign.unknown_delivery": "Campanha sem confirmação",
    "outbox.unknown": "Envios sem confirmação",
    "sla.human_case": "SLA de caso humano",
    "retention.candidates": "Retenção de dados",
  };
  const en: Record<string, string> = {
    "campaign.auto_paused": "Campaign paused",
    "ai.provider_down": "AI provider not responding",
    "ai.budget_exceeded": "Daily AI budget exhausted",
    "campaign.unknown_delivery": "Campaign unconfirmed",
    "outbox.unknown": "Unconfirmed sends",
    "sla.human_case": "Human case SLA",
    "retention.candidates": "Data retention",
  };
  return (locale === "pt" ? pt : en)[kind] ?? kind;
}

export function OpsAlertsPanel({ compact = false }: { compact?: boolean }) {
  const { locale, tr } = useI18n();
  const alerts = useQuery(api.ops.listAlerts, {});
  const acknowledge = useMutation(api.ops.acknowledgeAlert);
  const [busy, setBusy] = useState<Id<"opsAlerts"> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = Date.now();

  if (alerts === undefined) {
    return <div className="h-14 animate-pulse rounded-lg border border-slate-100 bg-slate-50" />;
  }
  if (alerts.length === 0) {
    if (compact) return null;
    return (
      <div className="flex items-center gap-2 rounded-lg border border-[#0d6b61]/20 bg-[#edf8f6] px-4 py-3 text-[13px] text-[#0d6b61]">
        <Check size={14} /> {tr("Sem alertas operacionais.", "No operational alerts.")}
      </div>
    );
  }
  const visible = compact ? alerts.slice(0, 3) : alerts;

  async function ack(alertId: Id<"opsAlerts">) {
    setBusy(alertId);
    setError(null);
    try {
      await acknowledge({ alertId });
    } catch (err) {
      setError(convexErrorMessage(err, locale));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="overflow-hidden rounded-lg border border-amber-200 bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-amber-100 bg-amber-50 px-4 py-2">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-amber-900">
          <BellRing size={14} /> {tr("Alertas", "Alerts")}
          <span className="rounded-full bg-amber-200 px-1.5 text-[11px]">{alerts.length}</span>
        </div>
        {error && <span className="text-[11px] text-[#b3261e]">{error}</span>}
      </div>
      <ul className="divide-y divide-slate-100">
        {visible.map((alert) => {
          const critical = alert.severity === "critical";
          return (
            <li key={alert._id} className="flex items-start gap-3 px-4 py-2.5">
              <span className={cn("mt-0.5 shrink-0", critical ? "text-[#b3261e]" : "text-amber-600")}>
                {critical ? <ShieldAlert size={15} /> : <AlertTriangle size={15} />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 text-[13px] text-[#0a1b33]">
                  <span className="font-semibold">{kindLabel(alert.kind, locale)}</span>
                  <span className="text-[11px] text-slate-400">{relativeTime(alert.updatedAt, now, locale)}</span>
                </div>
                <p className="text-[12px] text-slate-600">{alert.title}</p>
              </div>
              {alert.href && (
                <Link href={alert.href} className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[12px] font-semibold text-[#2b4f8a] hover:bg-slate-50">
                  {tr("Abrir", "Open")} <ChevronRight size={13} />
                </Link>
              )}
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void ack(alert._id)}
                className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 px-2 text-[12px] font-semibold text-slate-600 hover:border-slate-300 disabled:opacity-50"
              >
                {busy === alert._id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                {tr("Visto", "Seen")}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
