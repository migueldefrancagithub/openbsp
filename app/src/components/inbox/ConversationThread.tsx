"use client";

import { useEffect, useRef } from "react";
import { useQuery } from "convex/react";
import { Phone, Clock } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { MessageBubble } from "./MessageBubble";
import { Composer } from "./Composer";
import { relativeTime } from "@/lib/relativeTime";

type Props = { conversationId: Id<"conversations"> };

export function ConversationThread({ conversationId }: Props) {
  const conversation = useQuery(api.conversations.getById, { conversationId });
  const messages = useQuery(api.messages.listForConversation, {
    conversationId,
    limit: 200,
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages?.length]);

  if (conversation === undefined || messages === undefined) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
        Loading conversation…
      </div>
    );
  }
  if (conversation === null) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
        Conversation not found.
      </div>
    );
  }

  const within24h =
    conversation.serviceWindowExpiresAt &&
    conversation.serviceWindowExpiresAt > Date.now();

  return (
    <div className="flex-1 flex flex-col h-full bg-[#f4f6f9]">
      {/* Header */}
      <div className="px-6 py-3 border-b border-slate-200 bg-white flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full flex-shrink-0 bg-gradient-to-br from-[#F5C344] via-[#F28482] to-[#B567C2] flex items-center justify-center text-white text-[12px] font-semibold">
            {(conversation.contactName ?? conversation.contactE164)
              .charAt(conversation.contactName ? 0 : 1)
              .toUpperCase()}
          </div>
          <div>
            <div className="text-[14px] font-semibold text-[#0a1b33] leading-tight">
              {conversation.contactName ?? conversation.contactE164}
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mt-0.5">
              <Phone size={10} />
              <span>{conversation.contactE164}</span>
            </div>
          </div>
        </div>

        {conversation.serviceWindowExpiresAt && (
          <div
            className={
              within24h
                ? "inline-flex items-center gap-1.5 text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-md text-[11px] font-medium"
                : "inline-flex items-center gap-1.5 text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-md text-[11px] font-medium"
            }
          >
            <Clock size={11} />
            {within24h
              ? `Service window: ${relativeTime(conversation.serviceWindowExpiresAt - 24 * 60 * 60 * 1000)} of 24h`
              : "Service window expired"}
          </div>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-5 space-y-3">
        {messages.length === 0 ? (
          <div className="text-center text-slate-400 text-sm py-12">
            No messages in this conversation yet.
          </div>
        ) : (
          messages.map((m) => (
            <MessageBubble
              key={m._id}
              direction={m.direction}
              type={m.type}
              content={m.content}
              status={m.status}
              createdAt={m.createdAt}
            />
          ))
        )}
      </div>

      <Composer serviceWindowExpiresAt={conversation.serviceWindowExpiresAt} />
    </div>
  );
}
