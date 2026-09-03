"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useConvex, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { ArrowLeft, Copy, Download, Loader2, Pause, Play, XCircle } from "lucide-react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { PageHeader } from "@/components/app/EmptyState";
import { CampaignStatusBadge } from "@/components/campaigns/CampaignStatusBadge";
import { FunnelStats } from "@/components/campaigns/FunnelStats";
import { blockReasonLabel, campaignKindLabel, recipientStatusLabel, recipientStatusTone } from "@/components/campaigns/campaignLabels";
import { cn } from "@/lib/cn";
import { convexErrorMessage } from "@/lib/convexErrorMessage";
import { useI18n } from "@/lib/i18n";
import { relativeTime } from "@/lib/relativeTime";

const RECIPIENT_FILTERS = ["all", "pending", "sent", "delivered", "read", "replied", "clicked", "failed", "skipped"] as const;
type RecipientFilter = (typeof RECIPIENT_FILTERS)[number];

function eventLabel(type: string, locale: "pt" | "en"): string {
  const pt: Record<string, string> = {
    "campaign.created": "Campanha criada",
    "campaign.scheduled": "Campanha agendada",
    "campaign.launched": "Campanha lançada",
    "campaign.batch_queued": "Lote enviado para a fila",
    "campaign.paused": "Pausada manualmente",
    "campaign.auto_paused": "Pausada automaticamente",
    "campaign.resumed": "Retomada",
    "campaign.cancelled": "Cancelada",
    "campaign.completed": "Concluída",
    "campaign.failed": "Terminou sem envios aceites",
    "campaign.recipient.sent": "Mensagem aceite pelo canal",
    "campaign.recipient.delivered": "Mensagem entregue",
    "campaign.recipient.read": "Mensagem lida",
    "campaign.recipient.replied": "Paciente respondeu",
    "campaign.recipient.clicked": "Paciente clicou no link",
    "campaign.recipient.converted": "Conversão registada",
    "campaign.recipient.failed": "Envio falhou",
    "campaign.recipient.unknown": "Envio sem confirmação",
    "campaign.recipient.rate_limited": "Limite de ritmo — nova tentativa",
    "campaign.recipient.retry_scheduled": "Nova tentativa agendada",
  };
  const en: Record<string, string> = {
    "campaign.created": "Campaign created",
    "campaign.scheduled": "Campaign scheduled",
    "campaign.launched": "Campaign launched",
    "campaign.batch_queued": "Batch queued",
    "campaign.paused": "Paused manually",
    "campaign.auto_paused": "Paused automatically",
    "campaign.resumed": "Resumed",
    "campaign.cancelled": "Cancelled",
    "campaign.completed": "Completed",
    "campaign.failed": "Ended without accepted sends",
    "campaign.recipient.sent": "Message accepted by the channel",
    "campaign.recipient.delivered": "Message delivered",
    "campaign.recipient.read": "Message read",
    "campaign.recipient.replied": "Patient replied",
    "campaign.recipient.clicked": "Patient clicked the link",
    "campaign.recipient.converted": "Conversion recorded",
    "campaign.recipient.failed": "Send failed",
    "campaign.recipient.unknown": "Send unconfirmed",
    "campaign.recipient.rate_limited": "Rate limited — will retry",
    "campaign.recipient.retry_scheduled": "Retry scheduled",
  };
  return (locale === "pt" ? pt : en)[type] ?? type;
}

