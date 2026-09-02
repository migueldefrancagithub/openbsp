"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  Archive,
  Bell,
  CalendarDays,
  Check,
  ChevronRight,
  CircleUserRound,
  Clock3,
  History,
  ListTodo,
  Loader2,
  Megaphone,
  MessageSquareText,
  Paperclip,
  ShieldCheck,
  X,
} from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { cn } from "@/lib/cn";
import { convexErrorMessage } from "@/lib/convexErrorMessage";
import { relativeTime } from "@/lib/relativeTime";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { roleLabel } from "@/lib/operationalLabels";

type ThreadContext = {
  intent?: string;
  intentSource?: string;
  _id: Id<"channelThreads">;
  threadKey: string;
  displayName?: string;
  phone?: string;
  tags?: string[];
  leadStatus?: string;
  nextStep?: string;
  nextStepDueAt?: number;
  responsibleMemberId?: Id<"members">;
  assignedTeamId?: Id<"teams">;
  inboxStatus?: string;
  closedAt?: number;
  dnd?: boolean;
  automationMode?: string;
  serviceWindowExpiresAt?: number;
};

type Tool = "note" | "reminder" | "close" | null;
type PanelTab = "summary" | "tasks" | "history";
type LeadStatus =
  | "new"
  | "interested"
  | "asked_price"
  | "wants_booking"
  | "awaiting_human"
  | "booked"
  | "confirmed"
  | "attended"
  | "no_show"
  | "lost";

const inboxApi = api.inboxOperations;

const STATE_LABELS: Record<string, TranslationKey> = {
  new: "status.new",
  interested: "status.interested",
  asked_price: "status.asked_price",
  wants_booking: "status.wants_booking",
  awaiting_human: "status.awaiting_human",
  booked: "status.booked",
  confirmed: "status.confirmed",
  attended: "status.attended",
  no_show: "status.no_show",
  lost: "status.lost",
  scheduled: "state.scheduled",
  triggered: "state.triggered",
  completed: "state.completed",
  cancelled: "state.cancelled",
  failed: "state.failed",
  pending: "state.pending",
  queued: "state.queued",
  sent: "state.sent",
  delivered: "state.delivered",
  read: "state.read",
  replied: "state.replied",
  converted: "state.converted",
  granted: "state.granted",
  denied: "state.denied",
  withdrawn: "state.withdrawn",
  expired: "state.expired",
};

function stateLabel(
  value: string,
  translate: (key: TranslationKey) => string,
) {
  const key = STATE_LABELS[value];
  return key ? translate(key) : value.replace(/_/g, " ");
}

