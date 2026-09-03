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
  aiSuggestionPending?: boolean;
  command?: string;
  commandReason?: string;
  waitingSince?: number;
  openCaseUrgency?: string;
  dueReminderCount?: number;
};

type FilterItem = {
  value: InboxFilter;
  labelKey: TranslationKey;
  icon: LucideIcon;
};

const inboxApi = api.inboxOperations;

const SILENCE_PT: Record<string, string> = {
  member_in_command: "IA pausada — assumida",
  paused: "IA pausada",
  human_case_open: "Caso humano aberto",
  opted_out: "Não contactar",
  snoozed: "Adiada",
};

const SILENCE_EN: Record<string, string> = {
  member_in_command: "AI paused — taken over",
  paused: "AI paused",
  human_case_open: "Human case open",
  opted_out: "Do not contact",
  snoozed: "Snoozed",
};

const COMMAND_PT: Record<string, string> = {
  member: "Em atendimento",
  ai: "IA a responder",
  nobody: "Sem agente no ar",
  waiting: "À espera da equipa",
  closed: "Encerrada",
};

const COMMAND_EN: Record<string, string> = {
  member: "Being handled",
  ai: "AI answering",
  nobody: "No agent live",
  waiting: "Waiting for the team",
  closed: "Closed",
};

function silenceLabel(reason: string, locale: "pt" | "en"): string {
  return (locale === "pt" ? SILENCE_PT : SILENCE_EN)[reason] ?? reason;
}

function commandTitle(thread: { command?: string }, locale: "pt" | "en"): string | undefined {
  if (!thread.command) return undefined;
  return (locale === "pt" ? COMMAND_PT : COMMAND_EN)[thread.command];
}

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
  return "bg-surface-2 text-body border-line";
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
  const { locale, t, tr } = useI18n();
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
        "min-h-0 w-full shrink-0 border-r border-line bg-surface sm:w-auto lg:h-full",
        selectedThreadKey ? "hidden sm:flex" : "flex",
      )}
    >
      <aside className="flex h-full w-full min-w-0 flex-col bg-surface sm:w-[360px] sm:shrink-0">
        <div className="border-b border-line p-3">
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
                  className="h-9 w-full appearance-none rounded-md border border-line bg-surface px-3 pr-8 text-[12px] font-semibold text-ink outline-none focus:border-brand-solid/40"
                >
                  {channels.map((channel) => (
                    <option key={channel._id} value={channel._id}>
                      {channel.displayName}
                    </option>
                  ))}
                </select>
                <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-faint" />
              </label>
            ) : (
              <div className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">
                {channels?.[0]?.displayName ?? t("inbox.title")}
              </div>
            )}
            <span className="rounded-md bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700">
              {threads.length}
            </span>
          </div>
          <label className="relative mt-2 block">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("inbox.search")}
              className="h-9 w-full rounded-md border border-line bg-surface-2 pl-9 pr-3 text-[12px] text-ink outline-none transition-colors focus:border-brand-solid/40 focus:bg-surface"
            />
          </label>
          <nav
            className="mt-2 grid grid-cols-5 gap-1 rounded-md bg-surface-3 p-1"
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
                    ? "bg-surface text-ink shadow-sm"
                    : "text-muted hover:bg-white/70 hover:text-ink",
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
                      ? "border-brand-solid bg-brand-solid text-white"
                      : "border-line bg-surface text-muted hover:border-line hover:text-ink",
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
          <div className="flex flex-1 items-center justify-center gap-2 text-[12px] text-faint">
            <Loader2 size={14} className="animate-spin" />
            {t("inbox.loading")}
          </div>
        ) : channels.length === 0 || !activeChannelId ? (
          <div className="flex flex-1 items-center justify-center px-8 text-center text-[12px] leading-5 text-faint">
            {t("inbox.noChannel")}
          </div>
        ) : status === "LoadingFirstPage" ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-[12px] text-faint">
            <Loader2 size={14} className="animate-spin" />
            {t("inbox.loading")}
          </div>
        ) : threads.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-8 text-center text-[12px] text-faint">
            {t("inbox.noThreads")}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            <ul>
              {threads.map((thread, index) => {
                const label = thread.displayName ?? thread.phone ?? thread.threadKey;
                // Position is only meaningful in the queue, where the rows ARE
                // the queue and the oldest wait is what decides who goes first.
                const queuePosition = filter === "unassigned" ? index + 1 : undefined;
                const selected = selectedThreadKey === thread.threadKey;
                const windowOpen = !!thread.serviceWindowExpiresAt && thread.serviceWindowExpiresAt > Date.now();
                return (
                  <li key={thread._id}>
                    <Link
                      data-thread-link
                      aria-current={selected ? "true" : undefined}
                      href={routeWithState(
                        `/app/channel-inbox/${encodeURIComponent(thread.threadKey)}`,
                        activeChannelId,
                        filter,
                        search,
                      )}
                      className={cn(
                        "grid grid-cols-[40px_minmax(0,1fr)] gap-2.5 border-b border-line-soft px-3 py-3 transition-colors",
                        selected
                          ? "border-l-2 border-l-[#0a1b33] bg-[#f0f5f7] pl-[10px]"
                          : "hover:bg-surface-2",
                      )}
                    >
                      <div className="relative flex h-10 w-10 items-center justify-center rounded-full bg-[#dff3ef] text-[11px] font-bold text-[#0d6b61]">
                        {initials(label)}
                        <span
                          className={cn(
                            "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white",
                            windowOpen ? "bg-emerald-500" : "bg-faint/50",
                          )}
                        />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={cn("min-w-0 flex-1 truncate text-[12px]", thread.unreadCount > 0 ? "font-bold text-ink" : "font-semibold text-ink")}>
                            {label}
                          </span>
                          {thread.starred && <Star size={11} className="fill-amber-400 text-amber-400" />}
                          <span className="shrink-0 text-[9px] text-faint">{relativeTime(thread.lastEventAt, Date.now(), locale)}</span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-[11px] text-muted">
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
                            <span className="max-w-[110px] truncate rounded bg-surface-3 px-1.5 py-0.5 text-[9px] font-medium text-muted">
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
                          {queuePosition !== undefined && (
                            <span
                              className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[#0a1b33]/10 px-1 text-[10px] font-semibold tabular-nums text-ink"
                              aria-label={`${tr("Posição", "Position")} ${queuePosition}`}
                              title={
                                thread.waitingSince
                                  ? `${tr("À espera desde", "Waiting since")} ${relativeTime(thread.waitingSince, Date.now(), locale)}`
                                  : undefined
                              }
                            >
                              {queuePosition}º
                            </span>
                          )}
                          {thread.commandReason && (
                            <span className="text-[10px] text-faint" title={commandTitle(thread, locale)}>
                              {silenceLabel(thread.commandReason, locale)}
                            </span>
                          )}
                          {thread.aiSuggestionPending && (
                            <span className="inline-flex items-center gap-1 rounded bg-[#eef3fb] px-1.5 py-0.5 text-[10px] font-semibold text-[#2b4f8a]" title={t("inbox.aiSuggestion")}>
                              ✦ {t("inbox.aiSuggestion")}
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
                  className="rounded-md border border-line px-3 py-1.5 text-[11px] font-semibold text-body hover:bg-surface-2"
                >
                  {t("inbox.loadMore")}
                </button>
              ) : status === "LoadingMore" ? (
                <Loader2 size={14} className="mx-auto animate-spin text-faint" />
              ) : (
                <span className="text-[10px] text-faint">{t("inbox.end")}</span>
              )}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
