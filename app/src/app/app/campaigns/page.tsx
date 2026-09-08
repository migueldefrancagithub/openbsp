"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { usePaginatedQuery, useQuery } from "convex/react";
import {
  AlertCircle, BarChart3, CalendarClock, CheckCircle2, ChevronRight, CircleStop,
  Clock3, Eye, Loader2, MessageCircle, MousePointerClick, PauseCircle, Plus,
  Search, Send, UsersRound,
} from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { EmptyState, PageHeader } from "@/components/app/EmptyState";
import { CampaignStatusBadge } from "@/components/campaigns/CampaignStatusBadge";
import { campaignKindLabel, percent } from "@/components/campaigns/campaignLabels";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import { relativeTime } from "@/lib/relativeTime";

const FILTERS = ["all", "running", "scheduled", "paused", "completed", "cancelled", "failed"] as const;
type Filter = (typeof FILTERS)[number];

type CampaignRow = {
  _id: Id<"campaigns">; name: string; kind: string; status: string; contentPreview?: string;
  scheduledAt?: number; startedAt?: number; completedAt?: number; createdAt: number;
  rates: {
    attempted: number; sent: number; delivered: number; read: number; replied: number;
    clicked: number; converted: number; failed: number; skipped: number; unknown: number;
    pending: number; deliveryRate: number; readRate: number; replyRate: number;
    clickRate: number; conversionRate: number; failureRate: number;
  };
};

function filterLabel(filter: Filter, locale: "pt" | "en") {
  const labels = locale === "pt"
    ? { all: "Todas", running: "Ativas", scheduled: "Agendadas", paused: "Pausadas", completed: "Concluídas", cancelled: "Canceladas", failed: "Falhadas" }
    : { all: "All", running: "Active", scheduled: "Scheduled", paused: "Paused", completed: "Completed", cancelled: "Cancelled", failed: "Failed" };
  return labels[filter];
}

function filterIcon(filter: Filter) {
  if (filter === "running") return Send;
  if (filter === "scheduled") return CalendarClock;
  if (filter === "paused") return PauseCircle;
  if (filter === "completed") return CheckCircle2;
  if (filter === "cancelled") return CircleStop;
  if (filter === "failed") return AlertCircle;
  return BarChart3;
}

function statusAccent(status: string) {
  if (status === "completed") return "border-l-[#16877b]";
  if (status === "running") return "border-l-[#356fc3]";
  if (status === "scheduled") return "border-l-[#2b4f8a]";
  if (status === "paused") return "border-l-[#d18a13]";
  if (status === "failed" || status === "cancelled") return "border-l-[#e0533d]";
  return "border-l-[#7b8798]";
}

