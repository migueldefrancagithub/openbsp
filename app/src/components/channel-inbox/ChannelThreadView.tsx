"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCheck,
  Clock,
  Info,
  Loader2,
  MessageSquareText,
  Search,
  Send,
  ShieldAlert,
  Tag,
  Timer,
  UserRound,
  Zap,
} from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { cn } from "@/lib/cn";
import { formatTime, relativeTime } from "@/lib/relativeTime";

type BlockedReason = { title: string; detail: string } | null;

type ThreadSummary = {
  threadKey: string;
  displayName?: string;
  phone?: string;
  lastEventAt: number;
  lastEventKind: string;
  lastInboundAt?: number;
  lastOutboundAt?: number;
  lastPreview?: string;
  unreadCount: number;
  serviceWindowExpiresAt?: number;
  tags?: string[];
  automationMode?: string;
  automationChangeReason?: string;
  channelSendMode: string;
  channelProvider: string;
  channelDisplayName: string;
  channelConnectionState?: string;
  channelWebhookStatus?: string;
  channelHealthStatus?: string;
  recipientAllowlisted: boolean;
};

type ThreadEvent = {
  _id: Id<"channelEvents">;
  eventKind: string;
  direction: string;
  actorDisplayName?: string;
  actorPhone?: string;
  actorProviderScopedId?: string;
  payload: unknown;
  status: string;
  lastError?: string;
  receivedAt: number;
  providerTimestamp?: number;
};

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

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function short(value: string, max = 120): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function titleize(value: string): string {
  return value
    .replace(/^[^.]+\./, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function durationLabel(ms: number): string {
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const safe = Math.max(0, ms);
  if (safe < minute) return "<1m";
  if (safe < hour) return `${Math.floor(safe / minute)}m`;
  if (safe < day) return `${Math.floor(safe / hour)}h`;
  return `${Math.floor(safe / day)}d`;
}

function summarizeFlowResponse(value: unknown): string | null {
  const response = object(value);
  if (!response) return null;
  const pairs = Object.entries(response)
    .filter(([key, candidate]) => {
      if (key.toLowerCase().includes("token")) return false;
      return ["string", "number", "boolean"].includes(typeof candidate);
    })
    .slice(0, 3)
    .map(([key, candidate]) => `${key}: ${String(candidate)}`);
  return pairs.length > 0 ? pairs.join(" · ") : null;
}

/**
 * Display only normalized, known-safe fields. Raw provider payloads stay as
 * audit evidence in Convex and are not dumped into the browser.
 */
function eventText(
  payload: unknown,
  eventKind: string,
): { primary: string | null; detail?: string; label?: string } {
  const root = object(payload);
  if (!root) return { primary: null };

  const normalized = text(root.normalizedText);
  if (normalized) return { primary: normalized };

  const outboundText = text(root.text);
  if (outboundText) return { primary: outboundText };

  const message = object(root.message);
  const messageType = text(message?.type) ?? eventKind.replace("message.", "");

  const body = text(object(message?.text)?.body);
  if (body) return { primary: body };

  const interactive = object(message?.interactive) ?? object(root.interactive);
  const button = object(interactive?.button_reply);
  const buttonTitle = text(button?.title) ?? text(button?.id);
  if (buttonTitle) {
    return {
      primary: buttonTitle,
      detail: "Button reply",
      label: "Interactive",
    };
  }

  const list = object(interactive?.list_reply);
  const listTitle = text(list?.title) ?? text(list?.description) ?? text(list?.id);
  if (listTitle) {
    return { primary: listTitle, detail: "List reply", label: "Interactive" };
  }

  const interactiveBody = text(object(interactive?.body)?.text);
  if (interactiveBody) {
    const action = object(interactive?.action);
    const buttonText = text(action?.button);
    return {
      primary: interactiveBody,
      detail: buttonText ? `CTA: ${buttonText}` : undefined,
      label: "Interactive",
    };
  }

  const flowSummary = summarizeFlowResponse(root.flowResponse);
  if (flowSummary) {
    return { primary: "Flow submitted", detail: flowSummary, label: "Flow" };
  }

  const reaction = text(object(message?.reaction)?.emoji);
  if (reaction) return { primary: reaction, label: "Reaction" };

  const media = object(message?.[messageType]) ?? object(root[messageType]);
  const mediaCaption =
    text(media?.caption) ?? text(media?.filename) ?? text(media?.mime_type);
  if (mediaCaption) {
    return {
      primary: mediaCaption,
      detail: titleize(messageType),
      label: titleize(messageType),
    };
  }

  if (eventKind.startsWith("message.")) {
    return { primary: null, label: titleize(eventKind) };
  }

  return { primary: null };
}

function statusText(payload: unknown, eventKind: string): string {
  const root = object(payload);
  const status = object(root?.status);
  const reason =
    text(status?.reason) ??
    text(status?.error_message) ??
    text(object(Array.isArray(status?.errors) ? status.errors[0] : null)?.title);
  return reason ? `${titleize(eventKind)} · ${reason}` : titleize(eventKind);
}

function windowInfo(expiresAt?: number):
  | { state: "open"; label: string; detail: string }
  | { state: "closed"; label: string; detail: string }
  | { state: "unknown"; label: string; detail: string } {
  if (!expiresAt) {
    return {
      state: "unknown",
      label: "Window unknown",
      detail: "No inbound message has opened a service window yet.",
    };
  }
  const now = Date.now();
  if (expiresAt > now) {
    return {
      state: "open",
      label: `24h open · ${durationLabel(expiresAt - now)} left`,
      detail: "Free-form replies are allowed while this window is open.",
    };
  }
  return {
    state: "closed",
    label: `Closed · ${durationLabel(now - expiresAt)} ago`,
    detail: "A template is required to reopen this conversation.",
  };
}

function initials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "WA";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

function automationLabel(mode?: string): string {
  if (mode === "bot") return "Bot active";
  if (mode === "human") return "Human handoff";
  if (mode === "stopped") return "Automation stopped";
  return "Idle";
}

function AutomationIcon({ mode }: { mode?: string }) {
  if (mode === "bot") return <Bot size={12} />;
  if (mode === "human") return <UserRound size={12} />;
  return <Clock size={12} />;
}

function ChannelStatusIcon({ status }: { status: string }) {
  if (status === "failed") return <AlertTriangle size={12} className="text-red-400" />;
  if (status === "processed") return <CheckCheck size={12} />;
  if (status === "accepted") return <Check size={12} />;
  return null;
}

function ChannelMessageBubble({ event }: { event: ThreadEvent }) {
  const incoming = event.direction === "incoming";
  const rendered = eventText(event.payload, event.eventKind);
  const eventAt = event.providerTimestamp ?? event.receivedAt;
  const isFailed = event.status === "failed";

  if (!event.eventKind.startsWith("message.")) {
    return (
      <div className="flex justify-center py-1">
        <div
          className={cn(
            "inline-flex max-w-[80%] items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.12em]",
            isFailed
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-slate-200 bg-white text-slate-400",
          )}
          title={event.lastError}
        >
          <Info size={10} />
          {statusText(event.payload, event.eventKind)}
          <span className="text-slate-300">·</span>
          {formatTime(eventAt)}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex w-full", incoming ? "justify-start" : "justify-end")}>
      <div
        className={cn(
          "max-w-[78%] rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed shadow-sm",
          incoming
            ? "rounded-bl-md border border-slate-200 bg-white text-[#0a1b33]"
            : "rounded-br-md bg-[#0a152d] text-white",
          isFailed && "border-red-300",
        )}
      >
        {incoming && event.actorDisplayName && (
          <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
            {event.actorDisplayName}
          </div>
        )}
        {rendered.label && rendered.label !== "Text" && (
          <div
            className={cn(
              "mb-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium",
              incoming ? "bg-slate-100 text-slate-500" : "bg-white/10 text-white/70",
            )}
          >
            <MessageSquareText size={10} />
            {rendered.label}
          </div>
        )}
        {rendered.primary ? (
          <p className="whitespace-pre-wrap break-words">
            {short(rendered.primary, 2_000)}
          </p>
        ) : (
          <p className={cn("italic", incoming ? "text-slate-400" : "text-white/60")}>
            {titleize(event.eventKind)}
          </p>
        )}
        {rendered.detail && (
          <div
            className={cn(
              "mt-1 rounded-md px-2 py-1 text-[11px]",
              incoming ? "bg-slate-50 text-slate-500" : "bg-white/10 text-white/65",
            )}
          >
            {short(rendered.detail)}
          </div>
        )}
        {event.lastError && (
          <div
            className={cn(
              "mt-1 rounded-md px-2 py-1 text-[11px]",
              incoming ? "bg-red-50 text-red-700" : "bg-red-400/20 text-red-100",
            )}
          >
            {short(event.lastError)}
          </div>
        )}
        <div
          className={cn(
            "mt-1 flex items-center justify-end gap-1 text-[10px]",
            incoming ? "text-slate-400" : "text-white/50",
          )}
        >
          <span>{formatTime(eventAt)}</span>
          {!incoming && <ChannelStatusIcon status={event.status} />}
        </div>
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string | number | undefined;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-100 py-2 last:border-b-0">
      <span className="text-[11px] text-slate-400">{label}</span>
      <span className="min-w-0 truncate text-right text-[12px] font-medium text-[#0a1b33]">
        {value ?? "—"}
      </span>
    </div>
  );
}

function ThreadContextPanel({
  thread,
  blocked,
  eventCount,
}: {
  thread: ThreadSummary;
  blocked: BlockedReason;
  eventCount: number;
}) {
  const tags = thread.tags ?? [];
  const window = windowInfo(thread.serviceWindowExpiresAt);

  return (
    <aside className="hidden w-[310px] shrink-0 border-l border-slate-200 bg-white lg:flex lg:flex-col">
      <div className="border-b border-slate-200 px-5 py-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
          Context
        </div>
        <div className="mt-2 text-[15px] font-semibold text-[#0a1b33]">
          {thread.displayName ?? thread.phone ?? thread.threadKey}
        </div>
        <div className="mt-0.5 truncate text-[12px] text-slate-500">
          {thread.phone ?? thread.threadKey}
        </div>
      </div>

      <div className="space-y-5 overflow-y-auto px-5 py-4">
        <section>
          <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-[#0a1b33]">
            <Timer size={13} />
            Service window
          </div>
          <div
            className={cn(
              "rounded-lg border px-3 py-2 text-[12px]",
              window.state === "open"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : window.state === "closed"
                  ? "border-amber-200 bg-amber-50 text-amber-800"
                  : "border-slate-200 bg-slate-50 text-slate-600",
            )}
          >
            <div className="font-semibold">{window.label}</div>
            <div className="mt-0.5 text-[11px] opacity-80">{window.detail}</div>
          </div>
        </section>

        <section>
          <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-[#0a1b33]">
            <AutomationIcon mode={thread.automationMode} />
            Automation
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-600">
            <div className="font-semibold text-[#0a1b33]">
              {automationLabel(thread.automationMode)}
            </div>
            {thread.automationChangeReason && (
              <div className="mt-0.5 text-[11px] text-slate-500">
                {thread.automationChangeReason}
              </div>
            )}
          </div>
        </section>

        {tags.length > 0 && (
          <section>
            <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-[#0a1b33]">
              <Tag size={13} />
              Tags
            </div>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600"
                >
                  {tag}
                </span>
              ))}
            </div>
          </section>
        )}

        <section className="rounded-lg border border-slate-200 px-3">
          <DetailRow label="Channel" value={thread.channelDisplayName} />
          <DetailRow label="Provider" value={thread.channelProvider} />
          <DetailRow label="Connection" value={thread.channelConnectionState} />
          <DetailRow label="Webhook" value={thread.channelWebhookStatus} />
          <DetailRow label="Health" value={thread.channelHealthStatus} />
          <DetailRow label="Outbound" value={thread.channelSendMode} />
          <DetailRow
            label="Allowlist"
            value={thread.recipientAllowlisted ? "allowed" : "blocked"}
          />
          <DetailRow label="Events" value={eventCount} />
          <DetailRow
            label="Last inbound"
            value={
              thread.lastInboundAt ? relativeTime(thread.lastInboundAt) : undefined
            }
          />
          <DetailRow
            label="Last outbound"
            value={
              thread.lastOutboundAt ? relativeTime(thread.lastOutboundAt) : undefined
            }
          />
        </section>

        {blocked && (
          <section className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
            <div className="flex items-start gap-2">
              <ShieldAlert
                size={14}
                className="mt-0.5 shrink-0 text-amber-600"
              />
              <div>
                <div className="text-[12px] font-semibold text-amber-900">
                  {blocked.title}
                </div>
                <div className="mt-0.5 text-[11px] leading-relaxed text-amber-800">
                  {blocked.detail}
                </div>
              </div>
            </div>
          </section>
        )}
      </div>
    </aside>
  );
}

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
  const quickReplies = useQuery(api.quickReplies.list);
  const markRead = useMutation(api.channels.markThreadRead);
  const sendText = useAction(api.iaSolutionHub.sendText);

  const [draft, setDraft] = useState("");
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [quickReplySearch, setQuickReplySearch] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const markedRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!thread || thread.unreadCount === 0) return;
    if (markedRef.current === thread._id) return;
    markedRef.current = thread._id;
    void markRead({ threadId: thread._id }).catch(() => {
      markedRef.current = null;
    });
  }, [thread, markRead]);

  const ordered = useMemo(
    () => ((events as ThreadEvent[] | undefined) ? [...(events as ThreadEvent[])].reverse() : []),
    [events],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [ordered.length, threadKey]);

  const quickReplyNeedle = (
    quickReplySearch || (draft.startsWith("/") ? draft.slice(1) : "")
  )
    .trim()
    .toLowerCase();
  const filteredQuickReplies = useMemo(
    () =>
      (quickReplies ?? []).filter((reply) => {
        if (!quickReplyNeedle) return true;
        return (
          reply.name.toLowerCase().includes(quickReplyNeedle) ||
          reply.content.toLowerCase().includes(quickReplyNeedle)
        );
      }),
    [quickReplies, quickReplyNeedle],
  );
  const quickRepliesOpen = showQuickReplies || draft.startsWith("/");

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
          "More than 24h since the last inbound message. Use a template to reopen the conversation.",
      };
    }
    return null;
  }, [thread]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || sending || blocked) return;
    setSending(true);
    setError(null);
    try {
      await sendText({
        channelId,
        threadKey,
        text: message,
        clientNonce: crypto.randomUUID(),
      });
      setDraft("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  }

  function insertQuickReply(content: string) {
    setDraft(content);
    setShowQuickReplies(false);
    setQuickReplySearch("");
  }

  if (thread === undefined || events === undefined) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
        Loading…
      </div>
    );
  }

  if (thread === null) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
        This thread no longer exists.
      </div>
    );
  }

  const summary = thread as ThreadSummary;
  const label = summary.displayName ?? summary.phone ?? summary.threadKey;
  const window = windowInfo(summary.serviceWindowExpiresAt);

  return (
    <div className="flex min-h-0 flex-1 bg-[#f4f6f9]">
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-slate-200 bg-white px-6 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#F5C344] via-[#F28482] to-[#B567C2] text-[12px] font-semibold text-white">
                {initials(label)}
              </div>
              <div className="min-w-0">
                <div className="truncate font-[var(--font-outfit)] text-[15px] font-medium text-[#0a1b33]">
                  {label}
                </div>
                <div className="mt-0.5 truncate text-[11px] text-slate-400">
                  {summary.phone ?? summary.threadKey} · {summary.channelDisplayName}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium",
                  window.state === "open"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : window.state === "closed"
                      ? "border-amber-200 bg-amber-50 text-amber-700"
                      : "border-slate-200 bg-slate-50 text-slate-500",
                )}
                title={window.detail}
              >
                <Timer size={11} />
                {window.label}
              </span>
              <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-600">
                <AutomationIcon mode={summary.automationMode} />
                {automationLabel(summary.automationMode)}
              </span>
            </div>
          </div>

          {(summary.tags?.length ?? 0) > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {summary.tags!.slice(0, 6).map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-medium text-slate-500"
                >
                  <Tag size={10} />
                  {tag}
                </span>
              ))}
            </div>
          )}
        </header>

        <div
          ref={scrollRef}
          className="flex-1 space-y-2 overflow-y-auto px-6 py-5"
        >
          {ordered.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-400">
              No messages in this thread yet.
            </div>
          ) : (
            ordered.map((event) => (
              <ChannelMessageBubble key={event._id} event={event} />
            ))
          )}
        </div>

        <div className="border-t border-slate-200 bg-white px-6 py-3">
          {blocked ? (
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
              <ShieldAlert
                size={15}
                className="mt-0.5 shrink-0 text-amber-600"
              />
              <div>
                <div className="text-[12px] font-semibold text-amber-900">
                  {blocked.title}
                </div>
                <div className="mt-0.5 text-[11px] leading-relaxed text-amber-800">
                  {blocked.detail}
                </div>
              </div>
            </div>
          ) : (
            <>
              {quickRepliesOpen && (
                <div className="mb-3 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_18px_60px_-44px_rgba(15,23,42,0.65)]">
                  <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                      Quick replies
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setShowQuickReplies(false);
                        setQuickReplySearch("");
                        if (draft.startsWith("/")) setDraft("");
                      }}
                      className="text-[11px] text-slate-500 hover:text-slate-900"
                    >
                      Cancel
                    </button>
                  </div>
                  <div className="border-b border-slate-100 p-2">
                    <label className="relative block">
                      <Search
                        size={13}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                      />
                      <input
                        value={quickReplySearch}
                        onChange={(event) =>
                          setQuickReplySearch(event.target.value)
                        }
                        placeholder="Search shortcut..."
                        className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 text-[12px] text-[#0a1b33] outline-none focus:border-slate-400 focus:bg-white"
                      />
                    </label>
                  </div>
                  {quickReplies === undefined ? (
                    <div className="px-3 py-4 text-center text-[12px] text-slate-500">
                      Loading quick replies…
                    </div>
                  ) : quickReplies.length === 0 ? (
                    <div className="px-3 py-4 text-center text-[12px] text-slate-500">
                      No quick replies yet.
                    </div>
                  ) : (
                    <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto">
                      {filteredQuickReplies.map((reply) => (
                        <li key={reply._id}>
                          <button
                            type="button"
                            onClick={() => insertQuickReply(reply.content)}
                            className="flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors hover:bg-slate-50"
                          >
                            <Zap
                              size={12}
                              className="mt-0.5 shrink-0 text-amber-500"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="font-[var(--font-mono)] text-[12px] font-semibold text-[#0a1b33]">
                                /{reply.name}
                              </div>
                              <div className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-slate-500">
                                {reply.content}
                              </div>
                            </div>
                          </button>
                        </li>
                      ))}
                      {filteredQuickReplies.length === 0 && (
                        <li className="px-3 py-4 text-center text-[12px] text-slate-500">
                          No match
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              )}
              <form onSubmit={submit} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowQuickReplies((value) => !value)}
                  disabled={sending}
                  title="Quick replies"
                  className="rounded-lg border border-slate-200 p-2 text-slate-500 transition-colors hover:border-slate-300 hover:text-[#0a152d] disabled:opacity-40"
                >
                  <Zap size={15} />
                </button>
                <input
                  value={draft}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    if (event.target.value.startsWith("/")) {
                      setShowQuickReplies(true);
                    }
                  }}
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
            </>
          )}

          {error && (
            <div className="mt-2 flex items-start gap-2 text-[11px] text-red-700">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              {error}
            </div>
          )}
        </div>
      </section>

      <ThreadContextPanel
        thread={summary}
        blocked={blocked}
        eventCount={ordered.length}
      />
    </div>
  );
}
