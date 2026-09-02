"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { usePaginatedQuery, useQuery } from "convex/react";
import {
  Archive,
  Bell,
  Bot,
  ChevronDown,
  Clock3,
  Inbox,
  Loader2,
  MessageCircleMore,
  Search,
  ShieldAlert,
  Star,
  UserRound,
  UsersRound,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/relativeTime";
import { useI18n, type TranslationKey } from "@/lib/i18n";

type InboxFilter =
  | "all"
  | "mine"
  | "unassigned"
  | "open"
  | "active"
  | "awaiting_team"
  | "awaiting_patient"
  | "starred"
  | "snoozed"
  | "closed";

type ThreadRow = {
  _id: Id<"channelThreads">;
  channelId: Id<"channels">;
  threadKey: string;
  displayName?: string;
  phone?: string;
  lastEventAt: number;
  lastEventKind: string;
  lastPreview?: string;
  unreadCount: number;
  serviceWindowExpiresAt?: number;
  leadSource?: string;
  leadStatus?: string;
  nextStep?: string;
  responsibleName?: string;
  assignedTeamName?: string;
  inboxStatus: string;
  starred: boolean;
  automationMode?: string;
  pilotBlocked?: boolean;
  openCaseSlaDueAt?: number;
  firstResponseDueAt?: number;
  slaBreached?: boolean;
  openCaseUrgency?: string;
  dueReminderCount?: number;
};

type FilterItem = {
  value: InboxFilter;
  labelKey: TranslationKey;
  icon: LucideIcon;
};

const inboxApi = api.inboxOperations;

const FILTERS: FilterItem[] = [
  { value: "all", labelKey: "inbox.all", icon: Inbox },
  { value: "mine", labelKey: "inbox.mine", icon: UserRound },
  { value: "unassigned", labelKey: "inbox.unassigned", icon: UserRound },
  { value: "open", labelKey: "inbox.open", icon: MessageCircleMore },
  { value: "active", labelKey: "inbox.active", icon: Zap },
  { value: "awaiting_team", labelKey: "inbox.awaitingTeam", icon: UsersRound },
  { value: "awaiting_patient", labelKey: "inbox.awaitingPatient", icon: Clock3 },
  { value: "starred", labelKey: "inbox.starred", icon: Star },
  { value: "snoozed", labelKey: "inbox.snoozed", icon: Clock3 },
  { value: "closed", labelKey: "inbox.closed", icon: Archive },
];

const PRIMARY_FILTERS = FILTERS.filter((item) =>
  ["all", "mine", "unassigned", "awaiting_team", "awaiting_patient"].includes(
    item.value,
  ),
);

const MORE_FILTERS = FILTERS.filter((item) =>
  ["open", "active", "starred", "snoozed", "closed"].includes(item.value),
);

function isFilter(value: string | null): value is InboxFilter {
  return FILTERS.some((item) => item.value === value);
}

function initials(label: string) {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "WA";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return `${words[0]![0]}${words[words.length - 1]![0]}`.toUpperCase();
}

function statusTone(status?: string) {
  if (status === "awaiting_human") return "bg-amber-50 text-amber-700 border-amber-200";
  if (status === "confirmed" || status === "attended") {
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  }
  if (status === "no_show" || status === "lost") {
    return "bg-rose-50 text-rose-700 border-rose-200";
  }
  if (status === "booked" || status === "wants_booking") {
    return "bg-blue-50 text-blue-700 border-blue-200";
  }
  return "bg-slate-50 text-slate-600 border-slate-200";
}

function routeWithState(
  base: string,
  channelId: string,
  filter: InboxFilter,
  search: string,
) {
  const params = new URLSearchParams({ channel: channelId });
  if (filter !== "all") params.set("filter", filter);
  if (search.trim()) params.set("q", search.trim());
  return `${base}?${params.toString()}`;
}

export function ChannelThreadList() {
  const { locale, t } = useI18n();
  const router = useRouter();
  const channels = useQuery(api.channels.list, {});
  const params = useParams<{ threadKey?: string }>();
  const searchParams = useSearchParams();
  const selectedThreadKey = params.threadKey
    ? decodeURIComponent(params.threadKey)
    : undefined;
  const requestedChannel = searchParams.get("channel");
  const activeChannelId = (requestedChannel ??
    (channels?.length === 1 ? channels[0]._id : undefined)) as
    | Id<"channels">
    | undefined;
  const requestedFilter = searchParams.get("filter");
  const filter: InboxFilter = isFilter(requestedFilter) ? requestedFilter : "all";
  const [search, setSearch] = useState(searchParams.get("q") ?? "");
  const deferredSearch = useDeferredValue(search.trim());

  const queryArgs = useMemo(
    () =>
      activeChannelId
        ? {
            channelId: activeChannelId,
            filter,
            search: deferredSearch || undefined,
          }
        : "skip",
    [activeChannelId, filter, deferredSearch],
  );
  const { results, status, loadMore } = usePaginatedQuery(
    inboxApi.listThreads,
    queryArgs as any,
    { initialNumItems: 35 },
  );
  const threads = results as ThreadRow[];

  return (
    <div
      className={cn(
        "min-h-0 w-full shrink-0 border-r border-slate-200 bg-white sm:w-auto lg:h-full",
        selectedThreadKey ? "hidden sm:flex" : "flex",
      )}
    >
      <aside className="flex h-full w-full min-w-0 flex-col bg-white sm:w-[360px] sm:shrink-0">
        <div className="border-b border-slate-200 p-3">
          <div className="flex items-center gap-2">
            {channels && channels.length > 1 ? (
              <label className="relative min-w-0 flex-1">
                <select
                  value={activeChannelId ?? ""}
                  onChange={(event) => {
                    router.push(
                      routeWithState("/app/channel-inbox", event.target.value, filter, search),
                    );
                  }}
                  className="h-9 w-full appearance-none rounded-md border border-slate-200 bg-white px-3 pr-8 text-[12px] font-semibold text-[#0a1b33] outline-none focus:border-slate-400"
                >
                  {channels.map((channel) => (
                    <option key={channel._id} value={channel._id}>
                      {channel.displayName}
                    </option>
                  ))}
                </select>
                <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              </label>
            ) : (
              <div className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[#0a1b33]">
                {channels?.[0]?.displayName ?? t("inbox.title")}
              </div>
            )}
            <span className="rounded-md bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700">
              {threads.length}
            </span>
          </div>
          <label className="relative mt-2 block">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("inbox.search")}
              className="h-9 w-full rounded-md border border-slate-200 bg-slate-50 pl-9 pr-3 text-[12px] text-[#0a1b33] outline-none transition-colors focus:border-slate-400 focus:bg-white"
            />
          </label>
          <nav
            className="mt-2 grid grid-cols-5 gap-1 rounded-md bg-slate-100 p-1"
            aria-label={t("inbox.title")}
          >
            {PRIMARY_FILTERS.map((item) => {
              const Icon = item.icon;
              return (
              <Link
                key={item.value}
                href={routeWithState("/app/channel-inbox", activeChannelId ?? "", item.value, search)}
                className={cn(
                  "flex h-11 min-w-0 flex-col items-center justify-center gap-0.5 rounded px-1 text-[9px] font-semibold transition-colors",
                  filter === item.value
                    ? "bg-white text-[#0a1b33] shadow-sm"
                    : "text-slate-500 hover:bg-white/70 hover:text-[#0a1b33]",
                )}
                title={t(item.labelKey)}
              >
                <Icon size={13} />
                <span className="w-full truncate text-center">{t(item.labelKey)}</span>
              </Link>
              );
            })}
          </nav>
          <div className="mt-1.5 flex flex-wrap gap-1" aria-label={t("inbox.moreFilters")}>
            {MORE_FILTERS.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.value}
                  href={routeWithState("/app/channel-inbox", activeChannelId ?? "", item.value, search)}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-semibold transition-colors",
                    filter === item.value
                      ? "border-[#0a1b33] bg-[#0a1b33] text-white"
                      : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-[#0a1b33]",
                  )}
                >
                  <Icon size={11} />
                  {t(item.labelKey)}
                </Link>
              );
            })}
          </div>
        </div>

        {channels === undefined ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-[12px] text-slate-400">
            <Loader2 size={14} className="animate-spin" />
            {t("inbox.loading")}
          </div>
        ) : channels.length === 0 || !activeChannelId ? (
          <div className="flex flex-1 items-center justify-center px-8 text-center text-[12px] leading-5 text-slate-400">
            {t("inbox.noChannel")}
          </div>
        ) : status === "LoadingFirstPage" ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-[12px] text-slate-400">
            <Loader2 size={14} className="animate-spin" />
            {t("inbox.loading")}
          </div>
        ) : threads.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-8 text-center text-[12px] text-slate-400">
            {t("inbox.noThreads")}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            <ul>
              {threads.map((thread) => {
                const label = thread.displayName ?? thread.phone ?? thread.threadKey;
                const selected = selectedThreadKey === thread.threadKey;
                const windowOpen = !!thread.serviceWindowExpiresAt && thread.serviceWindowExpiresAt > Date.now();
                return (
                  <li key={thread._id}>
                    <Link
                      href={routeWithState(
                        `/app/channel-inbox/${encodeURIComponent(thread.threadKey)}`,
                        activeChannelId,
                        filter,
                        search,
                      )}
                      className={cn(
                        "grid grid-cols-[40px_minmax(0,1fr)] gap-2.5 border-b border-slate-100 px-3 py-3 transition-colors",
                        selected
                          ? "border-l-2 border-l-[#0a1b33] bg-[#f0f5f7] pl-[10px]"
                          : "hover:bg-slate-50",
                      )}
                    >
                      <div className="relative flex h-10 w-10 items-center justify-center rounded-full bg-[#dff3ef] text-[11px] font-bold text-[#0d6b61]">
                        {initials(label)}
                        <span
                          className={cn(
                            "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white",
                            windowOpen ? "bg-emerald-500" : "bg-slate-300",
                          )}
                        />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={cn("min-w-0 flex-1 truncate text-[12px]", thread.unreadCount > 0 ? "font-bold text-[#0a1b33]" : "font-semibold text-slate-700")}>
                            {label}
                          </span>
                          {thread.starred && <Star size={11} className="fill-amber-400 text-amber-400" />}
                          <span className="shrink-0 text-[9px] text-slate-400">{relativeTime(thread.lastEventAt, Date.now(), locale)}</span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-[11px] text-slate-500">
                            {thread.lastPreview ?? thread.lastEventKind}
                          </span>
                          {thread.unreadCount > 0 && (
                            <span className="min-w-5 rounded-full bg-[#0d6b61] px-1.5 py-0.5 text-center text-[9px] font-bold text-white">
                              {thread.unreadCount}
                            </span>
                          )}
                        </div>
                        <div className="mt-1.5 flex items-center gap-1 overflow-hidden">
                          <span className={cn("max-w-[120px] truncate rounded border px-1.5 py-0.5 text-[9px] font-semibold", statusTone(thread.leadStatus))}>
                            {thread.leadStatus ? t(`status.${thread.leadStatus}` as TranslationKey) : t("status.new")}
                          </span>
                          {thread.responsibleName && (
                            <span className="max-w-[110px] truncate rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-500">
                              {thread.responsibleName}
                            </span>
                          )}
                          {thread.automationMode === "bot" && <Bot size={11} className="shrink-0 text-blue-500" />}
                          {(thread.dueReminderCount ?? 0) > 0 && (
                            <span
                              className="inline-flex shrink-0 items-center gap-0.5 rounded border border-[#f5c2b8] bg-[#fff1ee] px-1 py-0.5 text-[9px] font-semibold text-[#8a2a1b]"
                              title={t("inbox.dueReminders")}
                            >
                              <Bell size={9} />
                              {thread.dueReminderCount}
                            </span>
                          )}
                          {thread.firstResponseDueAt && !thread.openCaseSlaDueAt && (
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold",
                                thread.firstResponseDueAt < Date.now() ? "bg-[#fdf1ef] text-[#b3261e]" : "bg-amber-50 text-amber-700",
                              )}
                              title={t("inbox.firstResponseSla")}
                            >
                              SLA {relativeTime(thread.firstResponseDueAt, Date.now(), locale)}
                            </span>
                          )}
                          {thread.openCaseSlaDueAt && (
                            <span
                              className={cn(
                                "inline-flex shrink-0 items-center gap-0.5 rounded border px-1 py-0.5 text-[9px] font-semibold",
                                thread.openCaseSlaDueAt < Date.now()
                                  ? "border-[#f5c2b8] bg-[#fff1ee] text-[#8a2a1b]"
                                  : "border-amber-200 bg-amber-50 text-amber-800",
                              )}
                              title={t("handoff.caseOpen")}
                            >
                              <UsersRound size={9} />
                              {relativeTime(thread.openCaseSlaDueAt, Date.now(), locale)}
                            </span>
                          )}
                          {thread.pilotBlocked && (
                            <span
                              className="inline-flex shrink-0 items-center gap-0.5 rounded border border-amber-200 bg-amber-50 px-1 py-0.5 text-[9px] font-semibold text-amber-800"
                              title={t("inbox.pilotTitle")}
                            >
                              <ShieldAlert size={9} />
                              {t("inbox.pilotBlockedShort")}
                            </span>
                          )}
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <div className="p-3 text-center">
              {status === "CanLoadMore" ? (
                <button
                  type="button"
                  onClick={() => loadMore(35)}
                  className="rounded-md border border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                >
                  {t("inbox.loadMore")}
                </button>
              ) : status === "LoadingMore" ? (
                <Loader2 size={14} className="mx-auto animate-spin text-slate-400" />
              ) : (
                <span className="text-[10px] text-slate-300">{t("inbox.end")}</span>
              )}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
