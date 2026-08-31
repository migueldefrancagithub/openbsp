"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { Bot, FlaskConical, Radio, Tag, Timer, UserRound } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/relativeTime";

const SHELL = "w-[320px] shrink-0 border-r border-slate-200 bg-white flex flex-col h-full";

function automationLabel(mode?: string): string {
  if (mode === "bot") return "Bot";
  if (mode === "human") return "Human";
  if (mode === "stopped") return "Stopped";
  return "Idle";
}

function AutomationIcon({ mode }: { mode?: string }) {
  if (mode === "bot") return <Bot size={10} />;
  if (mode === "human") return <UserRound size={10} />;
  return <Timer size={10} />;
}

export function ChannelThreadList() {
  const channels = useQuery(api.channels.list, {});
  const params = useParams<{ threadKey?: string }>();
  const searchParams = useSearchParams();
  const selectedThreadKey = params.threadKey
    ? decodeURIComponent(params.threadKey)
    : undefined;

  const requested = searchParams.get("channel");
  // Auto-select when there is exactly one channel, so the common case needs
  // no picker interaction.
  const activeChannelId = (requested ??
    (channels?.length === 1 ? channels[0]._id : undefined)) as
    | Id<"channels">
    | undefined;

  const threads = useQuery(
    api.channels.listThreads,
    activeChannelId ? { channelId: activeChannelId } : "skip",
  );

  if (channels === undefined) {
    return (
      <aside className={SHELL}>
        <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
          Loading…
        </div>
      </aside>
    );
  }

  if (channels.length === 0) {
    return (
      <aside className={SHELL}>
        <Header count={undefined} />
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-12">
          <FlaskConical size={20} className="text-slate-300 mb-3" />
          <div className="text-slate-400 text-sm leading-relaxed">
            No channel connected yet.
            <br />
            Connect one in Settings &gt; WhatsApp &gt; WhatsApp laboratory
            bridge.
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside className={SHELL}>
      <Header count={threads?.length} />

      {channels.length > 1 && (
        <div className="px-4 py-2.5 border-b border-slate-200 flex flex-wrap gap-1.5">
          {channels.map((channel) => (
            <Link
              key={channel._id}
              href={`/app/channel-inbox?channel=${channel._id}`}
              className={cn(
                "px-2 py-1 rounded-md text-[11px] font-medium transition-colors",
                channel._id === activeChannelId
                  ? "bg-[#0a152d] text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200",
              )}
            >
              {channel.displayName}
            </Link>
          ))}
        </div>
      )}

      {threads === undefined ? (
        <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
          Loading…
        </div>
      ) : threads.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-12">
          <div className="text-slate-400 text-sm leading-relaxed">
            No messages received yet.
            <br />
            Send a WhatsApp message to this channel to start a thread.
          </div>
        </div>
      ) : (
        <ul className="flex-1 overflow-y-auto">
          {threads.map((thread) => {
            const isSelected = selectedThreadKey === thread.threadKey;
            const hasUnread = thread.unreadCount > 0;
            const windowOpen =
              thread.serviceWindowExpiresAt !== undefined &&
              thread.serviceWindowExpiresAt > Date.now();
            const label = thread.displayName ?? thread.phone ?? thread.threadKey;
            const tags = thread.tags ?? [];
            return (
              <li key={thread._id}>
                <Link
                  href={`/app/channel-inbox/${encodeURIComponent(
                    thread.threadKey,
                  )}?channel=${activeChannelId}`}
                  className={cn(
                    "flex items-start gap-3 px-4 py-3 border-b border-slate-100 transition-colors",
                    isSelected
                      ? "bg-slate-50 border-l-2 border-l-[#0a152d]"
                      : "hover:bg-slate-50",
                  )}
                >
                  <div className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center text-[12px] font-semibold text-white bg-gradient-to-br from-[#F5C344] via-[#F28482] to-[#B567C2]">
                    {label.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={cn(
                          "text-[13px] truncate",
                          hasUnread
                            ? "font-semibold text-[#0a1b33]"
                            : "font-medium text-slate-700",
                        )}
                      >
                        {label}
                      </span>
                      <span className="text-[10px] text-slate-400 flex-shrink-0">
                        {relativeTime(thread.lastEventAt)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <span className="text-[11px] text-slate-500 truncate">
                        {thread.lastPreview ?? thread.lastEventKind}
                      </span>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <span
                          className={cn(
                            "w-1.5 h-1.5 rounded-full",
                            windowOpen
                              ? "bg-emerald-500"
                              : hasUnread
                                ? "bg-amber-500"
                                : "bg-slate-300",
                          )}
                          title={
                            windowOpen
                              ? "24h window open"
                              : hasUnread
                                ? "Awaiting reply, window expired"
                                : "Idle"
                          }
                        />
                        {hasUnread && (
                          <span className="px-1.5 py-0.5 rounded-md bg-[#0a152d] text-white text-[10px] font-semibold leading-none">
                            {thread.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="mt-1.5 flex min-h-5 flex-wrap items-center gap-1">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
                          thread.automationMode === "bot"
                            ? "border-violet-200 bg-violet-50 text-violet-700"
                            : thread.automationMode === "human"
                              ? "border-blue-200 bg-blue-50 text-blue-700"
                              : thread.automationMode === "stopped"
                                ? "border-amber-200 bg-amber-50 text-amber-700"
                                : "border-slate-200 bg-slate-50 text-slate-500",
                        )}
                      >
                        <AutomationIcon mode={thread.automationMode} />
                        {automationLabel(thread.automationMode)}
                      </span>
                      {tags.slice(0, 2).map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex max-w-[110px] items-center gap-1 truncate rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-500"
                          title={tag}
                        >
                          <Tag size={10} className="shrink-0" />
                          <span className="truncate">{tag}</span>
                        </span>
                      ))}
                      {tags.length > 2 && (
                        <span className="text-[10px] font-medium text-slate-400">
                          +{tags.length - 2}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}

function Header({ count }: { count: number | undefined }) {
  return (
    <div className="px-4 py-3.5 border-b border-slate-200 flex items-center gap-2.5">
      <Radio size={16} className="text-slate-400" />
      <h2 className="font-[var(--font-outfit)] text-[15px] font-medium text-[#0a1b33]">
        Channel inbox
      </h2>
      {count !== undefined && count > 0 && (
        <span className="ml-auto text-[11px] text-slate-400 font-medium">
          {count}
        </span>
      )}
    </div>
  );
}
