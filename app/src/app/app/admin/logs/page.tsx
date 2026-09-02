"use client";

import { useEffect, useMemo, useState } from "react";
import { usePaginatedQuery, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { PageHeader } from "@/components/app/EmptyState";
import { blockReasonLabel } from "@/components/campaigns/campaignLabels";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import { relativeTime } from "@/lib/relativeTime";

type Tab = "events" | "outbox" | "audit" | "followups";

function maskKey(value: string | undefined): string {
  if (!value) return "—";
  const digits = value.replace(/\D/g, "");
  if (digits.length >= 8) return `…${digits.slice(-4)}`;
  return value.length > 8 ? `${value.slice(0, 4)}…` : value;
}

function statusTone(status: string): string {
  if (["accepted", "processed", "sent", "delivered", "read"].includes(status)) return "bg-[#edf8f6] text-[#0d6b61]";
  if (["failed", "rejected"].includes(status)) return "bg-[#fdf1ef] text-[#b3261e]";
  if (["unknown", "claimed", "dispatching", "scheduled"].includes(status)) return "bg-amber-50 text-amber-800";
  return "bg-slate-100 text-slate-600";
}

export default function AdminLogsPage() {
  const { locale, tr } = useI18n();
  const [tab, setTab] = useState<Tab>("events");
  const channels = useQuery(api.channels.list);
  const productChannels = useMemo(() => (channels ?? []).filter((c) => c.provider === "iasolution_hub" && c.operationalTerritory === "openbsp"), [channels]);
  const [channelId, setChannelId] = useState<Id<"channels"> | "">("");
  useEffect(() => {
    if (!channelId && productChannels.length > 0) setChannelId(productChannels[0]._id);
  }, [channelId, productChannels]);
  const [outboxStatus, setOutboxStatus] = useState<string>("all");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("tab");
    if (requested === "outbox" || requested === "audit" || requested === "followups" || requested === "events") setTab(requested);
    const status = params.get("status");
    if (status) setOutboxStatus(status);
  }, []);

  const events = useQuery(api.channels.listRecentEvents, tab === "events" && channelId ? { channelId, limit: 100 } : "skip");
  const outbox = useQuery(api.channels.listRecentOutbox, tab === "outbox" && channelId ? { channelId, limit: 200 } : "skip");
  const audit = usePaginatedQuery(api.audit.listPaginated, tab === "audit" ? {} : "skip", { initialNumItems: 40 });
  const followUps = usePaginatedQuery(api.followUps.listRecent, tab === "followups" ? {} : "skip", { initialNumItems: 40 });
  const now = Date.now();

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: "events", label: tr("Eventos do canal", "Channel events") },
    { key: "outbox", label: tr("Envios", "Sends") },
    { key: "audit", label: tr("Auditoria", "Audit trail") },
    { key: "followups", label: tr("Follow-ups", "Follow-ups") },
  ];

  const filteredOutbox = (outbox ?? []).filter((row) => outboxStatus === "all" || row.status === outboxStatus);

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader eyebrow="Admin" title={tr("Registos", "Logs")} description={tr("O que entrou, o que saiu e quem mudou o quê. Sem conteúdo bruto nem números completos.", "What came in, what went out and who changed what. No raw payloads or full numbers.")} />
      <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-5 sm:px-6 xl:px-8">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex flex-wrap rounded-lg border border-slate-200 bg-white p-1 text-[12px] font-semibold">
            {tabs.map((item) => (
              <button key={item.key} type="button" onClick={() => setTab(item.key)} className={cn("rounded-md px-3 py-1.5", tab === item.key ? "bg-[#0a1b33] text-white" : "text-slate-500")}>{item.label}</button>
            ))}
          </div>
          {(tab === "events" || tab === "outbox") && productChannels.length > 1 && (
            <select value={channelId} onChange={(e) => setChannelId(e.target.value as Id<"channels">)} className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-[12px] text-[#0a1b33] outline-none">
              {productChannels.map((c) => <option key={c._id} value={c._id}>{c.displayName}</option>)}
            </select>
          )}
          {tab === "outbox" && (
            <div className="flex flex-wrap gap-1">
              {["all", "accepted", "failed", "unknown", "dispatching"].map((status) => (
                <button key={status} type="button" onClick={() => setOutboxStatus(status)} className={cn("rounded-full border px-2 py-0.5 text-[11px] font-semibold", outboxStatus === status ? "border-[#0a1b33] bg-[#0a1b33] text-white" : "border-slate-200 text-slate-500")}>{status === "all" ? tr("Todos", "All") : status}</button>
              ))}
            </div>
          )}
        </div>

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          {tab === "events" && (
            events === undefined ? <Loading /> : events.length === 0 ? <Empty /> : (
              <Table
                head={[tr("Quando", "When"), tr("Tipo", "Kind"), tr("Direção", "Direction"), tr("Conversa", "Conversation"), tr("Estado", "Status")]}
                rows={events.map((row) => [relativeTime(row.receivedAt, now, locale), row.eventKind, row.direction, maskKey(row.threadKey), <Badge key="s" status={row.status} />])}
              />
            )
          )}
          {tab === "outbox" && (
            outbox === undefined ? <Loading /> : filteredOutbox.length === 0 ? <Empty /> : (
              <Table
                head={[tr("Quando", "When"), tr("Tipo", "Kind"), tr("Destinatário", "Recipient"), tr("Origem", "Origin"), tr("Estado", "Status"), tr("Motivo", "Reason")]}
                rows={filteredOutbox.map((row) => [
                  relativeTime(row.createdAt, now, locale),
                  row.messageKind,
                  maskKey(row.recipient),
                  row.businessKey.includes(":campaign:") || row.businessKey.includes(":micro:") ? tr("campanha", "campaign") : row.businessKey.includes(":followup:") ? "follow-up" : row.businessKey.includes(":automation:") ? tr("agente", "agent") : tr("equipa", "team"),
                  <Badge key="s" status={row.status} />,
                  row.failureReason ? blockReasonLabel(row.failureReason.match(/[A-Z][A-Z_]{3,}/)?.[0], locale) || row.failureReason.slice(0, 60) : "",
                ])}
              />
            )
          )}
          {tab === "audit" && (
            audit.status === "LoadingFirstPage" ? <Loading /> : audit.results.length === 0 ? <Empty /> : (
              <>
                <Table
                  head={[tr("Quando", "When"), tr("Ação", "Action"), tr("Alvo", "Target"), tr("Ator", "Actor"), "Hash"]}
                  rows={audit.results.map((row) => [relativeTime(row.createdAt, now, locale), row.action, `${row.targetType ?? ""} ${row.targetId ? maskKey(row.targetId) : ""}`, `${row.actorType}${row.actorRoleSnapshot ? ` · ${row.actorRoleSnapshot}` : ""}`, <code key="h" className="text-[10px] text-slate-400">{row.selfHash.slice(0, 10)}…</code>])}
                />
                {audit.status === "CanLoadMore" && <LoadMore onClick={() => audit.loadMore(40)} />}
              </>
            )
          )}
          {tab === "followups" && (
            followUps.status === "LoadingFirstPage" ? <Loading /> : followUps.results.length === 0 ? <Empty /> : (
              <>
                <Table
                  head={[tr("Quando", "When"), tr("Tipo", "Kind"), tr("Conversa", "Conversation"), tr("Estado", "Status"), tr("Tentativas", "Attempts"), tr("Detalhe", "Detail")]}
                  rows={followUps.results.map((row) => [relativeTime(row.dueAt, now, locale), row.kind, maskKey(row.threadKey), <Badge key="s" status={row.status} />, String(row.attempts), row.failureCode ? blockReasonLabel(row.failureCode, locale) : row.stoppedReason ?? ""])}
                />
                {followUps.status === "CanLoadMore" && <LoadMore onClick={() => followUps.loadMore(40)} />}
              </>
            )
          )}
        </section>
      </div>
    </div>
  );
}