export default function CampaignDetailPage() {
  const { locale, tr } = useI18n();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const convex = useConvex();
  const campaignId = params.id as Id<"campaigns">;
  const detail = useQuery(api.channelCampaigns.get, { campaignId });
  const pause = useMutation(api.channelCampaigns.pause);
  const resume = useMutation(api.channelCampaigns.resume);
  const cancel = useMutation(api.channelCampaigns.cancel);
  const duplicate = useMutation(api.channelCampaigns.duplicate);
  const [tab, setTab] = useState<"recipients" | "events">("recipients");
  const [filter, setFilter] = useState<RecipientFilter>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recipients = usePaginatedQuery(
    api.channelCampaigns.listRecipients,
    { campaignId, status: filter === "all" ? undefined : filter },
    { initialNumItems: 30 },
  );
  const events = usePaginatedQuery(api.channelCampaigns.listEvents, { campaignId }, { initialNumItems: 30 });
  const now = Date.now();

  async function run(key: string, action: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(convexErrorMessage(err, locale));
    } finally {
      setBusy(null);
    }
  }

  async function exportCsv() {
    await run("export", async () => {
      const result = await convex.query(api.channelCampaigns.exportRecipients, { campaignId });
      const header = ["label", "threadKey", "status", "failureCode", "sentAt", "deliveredAt", "readAt", "repliedAt", "clickedAt", "convertedAt", "conversionLabel"];
      const lines = result.rows.map((row) =>
        [row.label, row.threadKey ?? "", row.status, row.failureCode ?? "", row.sentAt ?? "", row.deliveredAt ?? "", row.readAt ?? "", row.repliedAt ?? "", row.clickedAt ?? "", row.convertedAt ?? "", row.conversionLabel ?? ""]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(","),
      );
      const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `campanha-${campaignId}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  const blockedEntries = useMemo(
    () => Object.entries(detail?.audienceSummary.blocked ?? {}).filter(([, n]) => n > 0),
    [detail],
  );

  if (detail === undefined) {
    return (
      <div className="flex items-center gap-2 px-6 py-10 text-sm text-faint">
        <Loader2 size={15} className="animate-spin" /> {tr("A carregar campanha…", "Loading campaign…")}
      </div>
    );
  }

  const { campaign } = detail;
  const canPause = campaign.status === "running";
  const canResume = campaign.status === "paused";
  const canCancel = ["draft", "scheduled", "running", "paused"].includes(campaign.status);

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        eyebrow={tr("Campanhas", "Campaigns")}
        title={campaign.name}
        description={`${campaignKindLabel(campaign.kind, locale)}${detail.channelName ? ` · ${detail.channelName}` : ""}`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <CampaignStatusBadge status={campaign.status} />
            {canPause && (
              <button type="button" disabled={busy !== null} onClick={() => void run("pause", () => pause({ campaignId }))} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[12px] font-semibold text-ink">
                <Pause size={13} /> {tr("Pausar", "Pause")}
              </button>
            )}
            {canResume && (
              <button type="button" disabled={busy !== null} onClick={() => void run("resume", () => resume({ campaignId }))} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#0d6b61] px-3 text-[12px] font-semibold text-white">
                <Play size={13} /> {tr("Retomar", "Resume")}
              </button>
            )}
            {canCancel && (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => {
                  if (window.confirm(tr("Cancelar esta campanha? Os envios pendentes não serão feitos.", "Cancel this campaign? Pending sends will not go out."))) {
                    void run("cancel", () => cancel({ campaignId }));
                  }
                }}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#e0533d]/40 bg-surface px-3 text-[12px] font-semibold text-[#b3261e]"
              >
                <XCircle size={13} /> {tr("Cancelar", "Cancel")}
              </button>
            )}
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void run("duplicate", async () => { const id = await duplicate({ campaignId }); router.push(`/app/campaigns/${id}`); })}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[12px] font-semibold text-ink"
            >
              <Copy size={13} /> {tr("Duplicar", "Duplicate")}
            </button>
            <button type="button" disabled={busy !== null} onClick={() => void exportCsv()} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[12px] font-semibold text-ink">
              {busy === "export" ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} CSV
            </button>
            <Link href="/app/campaigns" className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-[12px] font-semibold text-muted hover:text-ink">
              <ArrowLeft size={13} /> {tr("Todas", "All")}
            </Link>
          </div>
        }
      />

      <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-5 sm:px-6 xl:px-8">
        {error && <div className="rounded-lg border border-[#e0533d]/30 bg-[#fdf1ef] px-4 py-3 text-[13px] text-[#b3261e]">{error}</div>}
        {campaign.pauseReason && campaign.status === "paused" && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
            {tr("Motivo da pausa: ", "Pause reason: ")}
            {campaign.pauseReason === "failure_rate"
              ? tr("taxa de falhas acima de 20%. Verifique os destinatários falhados antes de retomar.", "failure rate above 20%. Check the failed recipients before resuming.")
              : campaign.pauseReason === "manual"
                ? tr("pausada pela equipa.", "paused by the team.")
                : blockReasonLabel(campaign.pauseReason, locale) || campaign.pauseReason}
          </div>
        )}
        {campaign.status === "scheduled" && campaign.scheduledAt && (
          <div className="rounded-lg border border-[#2b4f8a]/30 bg-[#eef3fb] px-4 py-3 text-[13px] text-[#2b4f8a]">
            {tr("Agendada para ", "Scheduled for ")}{new Date(campaign.scheduledAt).toLocaleString(locale === "pt" ? "pt-PT" : "en-GB")}
          </div>
        )}

        <FunnelStats rates={campaign.rates} />

        <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <section className="rounded-lg border border-line bg-surface p-4">
            <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-faint">{tr("Mensagem", "Message")}</div>
            <div className="rounded-lg border border-line bg-surface-2 p-3 text-[13px] leading-relaxed text-ink whitespace-pre-wrap">
              {detail.messageText ?? `${tr("Template", "Template")} ${detail.templateName ?? ""} · ${detail.templateLanguage ?? ""}`}
            </div>
            {detail.variableBindings && detail.variableBindings.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-body">
                {detail.variableBindings.map((b) => (
                  <li key={b.index} className="rounded-md border border-line bg-surface px-2 py-0.5">
                    {`{{${b.index}}}`} → {b.source === "static" ? b.value : b.source === "first_name" ? tr("primeiro nome", "first name") : tr("link rastreado", "tracked link")}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="rounded-lg border border-line bg-surface p-4">
            <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-faint">{tr("Público", "Audience")}</div>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                { label: tr("Encontradas", "Matched"), value: detail.audienceSummary.matched },
                { label: tr("Elegíveis", "Eligible"), value: detail.audienceSummary.eligible, tone: "text-[#0d6b61]" },
                { label: tr("Bloqueadas", "Blocked"), value: detail.audienceSummary.matched - detail.audienceSummary.eligible, tone: "text-amber-700" },
              ].map((item) => (
                <div key={item.label} className="rounded-lg border border-line-soft bg-surface-2 px-2 py-2">
                  <div className={cn("font-[var(--font-outfit)] text-[20px] font-medium", item.tone ?? "text-ink")}>{item.value}</div>
                  <div className="text-[10px] uppercase tracking-[0.12em] text-faint">{item.label}</div>
                </div>
              ))}
            </div>
            {blockedEntries.length > 0 && (
              <ul className="mt-3 space-y-1 text-[12px] text-body">
                {blockedEntries.map(([code, n]) => (
                  <li key={code} className="flex justify-between"><span>{blockReasonLabel(code, locale)}</span><b className="text-ink">{n}</b></li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-[11px] text-faint">
              {tr(`Ritmo do piloto: ${detail.batchSize} mensagens a cada ${Math.round(detail.batchIntervalMs / 1000)} s.`, `Pilot pace: ${detail.batchSize} messages every ${Math.round(detail.batchIntervalMs / 1000)} s.`)}
              {detail.lastBatchAt ? ` ${tr("Último lote", "Last batch")} ${relativeTime(detail.lastBatchAt, now, locale)}.` : ""}
            </p>
          </section>
        </div>

        <section className="overflow-hidden rounded-lg border border-line bg-surface">
          <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-2">
            {(["recipients", "events"] as const).map((key) => (
              <button key={key} type="button" onClick={() => setTab(key)} className={cn("rounded-md px-3 py-1.5 text-[12px] font-semibold", tab === key ? "bg-brand-solid text-white" : "text-muted hover:text-ink")}>
                {key === "recipients" ? tr("Destinatários", "Recipients") : tr("Eventos", "Events")}
              </button>
            ))}
            {tab === "recipients" && (
              <div className="ml-auto flex flex-wrap gap-1">
                {RECIPIENT_FILTERS.map((key) => (
                  <button key={key} type="button" onClick={() => setFilter(key)} className={cn("rounded-full border px-2 py-0.5 text-[11px] font-semibold", filter === key ? "border-brand-solid bg-brand-solid text-white" : "border-line text-muted")}>
                    {key === "all" ? tr("Todos", "All") : recipientStatusLabel(key, locale)}
                  </button>
                ))}
              </div>
            )}
          </div>

          {tab === "recipients" ? (
            <>
              {recipients.status === "LoadingFirstPage" ? (
                <div className="px-4 py-6 text-sm text-faint">{tr("A carregar…", "Loading…")}</div>
              ) : recipients.results.length === 0 ? (
                <div className="px-4 py-8 text-center text-[13px] text-muted">{tr("Sem destinatários neste filtro.", "No recipients for this filter.")}</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead className="bg-surface-2 text-left text-[11px] uppercase tracking-[0.12em] text-faint">
                      <tr>
                        <th className="px-4 py-2 font-medium">{tr("Paciente", "Patient")}</th>
                        <th className="px-4 py-2 font-medium">{tr("Estado", "Status")}</th>
                        <th className="px-4 py-2 font-medium">{tr("Detalhe", "Detail")}</th>
                        <th className="px-4 py-2 font-medium">{tr("Atualizado", "Updated")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line-soft">
                      {recipients.results.map((row) => (
                        <tr key={row._id} className="hover:bg-surface-2">
                          <td className="px-4 py-2">
                            {row.threadKey && campaign.channelId ? (
                              <Link href={`/app/channel-inbox/${row.threadKey}?channel=${campaign.channelId}`} className="font-semibold text-ink hover:underline">{row.label}</Link>
                            ) : (
                              <span className="font-semibold text-ink">{row.label}</span>
                            )}
                          </td>
                          <td className="px-4 py-2">
                            <span className={cn("rounded-md px-2 py-0.5 text-[11px] font-semibold", recipientStatusTone(row.status))}>{recipientStatusLabel(row.status, locale)}</span>
                          </td>
                          <td className="px-4 py-2 text-body">
                            {row.failureCode ? blockReasonLabel(row.failureCode, locale) : row.convertedAt ? `${tr("Conversão", "Conversion")}: ${row.conversionLabel ?? ""}` : row.nextAttemptAt && row.nextAttemptAt > now ? tr(`Nova tentativa ${relativeTime(row.nextAttemptAt, now, locale)}`, `Retry ${relativeTime(row.nextAttemptAt, now, locale)}`) : row.dispatchAttempts > 1 ? tr(`${row.dispatchAttempts} tentativas`, `${row.dispatchAttempts} attempts`) : ""}
                          </td>
                          <td className="px-4 py-2 text-faint">{relativeTime(row.updatedAt, now, locale)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {recipients.status === "CanLoadMore" && (
                <div className="border-t border-line-soft px-4 py-2">
                  <button type="button" onClick={() => recipients.loadMore(30)} className="text-[12px] font-semibold text-[#2b4f8a] hover:underline">{tr("Carregar mais", "Load more")}</button>
                </div>
              )}
            </>
          ) : (
            <>
              {events.results.length === 0 ? (
                <div className="px-4 py-8 text-center text-[13px] text-muted">{tr("Sem eventos.", "No events.")}</div>
              ) : (
                <ul className="divide-y divide-line-soft">
                  {events.results.map((event) => (
                    <li key={event._id} className="flex items-center justify-between gap-3 px-4 py-2 text-[13px]">
                      <span className="text-ink">{eventLabel(event.type, locale)}</span>
                      <span className="text-[11px] text-faint">{relativeTime(event.createdAt, now, locale)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {events.status === "CanLoadMore" && (
                <div className="border-t border-line-soft px-4 py-2">
                  <button type="button" onClick={() => events.loadMore(30)} className="text-[12px] font-semibold text-[#2b4f8a] hover:underline">{tr("Carregar mais", "Load more")}</button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
