"use client";

import Link from "next/link";
import { useMemo } from "react";
import { usePaginatedQuery, useQuery } from "convex/react";
import { ArrowRight, Loader2, Plus, Send } from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import { EmptyState, PageHeader } from "@/components/app/EmptyState";
import { CampaignStatusBadge } from "@/components/campaigns/CampaignStatusBadge";
import { campaignKindLabel, percent } from "@/components/campaigns/campaignLabels";
import { useI18n } from "@/lib/i18n";
import { relativeTime } from "@/lib/relativeTime";

export default function CampaignsPage() {
  const { locale, tr } = useI18n();
  const channels = useQuery(api.channels.list);
  const productChannels = useMemo(
    () => (channels ?? []).filter((c) => c.provider === "iasolution_hub" && c.operationalTerritory === "openbsp"),
    [channels],
  );
  const { results, status, loadMore } = usePaginatedQuery(api.channelCampaigns.list, {}, { initialNumItems: 20 });

  const kpis = useMemo(() => {
    const running = results.filter((r) => r.status === "running" || r.status === "scheduled").length;
    const finished = results.filter((r) => r.status === "completed");
    const sent = results.reduce((sum, r) => sum + r.rates.sent, 0);
    const replied = results.reduce((sum, r) => sum + r.rates.replied, 0);
    return { running, completed: finished.length, sent, replyRate: sent > 0 ? replied / sent : 0 };
  }, [results]);

  const now = Date.now();

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        eyebrow={tr("Campanhas", "Campaigns")}
        title={tr("Campanhas", "Campaigns")}
        description={tr(
          "Mensagens em lote no canal da clínica, com público real, ritmo do piloto e métricas por destinatário.",
          "Batched messages on the clinic channel, with a real audience, pilot pacing and per-recipient metrics.",
        )}
        action={
          productChannels.length > 0 ? (
            <Link
              href="/app/campaigns/new"
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#0a1b33] px-4 text-[13px] font-semibold text-white hover:bg-[#12264a]"
            >
              <Plus size={15} /> {tr("Nova campanha", "New campaign")}
            </Link>
          ) : undefined
        }
      />

      <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-5 sm:px-6 xl:px-8">
        {channels !== undefined && productChannels.length === 0 ? (
          <EmptyState
            icon={Send}
            title={tr("Ligue o canal da clínica", "Connect the clinic channel")}
            description={tr(
              "As campanhas usam o canal WhatsApp ligado ao Hub. Configure-o em Definições › Canais.",
              "Campaigns use the WhatsApp channel connected to the Hub. Set it up in Settings › Channels.",
            )}
            action={
              <Link href="/app/settings?tab=channels" className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-[13px] font-semibold text-[#0a1b33]">
                {tr("Abrir Definições", "Open Settings")} <ArrowRight size={14} />
              </Link>
            }
          />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { label: tr("A decorrer", "In progress"), value: String(kpis.running) },
                { label: tr("Concluídas", "Completed"), value: String(kpis.completed) },
                { label: tr("Mensagens enviadas", "Messages sent"), value: String(kpis.sent) },
                { label: tr("Taxa de resposta", "Reply rate"), value: percent(kpis.replyRate) },
              ].map((item) => (
                <div key={item.label} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                  <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-400">{item.label}</div>
                  <div className="mt-1 font-[var(--font-outfit)] text-[22px] font-medium tracking-tight text-[#0a1b33]">{item.value}</div>
                </div>
              ))}
            </div>

            <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              {status === "LoadingFirstPage" ? (
                <div className="flex items-center gap-2 px-4 py-8 text-sm text-slate-400">
                  <Loader2 size={15} className="animate-spin" /> {tr("A carregar campanhas…", "Loading campaigns…")}
                </div>
              ) : results.length === 0 ? (
                <div className="px-4 py-12 text-center">
                  <div className="text-[15px] font-semibold text-[#0a1b33]">{tr("Ainda sem campanhas", "No campaigns yet")}</div>
                  <p className="mx-auto mt-1 max-w-md text-[13px] text-slate-500">
                    {tr("Crie a primeira em 3 passos: público, mensagem e confirmação.", "Create the first one in 3 steps: audience, message and confirmation.")}
                  </p>
                  <Link href="/app/campaigns/new" className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg bg-[#0a1b33] px-3 text-[13px] font-semibold text-white">
                    <Plus size={14} /> {tr("Nova campanha", "New campaign")}
                  </Link>
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {results.map((row) => (
                    <li key={row._id}>
                      <Link href={`/app/campaigns/${row._id}`} className="grid gap-2 px-4 py-3 hover:bg-slate-50 sm:grid-cols-[1.4fr_1fr_1fr_auto] sm:items-center">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-[14px] font-semibold text-[#0a1b33]">{row.name}</span>
                            <CampaignStatusBadge status={row.status} />
                          </div>
                          <div className="mt-0.5 truncate text-[12px] text-slate-500">
                            {campaignKindLabel(row.kind, locale)}
                            {row.contentPreview ? ` · ${row.contentPreview}` : ""}
                          </div>
                        </div>
                        <div className="flex gap-3 text-[12px] text-slate-600">
                          <span><b className="text-[#0a1b33]">{row.rates.sent}</b> {tr("enviadas", "sent")}</span>
                          <span><b className="text-[#0a1b33]">{percent(row.rates.deliveryRate)}</b> {tr("entregues", "delivered")}</span>
                        </div>
                        <div className="flex gap-3 text-[12px] text-slate-600">
                          <span><b className="text-[#0d6b61]">{percent(row.rates.replyRate)}</b> {tr("respostas", "replies")}</span>
                          <span><b className="text-[#0d6b61]">{row.rates.converted}</b> {tr("conversões", "conversions")}</span>
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {relativeTime(row.startedAt ?? row.createdAt, now, locale)}
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {status === "CanLoadMore" && (
                <div className="border-t border-slate-100 px-4 py-2">
                  <button type="button" onClick={() => loadMore(20)} className="text-[12px] font-semibold text-[#2b4f8a] hover:underline">
                    {tr("Carregar mais", "Load more")}
                  </button>
                </div>
              )}
            </section>

            <p className="text-[11px] text-slate-400">
              {tr("Campanhas antigas (Meta direto) continuam no ", "Older campaigns (Meta direct) remain in the ")}
              <Link href="/app/campaigns/legacy" className="font-semibold text-slate-500 hover:underline">
                {tr("estúdio legado", "legacy studio")}
              </Link>
              .
            </p>
          </>
        )}
      </div>
    </div>
  );
}
