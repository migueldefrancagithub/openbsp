"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import Link from "next/link";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  Bot,
  Check,
  CheckCheck,
  Clock,
  FileText,
  Info,
  Loader2,
  MessageSquareText,
  Paperclip,
  PanelRightOpen,
  Pause,
  Play,
  Search,
  Send,
  ShieldAlert,
  Star,
  Timer,
  UserRound,
  UsersRound,
  Zap,
} from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { cn } from "@/lib/cn";
import { formatTime, relativeTime } from "@/lib/relativeTime";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { convexErrorMessage } from "@/lib/convexErrorMessage";
import { templateCategoryLabel } from "@/lib/operationalLabels";
import { PatientContextPanel } from "@/components/channel-inbox/PatientContextPanel";
import { PilotBanner } from "@/components/channel-inbox/PilotBanner";
import { LeadHeaderBar } from "@/components/channel-inbox/LeadHeaderBar";
import { HandoffDialog } from "@/components/channel-inbox/HandoffDialog";
import { HumanCaseChip } from "@/components/channel-inbox/HumanCaseChip";
import {
  SystemEventRow,
  type TimelineSystemItem,
} from "@/components/channel-inbox/SystemEventRow";

type BlockedReason = {
  kind: "legacy" | "disabled" | "allowlist" | "window";
  title: string;
  detail: string;
} | null;

type ThreadSummary = {
  _id: Id<"channelThreads">;
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
  leadSource?: string;
  leadStatus?: string;
  nextStep?: string;
  nextStepDueAt?: number;
  responsibleMemberId?: Id<"members">;
  assignedTeamId?: Id<"teams">;
  inboxStatus?: string;
  starredAt?: number;
  snoozedUntil?: number;
  closedAt?: number;
  dnd?: boolean;
  automationMode?: string;
  automationChangeReason?: string;
  pilotBlockedAt?: number;
  intent?: string;
  intentSource?: string;
  originCampaignId?: Id<"campaigns">;
  originCampaignName?: string;
  channelSendMode: string;
  channelProvider: string;
  channelDisplayName: string;
  channelConnectionState?: string;
  channelWebhookStatus?: string;
  channelHealthStatus?: string;
  recipientAllowlisted: boolean;
};

type ChannelTemplate = {
  _id: Id<"channelTemplates">;
  name: string;
  languageCode: string;
  category?: string;
  components?: unknown;
};

const inboxApi = api.inboxOperations;

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

type TimelineItem =
  | { type: "event"; at: number; event: ThreadEvent }
  | { type: "system"; at: number; system: TimelineSystemItem };