export default function CampaignsPage() {
  const { locale, tr } = useI18n();
  const channels = useQuery(api.channels.list);
  const dashboard = useQuery(api.channelCampaigns.dashboard);
  const productChannels = useMemo(
    () => (channels ?? []).filter((channel) => channel.provider === "iasolution_hub" && channel.operationalTerritory === "openbsp"),
    [channels],
  );
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const query = usePaginatedQuery(
    api.channelCampaigns.list,
    { status: filter === "all" ? undefined : filter, search: search.trim().length >= 2 ? search.trim() : undefined },
    { initialNumItems: 18 },
  );
  const rows = query.results as CampaignRow[];
  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    if (!needle || needle.length >= 2) return rows;
    return rows.filter((row) => row.name.toLocaleLowerCase().includes(needle));
  }, [rows, search]);
  const now = Date.now();

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        eyebrow="Broadcasts"
        title={tr("Campanhas", "Campaigns")}
        description={tr(
          "Crie, agende e acompanhe envios em massa. Todas as métricas vêm dos destinatários e eventos reais.",
          "Create, schedule and monitor broadcasts. Every metric comes from real recipients and events.",
        )}
        action={productChannels.length > 0 ? (
          <Link href="/app/campaigns/new" className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-solid px-4 text-[13px] font-semibold text-white hover:bg-[#12264a]">
            <Plus size={15} /> {tr("Criar campanha", "Create campaign")}
          </Link>
        ) : undefined}
      />

      <div className="mx-auto w-full max-w-[1500px] space-y-4 px-4 py-5 sm:px-6 xl:px-8">
        {channels !== undefined && productChannels.length === 0 ? (
          <EmptyState
            icon={Send}
            title={tr("Ligue o canal do negócio", "Connect the business channel")}
            description={tr("As campanhas precisam de um canal WhatsApp ativo e autorizado.", "Campaigns need an active, authorised WhatsApp channel.")}
            action={<Link href="/app/settings?tab=channels" className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-[13px] font-semibold text-ink">{tr("Abrir canais", "Open channels")} <ChevronRight size={14} /></Link>}
          />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
              <Metric icon={Send} label={tr("Enviadas", "Sent")} value={dashboard?.rates.sent} />
              <Metric icon={CheckCircle2} label={tr("Entregues", "Delivered")} value={dashboard?.rates.delivered} />
              <Metric icon={Eye} label={tr("Lidas", "Read")} value={dashboard?.rates.read} />
              <Metric icon={MessageCircle} label={tr("Respostas", "Replies")} value={dashboard?.rates.replied} />
              <Metric icon={MousePointerClick} label={tr("Interações", "Interactions")} value={dashboard?.rates.clicked} />
              <Metric icon={UsersRound} label={tr("Conversões", "Conversions")} value={dashboard?.rates.converted} />
              <Metric icon={AlertCircle} label={tr("Falhas", "Failed")} value={dashboard?.rates.failed} danger />
            </div>
            {dashboard?.capped && <p className="text-[11px] text-faint">{tr("Resumo calculado sobre as 500 campanhas mais recentes.", "Summary calculated from the 500 most recent campaigns.")}</p>}

            <section className="overflow-hidden rounded-lg border border-line bg-surface">
              <div className="flex flex-col gap-3 border-b border-line-soft p-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex min-w-0 gap-1 overflow-x-auto">
                  {FILTERS.map((item) => {
                    const Icon = filterIcon(item);
                    const count = item === "all" ? dashboard?.campaignCount : dashboard?.statusCounts[item];
                    return (
                      <button key={item} type="button" onClick={() => setFilter(item)} className={cn("inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md px-3 text-[12px] font-semibold", filter === item ? "bg-brand-solid text-white" : "text-muted hover:bg-surface-2 hover:text-ink")}>
                        <Icon size={13} /> {filterLabel(item, locale)}
                        {count !== undefined && <span className={cn("ml-1 rounded px-1.5 py-0.5 text-[10px]", filter === item ? "bg-white/15" : "bg-surface-3")}>{count}</span>}
                      </button>
                    );
                  })}
                </div>
                <label className="flex h-9 min-w-0 items-center gap-2 rounded-md border border-line bg-surface px-3 lg:w-[320px]">
                  <Search size={14} className="text-faint" />
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={tr("Pesquisar campanhas…", "Search campaigns…")} className="min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none" />
                </label>
              </div>

              {query.status === "LoadingFirstPage" ? (
                <div className="flex items-center gap-2 px-4 py-10 text-sm text-faint"><Loader2 size={15} className="animate-spin" /> {tr("A carregar campanhas…", "Loading campaigns…")}</div>
              ) : visible.length === 0 ? (
                <div className="px-4 py-14 text-center">
                  <div className="text-[15px] font-semibold text-ink">{search ? tr("Nenhuma campanha corresponde à pesquisa", "No campaign matches your search") : tr("Sem campanhas neste estado", "No campaigns in this status")}</div>
                  <p className="mx-auto mt-1 max-w-md text-[13px] text-muted">{tr("Crie uma campanha em três passos: público, mensagem e confirmação.", "Create a campaign in three steps: audience, message and confirmation.")}</p>
                </div>
              ) : (
                <div className="grid gap-3 p-3 md:grid-cols-2 xl:grid-cols-3">
                  {visible.map((row) => <CampaignCard key={row._id} row={row} now={now} />)}
                </div>
              )}
              {query.status === "CanLoadMore" && (
                <div className="border-t border-line-soft px-4 py-3 text-center">
                  <button type="button" onClick={() => query.loadMore(18)} className="text-[12px] font-semibold text-chip-info-fg hover:underline">{tr("Carregar mais campanhas", "Load more campaigns")}</button>
                </div>
              )}
            </section>

            <p className="text-[11px] text-faint">
              {tr("O histórico Meta direto anterior continua disponível no ", "The previous Meta Direct history remains available in the ")}
              <Link href="/app/campaigns/legacy" className="font-semibold text-muted hover:underline">{tr("arquivo legado", "legacy archive")}</Link>.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function Metric({ icon: Icon, label, value, danger }: { icon: typeof Send; label: string; value?: number; danger?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2.5">
      <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-md", danger ? "bg-chip-danger text-chip-danger-fg" : "bg-surface-2 text-muted")}><Icon size={14} /></span>
      <div className="min-w-0"><div className="truncate text-[10px] font-medium uppercase text-faint">{label}</div><div className="text-[18px] font-semibold text-ink">{value ?? "–"}</div></div>
    </div>
  );
}

function CampaignCard({ row, now }: { row: CampaignRow; now: number }) {
  const { locale, tr } = useI18n();
  const total = Math.max(row.rates.attempted + row.rates.pending, row.rates.attempted, 0);
  const progress = total > 0 ? Math.min(1, row.rates.attempted / total) : 0;
  const date = row.scheduledAt ?? row.startedAt ?? row.completedAt ?? row.createdAt;
  return (
    <Link href={`/app/campaigns/${row._id}`} className={cn("flex min-h-[330px] flex-col rounded-lg border border-line border-l-4 bg-surface p-4 transition hover:border-brand-solid/35 hover:shadow-[var(--shadow-card)]", statusAccent(row.status))}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><h2 className="truncate text-[14px] font-bold text-ink">{row.name}</h2><p className="mt-0.5 truncate text-[11px] text-faint">{campaignKindLabel(row.kind, locale)} · {relativeTime(date, now, locale)}</p></div>
        <CampaignStatusBadge status={row.status} />
      </div>
      <p className="mt-3 line-clamp-2 min-h-9 text-[12px] leading-4 text-muted">{row.contentPreview || tr("Mensagem preparada", "Message prepared")}</p>
      <div className="mt-4 grid grid-cols-2 gap-2 text-[11px]">
        <CardMetric label={tr("Enviadas", "Sent")} value={row.rates.sent} />
        <CardMetric label={tr("Entregues", "Delivered")} value={row.rates.delivered} />
        <CardMetric label={tr("Lidas", "Read")} value={row.rates.read} />
        <CardMetric label={tr("Falhas", "Failed")} value={row.rates.failed} danger />
      </div>
      <div className="mt-3 space-y-2 rounded-md border border-line-soft bg-surface-2 p-2.5 text-[10px]">
        <Rate label={tr("Taxa de entrega", "Delivery rate")} value={row.rates.deliveryRate} />
        <Rate label={tr("Taxa de leitura", "Read rate")} value={row.rates.readRate} />
        <Rate label={tr("Taxa de resposta", "Reply rate")} value={row.rates.replyRate} />
      </div>
      <div className="mt-auto flex items-center gap-3 pt-3 text-[11px] text-body">
        <span className="inline-flex items-center gap-1"><MessageCircle size={12} /> {row.rates.replied}</span>
        <span className="inline-flex items-center gap-1"><MousePointerClick size={12} /> {row.rates.clicked}</span>
        <span className="inline-flex items-center gap-1"><UsersRound size={12} /> {row.rates.converted}</span>
        <span className="ml-auto inline-flex items-center gap-1 text-faint"><Clock3 size={11} /> {percent(progress)}</span>
      </div>
    </Link>
  );
}

function CardMetric({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return <div className="flex items-center justify-between rounded-md bg-surface-2 px-2.5 py-2"><span className="text-muted">{label}</span><b className={danger && value > 0 ? "text-chip-danger-fg" : "text-ink"}>{value}</b></div>;
}

function Rate({ label, value }: { label: string; value: number }) {
  return <div><div className="mb-1 flex justify-between text-body"><span>{label}</span><b className="text-ink">{percent(value)}</b></div><div className="h-1.5 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-[#356fc3]" style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }} /></div></div>;
}
