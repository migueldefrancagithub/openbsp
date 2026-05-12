"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { Inbox } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/relativeTime";
import { friendlyId } from "@/lib/friendlyId";

export function ConversationList() {
  const conversations = useQuery(api.conversations.listOpen, { limit: 80 });
  const params = useParams<{ conversationId?: string }>();
  const selectedId = params.conversationId;

  return (
    <aside className="w-[320px] shrink-0 border-r border-slate-200 bg-white flex flex-col h-full">
      <div className="px-4 py-3.5 border-b border-slate-200 flex items-center gap-2.5">
        <Inbox size={16} className="text-slate-400" />
        <h2 className="font-[var(--font-outfit)] text-[15px] font-medium text-[#0a1b33]">
          Inbox
        </h2>
        {conversations && conversations.length > 0 && (
          <span className="ml-auto text-[11px] text-slate-400 font-medium">
            {conversations.length}
          </span>
        )}
      </div>

      {conversations === undefined ? (
        <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
          Loading…
        </div>
      ) : conversations.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-12">
          <div className="text-slate-400 text-sm leading-relaxed">
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
                    "flex items-start gap-3 px-4 py-3 border-b border-slate-100 transition-colors",
                    isSelected
                      ? "bg-slate-50 border-l-2 border-l-[#0a152d]"
                      : "hover:bg-slate-50",
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
                            ? "font-semibold text-[#0a1b33]"
                            : "font-medium text-slate-700",
                        )}
                      >
                        {c.contactName ?? c.contactE164}
                      </span>
                      <span className="text-[10px] text-slate-400 flex-shrink-0">
                        {relativeTime(c.lastMessageAt)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <span className="text-[10px] text-slate-400 font-[var(--font-mono)] truncate">
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
                                : "bg-slate-300",
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
                          <span className="px-1.5 py-0.5 rounded-md bg-[#0a152d] text-white text-[10px] font-semibold leading-none">
                            {c.unreadCount}
                          </span>
                        )}
                      </div>
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
