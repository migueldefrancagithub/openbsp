"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { AlertTriangle, CheckCircle2, Loader2, ShieldAlert, Users } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { LEAD_STATUSES, leadColumnTone, type LeadStatus } from "@/components/leads/leadStatuses";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import { blockReasonLabel, leadStatusLabel } from "./campaignLabels";

export type AudienceDraft = {
  mode: "filters" | "picked";
  leadStatuses: LeadStatus[];
  tags: string;
  inboundWithinDays: number | undefined;
  excludeDnd: boolean;
  excludeLost: boolean;
  excludeRecentCampaignDays: number | undefined;
  threadKeys: string;
};

export const DEFAULT_AUDIENCE: AudienceDraft = {
  mode: "filters",
  leadStatuses: ["interested", "asked_price", "wants_booking"],
  tags: "",
  inboundWithinDays: 30,
  excludeDnd: true,
  excludeLost: true,
  excludeRecentCampaignDays: 7,
  threadKeys: "",
};

export function toAudienceArgs(draft: AudienceDraft) {
  if (draft.mode === "picked") {
    return {
      threadKeys: draft.threadKeys
        .split(/[\s,;]+/)
        .map((v) => v.replace(/\D/g, ""))
        .filter((v) => v.length >= 8),
      excludeDnd: draft.excludeDnd,
      excludeLost: draft.excludeLost,
      excludeRecentCampaignDays: draft.excludeRecentCampaignDays,
    };
  }
  const tags = draft.tags
    .split(/[,;]+/)
    .map((v) => v.trim())
    .filter(Boolean);
  return {
    leadStatuses: draft.leadStatuses.length > 0 ? draft.leadStatuses : undefined,
    tags: tags.length > 0 ? tags : undefined,
    inboundWithinDays: draft.inboundWithinDays,
    excludeDnd: draft.excludeDnd,
    excludeLost: draft.excludeLost,
    excludeRecentCampaignDays: draft.excludeRecentCampaignDays,
  };
}

const BLOCK_ORDER = [
  "RECIPIENT_NOT_ALLOWLISTED",
  "SERVICE_WINDOW_EXPIRED",
  "RECENT_CAMPAIGN",
  "DND",
  "OPT_OUT",
  "LOST",
  "INVALID_RECIPIENT",
] as const;

