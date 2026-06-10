"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import {
  AlertTriangle,
  Bot,
  ExternalLink,
  MessageCircle,
  MousePointerClick,
  Target,
  Timer,
  Banknote,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/app/EmptyState";
import { ConvexQueryFallback } from "@/components/app/ConvexQueryFallback";
import { api } from "../../../../convex/_generated/api";
import { relativeTime } from "@/lib/relativeTime";
import { DEFAULT_CURRENCY, formatMoney } from "@/lib/money";

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  replied: "Replied",
  opportunity: "Opportunity",
  booked: "Booked",
  lost: "Lost",
};

type Dashboard = {
  totalReferrals: number;
  openConversations: number;
  booked: number;
  pipelineValueMinor: number;
  bookedValueMinor: number;
  currency: string;
  freeEntryOpen: number;
  freeEntryExpiringSoon: number;
  byOpportunityStatus: Array<{ status: string; count: number }>;
  recent: Array<{
    _id: string;
    conversationId: string;
    contactName?: string;
    contactE164: string;
    sourceType?: string;
    sourceUrl?: string;
    headline?: string;
    body?: string;
    clickedAt: number;
    freeEntryWindowExpiresAt: number;
    opportunityStatus?: string;
    opportunityValueMinor?: number;
    opportunityCurrency?: string;
    aiState?: string;
  }>;
};

const EMPTY_DASHBOARD: Dashboard = {
  totalReferrals: 0,
  openConversations: 0,
  booked: 0,
  pipelineValueMinor: 0,
  bookedValueMinor: 0,
  currency: DEFAULT_CURRENCY,
  freeEntryOpen: 0,
  freeEntryExpiringSoon: 0,
  byOpportunityStatus: [
    { status: "new", count: 0 },
    { status: "contacted", count: 0 },
    { status: "replied", count: 0 },
    { status: "opportunity", count: 0 },
    { status: "booked", count: 0 },
    { status: "lost", count: 0 },
  ],
  recent: [],
};

export default function LeadsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Click-to-WhatsApp"
        title="Ad leads"
        description="Track CTWA referrals, the free-entry window, opportunity status, and AI handoff state."
      />

      <ConvexQueryFallback
        fallback={<LeadsDashboard dashboard={EMPTY_DASHBOARD} degraded />}
      >
        <LeadsContent />
      </ConvexQueryFallback>
    </>
  );
}

function LeadsContent() {
  const dashboard = useQuery(api.ctwa.dashboard, { limit: 50 });

  if (dashboard === undefined) {
    return (
      <div className="max-w-7xl space-y-6 px-8 py-8">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-400">
          Loading leads…
        </div>
      </div>
    );
  }

  return <LeadsDashboard dashboard={dashboard} />;
}

