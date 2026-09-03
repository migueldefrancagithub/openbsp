"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { Activity, Loader2 } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { addDaysLocal, formatDayIn } from "@/components/agenda/agendaLabels";
import { todayLocalDate } from "@/components/agenda/AppointmentScheduler";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";

function Bar({ value, max, className }: { value: number; max: number; className: string }) {
  const width = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return <div className={cn("h-1.5 rounded-full", className)} style={{ width: `${width}%` }} />;
}

export function OperationRollups({ days = 14 }: { days?: number }) {
  const { locale, tr } = useI18n();
  const to = todayLocalDate();
  const from = addDaysLocal(to, -(days - 1));
  const data = useQuery(api.analyticsRollups.readRange, { from, to });

  const totals = useMemo(() => {
    const rows = data?.rows ?? [];
    const sum = (key: keyof (typeof rows)[number]) => rows.reduce((acc, row) => acc + (Number(row[key]) || 0), 0);
    const responded = rows.filter((row) => row.firstResponseAvgMs !== undefined);
    return {
      newThreads: sum("newThreads"),
      inbound: sum("inboundMessages"),
      human: sum("outboundHuman"),
      bot: sum("outboundBot"),
      campaign: sum("outboundCampaign"),
      followUp: sum("outboundFollowUp"),
      failed: sum("outboundFailed"),
      booked: sum("booked"),
      attended: sum("attended"),
      noShow: sum("noShow"),
      avgFirstResponseMs: responded.length > 0 ? Math.round(responded.reduce((acc, row) => acc + (row.firstResponseAvgMs ?? 0), 0) / responded.length) : undefined,
      approximate: rows.some((row) => row.approximate),
    };
  }, [data]);

  const maxInbound = Math.max(1, ...(data?.rows ?? []).map((row) => row.inboundMessages));

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft px-5 py-3">
        <div className="flex items-center gap-2 text-[14px] font-semibold text-ink"><Activity size={15} /> {tr(`Operação · últimos ${days} dias`, `Operations · last ${days} days`)}</div>
        <span className="text-[11px] text-faint">{data?.timeZone ?? ""}{totals.approximate ? ` · ${tr("valores aproximados", "approximate values")}` : ""}</span>
      </div>
      {data === undefined ? (
        <div className="flex items-center gap-2 px-5 py-6 text-sm text-faint"><Loader2 size={14} className="animate-spin" /> {tr("A carregar…", "Loading…")}</div>
      ) : (
        <div className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-6">
            {[
              { label: tr("Conversas novas", "New conversations"), value: totals.newThreads },
              { label: tr("Mensagens recebidas", "Inbound messages"), value: totals.inbound },
              { label: tr("Respostas humanas", "Human replies"), value: totals.human },
              { label: tr("Respostas do agente", "Agent replies"), value: totals.bot },
              { label: tr("Campanhas + follow-ups", "Campaigns + follow-ups"), value: totals.campaign + totals.followUp },
              { label: tr("1.ª resposta (média)", "First response (avg)"), value: totals.avgFirstResponseMs !== undefined ? `${Math.round(totals.avgFirstResponseMs / 60_000)} min` : "—" },
              { label: tr("Marcações", "Bookings"), value: totals.booked },
              { label: tr("Compareceram", "Attended"), value: totals.attended, tone: "text-[#0d6b61]" },
              { label: tr("Faltas", "No-shows"), value: totals.noShow, tone: "text-[#b3261e]" },
              { label: tr("Envios falhados", "Failed sends"), value: totals.failed, tone: totals.failed > 0 ? "text-[#b3261e]" : undefined },
            ].map((item) => (
              <div key={item.label} className="rounded-lg border border-line-soft bg-surface-2 px-3 py-2">
                <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-faint">{item.label}</div>
                <div className={cn("mt-0.5 font-[var(--font-outfit)] text-[20px] font-medium", item.tone ?? "text-ink")}>{item.value}</div>
              </div>
            ))}
          </div>
          {data.rows.length === 0 ? (
            <p className="text-[12px] text-muted">{tr("Ainda sem dados agregados. O resumo é calculado de hora a hora.", "No aggregated data yet. The summary is computed hourly.")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead className="text-left text-[10px] uppercase tracking-[0.12em] text-faint">
                  <tr>
                    <th className="py-1 pr-3 font-medium">{tr("Dia", "Day")}</th>
                    <th className="py-1 pr-3 font-medium">{tr("Recebidas", "Inbound")}</th>
                    <th className="py-1 pr-3 font-medium">{tr("Humanas", "Human")}</th>
                    <th className="py-1 pr-3 font-medium">{tr("Agente", "Agent")}</th>
                    <th className="py-1 pr-3 font-medium">{tr("Camp./FU", "Camp./FU")}</th>
                    <th className="py-1 pr-3 font-medium">{tr("Novas", "New")}</th>
                    <th className="py-1 pr-3 font-medium">{tr("Marcações", "Bookings")}</th>
                    <th className="py-1 pr-3 font-medium">{tr("Faltas", "No-shows")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {[...data.rows].reverse().map((row) => (
                    <tr key={row.day}>
                      <td className="py-1.5 pr-3 capitalize text-ink">{formatDayIn(row.day, locale)}{row.approximate ? "*" : ""}</td>
                      <td className="py-1.5 pr-3"><div className="flex items-center gap-2"><span className="w-6 tabular-nums">{row.inboundMessages}</span><Bar value={row.inboundMessages} max={maxInbound} className="bg-[#2b4f8a]" /></div></td>
                      <td className="py-1.5 pr-3 tabular-nums">{row.outboundHuman}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{row.outboundBot}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{row.outboundCampaign + row.outboundFollowUp}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{row.newThreads}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{row.booked}</td>
                      <td className={cn("py-1.5 pr-3 tabular-nums", row.noShow > 0 && "text-[#b3261e]")}>{row.noShow}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.missingDays.length > 0 && <p className="mt-2 text-[11px] text-faint">{tr(`${data.missingDays.length} dia(s) ainda sem resumo.`, `${data.missingDays.length} day(s) not summarised yet.`)}</p>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