export function AudienceBuilder({
  channelId,
  kind,
  draft,
  onChange,
}: {
  channelId: Id<"channels"> | "";
  kind: "channel_template" | "channel_text";
  draft: AudienceDraft;
  onChange: (next: AudienceDraft) => void;
}) {
  const { locale, tr } = useI18n();
  const [showSample, setShowSample] = useState(false);
  const args = useMemo(() => toAudienceArgs(draft), [draft]);
  const preview = useQuery(
    api.channelCampaigns.previewAudience,
    channelId ? { channelId, audience: args, kind } : "skip",
  );

  function toggleStatus(status: LeadStatus) {
    const has = draft.leadStatuses.includes(status);
    onChange({
      ...draft,
      leadStatuses: has ? draft.leadStatuses.filter((s) => s !== status) : [...draft.leadStatuses, status],
    });
  }

  const inputClass =
    "h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-brand-solid/40";

  return (
    <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]">
      <div className="space-y-5">
        <div className="inline-flex rounded-lg border border-line bg-surface-2 p-1 text-[12px] font-semibold">
          {(["filters", "picked"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onChange({ ...draft, mode })}
              className={cn(
                "rounded-md px-3 py-1.5",
                draft.mode === mode ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
              )}
            >
              {mode === "filters" ? tr("Por etapa e filtros", "By stage and filters") : tr("Conversas escolhidas", "Picked conversations")}
            </button>
          ))}
        </div>

        {draft.mode === "filters" ? (
          <>
            <div>
              <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-faint">
                {tr("Etapas do lead", "Lead stages")}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {LEAD_STATUSES.map((status) => {
                  const active = draft.leadStatuses.includes(status);
                  const tone = leadColumnTone(status);
                  return (
                    <button
                      key={status}
                      type="button"
                      onClick={() => toggleStatus(status)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-semibold transition-colors",
                        active ? "border-brand-solid bg-brand-solid text-white" : "border-line bg-surface text-body hover:border-line",
                      )}
                    >
                      <span className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-surface" : tone.accent)} />
                      {leadStatusLabel(status, locale)}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[11px] text-muted">
                {tr("Sem etapas selecionadas = todas as conversas do canal.", "No stage selected = every conversation on the channel.")}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-[11px] font-medium text-muted">{tr("Última mensagem há menos de", "Last message within")}</span>
                <select
                  value={draft.inboundWithinDays ?? ""}
                  onChange={(e) => onChange({ ...draft, inboundWithinDays: e.target.value ? Number(e.target.value) : undefined })}
                  className={`mt-1 ${inputClass}`}
                >
                  <option value="7">{tr("7 dias", "7 days")}</option>
                  <option value="30">{tr("30 dias", "30 days")}</option>
                  <option value="90">{tr("90 dias", "90 days")}</option>
                  <option value="">{tr("Sem limite", "No limit")}</option>
                </select>
              </label>
              <label className="block">
                <span className="text-[11px] font-medium text-muted">{tr("Etiquetas (separadas por vírgula)", "Tags (comma separated)")}</span>
                <input
                  value={draft.tags}
                  onChange={(e) => onChange({ ...draft, tags: e.target.value })}
                  placeholder={tr("ex.: ortodontia, grupo:vip", "e.g. orthodontics, group:vip")}
                  className={`mt-1 ${inputClass}`}
                />
              </label>
            </div>
          </>
        ) : (
          <label className="block">
            <span className="text-[11px] font-medium text-muted">
              {tr("Números (um por linha, até 200)", "Numbers (one per line, up to 200)")}
            </span>
            <textarea
              value={draft.threadKeys}
              onChange={(e) => onChange({ ...draft, threadKeys: e.target.value })}
              rows={6}
              placeholder={"258840000001\n258840000002"}
              className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 font-mono text-[13px] text-ink outline-none focus:border-brand-solid/40"
            />
            <p className="mt-1.5 text-[11px] text-muted">
              {tr("Só conversas já existentes no canal podem receber campanhas.", "Only conversations that already exist on the channel can receive campaigns.")}
            </p>
          </label>
        )}

        <div className="grid gap-3 rounded-lg border border-line bg-surface-2 p-4 sm:grid-cols-3">
          <label className="flex items-center gap-2 text-[13px] text-ink">
            <input type="checkbox" checked={draft.excludeDnd} onChange={(e) => onChange({ ...draft, excludeDnd: e.target.checked })} className="h-4 w-4 accent-[#0a1b33]" />
            {tr("Excluir “não incomodar”", "Exclude do-not-disturb")}
          </label>
          <label className="flex items-center gap-2 text-[13px] text-ink">
            <input type="checkbox" checked={draft.excludeLost} onChange={(e) => onChange({ ...draft, excludeLost: e.target.checked })} className="h-4 w-4 accent-[#0a1b33]" />
            {tr("Excluir perdidos", "Exclude lost")}
          </label>
          <label className="block text-[13px] text-ink">
            <span className="text-[11px] font-medium text-muted">{tr("Sem campanha nos últimos", "No campaign in the last")}</span>
            <select
              value={draft.excludeRecentCampaignDays ?? ""}
              onChange={(e) => onChange({ ...draft, excludeRecentCampaignDays: e.target.value ? Number(e.target.value) : undefined })}
              className="mt-1 h-9 w-full rounded-lg border border-line bg-surface px-2 text-[13px] outline-none"
            >
              <option value="">{tr("Não filtrar", "Do not filter")}</option>
              <option value="7">{tr("7 dias", "7 days")}</option>
              <option value="30">{tr("30 dias", "30 days")}</option>
            </select>
          </label>
        </div>
      </div>

      <aside className="space-y-3 rounded-lg border border-line bg-surface p-4">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-ink">
          <Users size={15} />
          {tr("Pré-visualização do público", "Audience preview")}
          {channelId && preview === undefined && <Loader2 size={14} className="animate-spin text-faint" />}
        </div>
        {!channelId ? (
          <p className="text-[13px] text-muted">{tr("Escolha um canal.", "Pick a channel.")}</p>
        ) : preview === undefined ? (
          <div className="h-24 animate-pulse rounded-lg bg-surface-2" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-[#0d6b61]/30 bg-[#edf8f6] px-3 py-2">
                <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-[#0d6b61]">{tr("Elegíveis", "Eligible")}</div>
                <div className="font-[var(--font-outfit)] text-[24px] font-medium text-[#0d6b61]">{preview.eligible}</div>
              </div>
              <div className="rounded-lg border border-line bg-surface-2 px-3 py-2">
                <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-faint">{tr("Encontradas", "Matched")}</div>
                <div className="font-[var(--font-outfit)] text-[24px] font-medium text-ink">
                  {preview.matched}
                  {preview.capped && <span className="ml-1 text-[12px] text-faint">+</span>}
                </div>
              </div>
            </div>
            {!preview.pilotReady && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                <ShieldAlert size={14} className="mt-0.5 shrink-0" />
                {tr(
                  "O canal não está pronto para envios (kill switch do piloto). Pode preparar a campanha, mas o lançamento fica bloqueado.",
                  "The channel is not ready to send (pilot kill switch). You can prepare the campaign but launching is blocked.",
                )}
              </div>
            )}
            <ul className="space-y-1 text-[12px]">
              {BLOCK_ORDER.filter((code) => preview.blocked[code] > 0).map((code) => (
                <li key={code} className="flex items-center justify-between gap-2 text-body">
                  <span className="flex items-center gap-1.5">
                    <AlertTriangle size={12} className="text-amber-500" />
                    {blockReasonLabel(code, locale)}
                  </span>
                  <span className="font-semibold text-ink">{preview.blocked[code]}</span>
                </li>
              ))}
              {preview.matched > 0 && preview.eligible === preview.matched && (
                <li className="flex items-center gap-1.5 text-[#0d6b61]">
                  <CheckCircle2 size={12} /> {tr("Nenhum bloqueio.", "Nothing blocked.")}
                </li>
              )}
            </ul>
            {preview.sample.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowSample((v) => !v)}
                  className="text-[12px] font-semibold text-[#2b4f8a] hover:underline"
                >
                  {showSample ? tr("Esconder amostra", "Hide sample") : tr("Ver amostra", "Show sample")}
                </button>
                {showSample && (
                  <ul className="mt-2 divide-y divide-line-soft rounded-lg border border-line-soft">
                    {preview.sample.map((row) => (
                      <li key={row.threadId} className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-[12px]">
                        <span className="min-w-0 truncate text-ink">{row.label}</span>
                        <span className={cn("shrink-0 text-[11px]", row.blocked ? "text-amber-700" : "text-[#0d6b61]")}>
                          {row.blocked ? blockReasonLabel(row.blocked, locale) : leadStatusLabel(row.leadStatus, locale)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </aside>
    </div>
  );
}
