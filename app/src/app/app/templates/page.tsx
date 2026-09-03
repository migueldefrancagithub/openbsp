"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery, useAction } from "convex/react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Eye,
  FileText,
  FilterX,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  XCircle,
} from "lucide-react";
import { PageHeader } from "@/components/app/EmptyState";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { friendlyId } from "@/lib/friendlyId";
import { relativeTime } from "@/lib/relativeTime";
import { useI18n, type Locale } from "@/lib/i18n";
import { convexErrorMessage } from "@/lib/convexErrorMessage";

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-surface-3 text-body border-line",
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected: "bg-red-50 text-red-700 border-red-200",
  paused: "bg-surface-3 text-muted border-line",
  disabled: "bg-surface-3 text-faint border-line",
};

export default function TemplatesPage() {
  const { locale, tr } = useI18n();
  const templates = useQuery(api.templates.list);
  const sync = useAction(api.templates.syncFromMeta);
  const channels = useQuery(api.channels.list);
  const hubChannel = useMemo(
    () =>
      (channels ?? []).find(
        (channel) =>
          channel.provider === "iasolution_hub" &&
          channel.operationalTerritory === "openbsp",
      ),
    [channels],
  );
  const [syncing, setSyncing] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");

  const filteredTemplates = useMemo(() => {
    const term = query.trim().toLowerCase();
    return (templates ?? []).filter((template) => {
      const matchesQuery =
        term.length === 0 ||
        template.name.toLowerCase().includes(term) ||
        template.language.toLowerCase().includes(term);
      const matchesCategory =
        category === "all" || template.category === category;
      const matchesStatus = status === "all" || template.status === status;
      return matchesQuery && matchesCategory && matchesStatus;
    });
  }, [templates, query, category, status]);
  const templateStats = useMemo(() => {
    const rows = templates ?? [];
    return {
      approved: rows.filter((template) => template.status === "approved").length,
      pending: rows.filter((template) => template.status === "pending").length,
      blocked: rows.filter((template) =>
        ["rejected", "paused", "disabled"].includes(template.status),
      ).length,
      withVariables: rows.filter((template) => template.parameterCount > 0).length,
    };
  }, [templates]);

  async function onSync() {
    setSyncing(true);
    try {
      await sync({});
    } finally {
      setSyncing(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow={tr("Mensagens aprovadas pela Meta", "Meta-approved messages")}
        title="Templates"
        description={tr(
          "Mensagens versionadas para iniciar ou continuar atendimentos com segurança.",
          "Versioned messages for starting or continuing conversations safely.",
        )}
        action={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onSync}
              disabled={syncing || (templates?.length ?? 0) === 0}
              className="inline-flex items-center gap-2 bg-surface text-ink text-[13px] font-medium px-3 py-2 rounded-lg border border-line hover:border-line disabled:opacity-50 transition-all"
            >
              {syncing ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} strokeWidth={2} />
              )}
              {tr("Sincronizar com a Meta", "Sync from Meta")}
            </button>
            <Link
              href="/app/templates/new"
              className="inline-flex items-center gap-2 bg-nav-active text-white text-[13px] font-medium px-4 py-2 rounded-lg shadow-[0_8px_24px_-8px_rgba(10,21,45,0.5)] hover:bg-brand-solid transition-all"
            >
              <Plus size={14} strokeWidth={2.5} />
              {tr("Novo template", "New template")}
            </Link>
          </div>
        }
      />

      <div className="max-w-7xl space-y-5 px-4 py-5 sm:px-6 sm:py-6">
        {templates === undefined ? (
          <div className="text-sm text-faint">{tr("A carregar...", "Loading...")}</div>
        ) : templates.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line bg-surface p-8 text-center sm:p-12">
            <FileText size={28} className="mx-auto text-faint mb-3" />
            <h2 className="font-[var(--font-outfit)] text-[18px] font-medium text-ink">
              {tr("Ainda não há templates", "No templates yet")}
            </h2>
            <p className="text-muted text-sm mt-1.5 max-w-md mx-auto leading-relaxed">
              {tr(
                "É necessário um template aprovado para iniciar conversas fora da janela de atendimento de 24 horas.",
                "An approved template is required to start conversations outside the 24-hour service window.",
              )}
            </p>
            <Link
              href="/app/templates/new"
              className="inline-flex items-center gap-2 bg-nav-active text-white text-[13px] font-medium px-4 py-2 rounded-lg mt-5 hover:bg-brand-solid transition-all"
            >
              <Plus size={14} strokeWidth={2.5} />
              {tr("Criar primeiro template", "Create your first template")}
            </Link>
          </div>
        ) : (
          <>
            <section className="rounded-lg border border-line bg-surface p-4">
              <div className="mb-4 grid gap-3 md:grid-cols-4">
                <TemplateStat
                  icon={CheckCircle2}
                  label={tr("Aprovados", "Approved")}
                  value={templateStats.approved}
                  tone="good"
                />
                <TemplateStat
                  icon={Clock3}
                  label={tr("Em análise", "Pending Meta")}
                  value={templateStats.pending}
                  tone="warn"
                />
                <TemplateStat
                  icon={XCircle}
                  label={tr("Bloqueados", "Blocked")}
                  value={templateStats.blocked}
                  tone="bad"
                />
                <TemplateStat
                  icon={FileText}
                  label={tr("Com variáveis", "With variables")}
                  value={templateStats.withVariables}
                  tone="neutral"
                />
              </div>
              <div className="grid gap-3 lg:grid-cols-[1fr_220px_220px_auto]">
                <label className="relative block">
                  <Search
                    size={16}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
                  />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={tr("Pesquisar templates...", "Search templates...")}
                    className="h-11 w-full rounded-lg border border-line bg-surface pl-10 pr-3 text-sm text-ink outline-none transition-colors placeholder:text-faint focus:border-brand-solid/40"
                  />
                </label>
                <select
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  className="h-11 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-ink outline-none focus:border-brand-solid/40"
                >
                  <option value="all">{tr("Todas as categorias", "All categories")}</option>
                  <option value="marketing">Marketing</option>
                  <option value="utility">{tr("Utilidade", "Utility")}</option>
                  <option value="authentication">{tr("Autenticação", "Authentication")}</option>
                </select>
                <select
                  value={status}
                  onChange={(event) => setStatus(event.target.value)}
                  className="h-11 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-ink outline-none focus:border-brand-solid/40"
                >
                  <option value="all">{tr("Todos os estados", "All statuses")}</option>
                  <option value="draft">{tr("Rascunho", "Draft")}</option>
                  <option value="pending">{tr("Em análise", "Pending")}</option>
                  <option value="approved">{tr("Aprovado", "Approved")}</option>
                  <option value="rejected">{tr("Rejeitado", "Rejected")}</option>
                  <option value="paused">{tr("Pausado", "Paused")}</option>
                  <option value="disabled">{tr("Desativado", "Disabled")}</option>
                </select>
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setCategory("all");
                    setStatus("all");
                  }}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-ink transition-colors hover:border-line"
                >
                  <FilterX size={15} />
                  {tr("Limpar filtros", "Reset filters")}
                </button>
              </div>
            </section>

            <div className="overflow-hidden rounded-lg border border-line bg-surface">
              <ul className="divide-y divide-line-soft">
                {filteredTemplates.map((t) => (
                  <li
                    key={t._id}
                    className="grid gap-4 px-5 py-4 transition-colors hover:bg-surface-2 lg:grid-cols-[1fr_auto]"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-[15px] font-semibold text-ink">
                          {t.name}
                        </span>
                        <span className="text-[10px] text-faint font-[var(--font-mono)]">
                          {friendlyId("TPL", t._id)}
                        </span>
                        <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase text-sky-700">
                          {categoryLabel(t.category, locale)}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase ${STATUS_STYLES[t.status] ?? STATUS_STYLES.draft}`}
                        >
                          {t.status === "approved" && <CheckCircle2 size={12} />}
                          {statusLabel(t.status, locale)}
                        </span>
                      </div>
                      <div className="mt-1 text-[12px] text-muted capitalize">
                        {t.language} · v{t.currentVersion}
                        {t.syncedAt && ` · ${tr("sincronizado", "synced")} ${relativeTime(t.syncedAt, Date.now(), locale)}`}
                        {t.parameterCount > 0 &&
                          ` · ${t.parameterCount} ${locale === "pt" ? (t.parameterCount === 1 ? "variável" : "variáveis") : (t.parameterCount === 1 ? "variable" : "variables")}`}
                      </div>
                      {templateReadiness(t.status, t.rejectionReason, locale) && (
                        <div
                          className={`mt-2 inline-flex max-w-full items-start gap-2 rounded-lg border px-2.5 py-1.5 text-[12px] ${templateReadinessClass(
                            t.status,
                          )}`}
                        >
                          {templateReadinessIcon(t.status)}
                          <span className="min-w-0 truncate">
                            {templateReadiness(t.status, t.rejectionReason, locale)}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                      <Link
                        href={`/app/templates/${t._id}`}
                        className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-ink transition-colors hover:border-line"
                      >
                        <Eye size={15} />
                        {tr("Pré-visualizar", "Preview")}
                      </Link>
                      <Link
                        href={`/app/templates/${t._id}`}
                        className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-ink transition-colors hover:border-line"
                      >
                        <Pencil size={15} />
                        {tr("Editar", "Edit")}
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
              {filteredTemplates.length === 0 && (
                <div className="p-10 text-center">
                  <FileText size={26} className="mx-auto text-faint" />
                  <h2 className="mt-3 font-[var(--font-outfit)] text-lg font-semibold text-ink">
                    {tr("Nenhum template corresponde", "No templates match")}
                  </h2>
                  <p className="mt-1 text-sm text-muted">
                    {tr("Limpe os filtros ou sincronize novamente com a Meta.", "Clear filters or sync from Meta again.")}
                  </p>
                </div>
              )}
            </div>
            <div className="text-sm text-muted">
              {tr("A mostrar", "Showing")} {filteredTemplates.length} {tr("de", "of")} {templates.length} templates
            </div>
          </>
        )}
        {hubChannel && <HubTemplatesSection channelId={hubChannel._id} />}
      </div>
    </>
  );
}

function TemplateStat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof CheckCircle2;
  label: string;
  value: number;
  tone: "good" | "warn" | "bad" | "neutral";
}) {
  const toneClass =
    tone === "good"
      ? "border-emerald-100 bg-emerald-50 text-emerald-700"
      : tone === "warn"
        ? "border-amber-100 bg-amber-50 text-amber-700"
        : tone === "bad"
          ? "border-red-100 bg-red-50 text-red-700"
          : "border-line bg-surface-2 text-body";
  return (
    <div className={`rounded-lg border p-3 ${toneClass}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-[0.12em] opacity-75">
          {label}
        </span>
        <Icon size={15} />
      </div>
      <div className="mt-2 text-xl font-semibold">{value}</div>
    </div>
  );
}

function templateReadiness(status: string, reason: string | undefined, locale: Locale) {
  const pt = locale === "pt";
  if (status === "approved") return pt ? "Pronto para campanhas e mensagens de atendimento." : "Ready for campaigns and service-window sends.";
  if (status === "pending") return pt ? "A aguardar revisão da Meta. Ainda não pode ser usado em envios." : "Waiting for Meta review. Do not use in launches yet.";
  if (status === "rejected") {
    return reason
      ? `${pt ? "Rejeitado" : "Rejected"}: ${reason}`
      : pt
        ? "Rejeitado pela Meta. Corrija a mensagem e submeta uma nova versão."
        : "Rejected by Meta. Fix copy and submit a new version.";
  }
  if (status === "paused") return pt ? "Pausado pela Meta. Evite campanhas até a qualidade recuperar." : "Paused by Meta. Avoid campaigns until quality recovers.";
  if (status === "disabled") return pt ? "Desativado pela Meta. Retire-o dos fluxos de campanha." : "Disabled by Meta. Remove from campaign flows.";
  if (status === "draft") return pt ? "Apenas rascunho. Submeta à Meta antes de usar fora das 24 horas." : "Draft only. Submit to Meta before using outside 24h windows.";
  return "";
}

function statusLabel(status: string, locale: Locale) {
  const labels: Record<string, [string, string]> = {
    draft: ["Rascunho", "Draft"],
    pending: ["Em análise", "Pending"],
    approved: ["Aprovado", "Approved"],
    rejected: ["Rejeitado", "Rejected"],
    paused: ["Pausado", "Paused"],
    disabled: ["Desativado", "Disabled"],
  };
  const label = labels[status];
  return label ? label[locale === "pt" ? 0 : 1] : status;
}

function categoryLabel(category: string, locale: Locale) {
  const labels: Record<string, [string, string]> = {
    marketing: ["Marketing", "Marketing"],
    utility: ["Utilidade", "Utility"],
    authentication: ["Autenticação", "Authentication"],
  };
  const label = labels[category];
  return label ? label[locale === "pt" ? 0 : 1] : category;
}

function templateReadinessClass(status: string) {
  if (status === "approved") return "border-emerald-100 bg-emerald-50 text-emerald-700";
  if (status === "pending" || status === "draft") {
    return "border-amber-100 bg-amber-50 text-amber-800";
  }
  return "border-red-100 bg-red-50 text-red-700";
}

function templateReadinessIcon(status: string) {
  if (status === "approved") return <CheckCircle2 size={14} className="mt-0.5 shrink-0" />;
  if (status === "pending" || status === "draft") {
    return <AlertTriangle size={14} className="mt-0.5 shrink-0" />;
  }
  return <XCircle size={14} className="mt-0.5 shrink-0" />;
}

/**
 * Templates on the isolated Hub channel are approved on the channel itself and
 * mirrored into `channelTemplates`. Hub-only workspaces have no Meta-direct
 * templates, so this is the list the inbox composer actually uses.
 */
function HubTemplatesSection({ channelId }: { channelId: Id<"channels"> }) {
  const { locale, tr } = useI18n();
  const rows = useQuery(api.channels.listTemplates, { channelId });
  const syncHub = useAction(api.iaSolutionHub.syncTemplates);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function onSyncHub() {
    setSyncing(true);
    setNotice(null);
    try {
      const result = await syncHub({ channelId });
      setNotice(
        locale === "pt"
          ? `${result.upserted} templates sincronizados do canal.`
          : `${result.upserted} templates synced from the channel.`,
      );
    } catch (error) {
      setNotice(convexErrorMessage(error, locale));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-[14px] font-semibold text-ink">
            {tr("Templates do canal do piloto", "Pilot channel templates")}
          </h2>
          <p className="mt-0.5 text-[12px] text-muted">
            {tr(
              "Aprovados no canal WhatsApp do piloto. São estes que o inbox usa fora da janela de 24h.",
              "Approved on the pilot WhatsApp channel. These are the ones the inbox uses outside the 24h window.",
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void onSyncHub()}
          disabled={syncing}
          className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-[13px] font-medium text-ink hover:border-line disabled:opacity-50"
        >
          {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} strokeWidth={2} />}
          {tr("Sincronizar do canal", "Sync from channel")}
        </button>
      </div>
      {notice && <p className="mt-3 text-[12px] text-body">{notice}</p>}
      {rows === undefined ? (
        <p className="mt-4 text-[12px] text-faint">{tr("A carregar...", "Loading...")}</p>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-[12px] text-muted">
          {tr(
            "Ainda não há templates sincronizados. Aprove templates no Hub e sincronize.",
            "No templates synced yet. Approve templates on the Hub, then sync.",
          )}
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-line-soft rounded-lg border border-line-soft">
          {rows.map((row) => (
            <li key={row._id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold text-ink">{row.name}</div>
                <div className="text-[10px] uppercase tracking-wide text-faint">
                  {row.languageCode}
                  {row.category ? ` · ${row.category}` : ""}
                </div>
              </div>
              <span
                className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
                  ["approved", "active"].includes(row.status.toLowerCase())
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-amber-200 bg-amber-50 text-amber-700"
                }`}
              >
                {row.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
