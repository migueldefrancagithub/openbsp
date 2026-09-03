"use client";

import { useState } from "react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { Copy, KeyRound, Loader2, Plug, Plus, RefreshCw, Trash2, Webhook } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { cn } from "@/lib/cn";
import { convexErrorMessage } from "@/lib/convexErrorMessage";
import { useI18n } from "@/lib/i18n";
import { relativeTime } from "@/lib/relativeTime";

const inputClass = "mt-1 h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-brand-solid/40";

export function IntegrationsSection() {
  const { locale, tr } = useI18n();
  const hooks = useQuery(api.outboundWebhooks.list, {});
  const eventTypes = useQuery(api.outboundWebhooks.eventTypes, {});
  const create = useMutation(api.outboundWebhooks.create);
  const update = useMutation(api.outboundWebhooks.update);
  const rotate = useMutation(api.outboundWebhooks.rotateSecret);
  const remove = useMutation(api.outboundWebhooks.remove);
  const [form, setForm] = useState<{ name: string; url: string; events: string[] } | null>(null);
  const [secret, setSecret] = useState<{ name: string; value: string } | null>(null);
  const [selected, setSelected] = useState<Id<"outboundWebhooks"> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="space-y-6">
      {error && <div className="rounded-lg border border-[#e0533d]/30 bg-chip-danger px-4 py-3 text-sm text-chip-danger-fg">{error}</div>}
      {secret && (
        <div className="rounded-lg border border-[#0d6b61]/30 bg-chip-success p-4 text-[13px] text-ink">
          <div className="mb-1 flex items-center gap-2 font-semibold"><KeyRound size={14} /> {tr(`Segredo do webhook "${secret.name}" — copie agora, não volta a ser mostrado.`, `Secret for webhook "${secret.name}" — copy it now, it will not be shown again.`)}</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-md bg-surface px-2 py-1 text-[12px]">{secret.value}</code>
            <button type="button" onClick={() => void navigator.clipboard?.writeText(secret.value)} className="inline-flex h-8 items-center gap-1 rounded-md border border-line bg-surface px-2 text-[11px] font-semibold text-ink"><Copy size={12} /> {tr("Copiar", "Copy")}</button>
            <button type="button" onClick={() => setSecret(null)} className="text-[11px] font-semibold text-muted">{tr("Fechar", "Close")}</button>
          </div>
        </div>
      )}

      <section className="overflow-hidden rounded-lg border border-line bg-surface">
        <div className="flex flex-col gap-3 border-b border-line-soft px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Webhook size={16} className="text-ink" />
            <div>
              <h2 className="text-[15px] font-semibold text-ink">Webhooks</h2>
              <p className="text-xs text-muted">{tr("Eventos assinados (HMAC-SHA256) para n8n, Google Sheets, CRM. Reenvio com backoff até 8 tentativas; pausa após 20 falhas seguidas.", "Signed events (HMAC-SHA256) for n8n, Google Sheets, CRM. Retried with backoff up to 8 times; paused after 20 consecutive failures.")}</p>
            </div>
          </div>
          <button type="button" onClick={() => setForm({ name: "", url: "", events: ["appointment.booked", "human_case.opened"] })} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-[12px] font-semibold text-ink"><Plus size={14} /> {tr("Novo webhook", "New webhook")}</button>
        </div>
        <div className="p-6">
          {form && (
            <div className="mb-4 space-y-3 rounded-lg border border-line bg-surface-2 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-[11px] font-medium text-muted">{tr("Nome", "Name")}<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} maxLength={80} /></label>
                <label className="block text-[11px] font-medium text-muted">URL (https)<input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://hooks.example.com/openbsp" className={inputClass} /></label>
              </div>
              <div className="text-[11px] font-medium text-muted">
                {tr("Eventos", "Events")}
                <div className="mt-2 flex flex-wrap gap-1">
                  {(eventTypes ?? []).map((type) => {
                    const on = form.events.includes(type);
                    return <button key={type} type="button" onClick={() => setForm({ ...form, events: on ? form.events.filter((e) => e !== type) : [...form.events, type] })} className={cn("rounded-full border px-2.5 py-1 text-[11px] font-semibold", on ? "border-brand-solid bg-brand-solid text-white" : "border-line bg-surface text-body")}>{type}</button>;
                  })}
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setForm(null)} className="h-9 rounded-lg border border-line px-3 text-[12px] font-semibold text-body">{tr("Cancelar", "Cancel")}</button>
                <button type="button" disabled={busy !== null || form.name.trim().length < 2 || !form.url.startsWith("https://") || form.events.length === 0} onClick={() => void run("create", async () => { const result = await create({ name: form.name, url: form.url, events: form.events }); setSecret({ name: form.name, value: result.secret }); setForm(null); setSelected(result.webhookId); })} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-solid px-3 text-[12px] font-semibold text-white disabled:opacity-50">{busy === "create" && <Loader2 size={12} className="animate-spin" />} {tr("Criar", "Create")}</button>
              </div>
            </div>
          )}
          {hooks === undefined ? <Loader2 size={15} className="animate-spin text-faint" /> : hooks.length === 0 ? <p className="text-[13px] text-muted">{tr("Ainda sem webhooks.", "No webhooks yet.")}</p> : (
            <ul className="divide-y divide-line-soft">
              {hooks.map((hook) => (
                <li key={hook._id} className="py-2">
                  <div className="flex items-center justify-between gap-3">
                    <button type="button" onClick={() => setSelected(selected === hook._id ? null : hook._id)} className="min-w-0 flex-1 text-left">
                      <div className="flex items-center gap-2 text-[13px] font-semibold text-ink"><span className={cn("h-2 w-2 rounded-full", hook.active && !hook.pausedAt ? "bg-[#0d6b61]" : hook.pausedAt ? "bg-[#e0533d]" : "bg-faint/50")} /><span className="truncate">{hook.name}</span></div>
                      <div className="truncate text-[11px] text-muted">{hook.url} · {hook.events.length} {tr("eventos", "events")} · ••••{hook.secretLast4}{hook.pausedAt ? ` · ${tr("pausado", "paused")} (${hook.pausedReason})` : ""}{hook.lastDeliveredAt ? ` · ${tr("última entrega", "last delivery")} ${relativeTime(hook.lastDeliveredAt, Date.now(), locale)}` : ""}</div>
                    </button>
                    <div className="flex shrink-0 gap-1.5">
                      {hook.pausedAt && hook.pausedReason !== "removed" && <button type="button" disabled={busy !== null} onClick={() => void run(`resume-${hook._id}`, () => update({ webhookId: hook._id, active: true }))} className="h-8 rounded-md border border-line px-2 text-[11px] font-semibold text-chip-success-fg">{tr("Reativar", "Reactivate")}</button>}
                      {hook.active && !hook.pausedAt && (
                        <>
                          <button type="button" disabled={busy !== null} onClick={() => void run(`rotate-${hook._id}`, async () => { const r = await rotate({ webhookId: hook._id }); setSecret({ name: hook.name, value: r.secret }); })} className="inline-flex h-8 items-center gap-1 rounded-md border border-line px-2 text-[11px] font-semibold text-body" title={tr("Rodar segredo", "Rotate secret")}><RefreshCw size={12} /></button>
                          <button type="button" disabled={busy !== null} onClick={() => { if (window.confirm(tr("Desativar este webhook?", "Deactivate this webhook?"))) void run(`remove-${hook._id}`, () => remove({ webhookId: hook._id })); }} className="inline-flex h-8 items-center rounded-md border border-line px-2 text-[11px] font-semibold text-muted hover:text-chip-danger-fg"><Trash2 size={12} /></button>
                        </>
                      )}
                    </div>
                  </div>
                  {selected === hook._id && <Deliveries webhookId={hook._id} />}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-line bg-surface p-6">
        <div className="flex items-center gap-2 text-[15px] font-semibold text-ink"><Plug size={16} /> {tr("API REST e receitas", "REST API and recipes")}</div>
        <p className="mt-1 text-[12px] text-muted">{tr("As chaves de API ficam em Definições › Equipa. A documentação de integrações (assinatura, eventos, n8n, Google Sheets, REST v1) está em docs/INTEGRATIONS.md no repositório.", "API keys live in Settings › Team. The integrations guide (signature, events, n8n, Google Sheets, REST v1) is in docs/INTEGRATIONS.md in the repository.")}</p>
      </section>
    </div>
  );
}

function Deliveries({ webhookId }: { webhookId: Id<"outboundWebhooks"> }) {
  const { locale, tr } = useI18n();
  const deliveries = usePaginatedQuery(api.outboundWebhooks.listDeliveries, { webhookId }, { initialNumItems: 15 });
  const retry = useMutation(api.outboundWebhooks.retryDelivery);
  const now = Date.now();
  return (
    <div className="mt-2 rounded-lg border border-line-soft bg-surface-2 p-2 text-[11px]">
      {deliveries.status === "LoadingFirstPage" ? <Loader2 size={12} className="animate-spin text-faint" /> : deliveries.results.length === 0 ? <span className="text-faint">{tr("Sem entregas ainda.", "No deliveries yet.")}</span> : (
        <ul className="divide-y divide-line">
          {deliveries.results.map((d) => (
            <li key={d._id} className="flex items-center justify-between gap-2 py-1">
              <span className="min-w-0 truncate text-ink">{d.eventType} <span className="text-faint">· {relativeTime(d.createdAt, now, locale)}</span></span>
              <span className="flex shrink-0 items-center gap-2">
                <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", d.status === "delivered" ? "bg-chip-success text-chip-success-fg" : d.status === "dead" ? "bg-chip-danger text-chip-danger-fg" : "bg-chip-warn text-chip-warn-fg")}>{d.status}{d.lastStatus ? ` ${d.lastStatus}` : ""} · {d.attempts}×</span>
                {(d.status === "failed" || d.status === "dead") && <button type="button" onClick={() => void retry({ deliveryId: d._id })} className="font-semibold text-chip-info-fg">{tr("Repetir", "Retry")}</button>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {deliveries.status === "CanLoadMore" && <button type="button" onClick={() => deliveries.loadMore(15)} className="mt-1 font-semibold text-chip-info-fg">{tr("Carregar mais", "Load more")}</button>}
    </div>
  );
}
