"use client";

import { useQuery } from "convex/react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Bot,
  CheckCircle2,
  Clock3,
  FileText,
  MessageCircle,
  MousePointerClick,
  Network,
  Phone,
  RefreshCcw,
  Send,
  ShoppingBag,
  ShieldCheck,
  Users,
  WalletCards,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { relativeTime } from "@/lib/relativeTime";
import { formatMoney } from "@/lib/money";

type CampaignStats = {
  total: number;
  pending: number;
  queued: number;
  dispatching: number;
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  clicked: number;
  failed: number;
  skipped: number;
};

type RecentCampaign = {
  _id: Id<"campaigns">;
  name: string;
  status: string;
  pauseReason?: string;
  createdAt: number;
  updatedAt?: number;
  stats: CampaignStats;
};

const QUALITY_STYLES: Record<string, string> = {
  High: "bg-emerald-50 text-emerald-700 border-emerald-100",
  Medium: "bg-amber-50 text-amber-700 border-amber-100",
  Low: "bg-red-50 text-red-700 border-red-100",
  Unknown: "bg-slate-50 text-slate-600 border-slate-200",
};

export default function AppOverview() {
  const tenant = useQuery(api.tenantsQueries.getActive);
  const dashboard = useQuery(api.overview.dashboard, {});

  if (!tenant || !dashboard) {
    return (
      <main className="min-h-screen bg-[#f6f8fb] p-8">
        <div className="h-40 rounded-2xl border border-slate-200 bg-white animate-pulse" />
      </main>
    );
  }

  const connection = dashboard.connection.primaryPhone;

  return (
    <main className="min-h-screen bg-[#f6f8fb]">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
              Operations control
            </div>
            <h1 className="mt-1 font-[var(--font-outfit)] text-[30px] font-medium tracking-tight text-[#0a1b33]">
              {tenant.name}
            </h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
              Coexistence-first command center for WhatsApp campaigns, CTWA
              leads, quality limits, and human handoff.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/app/settings"
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-medium text-[#0a1b33] hover:border-slate-300"
            >
              <RefreshCcw size={15} />
              Sync Meta
            </Link>
            <Link
              href="/app/campaigns"
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#0a152d] px-3 text-[13px] font-medium text-white hover:bg-[#0e1f41]"
            >
              <Send size={15} />
              New campaign
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <ControlCard
            icon={Phone}
            label="Connected number"
            value={connection?.e164 ?? "Not connected"}
            note={connection?.displayName ?? "Connect WABA before broadcasts"}
          />
          <ControlCard
            icon={ShieldCheck}
            label="Quality"
            value={dashboard.connection.qualityLabel}
            note={`${dashboard.connection.connectedPhones} phone(s), ${dashboard.connection.activeWabas} active WABA`}
            badgeClass={QUALITY_STYLES[dashboard.connection.qualityLabel]}
          />
          <ControlCard
            icon={Activity}
            label="Mode"
            value={dashboard.connection.modeLabel}
            note={connection?.status === "paused" ? "Circuit breaker active" : "Cloud core ready"}
          />
          <ControlCard
            icon={MessageCircle}
            label="Messaging limit"
            value={dashboard.connection.messagingLimitLabel}
            note="Portfolio-wide template reach"
          />
        </section>

        <section className="grid gap-5 xl:grid-cols-[1.4fr_0.9fr]">
          <div className="space-y-5">
            <div className="grid gap-3 md:grid-cols-3">
              <MetricPanel
                icon={Users}
                label="Total leads"
                value={dashboard.leads.totalContacts}
                note={`${dashboard.leads.ctwaReferrals} CTWA referral(s)`}
              />
              <MetricPanel
                icon={BadgeCheck}
                label="Booked"
                value={dashboard.leads.booked}
                note={`${dashboard.leads.openCtwaChats} open ad chat(s)`}
              />
              <MetricPanel
                icon={WalletCards}
                label="Booked value"
                value={formatMoney(
                  dashboard.revenue.bookedValueMinor,
                  dashboard.revenue.currency,
                )}
                note={`${formatMoney(
                  dashboard.revenue.pipelineValueMinor,
                  dashboard.revenue.currency,
                )} pipeline`}
              />
            </div>

            <section className="rounded-2xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <div>
                  <h2 className="font-[var(--font-outfit)] text-lg font-medium text-[#0a1b33]">
                    Campaign console
                  </h2>
                  <p className="mt-0.5 text-sm text-slate-500">
                    Recent runs, delivery, read rate, and safety state.
                  </p>
                </div>
                <Link
                  href="/app/campaigns"
                  className="inline-flex items-center gap-1 text-[13px] font-medium text-[#0f766e]"
                >
                  Open studio <ArrowRight size={14} />
                </Link>
              </div>
              <div className="grid gap-3 border-b border-slate-100 p-5 md:grid-cols-4">
                <MiniStat label="Total" value={dashboard.campaigns.total} />
                <MiniStat label="Running" value={dashboard.campaigns.running} />
                <MiniStat label="Paused" value={dashboard.campaigns.paused} />
                <MiniStat
                  label="Read rate"
                  value={formatPercent(dashboard.campaigns.readRate)}
                />
              </div>
              {dashboard.campaigns.recent.length === 0 ? (
                <div className="p-8 text-center">
                  <Send size={24} className="mx-auto text-slate-300" />
                  <p className="mt-3 text-sm font-medium text-[#0a1b33]">
                    No campaign runs yet
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    Create a list, choose an approved template, and start with a
                    small cohort.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {dashboard.campaigns.recent.map((campaign) => (
                    <CampaignRow key={campaign._id} campaign={campaign} />
                  ))}
                </div>
              )}
            </section>
          </div>

          <aside className="space-y-5">
            <section className="rounded-2xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-5 py-4">
                <h2 className="font-[var(--font-outfit)] text-lg font-medium text-[#0a1b33]">
                  CTWA windows
                </h2>
                <p className="mt-0.5 text-sm text-slate-500">
                  Follow ad leads before the free-entry window expires.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 p-5">
                <WindowStat
                  icon={MousePointerClick}
                  label="Open"
                  value={dashboard.leads.freeEntryOpen}
                />
                <WindowStat
                  icon={Clock3}
                  label="Expiring"
                  value={dashboard.leads.freeEntryExpiringSoon}
                  urgent={dashboard.leads.freeEntryExpiringSoon > 0}
                />
              </div>
              <div className="border-t border-slate-100 px-5 py-3">
                <Link
                  href="/app/leads"
                  className="inline-flex items-center gap-1 text-sm font-medium text-[#0f766e]"
                >
                  Review ad leads <ArrowRight size={14} />
                </Link>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-5 py-4">
                <h2 className="font-[var(--font-outfit)] text-lg font-medium text-[#0a1b33]">
                  Operator queue
                </h2>
                <p className="mt-0.5 text-sm text-slate-500">
                  The next safest move, not generic AI suggestions.
                </p>
              </div>
              <div className="divide-y divide-slate-100">
                {dashboard.nextActions.map((action) => (
                  <Link
                    key={`${action.title}-${action.href}`}
                    href={action.href}
                    className="group flex gap-3 px-5 py-4 hover:bg-slate-50"
                  >
                    <ActionIcon tone={action.tone} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-[#0a1b33]">
                        {action.title}
                      </p>
                      <p className="mt-1 text-sm leading-5 text-slate-500">
                        {action.body}
                      </p>
                    </div>
                    <ArrowRight
                      size={15}
                      className="mt-1 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-[#0f766e]"
                    />
                  </Link>
                ))}
              </div>
            </section>
          </aside>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <ModuleCard
            icon={MessageCircle}
            title="Inbox"
            body="Manage all customer conversations in one place."
            href="/app/inbox"
          />
          <ModuleCard
            icon={Send}
            title="Broadcast"
            body="Create batch-safe campaigns with template compliance."
            href="/app/campaigns"
          />
          <ModuleCard
            icon={Network}
            title="Meta Channels"
            body="Connect WhatsApp numbers and inspect health."
            href="/app/channels"
          />
          <ModuleCard
            icon={BarChart3}
            title="Analytics"
            body="Track delivery, cost, category, and country performance."
            href="/app/analytics"
          />
          <ModuleCard
            icon={FileText}
            title="Templates"
            body="Manage approved marketing, utility, and auth templates."
            href="/app/templates"
          />
          <ModuleCard
            icon={Bot}
            title="Flow Builder"
            body="Build branching WhatsApp bots with templates, validation, and human handoff."
            href="/app/chatbots"
          />
          <ModuleCard
            icon={ShoppingBag}
            title="Ecommerce"
            body="Prepare catalog, cart recovery, and order updates."
            href="/app/settings"
          />
        </section>
      </div>
    </main>
  );
}

function ControlCard({
  icon: Icon,
  label,
  value,
  note,
  badgeClass,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  note: string;
  badgeClass?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-5 flex items-start justify-between gap-3">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-slate-50 text-slate-500">
          <Icon size={17} />
        </span>
        {badgeClass && (
          <span className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${badgeClass}`}>
            {value}
          </span>
        )}
      </div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
        {label}
      </p>
      <p className="mt-1 truncate font-[var(--font-outfit)] text-xl font-medium text-[#0a1b33]">
        {value}
      </p>
      <p className="mt-1 truncate text-xs text-slate-500">{note}</p>
    </div>
  );
}

function MetricPanel({
  icon: Icon,
  label,
  value,
  note,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  note: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <Icon size={18} className="text-[#0f766e]" />
      <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
        {label}
      </p>
      <p className="mt-1 font-[var(--font-outfit)] text-3xl font-medium text-[#0a1b33]">
        {value}
      </p>
      <p className="mt-1 text-sm text-slate-500">{note}</p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-[#f8fafc] px-3 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
        {label}
      </p>
      <p className="mt-1 font-[var(--font-outfit)] text-xl font-medium text-[#0a1b33]">
        {value}
      </p>
    </div>
  );
}

function CampaignRow({
  campaign,
}: {
  campaign: RecentCampaign;
}) {
  const completion =
    campaign.stats.total > 0
      ? Math.round(
          ((campaign.stats.delivered +
            campaign.stats.read +
            campaign.stats.replied +
            campaign.stats.clicked) /
            campaign.stats.total) *
            100,
        )
      : 0;
  return (
    <div className="px-5 py-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-[#0a1b33]">
              {campaign.name}
            </p>
            <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">
              {campaign.status}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {campaign.stats.sent} sent · {campaign.stats.read} read ·{" "}
            {campaign.stats.replied} replied · updated{" "}
            {relativeTime(campaign.updatedAt ?? campaign.createdAt)}
          </p>
        </div>
        <div className="w-full md:w-56">
          <div className="mb-1 flex justify-between text-[11px] text-slate-500">
            <span>Delivery progress</span>
            <span>{completion}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-[#12b981]"
              style={{ width: `${Math.min(100, completion)}%` }}
            />
          </div>
        </div>
      </div>
      {campaign.pauseReason && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {campaign.pauseReason}
        </p>
      )}
    </div>
  );
}

function WindowStat({
  icon: Icon,
  label,
  value,
  urgent,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  urgent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-100 bg-[#f8fafc] p-4">
      <Icon size={17} className={urgent ? "text-amber-600" : "text-[#0f766e]"} />
      <p className="mt-4 font-[var(--font-outfit)] text-3xl font-medium text-[#0a1b33]">
        {value}
      </p>
      <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
        {label}
      </p>
    </div>
  );
}

function ActionIcon({ tone }: { tone: "good" | "warn" | "action" }) {
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
      <BarChart3 size={16} />
    </span>
  );
}

function ModuleCard({
  icon: Icon,
  title,
  body,
  href,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group min-h-44 rounded-2xl border border-slate-200 bg-white p-5 transition-all hover:border-slate-300 hover:shadow-[0_18px_60px_-48px_rgba(15,23,42,0.55)]"
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-[#0a1b33] transition-colors group-hover:bg-violet-50 group-hover:text-violet-600">
        <Icon size={19} />
      </span>
      <h3 className="mt-5 text-base font-semibold text-[#0a1b33]">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-500">{body}</p>
      <div className="mt-5 flex items-center gap-1 border-t border-slate-100 pt-4 text-sm font-semibold text-violet-600">
        Open <ArrowRight size={14} />
      </div>
    </Link>
  );
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