function errorMessage(error: unknown, locale: "pt" | "en"): string {
  return convexErrorMessage(error, locale, locale === "pt" ? "Falha ao enviar." : "Send failed.");
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

function templateVariableCount(components: unknown): number {
  const matches = JSON.stringify(components ?? {}).matchAll(/\{\{\s*(\d+)\s*\}\}/g);
  let max = 0;
  for (const match of matches) max = Math.max(max, Number(match[1]));
  return max;
}

function titleize(value: string): string {
  return value
    .replace(/^[^.]+\./, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function eventLabel(value: string, locale: "pt" | "en"): string {
  const normalized = value.replace(/^[^.]+\./, "").replace(/_/g, " ").toLowerCase();
  const labels: Record<string, [string, string]> = {
    text: ["Texto", "Text"],
    image: ["Imagem", "Image"],
    audio: ["Áudio", "Audio"],
    video: ["Vídeo", "Video"],
    document: ["Documento", "Document"],
    sticker: ["Sticker", "Sticker"],
    interactive: ["Interação", "Interactive"],
    reaction: ["Reação", "Reaction"],
    sent: ["Enviada", "Sent"],
    delivered: ["Entregue", "Delivered"],
    read: ["Lida", "Read"],
    failed: ["Falhou", "Failed"],
    accepted: ["Aceite", "Accepted"],
    processed: ["Processada", "Processed"],
  };
  const translated = labels[normalized];
  return translated ? translated[locale === "pt" ? 0 : 1] : titleize(value);
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
  locale: "pt" | "en",
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
      detail: locale === "pt" ? "Resposta de botão" : "Button reply",
      label: locale === "pt" ? "Interação" : "Interactive",
    };
  }

  const list = object(interactive?.list_reply);
  const listTitle = text(list?.title) ?? text(list?.description) ?? text(list?.id);
  if (listTitle) {
    return {
      primary: listTitle,
      detail: locale === "pt" ? "Resposta de lista" : "List reply",
      label: locale === "pt" ? "Interação" : "Interactive",
    };
  }

  const interactiveBody = text(object(interactive?.body)?.text);
  if (interactiveBody) {
    const action = object(interactive?.action);
    const buttonText = text(action?.button);
    return {
      primary: interactiveBody,
      detail: buttonText ? `CTA: ${buttonText}` : undefined,
      label: locale === "pt" ? "Interação" : "Interactive",
    };
  }

  const flowSummary = summarizeFlowResponse(root.flowResponse);
  if (flowSummary) {
    return {
      primary: locale === "pt" ? "Fluxo submetido" : "Flow submitted",
      detail: flowSummary,
      label: "Flow",
    };
  }

  const reaction = text(object(message?.reaction)?.emoji);
  if (reaction) {
    return { primary: reaction, label: locale === "pt" ? "Reação" : "Reaction" };
  }

  const media = object(message?.[messageType]) ?? object(root[messageType]);
  const mediaCaption =
    text(media?.caption) ?? text(media?.filename) ?? text(media?.mime_type);
  if (mediaCaption) {
    return {
      primary: mediaCaption,
      detail: eventLabel(messageType, locale),
      label: eventLabel(messageType, locale),
    };
  }

  if (eventKind.startsWith("message.")) {
    return { primary: null, label: eventLabel(eventKind, locale) };
  }

  return { primary: null };
}

function statusText(payload: unknown, eventKind: string, locale: "pt" | "en"): string {
  const root = object(payload);
  const status = object(root?.status);
  const reason =
    text(status?.reason) ??
    text(status?.error_message) ??
    text(object(Array.isArray(status?.errors) ? status.errors[0] : null)?.title);
  const label = eventLabel(eventKind, locale);
  return reason ? `${label} · ${reason}` : label;
}

function windowInfo(expiresAt: number | undefined, locale: "pt" | "en"):
  | { state: "open"; label: string; detail: string }
  | { state: "closed"; label: string; detail: string }
  | { state: "unknown"; label: string; detail: string } {
  if (!expiresAt) {
    return {
      state: "unknown",
      label: locale === "pt" ? "Janela desconhecida" : "Window unknown",
      detail: locale === "pt"
        ? "Nenhuma mensagem recebida abriu a janela de atendimento."
        : "No inbound message has opened a service window yet.",
    };
  }
  const now = Date.now();
  if (expiresAt > now) {
    return {
      state: "open",
      label: locale === "pt"
        ? `24h aberta · faltam ${durationLabel(expiresAt - now)}`
        : `24h open · ${durationLabel(expiresAt - now)} left`,
      detail: locale === "pt"
        ? "Pode enviar respostas livres enquanto esta janela estiver aberta."
        : "Free-form replies are allowed while this window is open.",
    };
  }
  return {
    state: "closed",
    label: locale === "pt"
      ? `Fechada · há ${durationLabel(now - expiresAt)}`
      : `Closed · ${durationLabel(now - expiresAt)} ago`,
    detail: locale === "pt"
      ? "É necessário um template para reabrir esta conversa."
      : "A template is required to reopen this conversation.",
  };
}

function initials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "WA";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

function automationLabel(mode: string | undefined, locale: "pt" | "en"): string {
  if (mode === "bot") return locale === "pt" ? "IA ativa" : "AI active";
  if (mode === "human") return locale === "pt" ? "Atendimento humano" : "Human handoff";
  if (mode === "stopped") return locale === "pt" ? "Automação parada" : "Automation stopped";
  return locale === "pt" ? "Em espera" : "Idle";
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

function ChannelMessageBubble({ event, locale }: { event: ThreadEvent; locale: "pt" | "en" }) {
  const incoming = event.direction === "incoming";
  const rendered = eventText(event.payload, event.eventKind, locale);
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
          {statusText(event.payload, event.eventKind, locale)}
          <span className="text-slate-300">·</span>
          {formatTime(eventAt, locale)}
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
            {eventLabel(event.eventKind, locale)}
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
          <span>{formatTime(eventAt, locale)}</span>
          {!incoming && <ChannelStatusIcon status={event.status} />}
        </div>
      </div>
    </div>
  );
}

export function ChannelThreadView({
  channelId,
  threadKey,
}: {
  channelId: Id<"channels">;
  threadKey: string;
}) {
  const { locale, t } = useI18n();
  const thread = useQuery(api.channels.getThread, { channelId, threadKey });
  const events = useQuery(api.channels.listThreadEvents, {
    channelId,
    threadKey,
    limit: 200,
  });
  const timelineExtras = useQuery(
    inboxApi.listThreadTimelineExtras,
    thread ? { threadId: thread._id } : "skip",
  );
  const workspace = useQuery(api.tenantsQueries.getActiveOptional);
  const quickReplies = useQuery(api.quickReplies.list);
  const members = useQuery(api.memberInvites.listMembers, {});
  const templates = useQuery(api.channels.listTemplates, { channelId }) as
    | ChannelTemplate[]
    | undefined;
  const markRead = useMutation(api.channels.markThreadRead);
  const updateThread = useMutation(inboxApi.updateThread);
  const generateUploadUrl = useMutation(inboxApi.generateAttachmentUploadUrl);
  const registerAttachment = useMutation(inboxApi.registerAttachment);
  const settleAttachment = useMutation(inboxApi.settleAttachment);
  const sendText = useAction(api.iaSolutionHub.sendText);
  const sendTemplate = useAction(api.iaSolutionHub.sendTemplate);
  const sendDocument = useAction(api.iaSolutionHub.sendDocument);

  const [draft, setDraft] = useState("");
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<ChannelTemplate | null>(null);
  const [templateVariables, setTemplateVariables] = useState<string[]>([]);
  const [quickReplySearch, setQuickReplySearch] = useState("");
  const [patientPanelOpen, setPatientPanelOpen] = useState(false);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [headerNotice, setHeaderNotice] = useState<string | null>(null);
  const threadOps = useQuery(
    inboxApi.getThreadOps,
    thread ? { threadId: thread._id } : "skip",
  );
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const markedRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const timeline = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = ordered.map((event) => ({
      type: "event",
      at: event.receivedAt,
      event,
    }));
    for (const row of timelineExtras?.systemEvents ?? []) {
      const payload = (row.payload ?? {}) as { detail?: unknown };
      items.push({
        type: "system",
        at: row.createdAt,
        system: {
          id: row._id,
          kind: row.kind,
          severity: row.severity as TimelineSystemItem["severity"],
          code: row.code,
          botName: row.botName,
          actorName: row.actorName,
          detail: typeof payload.detail === "string" ? payload.detail : undefined,
          at: row.createdAt,
        },
      });
    }
    for (const row of timelineExtras?.failedOutbox ?? []) {
      items.push({
        type: "system",
        at: row.updatedAt,
        system: {
          id: row._id,
          kind: row.status === "unknown" ? "outbox.unknown" : "outbox.failed",
          severity: row.status === "unknown" ? "warning" : "error",
          code: row.code,
          detail: row.preview,
          at: row.updatedAt,
        },
      });
    }
    items.sort((a, b) => a.at - b.at);
    return items;
  }, [ordered, timelineExtras]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [timeline.length, threadKey]);

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
        kind: "legacy",
        title: t("inbox.blockedLegacyTitle"),
        detail: t("inbox.blockedLegacyDetail"),
      };
    }
    if (thread.channelSendMode === "disabled") {
      return {
        kind: "disabled",
        title: t("inbox.blockedDisabledTitle"),
        detail: t("inbox.blockedDisabledDetail"),
      };
    }
    if (!thread.recipientAllowlisted) {
      return {
        kind: "allowlist",
        title: t("inbox.blockedAllowlistTitle"),
        detail: t("inbox.blockedAllowlistDetail"),
      };
    }
    const windowOpen =
      thread.serviceWindowExpiresAt !== undefined &&
      thread.serviceWindowExpiresAt > Date.now();
    if (!windowOpen) {
      return {
        kind: "window",
        title: t("inbox.blockedWindowTitle"),
        detail: t("inbox.blockedWindowDetail"),
      };
    }
    return null;
  }, [thread, t]);

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
      setError(errorMessage(err, locale));
    } finally {
      setSending(false);
    }
  }

  function insertQuickReply(content: string) {
    setDraft(content);
    setShowQuickReplies(false);
    setQuickReplySearch("");
  }

  function chooseTemplate(template: ChannelTemplate) {
    const count = templateVariableCount(template.components);
    setSelectedTemplate(template);
    setTemplateVariables(Array.from({ length: count }, () => ""));
  }

  async function sendSelectedTemplate() {
    if (!selectedTemplate || sending || !thread) return;
    if (templateVariables.some((value) => !value.trim())) {
      setError(t("inbox.fillTemplateVariables"));
      return;
    }
    setSending(true);
    setError(null);
    try {
      await sendTemplate({
        channelId,
        threadKey,
        templateName: selectedTemplate.name,
        languageCode: selectedTemplate.languageCode,
        bodyVariables: templateVariables,
        clientNonce: crypto.randomUUID(),
      });
      setShowTemplates(false);
      setSelectedTemplate(null);
      setTemplateVariables([]);
    } catch (cause) {
      setError(errorMessage(cause, locale));
    } finally {
      setSending(false);
    }
  }

  async function uploadAttachment(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !thread || blocked || sending) return;
    setSending(true);
    setError(null);
    let attachmentId: Id<"channelAttachments"> | undefined;
    try {
      const uploadUrl = await generateUploadUrl({});
      const upload = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!upload.ok) throw new Error(t("inbox.uploadFailed"));
      const { storageId } = (await upload.json()) as { storageId: Id<"_storage"> };
      const registered = (await registerAttachment({
        threadId: thread._id,
        storageId,
        fileName: file.name,
        contentType: file.type,
        size: file.size,
      })) as { attachmentId: Id<"channelAttachments">; url: string };
      attachmentId = registered.attachmentId;
      const dispatched = (await sendDocument({
        channelId,
        threadKey,
        url: registered.url,
        filename: file.name,
        clientNonce: crypto.randomUUID(),
      })) as { outboxId?: Id<"channelOutbox"> };
      await settleAttachment({
        attachmentId,
        status: "sent",
        outboxId: dispatched.outboxId,
      });
    } catch (cause) {
      if (attachmentId) {
        await settleAttachment({
          attachmentId,
          status: "failed",
          failureReason: errorMessage(cause, locale),
        }).catch(() => undefined);
      }
      setError(errorMessage(cause, locale));
    } finally {
      setSending(false);
    }
  }

  if (thread === undefined || events === undefined) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
        {t("inbox.loadingThread")}
      </div>
    );
  }

  if (thread === null) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
        {t("inbox.missingThread")}
      </div>
    );
  }

  const summary = thread as ThreadSummary;
  const label = summary.displayName ?? summary.phone ?? summary.threadKey;
  const window = windowInfo(summary.serviceWindowExpiresAt, locale);
  const templateAllowed =
    summary.channelProvider === "iasolution_hub" &&
    summary.channelSendMode !== "disabled" &&
    summary.recipientAllowlisted;

  return (
    <div className="flex min-h-0 flex-1 bg-[#f4f6f9]">
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-slate-200 bg-white">
          <div className="flex items-center justify-between gap-3 px-3 py-2.5 sm:px-4">
            <div className="flex min-w-0 items-center gap-3">
              <Link
                href={`/app/channel-inbox?channel=${channelId}`}
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 sm:hidden"
                title={t("inbox.all")}
              >
                <ArrowLeft size={17} />
              </Link>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#dff3ef] text-[11px] font-bold text-[#0d6b61]">
                {initials(label)}
              </div>
              <div className="min-w-0">
                <div className="truncate text-[13px] font-bold text-[#0a1b33]">
                  {label}
                </div>
                <div className="mt-0.5 truncate text-[10px] text-slate-400">
                  {summary.phone ?? summary.threadKey} · {summary.channelDisplayName}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <span
                className={cn(
                  "hidden items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-semibold md:inline-flex",
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
              <button
                type="button"
                onClick={() => void updateThread({ threadId: summary._id, starred: !summary.starredAt })}
                className={cn("rounded-md p-2 transition-colors hover:bg-slate-100", summary.starredAt ? "text-amber-500" : "text-slate-400")}
                title={summary.starredAt ? t("inbox.unfavorite") : t("inbox.favorite")}
              >
                <Star size={15} className={summary.starredAt ? "fill-current" : undefined} />
              </button>
              {threadOps?.openCase ? (
                <HumanCaseChip threadId={summary._id} currentMemberId={workspace?.memberId} />
              ) : (
                <button
                  type="button"
                  onClick={() => setHandoffOpen(true)}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[10px] font-semibold text-slate-600 transition-colors hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800"
                  title={t("handoff.title")}
                  data-handoff-button
                >
                  <UsersRound size={12} />
                  <span className="hidden sm:inline">{t("handoff.button")}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  if (summary.automationMode !== "bot" && threadOps?.openCase) {
                    setHeaderNotice(t("handoff.aiBlocked"));
                    return;
                  }
                  setHeaderNotice(null);
                  void updateThread({
                    threadId: summary._id,
                    automationMode: summary.automationMode === "bot" ? "human" : "bot",
                  }).catch((cause) => setHeaderNotice(errorMessage(cause, locale)));
                }}
                className={cn(
                  "rounded-md p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-[#0a1b33]",
                  summary.automationMode !== "bot" && threadOps?.openCase && "opacity-40",
                )}
                title={summary.automationMode === "bot" ? t("inbox.pauseAi") : t("inbox.resumeAi")}
              >
                {summary.automationMode === "bot" ? <Pause size={15} /> : <Play size={15} />}
              </button>
              <button
                type="button"
                onClick={() => void updateThread({
                  threadId: summary._id,
                  inboxStatus: "snoozed",
                  snoozedUntil: Date.now() + 2 * 60 * 60 * 1000,
                })}
                className="rounded-md p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-[#0a1b33]"
                title={t("inbox.snooze")}
              >
                <Clock size={15} />
              </button>
              <button
                type="button"
                onClick={() => setPatientPanelOpen(true)}
                className="rounded-md p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-[#0a1b33] xl:hidden"
                title={t("inbox.patient")}
              >
                <PanelRightOpen size={15} />
              </button>
            </div>
          </div>

          <LeadHeaderBar
            thread={summary}
            members={members}
            currentMemberId={workspace?.memberId}
          />
          {headerNotice && (
            <div className="border-t border-amber-100 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-900">
              {headerNotice}
            </div>
          )}
        </header>

        <div
          ref={scrollRef}
          className="flex-1 space-y-2 overflow-y-auto px-6 py-5"
        >
          {timeline.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-400">
              {t("inbox.noMessages")}
            </div>
          ) : (
            timeline.map((item) =>
              item.type === "event" ? (
                <ChannelMessageBubble key={item.event._id} event={item.event} locale={locale} />
              ) : (
                <SystemEventRow key={item.system.id} item={item.system} />
              ),
            )
          )}
        </div>

        <div className="border-t border-slate-200 bg-white px-3 py-3 sm:px-4">
          {blocked?.kind === "allowlist" && (
            <PilotBanner
              threadId={summary._id}
              recipient={summary.phone ?? summary.threadKey}
              role={workspace?.role}
              onHandoff={threadOps?.openCase ? undefined : () => setHandoffOpen(true)}
            />
          )}
          {blocked && blocked.kind !== "allowlist" && (
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
          )}

          {quickRepliesOpen && !blocked && (
                <div className="mb-3 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_18px_60px_-44px_rgba(15,23,42,0.65)]">
                  <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                      {t("inbox.quickReplies")}
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
                      {t("inbox.cancel")}
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
                        placeholder={t("inbox.searchQuickReplies")}
                        className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 text-[12px] text-[#0a1b33] outline-none focus:border-slate-400 focus:bg-white"
                      />
                    </label>
                  </div>
                  {quickReplies === undefined ? (
                    <div className="px-3 py-4 text-center text-[12px] text-slate-500">
                      {t("inbox.loadingQuickReplies")}
                    </div>
                  ) : quickReplies.length === 0 ? (
                    <div className="px-3 py-4 text-center text-[12px] text-slate-500">
                      {t("inbox.noQuickReplies")}
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
                          {t("inbox.noMatch")}
                        </li>
                      )}
                    </ul>
                  )}
                </div>
          )}

          {showTemplates && (
            <div className="mb-3 grid max-h-[310px] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl sm:grid-cols-[minmax(190px,0.8fr)_minmax(220px,1.2fr)]">
              <div className="overflow-y-auto border-b border-slate-100 p-2 sm:border-b-0 sm:border-r">
                <div className="flex items-center justify-between px-1 pb-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                    {t("inbox.templates")}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setShowTemplates(false);
                      setSelectedTemplate(null);
                      setTemplateVariables([]);
                    }}
                    className="text-[10px] font-semibold text-slate-400 hover:text-slate-700"
                  >
                    {t("inbox.cancel")}
                  </button>
                </div>
                {templates === undefined ? (
                  <div className="flex justify-center py-6"><Loader2 size={15} className="animate-spin text-slate-300" /></div>
                ) : templates.length === 0 ? (
                  <p className="px-2 py-4 text-center text-[11px] text-slate-400">{t("inbox.noTemplates")}</p>
                ) : (
                  <div className="space-y-1">
                    {templates.map((template) => (
                      <button
                        key={template._id}
                        type="button"
                        onClick={() => chooseTemplate(template)}
                        className={cn(
                          "w-full rounded-md border px-2.5 py-2 text-left transition-colors",
                          selectedTemplate?._id === template._id
                            ? "border-[#0d6b61] bg-[#edf8f6]"
                            : "border-transparent hover:bg-slate-50",
                        )}
                      >
                        <div className="truncate text-[11px] font-semibold text-[#0a1b33]">{template.name}</div>
                        <div className="mt-0.5 text-[9px] uppercase text-slate-400">{template.languageCode}{template.category ? ` · ${templateCategoryLabel(template.category, locale)}` : ""}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="min-h-[130px] overflow-y-auto p-3">
                {selectedTemplate ? (
                  <div className="flex h-full flex-col">
                    <div>
                      <div className="text-[12px] font-bold text-[#0a1b33]">{selectedTemplate.name}</div>
                      <p className="mt-1 text-[10px] text-slate-400">{t("inbox.templateVariables")}</p>
                    </div>
                    {templateVariables.length > 0 ? (
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {templateVariables.map((value, index) => (
                          <input
                            key={index}
                            value={value}
                            onChange={(event) => setTemplateVariables((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))}
                            placeholder={`{{${index + 1}}}`}
                            className="h-9 rounded-md border border-slate-200 px-2.5 text-[11px] outline-none focus:border-slate-400"
                          />
                        ))}
                      </div>
                    ) : (
                      <p className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-[10px] text-slate-500">{t("inbox.noTemplateVariables")}</p>
                    )}
                    <button
                      type="button"
                      onClick={() => void sendSelectedTemplate()}
                      disabled={sending || templateVariables.some((value) => !value.trim())}
                      className="mt-3 inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[#0a1b33] px-3 text-[11px] font-bold text-white disabled:opacity-40 sm:mt-auto"
                    >
                      {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                      {t("inbox.sendTemplate")}
                    </button>
                  </div>
                ) : (
                  <div className="flex h-full min-h-[120px] items-center justify-center text-center text-[11px] text-slate-400">{t("inbox.pickTemplate")}</div>
                )}
              </div>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,image/jpeg,image/png,audio/mpeg,audio/ogg,audio/webm"
            onChange={(event) => void uploadAttachment(event)}
            className="hidden"
          />

          <div className={cn("mt-2 flex items-center gap-1.5", !blocked && "mt-0")}>
                <button
                  type="button"
                  onClick={() => setShowQuickReplies((value) => !value)}
                  disabled={sending || Boolean(blocked)}
                  title={t("inbox.quickReplies")}
                  className="rounded-md p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-[#0a152d] disabled:opacity-30"
                >
                  <Zap size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => setShowTemplates((value) => !value)}
                  disabled={sending || !templateAllowed}
                  title={t("inbox.templates")}
                  className="rounded-md p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-[#0a152d] disabled:opacity-30"
                >
                  <FileText size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={sending || Boolean(blocked)}
                  title={t("inbox.attachment")}
                  className="rounded-md p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-[#0a152d] disabled:opacity-30"
                >
                  <Paperclip size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => setPatientPanelOpen(true)}
                  title={t("inbox.createReminder")}
                  className="rounded-md p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-[#0a152d] xl:hidden"
                >
                  <Bell size={15} />
                </button>
                <form onSubmit={submit} className="flex min-w-0 flex-1 items-center gap-1.5">
                <input
                  value={draft}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    if (event.target.value.startsWith("/")) {
                      setShowQuickReplies(true);
                    }
                  }}
                  placeholder={blocked ? blocked.title : t("inbox.writeReply")}
                  maxLength={4096}
                  disabled={sending || Boolean(blocked)}
                  className="h-10 min-w-0 flex-1 rounded-md border border-slate-200 px-3 text-[13px] outline-none focus:border-slate-400 disabled:bg-slate-50 disabled:text-slate-400"
                />
                <button
                  type="submit"
                  disabled={sending || !draft.trim() || Boolean(blocked)}
                  title={t("inbox.send")}
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[#0a152d] text-white disabled:opacity-35"
                >
                  {sending ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Send size={14} />
                  )}
                </button>
              </form>
          </div>

          {error && (
            <div className="mt-2 flex items-start gap-2 text-[11px] text-red-700">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              {error}
            </div>
          )}
        </div>
      </section>

      {handoffOpen && (
        <HandoffDialog
          threadId={summary._id}
          intent={summary.intent}
          lastPreview={summary.lastPreview}
          members={members}
          currentMemberId={workspace?.memberId}
          onClose={() => setHandoffOpen(false)}
          onCreated={() => {
            setHandoffOpen(false);
            setHeaderNotice(t("handoff.created"));
          }}
        />
      )}
      <PatientContextPanel thread={summary} className="hidden xl:flex" />
      {patientPanelOpen && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-slate-950/30 xl:hidden"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPatientPanelOpen(false);
          }}
        >
          <PatientContextPanel
            thread={summary}
            onClose={() => setPatientPanelOpen(false)}
            className="w-full max-w-[360px] shadow-2xl"
          />
        </div>
      )}
    </div>
  );
}