function formatMoment(timestamp: number, locale: "pt" | "en") {
  return new Intl.DateTimeFormat(locale === "pt" ? "pt-MZ" : "en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function auditActionLabel(action: string, t: (key: TranslationKey) => string): string {
  const key = `audit.${action}` as TranslationKey;
  const label = t(key);
  return label === key ? action.replace(/[._]/g, " ") : label;
}

function describeChanges(payload: unknown, t: (key: TranslationKey) => string): string {
  const changed =
    payload && typeof payload === "object" && "changed" in payload
      ? (payload as { changed?: Record<string, { from?: unknown; to?: unknown }> }).changed
      : undefined;
  if (!changed) return "";
  const parts = Object.entries(changed).map(([field, diff]) => {
    const key = `audit.field.${field}` as TranslationKey;
    const label = t(key) === key ? field : t(key);
    const to = diff?.to;
    const rendered =
      to === undefined || to === null || to === ""
        ? "—"
        : typeof to === "boolean"
          ? to ? "✓" : "✗"
          : Array.isArray(to)
            ? to.join(", ")
            : typeof to === "number" && to > 1_000_000_000_000
              ? new Date(to).toLocaleString()
              : String(to);
    return `${label} → ${rendered}`;
  });
  return parts.length ? ` · ${parts.join(" · ")}` : "";
}

function errorText(error: unknown, locale: "pt" | "en") {
  return convexErrorMessage(error, locale, locale === "pt" ? "Não foi possível guardar." : "Could not save.");
}

function Section({
  title,
  icon: Icon,
  action,
  children,
}: {
  title: string;
  icon: typeof CircleUserRound;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-slate-100 px-4 py-3.5 last:border-b-0">
      <div className="mb-2.5 flex items-center gap-2">
        <Icon size={13} className="text-slate-400" />
        <h3 className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
          {title}
        </h3>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {children}
    </section>
  );
}

export function PatientContextPanel({
  thread,
  className,
  onClose,
}: {
  thread: ThreadContext;
  className?: string;
  onClose?: () => void;
}) {
  const { locale, t, tr } = useI18n();
  const context = useQuery(inboxApi.getPatientContext, { threadId: thread._id }) as any;
  const members = useQuery(api.memberInvites.listMembers, {});
  const teams = useQuery(api.teams.list, {});
  const closeReasons = useQuery(inboxApi.listCloseReasons, {}) as
    | Array<{ _id: Id<"threadCloseReasons">; name: string }>
    | undefined;
  const updateThread = useMutation(inboxApi.updateThread);
  const addInternalNote = useMutation(inboxApi.addInternalNote);
  const createReminder = useMutation(inboxApi.createReminder);
  const setReminderStatus = useMutation(inboxApi.setReminderStatus);
  const createCloseReason = useMutation(inboxApi.createCloseReason);
  const [tool, setTool] = useState<Tool>(null);
  const [activeTab, setActiveTab] = useState<PanelTab>("summary");
  const history = useQuery(
    inboxApi.listThreadHistory,
    activeTab === "history" ? { threadId: thread._id, limit: 40 } : "skip",
  );
  const [note, setNote] = useState("");
  const [nextStep, setNextStep] = useState(thread.nextStep ?? "");
  const [closeReason, setCloseReason] = useState("");
  const [reminderAt, setReminderAt] = useState(() => {
    const date = new Date(Date.now() + 3 * 60 * 60 * 1000);
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 16);
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setNextStep(thread.nextStep ?? ""), [thread.nextStep]);

  async function run(operation: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await operation();
      setTool(null);
    } catch (cause) {
      setError(errorText(cause, locale));
    } finally {
      setBusy(false);
    }
  }

  async function saveNote(event: FormEvent) {
    event.preventDefault();
    const body = note.trim();
    if (!body) return;
    await run(async () => {
      await addInternalNote({ threadId: thread._id, body, mentionedMemberIds: [] });
      setNote("");
    });
  }

  async function saveReminder(event: FormEvent) {
    event.preventDefault();
    const body = note.trim();
    const dueAt = new Date(reminderAt).getTime();
    if (!body || !Number.isFinite(dueAt)) return;
    await run(async () => {
      await createReminder({ threadId: thread._id, note: body, dueAt });
      setNote("");
    });
  }

  async function closeConversation(event: FormEvent) {
    event.preventDefault();
    const reason = closeReason.trim();
    if (!reason) return;
    await run(async () => {
      const existing = closeReasons?.find(
        (item) => item.name.toLowerCase() === reason.toLowerCase(),
      );
      const closeReasonId = existing?._id ?? (await createCloseReason({ name: reason }));
      await updateThread({
        threadId: thread._id,
        inboxStatus: "closed",
        closeReasonId,
        automationMode: "stopped",
      });
      setCloseReason("");
    });
  }

  const patientName = context?.contact?.name ?? thread.displayName ?? thread.phone ?? thread.threadKey;
  const patientPhone = context?.contact?.phone ?? thread.phone ?? thread.threadKey;
  const tags = Array.from(new Set([...(thread.tags ?? []), ...(context?.contact?.tags ?? [])]));

  return (
    <aside className={cn("relative flex h-full w-[326px] shrink-0 flex-col border-l border-slate-200 bg-white", className)}>
      <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3.5">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#dff3ef] text-[11px] font-bold text-[#0d6b61]">
          {patientName.slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-bold text-[#0a1b33]">{patientName}</div>
          <div className="mt-0.5 truncate text-[10px] text-slate-400">{patientPhone}</div>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100" title={t("inbox.cancel")}>
            <X size={15} />
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 border-b border-slate-200 bg-slate-50 p-1.5">
        {([
          ["summary", t("inbox.summary"), CircleUserRound],
          ["tasks", t("inbox.tasks"), ListTodo],
          ["history", t("inbox.history"), History],
        ] as const).map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            onClick={() => setActiveTab(value)}
            className={cn(
              "flex h-9 min-w-0 items-center justify-center gap-1.5 rounded text-[10px] font-semibold transition-colors",
              activeTab === value
                ? "bg-white text-[#0a1b33] shadow-sm"
                : "text-slate-500 hover:text-[#0a1b33]",
            )}
          >
            <Icon size={13} />
            <span className="truncate">{label}</span>
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {activeTab === "summary" && <>
        <Section title={t("inbox.flow")} icon={ChevronRight}>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[10px] font-semibold text-slate-400">
              {t("inbox.stage")}
              <select
                value={thread.leadStatus ?? "new"}
                onChange={(event) => void updateThread({ threadId: thread._id, leadStatus: event.target.value as LeadStatus })}
                className="mt-1 h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-[#0a1b33] outline-none"
              >
                {["new", "interested", "asked_price", "wants_booking", "awaiting_human", "booked", "confirmed", "attended", "no_show", "lost"].map((status) => (
                  <option key={status} value={status}>{t(`status.${status}` as TranslationKey)}</option>
                ))}
              </select>
            </label>
            <label className="text-[10px] font-semibold text-slate-400">
              {t("inbox.intent")}
              <select
                value={thread.intent ?? ""}
                onChange={(event) => void updateThread(event.target.value
                  ? { threadId: thread._id, intent: event.target.value as never }
                  : { threadId: thread._id, clearIntent: true })}
                className="mt-1 h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-[#0a1b33] outline-none"
              >
                <option value="">{t("inbox.noIntent")}</option>
                {["greeting", "info_request", "price_request", "booking_request", "reschedule", "cancel", "confirm_attendance", "complaint", "support", "human_request", "opt_out", "clinical_question", "out_of_scope", "other"].map((intent) => (
                  <option key={intent} value={intent}>{t(`intent.${intent}` as TranslationKey)}</option>
                ))}
              </select>
            </label>
            <label className="text-[10px] font-semibold text-slate-400">
              {t("inbox.owner")}
              <select
                value={thread.responsibleMemberId ?? ""}
                onChange={(event) => void updateThread(event.target.value
                  ? { threadId: thread._id, responsibleMemberId: event.target.value as Id<"members"> }
                  : { threadId: thread._id, clearResponsible: true })}
                className="mt-1 h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-[#0a1b33] outline-none"
              >
                <option value="">{t("inbox.unassignedShort")}</option>
                {(members ?? []).filter((member) => member.status === "active").map((member) => (
                  <option key={member._id} value={member._id}>{member.email ?? roleLabel(member.role, locale)}</option>
                ))}
              </select>
            </label>
            <label className="col-span-2 text-[10px] font-semibold text-slate-400">
              {t("inbox.team")}
              <select
                value={thread.assignedTeamId ?? ""}
                onChange={(event) => void updateThread(event.target.value
                  ? { threadId: thread._id, assignedTeamId: event.target.value as Id<"teams"> }
                  : { threadId: thread._id, clearTeam: true })}
                className="mt-1 h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-[#0a1b33] outline-none"
              >
                <option value="">{t("inbox.unassignedShort")}</option>
                {(teams ?? []).map((team) => <option key={team._id} value={team._id}>{team.name}</option>)}
              </select>
            </label>
          </div>
          <div className="mt-2 flex gap-1.5">
            <input
              value={nextStep}
              onChange={(event) => setNextStep(event.target.value)}
              placeholder={t("inbox.nextAction")}
              className="h-8 min-w-0 flex-1 rounded-md border border-slate-200 px-2 text-[11px] outline-none focus:border-slate-400"
            />
            <button
              type="button"
              onClick={() => void updateThread({ threadId: thread._id, nextStep })}
              className="rounded-md bg-[#0a1b33] px-2.5 text-white"
              title={t("inbox.save")}
            >
              <Check size={13} />
            </button>
          </div>
          {thread.nextStepDueAt && (
            <div className="mt-1.5 flex items-center gap-1 text-[10px] text-amber-700">
              <Clock3 size={11} /> {formatMoment(thread.nextStepDueAt, locale)}
            </div>
          )}
        </Section>

        <Section title={t("inbox.patient")} icon={CircleUserRound}>
          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <button
              type="button"
              onClick={() => void updateThread({ threadId: thread._id, dnd: !thread.dnd })}
              className={cn("rounded-md border px-2 py-2 text-left font-semibold", thread.dnd ? "border-rose-200 bg-rose-50 text-rose-700" : "border-slate-200 text-slate-600")}
            >
              DND · {thread.dnd ? tr("Ativo", "On") : tr("Inativo", "Off")}
            </button>
            <button
              type="button"
              onClick={() => void updateThread({
                threadId: thread._id,
                automationMode: thread.automationMode === "bot" ? "human" : "bot",
              })}
              className="rounded-md border border-slate-200 px-2 py-2 text-left font-semibold text-slate-600"
            >
              IA · {thread.automationMode === "bot" ? tr("Ativa", "On") : tr("Pausada", "Paused")}
            </button>
          </div>
          {tags.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {tags.slice(0, 8).map((tag) => (
                <span key={tag} className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] font-semibold text-slate-500">{tag}</span>
              ))}
            </div>
          ) : <p className="mt-2 text-[10px] text-slate-400">{t("inbox.noTags")}</p>}
          {context?.contact?.locale && (
            <div className="mt-2 text-[10px] text-slate-400">
              {tr("Idioma do paciente", "Patient language")}: <span className="font-semibold text-slate-600">{context.contact.locale}</span>
            </div>
          )}
        </Section>

        <Section title={t("inbox.consent")} icon={ShieldCheck}>
          <div className="space-y-1.5">
            {(context?.consents ?? []).map((item: any) => (
              <div key={item.purpose} className="flex items-center justify-between text-[10px]">
                <span className="capitalize text-slate-500">
                  {item.purpose === "marketing"
                    ? tr("Marketing", "Marketing")
                    : item.purpose === "transactional"
                      ? tr("Atendimento", "Service")
                      : tr("Autenticação", "Authentication")}
                </span>
                <span className={cn("font-bold", item.status === "granted" ? "text-emerald-600" : "text-rose-600")}>
                  {stateLabel(item.status, t)}
                </span>
              </div>
            ))}
            {context?.consents?.length === 0 && <span className="text-[10px] text-slate-400">{t("inbox.noConsents")}</span>}
          </div>
        </Section>

        <Section title={t("inbox.actions")} icon={Archive}>
          {thread.closedAt || thread.inboxStatus === "closed" ? (
            <button type="button" onClick={() => void updateThread({ threadId: thread._id, inboxStatus: "open", automationMode: "human" })} className="w-full rounded-md border border-slate-200 py-2 text-[11px] font-semibold text-slate-600">{t("inbox.reopen")}</button>
          ) : (
            <button type="button" onClick={() => setTool("close")} className="w-full rounded-md border border-rose-200 py-2 text-[11px] font-semibold text-rose-600">{t("inbox.close")}</button>
          )}
        </Section>
        </>}

        {activeTab === "tasks" && <>
        <Section
          title={t("inbox.notes")}
          icon={MessageSquareText}
          action={<button type="button" onClick={() => setTool("note")} className="text-[10px] font-bold text-[#0d6b61]">+ {t("inbox.addNote")}</button>}
        >
          {context === undefined ? <Loader2 size={13} className="animate-spin text-slate-300" /> : context.notes.length === 0 ? (
            <p className="text-[10px] text-slate-400">{t("inbox.noNotes")}</p>
          ) : (
            <div className="space-y-2">
              {context.notes.slice(0, 4).map((item: any) => (
                <div key={item._id} className="border-l-2 border-amber-300 pl-2">
                  <p className="text-[11px] leading-4 text-slate-700">{item.body}</p>
                  <span className="text-[9px] text-slate-400">{item.authorName ?? t("inbox.team")} · {relativeTime(item.createdAt, Date.now(), locale)}</span>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section
          title={t("inbox.reminders")}
          icon={Bell}
          action={<button type="button" onClick={() => setTool("reminder")} className="text-[10px] font-bold text-[#0d6b61]">+ {t("inbox.createReminder")}</button>}
        >
          {context?.reminders?.length ? (
            <div className="space-y-2">
              {context.reminders.slice(0, 4).map((item: any) => (
                <div key={item._id} className="flex items-start gap-2">
                  <button
                    type="button"
                    disabled={["completed", "cancelled"].includes(item.status)}
                    onClick={() => void setReminderStatus({ reminderId: item._id, status: "completed" })}
                    className={cn("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border", item.status === "completed" ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300")}
                  >
                    {item.status === "completed" && <Check size={10} />}
                  </button>
                  <div className="min-w-0">
                    <p className="truncate text-[11px] text-slate-700">{item.note}</p>
                    <span className="text-[9px] text-slate-400">{formatMoment(item.dueAt, locale)} · {stateLabel(item.status, t)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : <p className="text-[10px] text-slate-400">{t("inbox.noReminders")}</p>}
        </Section>

        <Section title={t("inbox.appointments")} icon={CalendarDays}>
          {context?.appointments?.length ? context.appointments.slice(0, 3).map((item: any) => (
            <div key={item._id} className="mb-2 flex items-center gap-2 last:mb-0">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-50 text-blue-600"><CalendarDays size={13} /></div>
              <div className="min-w-0"><p className="truncate text-[11px] font-semibold text-slate-700">{item.serviceName}</p><p className="text-[9px] text-slate-400">{formatMoment(item.startAt, locale)} · {stateLabel(item.status, t)}</p></div>
            </div>
          )) : <p className="text-[10px] text-slate-400">{t("inbox.noAppointments")}</p>}
        </Section>
        </>}

        {activeTab === "history" && <>
        <Section title={t("inbox.changes")} icon={History}>
          {history === undefined ? (
            <p className="text-[10px] text-slate-400">{t("shell.loading")}</p>
          ) : history.length === 0 ? (
            <p className="text-[10px] text-slate-400">{t("inbox.historyEmpty")}</p>
          ) : (
            history.map((row) => (
              <div key={row._id} className="mb-2 text-[10px] last:mb-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-semibold text-slate-600">
                    {auditActionLabel(row.action, t)}
                  </span>
                  <span className="shrink-0 text-[9px] text-slate-400">{relativeTime(row.createdAt, Date.now(), locale)}</span>
                </div>
                <div className="text-[9px] text-slate-400">
                  {row.actorName ?? (row.actorKind === "ai" ? "IA" : t("inbox.team"))}
                  {describeChanges(row.payload, t)}
                </div>
              </div>
            ))
          )}
        </Section>

        <Section title={t("inbox.campaigns")} icon={Megaphone}>
          {context?.campaigns?.length ? context.campaigns.slice(0, 4).map((item: any) => (
            <div key={`${item.campaignId}-${item.updatedAt}`} className="mb-1.5 flex items-center justify-between gap-2 text-[10px] last:mb-0">
              <span className="min-w-0 truncate font-semibold text-slate-600">{item.name}</span>
              <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">{stateLabel(item.recipientStatus, t)}</span>
            </div>
          )) : <p className="text-[10px] text-slate-400">{t("inbox.noCampaigns")}</p>}
        </Section>

        <Section title={tr("Ficheiros", "Files")} icon={Paperclip}>
          {context?.attachments?.length ? context.attachments.slice(0, 8).map((item: any) => (
            item.url ? (
              <a key={item._id} href={item.url} target="_blank" rel="noreferrer" className="mb-1.5 flex items-center gap-2 text-[10px] text-slate-600 last:mb-0 hover:text-[#0d6b61]">
                <Paperclip size={11} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate font-semibold">{item.fileName}</span>
                <span className="shrink-0 text-[9px] text-slate-400">{relativeTime(item.createdAt, Date.now(), locale)}</span>
              </a>
            ) : (
              <div key={item._id} className="mb-1.5 flex items-center gap-2 text-[10px] text-slate-400 last:mb-0">
                <Paperclip size={11} /><span className="truncate">{item.fileName}</span>
              </div>
            )
          )) : <p className="text-[10px] text-slate-400">{tr("Sem ficheiros nesta conversa", "No files in this conversation")}</p>}
        </Section>
        </>}
      </div>

      {tool && (
        <div className="absolute inset-0 z-20 flex flex-col bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div className="text-[13px] font-bold text-[#0a1b33]">
              {tool === "note" ? t("inbox.internalNote") : tool === "reminder" ? t("inbox.reminder") : t("inbox.close")}
            </div>
            <button type="button" onClick={() => setTool(null)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100"><X size={15} /></button>
          </div>
          <form onSubmit={tool === "note" ? saveNote : tool === "reminder" ? saveReminder : closeConversation} className="flex flex-1 flex-col gap-3 p-4">
            {tool === "close" ? (
              <>
                <label className="text-[11px] font-semibold text-slate-600">{t("inbox.closeReason")}</label>
                <input list="close-reasons" value={closeReason} onChange={(event) => setCloseReason(event.target.value)} className="h-10 rounded-md border border-slate-200 px-3 text-[12px] outline-none focus:border-slate-400" autoFocus />
                <datalist id="close-reasons">{(closeReasons ?? []).map((reason) => <option key={reason._id} value={reason.name} />)}</datalist>
              </>
            ) : (
              <>
                <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={7} maxLength={tool === "note" ? 4000 : 500} placeholder={tool === "note" ? t("inbox.teamOnlyNote") : t("inbox.nextAction")} className="resize-none rounded-md border border-slate-200 p-3 text-[12px] leading-5 outline-none focus:border-slate-400" autoFocus />
                {tool === "reminder" && <input type="datetime-local" value={reminderAt} onChange={(event) => setReminderAt(event.target.value)} className="h-10 rounded-md border border-slate-200 px-3 text-[12px] outline-none" />}
              </>
            )}
            {error && <p className="text-[11px] text-rose-600">{error}</p>}
            <button type="submit" disabled={busy} className="mt-auto flex h-10 items-center justify-center gap-2 rounded-md bg-[#0a1b33] text-[12px] font-bold text-white disabled:opacity-50">
              {busy && <Loader2 size={13} className="animate-spin" />}{t("inbox.save")}
            </button>
          </form>
        </div>
      )}
    </aside>
  );
}