function LeadsDashboard({
  dashboard,
  degraded = false,
}: {
  dashboard: Dashboard;
  degraded?: boolean;
}) {

  return (
    <div className="max-w-7xl space-y-6 px-8 py-8">
      {degraded && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 shrink-0" size={17} />
          <div>
            <div className="font-medium">Convex backend sync pending</div>
            <div className="mt-0.5 text-amber-700">
              The CTWA dashboard function is not deployed on this dev backend yet,
              so this page is showing the safe empty preview instead of crashing.
            </div>
          </div>
        </div>
      )}
            <div className="grid gap-3 md:grid-cols-5">
              <Kpi
                icon={MousePointerClick}
                label="Referrals"
                value={dashboard.totalReferrals}
              />
              <Kpi
                icon={MessageCircle}
                label="Open CTWA chats"
                value={dashboard.openConversations}
              />
              <Kpi icon={Target} label="Booked" value={dashboard.booked} />
              <Kpi
                icon={Timer}
                label="Free entry open"
                value={dashboard.freeEntryOpen}
              />
              <Kpi
                icon={Timer}
                label="Expiring soon"
                value={dashboard.freeEntryExpiringSoon}
                tone="amber"
              />
              <Kpi
                icon={Banknote}
                label="Booked value"
                value={formatMoney(dashboard.bookedValueMinor, dashboard.currency)}
              />
            </div>

            <section className="grid gap-6 xl:grid-cols-[0.75fr_1.25fr]">
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="font-[var(--font-outfit)] text-[18px] font-medium text-[#0a1b33]">
                    Pipeline
                  </h2>
                  <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
                    CTWA only
                  </span>
                </div>
                <div className="space-y-2">
                  {dashboard.byOpportunityStatus.map((item) => (
                    <div key={item.status}>
                      <div className="mb-1 flex items-center justify-between text-[12px]">
                        <span className="font-medium text-slate-600">
                          {STATUS_LABELS[item.status] ?? item.status}
                        </span>
                        <span className="text-slate-400">{item.count}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-[#0a152d]"
                          style={{
                            width: `${Math.min(
                              100,
                              dashboard.openConversations > 0
                                ? (item.count / dashboard.openConversations) * 100
                                : 0,
                            )}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <div className="border-b border-slate-100 px-5 py-4">
                  <h2 className="font-[var(--font-outfit)] text-[18px] font-medium text-[#0a1b33]">
                    Recent ad entries
                  </h2>
                  <p className="mt-0.5 text-sm text-slate-500">
                    Every row links the Meta referral to the inbox conversation.
                  </p>
                </div>
                {dashboard.recent.length === 0 ? (
                  <div className="p-10 text-center">
                    <MousePointerClick
                      size={26}
                      className="mx-auto mb-3 text-slate-300"
                    />
                    <h3 className="font-[var(--font-outfit)] text-[18px] font-medium text-[#0a1b33]">
                      No CTWA leads yet
                    </h3>
                    <p className="mt-1 text-sm text-slate-500">
                      Referrals will appear after a Click-to-WhatsApp ad opens a chat.
                    </p>
                  </div>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {dashboard.recent.map((lead) => (
                      <li key={lead._id} className="px-5 py-4">
                        <div className="flex items-start gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                            <MousePointerClick size={17} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <Link
                                href={`/app/inbox/${lead.conversationId}`}
                                className="truncate text-[14px] font-semibold text-[#0a1b33] hover:underline"
                              >
                                {lead.contactName ?? lead.contactE164}
                              </Link>
                              <span className="rounded-md border border-emerald-100 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-700">
                                {lead.sourceType ?? "ctwa"}
                              </span>
                              {lead.aiState && (
                                <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                                  <Bot size={11} />
                                  {lead.aiState}
                                </span>
                              )}
                            </div>
                            <p className="mt-1 text-[12px] text-slate-500">
                              {lead.headline ?? lead.body ?? "Untitled ad"} · clicked{" "}
                              {relativeTime(lead.clickedAt)}
                            </p>
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                              <span>
                                {STATUS_LABELS[lead.opportunityStatus ?? "new"] ??
                                  lead.opportunityStatus ??
                                  "New"}
                              </span>
                              <span>
                                Free entry until {formatShortDateTime(lead.freeEntryWindowExpiresAt)}
                              </span>
                              {lead.sourceUrl && (
                                <a
                                  href={lead.sourceUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-slate-500 hover:text-[#0a1b33]"
                                >
                                  Source
                                  <ExternalLink size={11} />
                                </a>
                              )}
                              {lead.opportunityValueMinor !== undefined && (
                                <span>
                                  {formatMoney(
                                    lead.opportunityValueMinor,
                                    lead.opportunityCurrency ?? dashboard.currency,
                                  )}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
    </div>
  );
}

function formatShortDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Kpi({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: number | string;
  tone?: "amber";
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div
        className={`mb-3 flex h-9 w-9 items-center justify-center rounded-lg ${
          tone === "amber"
            ? "bg-amber-50 text-amber-700"
            : "bg-slate-100 text-[#0a1b33]"
        }`}
      >
        <Icon size={17} />
      </div>
      <div className="text-[24px] font-semibold text-[#0a1b33]">{value}</div>
      <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
        {label}
      </div>
    </div>
  );
}
