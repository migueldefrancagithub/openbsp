"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { CheckCircle2, Clock3, PlaneTakeoff, TriangleAlert } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";

const BUCKET = {
  critical: { pt: "crítico", en: "critical", box: "bg-[#fdf1ef] text-[#b3261e]", Icon: TriangleAlert },
  at_risk: { pt: "em risco", en: "at risk", box: "bg-amber-50 text-amber-800", Icon: Clock3 },
  in_flight: { pt: "em voo", en: "in flight", box: "bg-[#eef3fb] text-[#2b4f8a]", Icon: PlaneTakeoff },
} as const;

/**
 * Conversations that went cold, and the ones nobody wrote a next step for.
 *
 * "In flight" is its own bucket on purpose: cold with a follow-up scheduled is
 * the system still holding the patient; cold with nothing is the clinic losing
 * them quietly. Treating both as risk would bury the second in the first.
 */
export function RiskRadarPanel() {
  const { locale, tr } = useI18n();
  const radar = useQuery(api.leads.riskRadar, {});
  if (!radar) return null;

  const nothingToShow = radar.items.length === 0 && radar.withoutNextStep.length === 0;
  if (nothingToShow) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white px-4 py-6 text-center">
        <CheckCircle2 size={22} className="mx-auto text-[#0d6b61]" />
        <p className="mt-1 text-[13px] font-medium text-[#0a1b33]">{tr("Nada em risco", "Nothing at risk")}</p>
        <p className="text-[12px] text-slate-500">
          {tr(
            "Todas as conversas abertas tiveram actividade recente ou já têm um retorno agendado.",
            "Every open conversation had recent activity or already has a scheduled return.",
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {radar.withoutNextStep.length > 0 && (
        <section className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
          <p className="text-[13px] font-medium text-amber-900">
            {radar.withoutNextStep.length}{" "}
            {radar.withoutNextStep.length === 1
              ? tr("conversa aberta sem próximo passo", "open conversation without a next step")
              : tr("conversas abertas sem próximo passo", "open conversations without a next step")}
          </p>
          <p className="mb-1.5 text-[11px] text-amber-800">
            {tr(
              "Ninguém marcou o que acontece a seguir. Cada uma é alguém à espera sem nada combinado.",
              "Nobody set what happens next. Each one is someone waiting with nothing agreed.",
            )}
          </p>
          <ul className="space-y-0.5">
            {radar.withoutNextStep.slice(0, 6).map((row) => (
              <li key={row.threadId} className="flex items-baseline justify-between gap-3 text-[11px]">
                <Link
                  href={`/app/channel-inbox/${encodeURIComponent(row.threadKey)}?channel=${row.channelId}`}
                  className="truncate text-[#2b4f8a] hover:underline"
                >
                  {row.displayName ?? row.threadKey}
                </Link>
                <span className="shrink-0 tabular-nums text-amber-800">
                  {tr("aberta há", "open for")} {row.hoursOpen}h
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap gap-1.5">
        {(["critical", "at_risk", "in_flight"] as const).map((key) => (
          <span key={key} className={cn("rounded-md px-2 py-0.5 text-[11px] font-semibold", BUCKET[key].box)}>
            {radar.counts[key]} {locale === "pt" ? BUCKET[key].pt : BUCKET[key].en}
          </span>
        ))}
      </div>

      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {radar.items.slice(0, 10).map((item) => {
          const meta = BUCKET[item.bucket as keyof typeof BUCKET] ?? BUCKET.at_risk;
          return (
            <li key={item.threadId} className="flex items-center gap-2 px-3 py-2 text-[12px]">
              <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold", meta.box)}>
                {locale === "pt" ? meta.pt : meta.en}
              </span>
              <Link
                href={`/app/channel-inbox/${encodeURIComponent(item.threadKey)}?channel=${item.channelId}`}
                className="min-w-0 flex-1 truncate font-medium text-[#0a1b33] hover:underline"
              >
                {item.displayName ?? item.threadKey}
              </Link>
              <span className="shrink-0 text-[11px] text-slate-500">
                {tr("parado há", "quiet for")} {item.hoursSinceActivity < 48 ? `${item.hoursSinceActivity}h` : `${Math.round(item.hoursSinceActivity / 24)}d`}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
