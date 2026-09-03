"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { Inbox, Megaphone, UserRound, Users } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/relativeTime";
import { friendlyId } from "@/lib/friendlyId";

export function ConversationList() {
  const conversations = useQuery(api.conversations.listOpen, { limit: 80 });
  const params = useParams<{ conversationId?: string }>();
  const selectedId = params.conversationId;

  return (
    <aside className="w-[320px] shrink-0 border-r border-line bg-surface flex flex-col h-full">
      <div className="px-4 py-3.5 border-b border-line flex items-center gap-2.5">
        <Inbox size={16} className="text-faint" />
        <h2 className="font-[var(--font-outfit)] text-[15px] font-medium text-ink">
          Inbox
        </h2>
        {conversations && conversations.length > 0 && (
          <span className="ml-auto text-[11px] text-faint font-medium">
            {conversations.length}
          </span>
        )}
      </div>

      {conversations === undefined ? (
        <div className="flex-1 flex items-center justify-center text-faint text-sm">
          Loading…
        </div>
      ) : conversations.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-12">
          <div className="text-faint text-sm leading-relaxed">
            No conversations yet.
            <br />
            Connect a WhatsApp number in Settings.
          </div>
        </div>
      ) : (
        <ul className="flex-1 overflow-y-auto">
          {conversations.map((c) => {
            const isSelected = selectedId === c._id;
            const hasUnread = c.unreadCount > 0;
            const within24h =
              c.serviceWindowExpiresAt && c.serviceWindowExpiresAt > Date.now();
            return (
              <li key={c._id}>
                <Link
                  href={`/app/inbox/${c._id}`}
                  className={cn(
                    "flex items-start gap-3 px-4 py-3 border-b border-line-soft transition-colors",
                    isSelected
                      ? "bg-surface-2 border-l-2 border-l-[#0a152d]"
                      : "hover:bg-surface-2",
                  )}
                >
                  <div
                    className={cn(
                      "w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center text-[12px] font-semibold text-white",
                      "bg-gradient-to-br from-[#F5C344] via-[#F28482] to-[#B567C2]",
                    )}
                  >
                    {(c.contactName ?? c.contactE164).charAt(c.contactName ? 0 : 1).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={cn(
                          "text-[13px] truncate",
                          hasUnread
                            ? "font-semibold text-ink"
                            : "font-medium text-ink",
                        )}
                      >
                        {c.contactName ?? c.contactE164}
                      </span>
                      <span className="text-[10px] text-faint flex-shrink-0">
                        {relativeTime(c.lastMessageAt)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <span className="text-[10px] text-faint font-[var(--font-mono)] truncate">
                        {friendlyId("CONV", c._id)}
                      </span>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <span
                          className={cn(
                            "w-1.5 h-1.5 rounded-full",
                            within24h
                              ? "bg-emerald-500"
                              : hasUnread
                                ? "bg-amber-500"
                                : "bg-faint/50",
                          )}
                          title={
                            within24h
                              ? "24h window open"
                              : hasUnread
                                ? "Awaiting reply, window expired"
                                : "Idle"
                          }
                        />
                        {hasUnread && (
                          <span className="px-1.5 py-0.5 rounded-md bg-nav-active text-white text-[10px] font-semibold leading-none">
                            {c.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                    {c.leadSource === "ctwa" && (
                      <div className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                        <Megaphone size={10} />
                        CTWA lead
                      </div>
                    )}
                    {(c.assignedTeamName || c.assignedAgentName) && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {c.assignedTeamName && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-surface-3 px-1.5 py-0.5 text-[10px] font-medium text-body">
                            <Users size={10} />
                            {c.assignedTeamName}
                          </span>
                        )}
                        {c.assignedAgentName && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                            <UserRound size={10} />
                            {c.assignedAgentName}
                          </span>
                        )}
                      </div>
                    )}
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
