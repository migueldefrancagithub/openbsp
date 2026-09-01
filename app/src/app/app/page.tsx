"use client";

import { useQuery } from "convex/react";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FilePlus2,
  Inbox,
  MessageCircle,
  MousePointerClick,
  Radio,
  Send,
  ShieldCheck,
  Sparkles,
  UserRoundCheck,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { api } from "../../../convex/_generated/api";
import { relativeTime } from "@/lib/relativeTime";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { ClinicOpsPanel } from "@/components/operation/ClinicOpsPanel";

type LeadStatus =
  | "new"
  | "interested"
  | "asked_price"
  | "wants_booking"
  | "awaiting_human"
  | "booked"
  | "confirmed"
  | "lost";

type ActionTone = "good" | "warn" | "action";

const LEAD_STATUSES: LeadStatus[] = [
  "new",
  "interested",
  "asked_price",
  "wants_booking",
  "awaiting_human",
  "booked",
  "confirmed",
  "lost",
];

const STATUS_KEYS: Record<LeadStatus, TranslationKey> = {
  new: "status.new",
  interested: "status.interested",
  asked_price: "status.asked_price",
  wants_booking: "status.wants_booking",
  awaiting_human: "status.awaiting_human",
  booked: "status.booked",
  confirmed: "status.confirmed",
  lost: "status.lost",
};

const QUICK_CREATORS = [
  {
    labelKey: "op.creatorCampaign",
    href: "/app/campaigns",
    icon: Send,
    detail: { pt: "Público, mensagem, envio seguro", en: "Audience, message, safe send" },
  },
  {
    labelKey: "op.creatorAgent",
    href: "/app/chatbots",
    icon: Bot,
    detail: { pt: "Objetivo, tom, ferramentas", en: "Goal, tone, tools" },
  },
  {
    labelKey: "op.creatorKnowledge",
    href: "/app#clinic-center",
    icon: FilePlus2,
    detail: { pt: "FAQ, serviços, políticas", en: "FAQ, services, policies" },
  },
  {
    labelKey: "op.creatorService",
    href: "/app#clinic-center",
    icon: CalendarDays,
    detail: { pt: "Duração, equipa, disponibilidade", en: "Duration, team, availability" },
  },
  {
    labelKey: "op.creatorFollowup",
    href: "/app#clinic-center",
    icon: Clock3,
    detail: { pt: "Regra, pausa, próxima tentativa", en: "Rule, stop, next attempt" },
  },
] satisfies Array<{
  labelKey: TranslationKey;
  href: string;
  icon: LucideIcon;
  detail: Record<"pt" | "en", string>;
}>;