function Loading() {
  const { tr } = useI18n();
  return <div className="flex items-center gap-2 px-4 py-6 text-sm text-slate-400"><Loader2 size={14} className="animate-spin" /> {tr("A carregar…", "Loading…")}</div>;
}
function Empty() {
  const { tr } = useI18n();
  return <div className="px-4 py-8 text-center text-[13px] text-slate-500">{tr("Sem registos.", "No records.")}</div>;
}
function LoadMore({ onClick }: { onClick: () => void }) {
  const { tr } = useI18n();
  return <div className="border-t border-slate-100 px-4 py-2"><button type="button" onClick={onClick} className="text-[12px] font-semibold text-[#2b4f8a] hover:underline">{tr("Carregar mais", "Load more")}</button></div>;
}
function Badge({ status }: { status: string }) {
  return <span className={cn("rounded-md px-2 py-0.5 text-[11px] font-semibold", statusTone(status))}>{status}</span>;
}
function Table({ head, rows }: { head: string[]; rows: Array<Array<string | React.ReactNode>> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-[0.12em] text-slate-400">
          <tr>{head.map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((cells, index) => (
            <tr key={index} className="hover:bg-slate-50">{cells.map((cell, i) => <td key={i} className="px-4 py-1.5 text-[#0a1b33]">{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
