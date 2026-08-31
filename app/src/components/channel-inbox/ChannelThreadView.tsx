"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { AlertTriangle, Loader2, Send, ShieldAlert } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { cn } from "@/lib/cn";
import { formatTime } from "@/lib/relativeTime";

function errorMessage(error: unknown): string {
  const data =
    error && typeof error === "object" && "data" in error
      ? (error as { data?: unknown }).data
      : null;
  if (data && typeof data === "object" && "message" in data) {
    return String((data as { message: unknown }).message);
  }
  if (data && typeof data === "object" && "code" in data) {
    return String((data as { code: unknown }).code);
  }
  return error instanceof Error ? error.message : "Send failed.";
}

/**
 * Read the display text out of a normalized event payload. Deliberately narrow:
 * raw provider payloads are evidence and are never dumped into the UI.
 */
function eventText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const normalized = root.normalizedText;
  if (typeof normalized === "string" && normalized.trim()) return normalized;
  const outboundText = root.text;
  if (typeof outboundText === "string" && outboundText.trim()) {
    return outboundText;
  }
  const message = root.message as Record<string, unknown> | undefined;
  const text = message?.text as Record<string, unknown> | undefined;
  const body = text?.body;
  return typeof body === "string" && body.trim() ? body : null;
}

type BlockedReason = { title: string; detail: string } | null;

export function ChannelThreadView({
  channelId,
  threadKey,
}: {
  channelId: Id<"channels">;
  threadKey: string;
}) {
  const thread = useQuery(api.channels.getThread, { channelId, threadKey });
  const events = useQuery(api.channels.listThreadEvents, {
    channelId,
    threadKey,
    limit: 200,
  });
  const markRead = useMutation(api.channels.markThreadRead);
  const sendText = useAction(api.iaSolutionHub.sendText);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const markedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!thread || thread.unreadCount === 0) return;
    if (markedRef.current === thread._id) return;
    markedRef.current = thread._id;
    void markRead({ threadId: thread._id }).catch(() => {
      markedRef.current = null;
    });
  }, [thread, markRead]);

  // Oldest at the top: the query returns newest-first for pagination.
  const ordered = useMemo(
    () => (events ? [...events].reverse() : []),
    [events],
  );

  const blocked: BlockedReason = useMemo(() => {
    if (!thread) return null;
    if (thread.channelProvider !== "iasolution_hub") {
      return {
        title: "Legacy channel is read-only",
        detail:
          "This inbox never falls back to another provider connection. Configure the isolated OpenBSP Hub channel before sending.",
      };
    }
    if (thread.channelSendMode === "disabled") {
      return {
        title: "Kill switch active",
        detail:
          "This channel starts disabled by design. Verify its dedicated webhook and enable pilot mode before sending.",
      };
    }
    if (!thread.recipientAllowlisted) {
      return {
        title: "Recipient not allowlisted",
        detail:
          "Add this number to the isolated channel allowlist before sending to it.",
      };
    }
    const windowOpen =
      thread.serviceWindowExpiresAt !== undefined &&
      thread.serviceWindowExpiresAt > Date.now();
    if (!windowOpen) {
      return {
        title: "Service window closed",
        detail:
          "More than 24h since the last inbound message. A template is required to reopen the conversation, and templates have no UI yet.",
      };
    }
    return null;
  }, [thread]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending || blocked) return;
    setSending(true);
    setError(null);
    try {
      // A fresh nonce per submit: the outbox business key is derived from it,
      // so a double click cannot produce two sends.
      await sendText({
        channelId,
        threadKey,
        text,
        clientNonce: crypto.randomUUID(),
      });
      setDraft("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  }

  if (thread === undefined || events === undefined) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
        Loading…
      </div>
    );
  }

  if (thread === null) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
        This thread no longer exists.
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-0 flex flex-col bg-[#f4f6f9]">
      <div className="px-6 py-3.5 border-b border-slate-200 bg-white">
        <div className="font-[var(--font-outfit)] text-[15px] font-medium text-[#0a1b33]">
          {thread.displayName ?? thread.phone ?? thread.threadKey}
        </div>
        <div className="text-[11px] text-slate-400 mt-0.5">
          {thread.phone ?? thread.threadKey} · isolated OpenBSP channel
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-2">
        {ordered.length === 0 ? (
          <div className="text-center text-slate-400 text-sm py-10">
            No messages in this thread yet.
          </div>
        ) : (
          ordered.map((event) => {
            const isMessage = event.eventKind.startsWith("message.");
            const text = eventText(event.payload);
            if (!isMessage) {
              return (
                <div
                  key={event._id}
                  className="text-center text-[10px] uppercase tracking-[0.14em] text-slate-400 py-1"
                >
                  {event.eventKind.replace("status.", "")} ·{" "}
                  {formatTime(event.receivedAt)}
                </div>
              );
            }
            const incoming = event.direction === "incoming";
            return (
              <div
                key={event._id}
                className={cn("flex", incoming ? "justify-start" : "justify-end")}
              >
                <div
                  className={cn(
                    "max-w-[70%] rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed shadow-sm",
                    incoming
                      ? "bg-white text-[#0a1b33] rounded-bl-md"
                      : "bg-[#0a152d] text-white rounded-br-md",
                  )}
                >
                  {text ?? (
                    <span className="italic opacity-70">
                      {event.eventKind}
                    </span>
                  )}
                  <div
                    className={cn(
                      "text-[10px] mt-1",
                      incoming ? "text-slate-400" : "text-white/50",
                    )}
                  >
                    {formatTime(event.receivedAt)}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="border-t border-slate-200 bg-white px-6 py-3">
        {blocked ? (
          <div className="flex items-start gap-2.5 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5">
            <ShieldAlert
              size={15}
              className="text-amber-600 flex-shrink-0 mt-0.5"
            />
            <div>
              <div className="text-[12px] font-semibold text-amber-900">
                {blocked.title}
              </div>
              <div className="text-[11px] text-amber-800 mt-0.5 leading-relaxed">
                {blocked.detail}
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="flex items-center gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Write a reply…"
              maxLength={4096}
              disabled={sending}
              className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-[13px] outline-none focus:border-slate-400 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={sending || !draft.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0a152d] px-3.5 py-2 text-[13px] font-medium text-white disabled:opacity-40"
            >
              {sending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Send size={14} />
              )}
              Send
            </button>
          </form>
        )}

        {error && (
          <div className="mt-2 flex items-start gap-2 text-[11px] text-red-700">
            <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