export default function AppOverview() {
  const tenant = useQuery(api.tenantsQueries.getActive);
  const dashboard = useQuery(api.operation.dashboard, {});
  const { locale, t } = useI18n();

  if (!tenant || !dashboard) {
    return (
      <main className="min-h-screen bg-[#f6f8fb] p-6">
        <div className="mx-auto max-w-7xl space-y-4">
          <div className="h-28 rounded-2xl border border-slate-200 bg-white animate-pulse" />
          <div className="grid gap-3 md:grid-cols-3">
            <div className="h-28 rounded-2xl border border-slate-200 bg-white animate-pulse" />
            <div className="h-28 rounded-2xl border border-slate-200 bg-white animate-pulse" />
            <div className="h-28 rounded-2xl border border-slate-200 bg-white animate-pulse" />
          </div>
        </div>
      </main>
    );
  }

  const statusCounts = new Map(
    dashboard.leads.statusCounts.map((item) => [item.status, item.count]),
  );
  const totalLeadStatuses = Math.max(
    1,
    dashboard.leads.statusCounts.reduce((sum, item) => sum + item.count, 0),
  );

  return (
    <main className="min-h-screen bg-[#f6f8fb]">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
              {t("op.eyebrow")}
            </div>
            <h1 className="mt-1 font-[var(--font-outfit)] text-[30px] font-medium tracking-tight text-[#0a1b33]">
              {t("op.title")}
            </h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
              {t("op.subtitle")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/app/channel-inbox"
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-medium text-[#0a1b33] hover:border-slate-300"
            >
              <Inbox size={15} />
              {t("op.openInbox")}
            </Link>
            <Link
              href="/app/campaigns"
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#0a152d] px-3 text-[13px] font-medium text-white hover:bg-[#0e1f41]"
            >
              <Send size={15} />
              {t("op.createCampaign")}
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <AttentionCard
            icon={MessageCircle}
            label={t("op.attention")}
            value={dashboard.attention.threads}
            note={`${dashboard.attention.unread} ${t("op.unread").toLowerCase()}`}
          />
          <AttentionCard
            icon={UserRoundCheck}
            label={t("op.human")}
            value={dashboard.attention.awaitingHuman}
            note={locale === "pt" ? "decisão ou exceção" : "decision or exception"}
            urgent={dashboard.attention.awaitingHuman > 0}
          />
          <AttentionCard
            icon={Clock3}
            label={t("op.window")}
            value={dashboard.attention.open24h}
            note={`${dashboard.attention.expiring24h} ${t("op.expiring").toLowerCase()}`}
            urgent={dashboard.attention.expiring24h > 0}
          />
          <AttentionCard
            icon={Bot}
            label={t("op.activeBots")}
            value={dashboard.attention.activeBots}
            note={`${dashboard.agents.active}/${dashboard.agents.total} ${
              locale === "pt" ? "publicados" : "published"
            }`}
          />
          <AttentionCard
            icon={Radio}
            label={t("op.channelsReady")}
            value={`${dashboard.channels.labReady}/${dashboard.channels.total}`}
            note={
              dashboard.channels.sendEnabled > 0
                ? locale === "pt"
                  ? "envio controlado ativo"
                  : "controlled send active"
                : locale === "pt"
                  ? "envio desativado"
                  : "send disabled"
            }
          />
        </section>

        <section className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
          <section className="rounded-2xl border border-slate-200 bg-white">
            <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-[var(--font-outfit)] text-lg font-medium text-[#0a1b33]">
                  {t("op.pipeline")}
                </h2>
                <p className="mt-0.5 text-sm text-slate-500">
                  {locale === "pt"
                    ? "Estado automático das conversas que já viraram pedido."
                    : "Automatic state for conversations that became requests."}
                </p>
              </div>
              <span className="rounded-lg bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-500">
                {dashboard.leads.total} {locale === "pt" ? "leads" : "leads"}
              </span>
            </div>
            <div className="divide-y divide-slate-100">
              {LEAD_STATUSES.map((status) => {
                const count = statusCounts.get(status) ?? 0;
                return (
                  <div key={status} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className={statusDotClass(status)} />
                        <span className="truncate text-sm font-medium text-[#0a1b33]">
                          {t(STATUS_KEYS[status])}
                        </span>
                      </div>
                      <span className="font-mono text-sm text-slate-500">{count}</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={statusBarClass(status)}
                        style={{ width: `${Math.round((count / totalLeadStatuses) * 100)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="font-[var(--font-outfit)] text-lg font-medium text-[#0a1b33]">
                {t("op.actionQueue")}
              </h2>
              <p className="mt-0.5 text-sm text-slate-500">
                {locale === "pt"
                  ? "O próximo movimento seguro para a equipa."
                  : "The next safe move for the team."}
              </p>
            </div>
            <div className="divide-y divide-slate-100">
              {dashboard.actionItems.map((action) => (
                <Link
                  key={`${action.key}-${action.href}`}
                  href={action.href}
                  className="group flex gap-3 px-5 py-4 hover:bg-slate-50"
                >
                  <ActionIcon tone={action.tone as ActionTone} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[#0a1b33]">
                      {t(`op.action.${action.key}` as TranslationKey)}
                    </p>
                    <p className="mt-1 text-sm leading-5 text-slate-500">
                      {t(`op.actionBody.${action.key}` as TranslationKey)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {action.count > 0 && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                        {action.count}
                      </span>
                    )}
                    <ArrowRight
                      size={15}
                      className="text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-[#0f766e]"
                    />
                  </div>
                </Link>
              ))}
            </div>
          </section>
        </section>

        <section className="grid gap-5 xl:grid-cols-[1fr_1fr]">
          <section className="rounded-2xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h2 className="font-[var(--font-outfit)] text-lg font-medium text-[#0a1b33]">
                  {t("op.recent")}
                </h2>
                <p className="mt-0.5 text-sm text-slate-500">
                  {locale === "pt"
                    ? "Cada conversa traz estado, próximo passo e janela."
                    : "Each conversation shows state, next step, and window."}
                </p>
              </div>
              <Link
                href="/app/channel-inbox"
                className="inline-flex items-center gap-1 text-[13px] font-medium text-[#0f766e]"
              >
                {t("op.openInbox")} <ArrowRight size={14} />
              </Link>
            </div>
            {dashboard.recentThreads.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <MessageCircle size={24} className="mx-auto text-slate-300" />
                <p className="mt-3 text-sm font-medium text-[#0a1b33]">
                  {t("op.noRecent")}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {dashboard.recentThreads.map((thread) => (
                  <Link
                    key={thread.threadId}
                    href="/app/channel-inbox"
                    className="block px-5 py-4 hover:bg-slate-50"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-semibold text-[#0a1b33]">
                            {thread.label}
                          </p>
                          <StatusBadge status={thread.leadStatus as LeadStatus} />
                          {thread.unreadCount > 0 && (
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                              {thread.unreadCount} {t("op.unread").toLowerCase()}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 truncate text-sm text-slate-500">
                          {thread.preview ?? (locale === "pt" ? "Sem prévia" : "No preview")}
                        </p>
                        {thread.nextStep && (
                          <p className="mt-2 text-xs font-medium text-slate-600">
                            {t("op.nextStep")}: {thread.nextStep}
                          </p>
                        )}
                      </div>
                      <span className="shrink-0 text-xs text-slate-400">
                        {relativeTime(thread.lastEventAt)}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="font-[var(--font-outfit)] text-lg font-medium text-[#0a1b33]">
                {t("op.campaignHealth")}
              </h2>
              <p className="mt-0.5 text-sm text-slate-500">
                {locale === "pt"
                  ? "Só contadores vindos de campanhas e eventos reais."
                  : "Only counters from real campaigns and events."}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-4">
              <CampaignMetric label={locale === "pt" ? "Enviados" : "Sent"} value={dashboard.campaigns.stats.sent} />
              <CampaignMetric label={locale === "pt" ? "Entregues" : "Delivered"} value={dashboard.campaigns.stats.delivered} />
              <CampaignMetric label={locale === "pt" ? "Lidos" : "Read"} value={dashboard.campaigns.stats.read} />
              <CampaignMetric label={locale === "pt" ? "Respostas" : "Replies"} value={dashboard.campaigns.stats.replied} />
              <CampaignMetric label={locale === "pt" ? "Interações" : "Clicks"} value={dashboard.campaigns.stats.clicked} />
              <CampaignMetric label={locale === "pt" ? "Conversões" : "Conversions"} value={dashboard.campaigns.stats.converted} />
              <CampaignMetric label={locale === "pt" ? "Falhas" : "Failed"} value={dashboard.campaigns.stats.failed} />
              <CampaignMetric label={locale === "pt" ? "Agendadas" : "Scheduled"} value={dashboard.campaigns.scheduled} />
            </div>
            <div className="grid gap-3 p-5 sm:grid-cols-2">
              <CompactHealth
                icon={Sparkles}
                title={t("op.agentHealth")}
                value={`${dashboard.agents.active}/${dashboard.agents.total}`}
                note={
                  dashboard.agents.validationErrors > 0
                    ? `${dashboard.agents.validationErrors} ${
                        locale === "pt" ? "erro(s) de validação" : "validation error(s)"
                      }`
                    : locale === "pt"
                      ? "sem bloqueios críticos"
                      : "no critical blockers"
                }
                urgent={dashboard.agents.validationErrors > 0}
              />
              <CompactHealth
                icon={ShieldCheck}
                title={locale === "pt" ? "Isolamento" : "Isolation"}
                value={dashboard.channels.labReady > 0 ? "OK" : locale === "pt" ? "Pendente" : "Pending"}
                note={
                  locale === "pt"
                    ? "canal lab separado da operação"
                    : "lab channel separated from operation"
                }
                urgent={dashboard.channels.labReady === 0}
              />
            </div>
          </section>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-[var(--font-outfit)] text-lg font-medium text-[#0a1b33]">
                {t("op.quickCreators")}
              </h2>
              <p className="mt-0.5 text-sm text-slate-500">
                {locale === "pt"
                  ? "Configuração curta; operação automática depois que o lead entra."
                  : "Short setup; automatic operation after the lead enters."}
              </p>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-5">
            {QUICK_CREATORS.map((creator) => {
              const Icon = creator.icon;
              return (
                <Link
                  key={creator.labelKey}
                  href={creator.href}
                  className="group rounded-xl border border-slate-100 bg-[#f8fafc] p-4 transition-colors hover:border-slate-200 hover:bg-white"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white text-[#0f766e] shadow-sm">
                    <Icon size={17} />
                  </span>
                  <p className="mt-4 text-sm font-semibold text-[#0a1b33]">
                    {t(creator.labelKey)}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    {creator.detail[locale]}
                  </p>
                </Link>
              );
            })}
          </div>
        </section>

        <ClinicOpsPanel />
      </div>
    </main>
  );
}

function AttentionCard({
  icon: Icon,
  label,
  value,
  note,
  urgent = false,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  note: string;
  urgent?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <span
        className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${
          urgent ? "bg-amber-50 text-amber-600" : "bg-emerald-50 text-[#0f766e]"
        }`}
      >
        <Icon size={17} />
      </span>
      <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
        {label}
      </p>
      <p className="mt-1 font-[var(--font-outfit)] text-3xl font-medium text-[#0a1b33]">
        {value}
      </p>
      <p className="mt-1 truncate text-sm text-slate-500">{note}</p>
    </div>
  );
}

function ActionIcon({ tone }: { tone: ActionTone }) {
  if (tone === "good") {
    return (
      <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
        <CheckCircle2 size={16} />
      </span>
    );
  }
  if (tone === "warn") {
    return (
      <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
        <AlertTriangle size={16} />
      </span>
    );
  }
  return (
    <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-[#0f766e]">
      <ArrowRight size={16} />
    </span>
  );
}

function StatusBadge({ status }: { status: LeadStatus }) {
  const { t } = useI18n();
  return (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
      {t(STATUS_KEYS[status])}
    </span>
  );
}

function CampaignMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white p-4">
      <p className="font-[var(--font-outfit)] text-2xl font-medium text-[#0a1b33]">
        {value}
      </p>
      <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
        {label}
      </p>
    </div>
  );
}

function CompactHealth({
  icon: Icon,
  title,
  value,
  note,
  urgent,
}: {
  icon: LucideIcon;
  title: string;
  value: string;
  note: string;
  urgent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-100 bg-[#f8fafc] p-4">
      <div className="flex items-start justify-between gap-3">
        <Icon size={17} className={urgent ? "text-amber-600" : "text-[#0f766e]"} />
        <span className="font-[var(--font-outfit)] text-xl font-medium text-[#0a1b33]">
          {value}
        </span>
      </div>
      <p className="mt-4 text-sm font-semibold text-[#0a1b33]">{title}</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{note}</p>
    </div>
  );
}

function statusDotClass(status: LeadStatus) {
  const base = "h-2.5 w-2.5 rounded-full shrink-0";
  if (status === "awaiting_human") return `${base} bg-amber-500`;
  if (status === "lost") return `${base} bg-slate-400`;
  if (status === "booked" || status === "confirmed") return `${base} bg-emerald-500`;
  if (status === "wants_booking") return `${base} bg-cyan-500`;
  if (status === "asked_price") return `${base} bg-indigo-500`;
  return `${base} bg-teal-500`;
}

function statusBarClass(status: LeadStatus) {
  const base = "h-full rounded-full";
  if (status === "awaiting_human") return `${base} bg-amber-500`;
  if (status === "lost") return `${base} bg-slate-400`;
  if (status === "booked" || status === "confirmed") return `${base} bg-emerald-500`;
  if (status === "wants_booking") return `${base} bg-cyan-500`;
  if (status === "asked_price") return `${base} bg-indigo-500`;
  return `${base} bg-teal-500`;
}
