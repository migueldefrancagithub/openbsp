"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { CalendarDays, CalendarPlus, Check, ChevronLeft, ChevronRight, Loader2, MessageCircle, RefreshCw, Send, UserX, X } from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { PageHeader } from "@/components/app/EmptyState";
import { AppointmentScheduler, todayLocalDate, type SchedulerMode } from "@/components/agenda/AppointmentScheduler";
import { addDaysLocal, appointmentStatusLabel, appointmentStatusTone, formatDayIn, formatTimeIn, startOfWeek } from "@/components/agenda/agendaLabels";
import { cn } from "@/lib/cn";
import { convexErrorMessage } from "@/lib/convexErrorMessage";
import { useI18n } from "@/lib/i18n";

type View = "day" | "week";

export default function AgendaPage() {
  const { locale, tr } = useI18n();
  const [view, setView] = useState<View>("day");
  const [anchor, setAnchor] = useState(todayLocalDate());
  const [professionalId, setProfessionalId] = useState<Id<"clinicProfessionals"> | "">("");
  const [scheduler, setScheduler] = useState<SchedulerMode | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const from = view === "day" ? anchor : startOfWeek(anchor);
  const to = view === "day" ? anchor : addDaysLocal(from, 6);
  const agenda = useQuery(api.clinic.listAgenda, { from, to, professionalId: professionalId || undefined });
  const professionals = useQuery(api.clinic.listProfessionals, {});
  const confirm = useMutation(api.clinic.confirmAppointment);
  const cancel = useMutation(api.clinic.cancelAppointment);
  const outcome = useMutation(api.clinic.recordAppointmentOutcome);
  const notice = useMutation(api.clinic.sendAppointmentNotice);

  const days = useMemo(() => {
    const list: string[] = [];
    for (let i = 0; ; i += 1) {
      const date = addDaysLocal(from, i);
      list.push(date);
      if (date === to || i > 30) break;
    }
    return list;
  }, [from, to]);

  const timeZone = agenda?.timeZone ?? "Africa/Maputo";
  const rowsByDay = useMemo(() => {
    const map = new Map<string, NonNullable<typeof agenda>["rows"]>();
    for (const day of days) map.set(day, []);
    for (const row of agenda?.rows ?? []) {
      const day = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(row.startAt);
      map.get(day)?.push(row);
    }
    for (const list of map.values()) list.sort((a, b) => a.startAt - b.startAt);
    return map;
  }, [agenda, days, timeZone]);

  async function run(key: string, action: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(convexErrorMessage(err, locale));
    } finally {
      setBusy(null);
    }
  }

  const now = Date.now();
  const step = view === "day" ? 1 : 7;

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        eyebrow={tr("Operação", "Operations")}
        title={tr("Agenda", "Calendar")}
        description={tr("Marcações reais da clínica, por dia ou semana, com confirmação e lembretes pelo WhatsApp.", "The clinic's real appointments by day or week, with WhatsApp confirmation and reminders.")}
        action={
          <button type="button" onClick={() => setScheduler({ kind: "book", source: "agenda" })} className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#2b4f8a] px-4 text-[13px] font-semibold text-white hover:bg-[#244478]">
            <CalendarPlus size={15} /> {tr("Nova marcação", "New appointment")}
          </button>
        }
      />

      <div className="mx-auto w-full max-w-7xl space-y-4 px-4 py-5 sm:px-6 xl:px-8">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-line bg-surface p-1 text-[12px] font-semibold">
            {(["day", "week"] as const).map((key) => (
              <button key={key} type="button" onClick={() => setView(key)} className={cn("rounded-md px-3 py-1.5", view === key ? "bg-brand-solid text-white" : "text-muted")}>
                {key === "day" ? tr("Dia", "Day") : tr("Semana", "Week")}
              </button>
            ))}
          </div>
          <div className="inline-flex items-center rounded-lg border border-line bg-surface">
            <button type="button" onClick={() => setAnchor(addDaysLocal(anchor, -step))} className="p-2 text-muted hover:text-ink" aria-label={tr("Anterior", "Previous")}><ChevronLeft size={15} /></button>
            <button type="button" onClick={() => setAnchor(todayLocalDate())} className="px-2 text-[12px] font-semibold text-ink">{tr("Hoje", "Today")}</button>
            <button type="button" onClick={() => setAnchor(addDaysLocal(anchor, step))} className="p-2 text-muted hover:text-ink" aria-label={tr("Seguinte", "Next")}><ChevronRight size={15} /></button>
          </div>
          <input type="date" value={anchor} onChange={(e) => e.target.value && setAnchor(e.target.value)} className="h-9 rounded-lg border border-line bg-surface px-2 text-[12px] text-ink outline-none" />
          {professionals && professionals.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <button type="button" onClick={() => setProfessionalId("")} className={cn("rounded-full border px-2.5 py-1 text-[11px] font-semibold", professionalId === "" ? "border-brand-solid bg-brand-solid text-white" : "border-line bg-surface text-body")}>{tr("Todos", "All")}</button>
              {professionals.map((p) => (
                <button key={p._id} type="button" onClick={() => setProfessionalId(p._id)} className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold", professionalId === p._id ? "border-brand-solid bg-brand-solid text-white" : "border-line bg-surface text-body")}>
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color ?? "#2b4f8a" }} />
                  {p.name}
                </button>
              ))}
            </div>
          )}
          <span className="ml-auto text-[11px] text-faint">{timeZone}</span>
        </div>

        {error && <div className="rounded-lg border border-[#e0533d]/30 bg-chip-danger px-4 py-3 text-[13px] text-chip-danger-fg">{error}</div>}

        {agenda === undefined ? (
          <div className="flex items-center gap-2 px-2 py-8 text-sm text-faint"><Loader2 size={15} className="animate-spin" /> {tr("A carregar agenda…", "Loading calendar…")}</div>
        ) : (
          <div className={cn("grid gap-3", view === "week" ? "md:grid-cols-2 xl:grid-cols-7" : "grid-cols-1")}>
            {days.map((day) => {
              const rows = rowsByDay.get(day) ?? [];
              const isToday = day === todayLocalDate();
              return (
                <section key={day} className={cn("min-w-0 rounded-lg border bg-surface", isToday ? "border-[#2b4f8a]/40" : "border-line")}>
                  <header className={cn("flex items-center justify-between border-b px-3 py-2", isToday ? "border-[#2b4f8a]/20 bg-chip-info" : "border-line-soft")}>
                    <span className={cn("text-[12px] font-semibold capitalize", isToday ? "text-chip-info-fg" : "text-ink")}>{formatDayIn(day, locale)}</span>
                    <span className="text-[11px] text-faint">{rows.length}</span>
                  </header>
                  {rows.length === 0 ? (
                    <p className="px-3 py-4 text-[12px] text-faint">{tr("Sem marcações.", "No appointments.")}</p>
                  ) : (
                    <ul className="divide-y divide-line-soft">
                      {rows.map((row) => {
                        const past = row.endAt < now;
                        const active = row.status === "scheduled" || row.status === "confirmed";
                        return (
                          <li key={row._id} className="px-3 py-2">
                            <div className="flex items-start gap-2">
                              <div className="w-11 shrink-0 text-[12px] font-semibold tabular-nums text-ink">{formatTimeIn(row.startAt, timeZone, locale)}</div>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="truncate text-[13px] font-semibold text-ink">{row.patientName ?? tr("Sem nome", "No name")}</span>
                                  <span className={cn("rounded-md border px-1.5 py-0.5 text-[10px] font-semibold", appointmentStatusTone(row.status))}>{appointmentStatusLabel(row.status, locale)}</span>
                                  {row.pendingNotices > 0 && <span className="text-[10px] text-chip-warn-fg">{tr("aviso pendente", "notice pending")}</span>}
                                </div>
                                <div className="truncate text-[11px] text-muted">
                                  {row.serviceName}{row.professionalName ? ` · ${row.professionalName}` : ""}{row.confirmedVia === "reply" ? ` · ${tr("confirmou pelo WhatsApp", "confirmed on WhatsApp")}` : ""}
                                </div>
                                {active && (
                                  <div className="mt-1.5 flex flex-wrap gap-1">
                                    {row.threadKey && row.channelId && (
                                      <Link href={`/app/channel-inbox/${row.threadKey}?channel=${row.channelId}`} className="inline-flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[11px] font-semibold text-body hover:text-ink"><MessageCircle size={11} /> {tr("Conversa", "Chat")}</Link>
                                    )}
                                    {row.status === "scheduled" && (
                                      <button type="button" disabled={busy !== null} onClick={() => void run(row._id, () => confirm({ appointmentId: row._id }))} className="inline-flex h-7 items-center gap-1 rounded-md border border-[#0d6b61]/30 px-2 text-[11px] font-semibold text-chip-success-fg"><Check size={11} /> {tr("Confirmar", "Confirm")}</button>
                                    )}
                                    {row.threadId && !past && (
                                      <button type="button" disabled={busy !== null} onClick={() => void run(`n-${row._id}`, () => notice({ appointmentId: row._id, kind: row.status === "confirmed" ? "appointment_reminder" : "appointment_confirmation" }))} className="inline-flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[11px] font-semibold text-body"><Send size={11} /> {row.status === "confirmed" ? tr("Lembrete", "Reminder") : tr("Pedir confirmação", "Ask to confirm")}</button>
                                    )}
                                    {!past && (
                                      <button type="button" onClick={() => setScheduler({ kind: "reschedule", appointmentId: row._id, serviceId: row.serviceId, professionalId: row.professionalId })} className="inline-flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[11px] font-semibold text-body"><RefreshCw size={11} /> {tr("Remarcar", "Reschedule")}</button>
                                    )}
                                    {past ? (
                                      <>
                                        <button type="button" disabled={busy !== null} onClick={() => void run(`a-${row._id}`, () => outcome({ appointmentId: row._id, status: "completed" }))} className="inline-flex h-7 items-center gap-1 rounded-md border border-[#0d6b61]/30 px-2 text-[11px] font-semibold text-chip-success-fg"><Check size={11} /> {tr("Compareceu", "Attended")}</button>
                                        <button type="button" disabled={busy !== null} onClick={() => void run(`ns-${row._id}`, () => outcome({ appointmentId: row._id, status: "no_show" }))} className="inline-flex h-7 items-center gap-1 rounded-md border border-[#e0533d]/30 px-2 text-[11px] font-semibold text-chip-danger-fg"><UserX size={11} /> {tr("Faltou", "No-show")}</button>
                                      </>
                                    ) : (
                                      <button type="button" disabled={busy !== null} onClick={() => { if (window.confirm(tr("Cancelar esta marcação?", "Cancel this appointment?"))) void run(`c-${row._id}`, () => cancel({ appointmentId: row._id })); }} className="inline-flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[11px] font-semibold text-muted hover:border-[#e0533d]/40 hover:text-chip-danger-fg"><X size={11} /> {tr("Cancelar", "Cancel")}</button>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        )}
        {agenda?.capped && <p className="text-[11px] text-chip-warn-fg">{tr("Mostrando as primeiras 500 marcações do intervalo.", "Showing the first 500 appointments in range.")}</p>}
      </div>

      {scheduler && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-[#0a1b33]/40 p-2 sm:items-center sm:p-6" onClick={() => setScheduler(null)}>
          <div className="w-full max-w-2xl rounded-xl border border-line bg-surface p-4 shadow-xl sm:p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink"><CalendarDays size={16} /> {scheduler.kind === "reschedule" ? tr("Remarcar consulta", "Reschedule appointment") : tr("Nova marcação", "New appointment")}</h2>
              <button type="button" onClick={() => setScheduler(null)} className="rounded-md p-1.5 text-faint hover:bg-surface-3"><X size={15} /></button>
            </div>
            <AppointmentScheduler mode={scheduler} onDone={() => setScheduler(null)} />
          </div>
        </div>
      )}
    </div>
  );
}
