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
import { CustomFieldsSection } from "@/components/channel-inbox/CustomFieldsSection";
import { AppointmentScheduler } from "@/components/agenda/AppointmentScheduler";
import { appointmentStatusLabel } from "@/components/agenda/agendaLabels";

type ThreadContext = {
  customFields?: Record<string, string | number | boolean>;
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
type PanelTab = "lead" | "appointments" | "notes" | "followups";
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

function memberDisplay(member: { email?: string; name?: string; role: string }): string {
  return member.name ?? member.email?.split("@")[0] ?? member.role;
}

function toLocalInputValue(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function reminderPresets(t: (key: TranslationKey) => string): Array<[string, number]> {
  const now = Date.now();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  const monday = new Date();
  const day = monday.getDay();
  monday.setDate(monday.getDate() + ((8 - day) % 7 || 7));
  monday.setHours(9, 0, 0, 0);
  return [
    [t("inbox.reminderIn1h"), now + 60 * 60 * 1000],
    [t("inbox.reminderIn4h"), now + 4 * 60 * 60 * 1000],
    [t("inbox.reminderTomorrow"), tomorrow.getTime()],
    [t("inbox.reminderNextMonday"), monday.getTime()],
  ];
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
    <section className="border-b border-line-soft px-4 py-3.5 last:border-b-0">
      <div className="mb-2.5 flex items-center gap-2">
        <Icon size={13} className="text-faint" />
        <h3 className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
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
  toolRequest,
}: {
  thread: ThreadContext;
  className?: string;
  onClose?: () => void;
  toolRequest?: { tool: "note" | "reminder" | "close"; nonce: number } | null;
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
  const [activeTab, setActiveTab] = useState<PanelTab>("lead");
  const followUps = useQuery(api.followUps.listForThread, activeTab === "followups" ? { threadId: thread._id } : "skip");
  const threadAppointments = useQuery(api.clinic.listThreadAppointments, activeTab === "appointments" ? { threadId: thread._id } : "skip");
  const confirmAppointment = useMutation(api.clinic.confirmAppointment);
  const cancelAppointment = useMutation(api.clinic.cancelAppointment);
  const sendAppointmentNotice = useMutation(api.clinic.sendAppointmentNotice);
  const [showScheduler, setShowScheduler] = useState(false);
  const [appointmentError, setAppointmentError] = useState<string | null>(null);
  async function runAppointmentAction(action: () => Promise<unknown>) {
    setAppointmentError(null);
    try {
      await action();
    } catch (cause) {
      setAppointmentError(convexErrorMessage(cause, locale));
    }
  }
  const stopFollowUps = useMutation(api.followUps.stopForThread);
  const stopFollowUpTask = useMutation(api.followUps.stopTask);
  const history = useQuery(
    inboxApi.listThreadHistory,
    activeTab === "lead" ? { threadId: thread._id, limit: 40 } : "skip",
  );
  const [note, setNote] = useState("");
  const [mentioned, setMentioned] = useState<Id<"members">[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [consentDraft, setConsentDraft] = useState<
    { purpose: "marketing" | "transactional"; status: "granted" | "revoked"; proof: string } | null
  >(null);
  const recordConsent = useMutation(inboxApi.recordConsent);
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
  useEffect(() => {
    if (!toolRequest) return;
    // Land on the tab that owns the tool, so the form the operator asked for is
    // the first thing on screen.
    setActiveTab(toolRequest.tool === "close" ? "lead" : "notes");
    setTool(toolRequest.tool);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolRequest?.nonce]);

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
      await addInternalNote({ threadId: thread._id, body, mentionedMemberIds: mentioned });
      setNote("");
      setMentioned([]);
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
    <aside className={cn("relative flex h-full w-[326px] shrink-0 flex-col border-l border-line bg-surface", className)}>
      <div className="flex items-center gap-3 border-b border-line px-4 py-3.5">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#dff3ef] text-[11px] font-bold text-chip-success-fg">
          {patientName.slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-bold text-ink">{patientName}</div>
          <div className="mt-0.5 truncate text-[10px] text-faint">{patientPhone}</div>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-faint hover:bg-surface-3" title={t("inbox.cancel")}>
            <X size={15} />
          </button>
        )}
      </div>

      <div className="grid grid-cols-4 border-b border-line bg-surface-2 p-1.5">
        {([
          ["lead", tr("Ficha", "Record"), CircleUserRound],
          ["appointments", tr("Marcações", "Bookings"), CalendarDays],
          ["notes", tr("Notas", "Notes"), MessageSquareText],
          ["followups", tr("Follow-ups", "Follow-ups"), Clock3],
        ] as const).map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            onClick={() => setActiveTab(value)}
            className={cn(
              "flex h-9 min-w-0 items-center justify-center gap-1.5 rounded text-[10px] font-semibold transition-colors",
              activeTab === value
                ? "bg-surface text-ink shadow-sm"
                : "text-muted hover:text-ink",
            )}
          >
            <Icon size={13} />
            <span className="truncate">{label}</span>
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {activeTab === "lead" && <>
        <Section title={t("inbox.flow")} icon={ChevronRight}>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[10px] font-semibold text-faint">
              {t("inbox.stage")}
              <select
                value={thread.leadStatus ?? "new"}
                onChange={(event) => void updateThread({ threadId: thread._id, leadStatus: event.target.value as LeadStatus })}
                className="mt-1 h-8 w-full rounded-md border border-line bg-surface px-2 text-[11px] font-semibold text-ink outline-none"
              >
                {["new", "interested", "asked_price", "wants_booking", "awaiting_human", "booked", "confirmed", "attended", "no_show", "lost"].map((status) => (
                  <option key={status} value={status}>{t(`status.${status}` as TranslationKey)}</option>
                ))}
              </select>
            </label>
            <label className="text-[10px] font-semibold text-faint">
              {t("inbox.intent")}
              <select
                value={thread.intent ?? ""}
                onChange={(event) => void updateThread(event.target.value
                  ? { threadId: thread._id, intent: event.target.value as never }
                  : { threadId: thread._id, clearIntent: true })}
                className="mt-1 h-8 w-full rounded-md border border-line bg-surface px-2 text-[11px] font-semibold text-ink outline-none"
              >
                <option value="">{t("inbox.noIntent")}</option>
                {["greeting", "info_request", "price_request", "booking_request", "reschedule", "cancel", "confirm_attendance", "complaint", "support", "human_request", "opt_out", "clinical_question", "out_of_scope", "other"].map((intent) => (
                  <option key={intent} value={intent}>{t(`intent.${intent}` as TranslationKey)}</option>
                ))}
              </select>
            </label>
            <label className="text-[10px] font-semibold text-faint">
              {t("inbox.owner")}
              <select
                value={thread.responsibleMemberId ?? ""}
                onChange={(event) => void updateThread(event.target.value
                  ? { threadId: thread._id, responsibleMemberId: event.target.value as Id<"members"> }
                  : { threadId: thread._id, clearResponsible: true })}
                className="mt-1 h-8 w-full rounded-md border border-line bg-surface px-2 text-[11px] font-semibold text-ink outline-none"
              >
                <option value="">{t("inbox.unassignedShort")}</option>
                {(members ?? []).filter((member) => member.status === "active").map((member) => (
                  <option key={member._id} value={member._id}>{member.email ?? roleLabel(member.role, locale)}</option>
                ))}
              </select>
            </label>
            <label className="col-span-2 text-[10px] font-semibold text-faint">
              {t("inbox.team")}
              <select
                value={thread.assignedTeamId ?? ""}
                onChange={(event) => void updateThread(event.target.value
                  ? { threadId: thread._id, assignedTeamId: event.target.value as Id<"teams"> }
                  : { threadId: thread._id, clearTeam: true })}
                className="mt-1 h-8 w-full rounded-md border border-line bg-surface px-2 text-[11px] font-semibold text-ink outline-none"
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
              className="h-8 min-w-0 flex-1 rounded-md border border-line px-2 text-[11px] outline-none focus:border-brand-solid/40"
            />
            <button
              type="button"
              onClick={() => void updateThread({ threadId: thread._id, nextStep })}
              className="rounded-md bg-brand-solid px-2.5 text-white"
              title={t("inbox.save")}
            >
              <Check size={13} />
            </button>
          </div>
          {thread.nextStepDueAt && (
            <div className="mt-1.5 flex items-center gap-1 text-[10px] text-chip-warn-fg">
              <Clock3 size={11} /> {formatMoment(thread.nextStepDueAt, locale)}
            </div>
          )}
        </Section>

        <Section title={t("inbox.patient")} icon={CircleUserRound}>
          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <button
              type="button"
              onClick={() => void updateThread({ threadId: thread._id, dnd: !thread.dnd })}
              className={cn("rounded-md border px-2 py-2 text-left font-semibold", thread.dnd ? "border-chip-danger-fg/25 bg-chip-danger text-rose-700" : "border-line text-body")}
            >
              DND · {thread.dnd ? tr("Ativo", "On") : tr("Inativo", "Off")}
            </button>
            <button
              type="button"
              onClick={() => void updateThread({
                threadId: thread._id,
                automationMode: thread.automationMode === "bot" ? "human" : "bot",
              })}
              className="rounded-md border border-line px-2 py-2 text-left font-semibold text-body"
            >
              IA · {thread.automationMode === "bot" ? tr("Ativa", "On") : tr("Pausada", "Paused")}
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1" data-tags>
            {tags.map((tag) => (
              <span
                key={tag}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-semibold",
                  tag.startsWith("grupo:") || tag.startsWith("group:")
                    ? "border-[#cfe0f5] bg-chip-info text-chip-info-fg"
                    : "border-line bg-surface-2 text-muted",
                )}
              >
                {tag}
                <button
                  type="button"
                  onClick={() => void updateThread({ threadId: thread._id, tags: tags.filter((item) => item !== tag) })}
                  className="text-faint hover:text-chip-danger-fg"
                  aria-label={`${t("inbox.cancel")} ${tag}`}
                >
                  <X size={9} />
                </button>
              </span>
            ))}
            {tags.length === 0 && <span className="text-[10px] text-faint">{t("inbox.noTags")}</span>}
          </div>
          <form
            className="mt-1.5 flex gap-1"
            onSubmit={(event) => {
              event.preventDefault();
              const next = tagDraft.trim().toLowerCase();
              if (!next || tags.includes(next)) return;
              void updateThread({ threadId: thread._id, tags: [...tags, next] });
              setTagDraft("");
            }}
          >
            <input
              value={tagDraft}
              onChange={(event) => setTagDraft(event.target.value)}
              placeholder={t("tags.placeholder")}
              maxLength={40}
              className="h-7 min-w-0 flex-1 rounded-md border border-line px-2 text-[10px] outline-none focus:border-brand-solid/40"
            />
            <button type="submit" className="rounded-md border border-line px-2 text-[10px] font-semibold text-body" title={t("tags.add")}>
              +
            </button>
          </form>
          {context?.contact?.locale && (
            <div className="mt-2 text-[10px] text-faint">
              {tr("Idioma do paciente", "Patient language")}: <span className="font-semibold text-body">{context.contact.locale}</span>
            </div>
          )}
        </Section>

        <Section title={t("fields.title")} icon={ListTodo}>
          <CustomFieldsSection threadId={thread._id} values={thread.customFields} />
        </Section>

        <Section title={t("inbox.consent")} icon={ShieldCheck}>
          <div className="space-y-1.5">
            {(context?.consents ?? []).map((item: any) => (
              <div key={item.purpose} className="flex items-center justify-between text-[10px]">
                <span className="capitalize text-muted">
                  {item.purpose === "marketing"
                    ? tr("Marketing", "Marketing")
                    : item.purpose === "transactional"
                      ? tr("Atendimento", "Service")
                      : tr("Autenticação", "Authentication")}
                </span>
                <span className={cn("font-bold", item.status === "granted" ? "text-emerald-600" : "text-chip-danger-fg")}>
                  {stateLabel(item.status, t)}
                </span>
              </div>
            ))}
            {context?.consents?.length === 0 && <span className="text-[10px] text-faint">{t("inbox.noConsents")}</span>}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1" data-consent-actions>
            {(["marketing", "transactional"] as const).map((purpose) => {
              const current = (context?.consents ?? []).find((item: any) => item.purpose === purpose)?.status;
              const nextStatus = current === "granted" ? "revoked" : "granted";
              return (
                <button
                  key={purpose}
                  type="button"
                  onClick={() => setConsentDraft({ purpose, status: nextStatus, proof: "" })}
                  className={cn(
                    "rounded-md border px-2 py-1.5 text-left text-[10px] font-semibold",
                    nextStatus === "granted" ? "border-chip-success-fg/25 text-chip-success-fg" : "border-chip-danger-fg/25 text-chip-danger-fg",
                  )}
                >
                  {nextStatus === "granted" ? t("consent.grant") : t("consent.revoke")} · {t(`consent.${purpose}` as TranslationKey)}
                </button>
              );
            })}
          </div>
          {consentDraft && (
            <form
              className="mt-2 space-y-1.5 rounded-md bg-surface-2 p-2"
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  await recordConsent({
                    threadId: thread._id,
                    purpose: consentDraft.purpose,
                    status: consentDraft.status,
                    proofText: consentDraft.proof,
                  });
                  setConsentDraft(null);
                });
              }}
            >
              <label className="block text-[10px] font-semibold text-muted">
                {t("consent.proof")}
                <input
                  value={consentDraft.proof}
                  onChange={(event) => setConsentDraft({ ...consentDraft, proof: event.target.value })}
                  placeholder={t("consent.proofPlaceholder")}
                  minLength={5}
                  maxLength={500}
                  required
                  autoFocus
                  className="mt-1 h-8 w-full rounded-md border border-line bg-surface px-2 text-[10px] outline-none focus:border-brand-solid/40"
                />
              </label>
              <div className="flex justify-end gap-1">
                <button type="button" onClick={() => setConsentDraft(null)} className="rounded-md px-2 py-1 text-[10px] font-semibold text-muted">{t("inbox.cancel")}</button>
                <button type="submit" disabled={busy || consentDraft.proof.trim().length < 5} className="rounded-md bg-brand-solid px-2 py-1 text-[10px] font-bold text-white disabled:opacity-50">{t("consent.save")}</button>
              </div>
            </form>
          )}
          {error && !tool && <p className="mt-1 text-[10px] text-chip-danger-fg">{error}</p>}
        </Section>

        <Section title={t("inbox.actions")} icon={Archive}>
          {thread.closedAt || thread.inboxStatus === "closed" ? (
            <button type="button" onClick={() => void updateThread({ threadId: thread._id, inboxStatus: "open", automationMode: "human" })} className="w-full rounded-md border border-line py-2 text-[11px] font-semibold text-body">{t("inbox.reopen")}</button>
          ) : (
            <button type="button" onClick={() => setTool("close")} className="w-full rounded-md border border-chip-danger-fg/25 py-2 text-[11px] font-semibold text-chip-danger-fg">{t("inbox.close")}</button>
          )}
        </Section>
        </>}

        {activeTab === "notes" && <>
        <Section
          title={t("inbox.notes")}
          icon={MessageSquareText}
          action={<button type="button" onClick={() => setTool("note")} className="text-[10px] font-bold text-chip-success-fg">+ {t("inbox.addNote")}</button>}
        >
          {context === undefined ? <Loader2 size={13} className="animate-spin text-faint" /> : context.notes.length === 0 ? (
            <p className="text-[10px] text-faint">{t("inbox.noNotes")}</p>
          ) : (
            <div className="space-y-2">
              {context.notes.slice(0, 4).map((item: any) => (
                <div key={item._id} className="border-l-2 border-amber-300 pl-2">
                  <p className="text-[11px] leading-4 text-ink">{item.body}</p>
                  {item.mentionedMemberIds?.length > 0 && (
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {item.mentionedMemberIds.map((id: Id<"members">) => {
                        const member = members?.find((row) => row._id === id);
                        return (
                          <span key={id} className="rounded bg-chip-info px-1 py-0.5 text-[9px] font-semibold text-chip-info-fg">
                            @{member ? memberDisplay(member) : "…"}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  <span className="text-[9px] text-faint">{item.authorName ?? t("inbox.team")} · {relativeTime(item.createdAt, Date.now(), locale)}</span>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section
          title={t("inbox.reminders")}
          icon={Bell}
          action={<button type="button" onClick={() => setTool("reminder")} className="text-[10px] font-bold text-chip-success-fg">+ {t("inbox.createReminder")}</button>}
        >
          {context?.reminders?.length ? (
            <div className="space-y-2">
              {context.reminders.slice(0, 4).map((item: any) => (
                <div key={item._id} className="flex items-start gap-2">
                  <button
                    type="button"
                    disabled={["completed", "cancelled"].includes(item.status)}
                    onClick={() => void setReminderStatus({ reminderId: item._id, status: "completed" })}
                    className={cn("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border", item.status === "completed" ? "border-emerald-500 bg-emerald-500 text-white" : "border-line")}
                  >
                    {item.status === "completed" && <Check size={10} />}
                  </button>
                  <div className="min-w-0">
                    <p className="truncate text-[11px] text-ink">{item.note}</p>
                    <span className="text-[9px] text-faint">{formatMoment(item.dueAt, locale)} · {stateLabel(item.status, t)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : <p className="text-[10px] text-faint">{t("inbox.noReminders")}</p>}
        </Section>

        </>}

        {activeTab === "followups" && <>
        <Section
          title={tr("Follow-ups automáticos", "Automatic follow-ups")}
          icon={Clock3}
          action={
            followUps && followUps.some((task) => task.status === "scheduled" || task.status === "claimed") ? (
              <button type="button" onClick={() => void stopFollowUps({ threadId: thread._id })} className="text-[10px] font-bold text-chip-danger-fg">
                {tr("Parar todos", "Stop all")}
              </button>
            ) : undefined
          }
        >
          {followUps === undefined ? (
            <Loader2 size={13} className="animate-spin text-faint" />
          ) : followUps.length === 0 ? (
            <p className="text-[10px] text-faint">{tr("Sem follow-ups nesta conversa.", "No follow-ups on this conversation.")}</p>
          ) : (
            <div className="space-y-1.5">
              {followUps.slice(0, 5).map((task) => {
                const pending = task.status === "scheduled" || task.status === "claimed";
                const label =
                  task.kind === "appointment_confirmation"
                    ? tr("Pedido de confirmação", "Confirmation request")
                    : task.kind === "appointment_reminder"
                      ? tr("Lembrete de consulta", "Appointment reminder")
                      : task.ruleName ?? tr("Regra de follow-up", "Follow-up rule");
                const state =
                  task.status === "scheduled"
                    ? `${tr("Dispara", "Fires")} ${relativeTime(task.nextAttemptAt ?? task.dueAt, Date.now(), locale)}`
                    : task.status === "claimed"
                      ? tr("A enviar…", "Sending…")
                      : task.status === "sent"
                        ? `${tr("Enviado", "Sent")} ${relativeTime(task.sentAt ?? task.updatedAt, Date.now(), locale)}`
                        : task.status === "failed"
                          ? `${tr("Falhou", "Failed")}${task.failureCode ? ` · ${task.failureCode}` : ""}`
                          : `${tr("Parado", "Stopped")}${task.stoppedReason ? ` · ${task.stoppedReason}` : ""}`;
                return (
                  <div key={task._id} className="flex items-start gap-2">
                    <span className={cn("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", pending ? "bg-[#2b4f8a]" : task.status === "sent" ? "bg-[#0d6b61]" : task.status === "failed" ? "bg-[#e0533d]" : "bg-faint/50")} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] text-ink">{label}{task.attempts > 1 ? ` · ${task.attempts}×` : ""}</p>
                      <span className="text-[9px] text-faint">{state}</span>
                    </div>
                    {pending && (
                      <button type="button" onClick={() => void stopFollowUpTask({ taskId: task._id })} className="text-[9px] font-semibold text-faint hover:text-chip-danger-fg">
                        {tr("Parar", "Stop")}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Section>

        </>}

        {activeTab === "appointments" && <>
        <Section
          title={t("inbox.appointments")}
          icon={CalendarDays}
          action={<button type="button" onClick={() => setShowScheduler(true)} className="text-[10px] font-bold text-chip-info-fg">+ {tr("Agendar", "Book")}</button>}
        >
          {threadAppointments === undefined ? (
            <Loader2 size={13} className="animate-spin text-faint" />
          ) : threadAppointments.length === 0 ? (
            <p className="text-[10px] text-faint">{t("inbox.noAppointments")}</p>
          ) : (
            <div className="space-y-2">
              {threadAppointments.slice(0, 3).map((item) => {
                const active = item.status === "scheduled" || item.status === "confirmed";
                return (
                  <div key={item._id} className="flex items-start gap-2">
                    <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md", active ? "bg-chip-info text-chip-info-fg" : "bg-surface-3 text-faint")}><CalendarDays size={13} /></div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] font-semibold text-ink">{item.serviceName}{item.professionalName ? ` · ${item.professionalName}` : ""}</p>
                      <p className="text-[9px] text-faint">{formatMoment(item.startAt, locale)} · {appointmentStatusLabel(item.status, locale)}{item.pendingNotices > 0 ? ` · ${tr("aviso pendente", "notice pending")}` : ""}</p>
                      {active && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {item.status === "scheduled" && (
                            <button type="button" onClick={() => void runAppointmentAction(() => confirmAppointment({ appointmentId: item._id }))} className="rounded border border-[#0d6b61]/30 px-1.5 py-0.5 text-[9px] font-semibold text-chip-success-fg">{tr("Confirmar", "Confirm")}</button>
                          )}
                          <button type="button" onClick={() => void runAppointmentAction(() => sendAppointmentNotice({ appointmentId: item._id, kind: item.status === "confirmed" ? "appointment_reminder" : "appointment_confirmation" }))} className="rounded border border-line px-1.5 py-0.5 text-[9px] font-semibold text-body">{item.status === "confirmed" ? tr("Lembrete", "Reminder") : tr("Pedir confirmação", "Ask to confirm")}</button>
                          <button type="button" onClick={() => { if (window.confirm(tr("Cancelar esta marcação?", "Cancel this appointment?"))) void runAppointmentAction(() => cancelAppointment({ appointmentId: item._id })); }} className="rounded border border-line px-1.5 py-0.5 text-[9px] font-semibold text-muted hover:text-chip-danger-fg">{tr("Cancelar", "Cancel")}</button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {appointmentError && <p className="text-[10px] text-chip-danger-fg">{appointmentError}</p>}
            </div>
          )}
        </Section>
        </>}

        {activeTab === "lead" && <>
        <Section title={t("inbox.changes")} icon={History}>
          {history === undefined ? (
            <p className="text-[10px] text-faint">{t("shell.loading")}</p>
          ) : history.length === 0 ? (
            <p className="text-[10px] text-faint">{t("inbox.historyEmpty")}</p>
          ) : (
            history.map((row) => (
              <div key={row._id} className="mb-2 text-[10px] last:mb-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-semibold text-body">
                    {auditActionLabel(row.action, t)}
                  </span>
                  <span className="shrink-0 text-[9px] text-faint">{relativeTime(row.createdAt, Date.now(), locale)}</span>
                </div>
                <div className="text-[9px] text-faint">
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
              <span className="min-w-0 truncate font-semibold text-body">{item.name}</span>
              <span className="shrink-0 rounded bg-surface-3 px-1.5 py-0.5 text-muted">{stateLabel(item.recipientStatus, t)}</span>
            </div>
          )) : <p className="text-[10px] text-faint">{t("inbox.noCampaigns")}</p>}
        </Section>

        <Section title={tr("Ficheiros", "Files")} icon={Paperclip}>
          {context?.attachments?.length ? context.attachments.slice(0, 8).map((item: any) => (
            item.url ? (
              <a key={item._id} href={item.url} target="_blank" rel="noreferrer" className="mb-1.5 flex items-center gap-2 text-[10px] text-body last:mb-0 hover:text-chip-success-fg">
                <Paperclip size={11} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate font-semibold">{item.fileName}</span>
                <span className="shrink-0 text-[9px] text-faint">{relativeTime(item.createdAt, Date.now(), locale)}</span>
              </a>
            ) : (
              <div key={item._id} className="mb-1.5 flex items-center gap-2 text-[10px] text-faint last:mb-0">
                <Paperclip size={11} /><span className="truncate">{item.fileName}</span>
              </div>
            )
          )) : <p className="text-[10px] text-faint">{tr("Sem ficheiros nesta conversa", "No files in this conversation")}</p>}
        </Section>
        </>}
      </div>

      {showScheduler && (
        <div className="absolute inset-0 z-20 flex flex-col bg-surface">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="text-[13px] font-bold text-ink">{tr("Agendar consulta", "Book appointment")}</div>
            <button type="button" onClick={() => setShowScheduler(false)} className="rounded-md p-1.5 text-faint hover:bg-surface-3"><X size={15} /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <AppointmentScheduler
              compact
              mode={{ kind: "book", threadId: thread._id, patientName: thread.displayName ?? undefined, source: "inbox" }}
              onDone={() => setShowScheduler(false)}
            />
          </div>
        </div>
      )}

      {tool && (
        <div className="absolute inset-0 z-20 flex flex-col bg-surface">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="text-[13px] font-bold text-ink">
              {tool === "note" ? t("inbox.internalNote") : tool === "reminder" ? t("inbox.reminder") : t("inbox.close")}
            </div>
            <button type="button" onClick={() => setTool(null)} className="rounded-md p-1.5 text-faint hover:bg-surface-3"><X size={15} /></button>
          </div>
          <form onSubmit={tool === "note" ? saveNote : tool === "reminder" ? saveReminder : closeConversation} className="flex flex-1 flex-col gap-3 p-4">
            {tool === "close" ? (
              <>
                <label className="text-[11px] font-semibold text-body">{t("inbox.closeReason")}</label>
                <input list="close-reasons" value={closeReason} onChange={(event) => setCloseReason(event.target.value)} className="h-10 rounded-md border border-line px-3 text-[12px] outline-none focus:border-brand-solid/40" autoFocus />
                <datalist id="close-reasons">{(closeReasons ?? []).map((reason) => <option key={reason._id} value={reason.name} />)}</datalist>
              </>
            ) : (
              <>
                <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={7} maxLength={tool === "note" ? 4000 : 500} placeholder={tool === "note" ? t("inbox.teamOnlyNote") : t("inbox.nextAction")} className="resize-none rounded-md border border-line p-3 text-[12px] leading-5 outline-none focus:border-brand-solid/40" autoFocus />
                {tool === "reminder" && (
                  <>
                    <div className="flex flex-wrap gap-1">
                      {reminderPresets(t).map(([label, timestamp]) => (
                        <button
                          key={label}
                          type="button"
                          onClick={() => setReminderAt(toLocalInputValue(timestamp))}
                          className="rounded-md border border-line bg-surface px-2 py-1 text-[10px] font-semibold text-body hover:border-line"
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <input type="datetime-local" value={reminderAt} onChange={(event) => setReminderAt(event.target.value)} className="h-10 rounded-md border border-line px-3 text-[12px] outline-none" />
                  </>
                )}
                {tool === "note" && (
                  <div>
                    <div className="mb-1 text-[10px] font-semibold text-muted">{t("inbox.mentions")}</div>
                    <div className="flex flex-wrap gap-1" data-mention-picker>
                      {(members ?? [])
                        .filter((member) => member.status === "active")
                        .map((member) => {
                          const selected = mentioned.includes(member._id);
                          return (
                            <button
                              key={member._id}
                              type="button"
                              onClick={() =>
                                setMentioned((current) =>
                                  selected ? current.filter((id) => id !== member._id) : [...current, member._id],
                                )
                              }
                              className={cn(
                                "rounded-md border px-2 py-1 text-[10px] font-semibold transition-colors",
                                selected ? "border-brand-solid bg-brand-solid text-white" : "border-line bg-surface text-body hover:border-line",
                              )}
                            >
                              @{memberDisplay(member)}
                            </button>
                          );
                        })}
                    </div>
                  </div>
                )}
              </>
            )}
            {error && <p className="text-[11px] text-chip-danger-fg">{error}</p>}
            <button type="submit" disabled={busy} className="mt-auto flex h-10 items-center justify-center gap-2 rounded-md bg-brand-solid text-[12px] font-bold text-white disabled:opacity-50">
              {busy && <Loader2 size={13} className="animate-spin" />}{t("inbox.save")}
            </button>
          </form>
        </div>
      )}
    </aside>
  );
}
