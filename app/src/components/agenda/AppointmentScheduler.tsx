"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { CalendarCheck, Loader2, Send } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { cn } from "@/lib/cn";
import { convexErrorMessage } from "@/lib/convexErrorMessage";
import { useI18n } from "@/lib/i18n";

export function todayLocalDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export type SchedulerMode =
  | { kind: "book"; threadId?: Id<"channelThreads">; patientName?: string; source: "inbox" | "operation" | "agenda" }
  | { kind: "reschedule"; appointmentId: Id<"clinicAppointments">; serviceId: Id<"clinicServices">; professionalId?: Id<"clinicProfessionals"> };

/**
 * One scheduler for the inbox, Operação and the Agenda page. Booking goes
 * through `clinic.reserveSlot` (idempotent), so a double click never creates
 * two appointments; the id comes back before any confirmation is sent.
 */
export function AppointmentScheduler({
  mode,
  onDone,
  compact = false,
}: {
  mode: SchedulerMode;
  onDone?: (appointmentId: Id<"clinicAppointments">) => void;
  compact?: boolean;
}) {
  const { locale, tr } = useI18n();
  const workspace = useQuery(api.clinic.listWorkspace, {});
  const professionals = useQuery(api.clinic.listProfessionals, {});
  const reserveSlot = useMutation(api.clinic.reserveSlot);
  const reschedule = useMutation(api.clinic.rescheduleAppointment);
  const sendNotice = useMutation(api.clinic.sendAppointmentNotice);

  const services = useMemo(() => (workspace?.services ?? []).filter((s) => s.status === "active"), [workspace]);
  const [serviceId, setServiceId] = useState<Id<"clinicServices"> | "">(mode.kind === "reschedule" ? mode.serviceId : "");
  const [professionalId, setProfessionalId] = useState<Id<"clinicProfessionals"> | "">(mode.kind === "reschedule" ? (mode.professionalId ?? "") : "");
  const [date, setDate] = useState(todayLocalDate());
  const [patientName, setPatientName] = useState(mode.kind === "book" ? (mode.patientName ?? "") : "");
  const [notes, setNotes] = useState("");
  const [askConfirmation, setAskConfirmation] = useState(mode.kind === "book" && !!mode.threadId);
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce] = useState(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now())));

  useEffect(() => {
    if (!serviceId && services.length > 0) setServiceId(services[0]._id);
  }, [serviceId, services]);

  const eligibleProfessionals = useMemo(() => {
    const service = services.find((s) => s._id === serviceId);
    const all = professionals ?? [];
    if (!service?.professionalIds || service.professionalIds.length === 0) return all;
    return all.filter((p) => service.professionalIds!.includes(p._id));
  }, [professionals, services, serviceId]);

  const slots = useQuery(
    api.clinic.listAvailableSlots,
    serviceId ? { serviceId, date, professionalId: professionalId || undefined } : "skip",
  );

  async function submit() {
    if (!serviceId || selected === null) return;
    setBusy(true);
    setError(null);
    try {
      let appointmentId: Id<"clinicAppointments">;
      if (mode.kind === "reschedule") {
        const result = await reschedule({ appointmentId: mode.appointmentId, startAt: selected, professionalId: professionalId || undefined });
        appointmentId = result.appointmentId;
      } else {
        const result = await reserveSlot({
          serviceId,
          professionalId: professionalId || undefined,
          threadId: mode.threadId,
          patientName: patientName.trim() || undefined,
          startAt: selected,
          businessKey: `ui:${nonce}:${serviceId}:${selected}`,
          source: mode.source,
          notes: notes.trim() || undefined,
        });
        appointmentId = result.appointmentId;
        if (askConfirmation && mode.threadId) {
          await sendNotice({ appointmentId, kind: "appointment_confirmation" });
        }
      }
      onDone?.(appointmentId);
    } catch (err) {
      setError(convexErrorMessage(err, locale));
    } finally {
      setBusy(false);
    }
  }

  const inputClass = "mt-1 h-9 w-full rounded-lg border border-line bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-brand-solid/40";

  if (workspace !== undefined && services.length === 0) {
    return (
      <p className="rounded-lg border border-chip-warn-fg/25 bg-chip-warn px-3 py-2 text-[12px] text-chip-warn-fg">
        {tr("Crie um serviço em Operação › Clínica antes de marcar.", "Create a service in Operations › Clinic before booking.")}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className={cn("grid gap-2", compact ? "grid-cols-1" : "sm:grid-cols-3")}>
        <label className="block text-[11px] font-medium text-muted">
          {tr("Serviço", "Service")}
          <select value={serviceId} onChange={(e) => { setServiceId(e.target.value as Id<"clinicServices">); setSelected(null); }} className={inputClass} disabled={mode.kind === "reschedule"}>
            {services.map((s) => (
              <option key={s._id} value={s._id}>{s.name} · {s.durationMinutes} min</option>
            ))}
          </select>
        </label>
        {eligibleProfessionals.length > 0 && (
          <label className="block text-[11px] font-medium text-muted">
            {tr("Profissional", "Professional")}
            <select value={professionalId} onChange={(e) => { setProfessionalId(e.target.value as Id<"clinicProfessionals"> | ""); setSelected(null); }} className={inputClass}>
              <option value="">{tr("Qualquer", "Any")}</option>
              {eligibleProfessionals.map((p) => (
                <option key={p._id} value={p._id}>{p.name}</option>
              ))}
            </select>
          </label>
        )}
        <label className="block text-[11px] font-medium text-muted">
          {tr("Dia", "Day")}
          <input type="date" value={date} min={todayLocalDate()} onChange={(e) => { setDate(e.target.value); setSelected(null); }} className={inputClass} />
        </label>
      </div>

      <div>
        <div className="mb-1.5 text-[11px] font-medium text-muted">{tr("Horários livres", "Free slots")}</div>
        {slots === undefined ? (
          <div className="h-10 animate-pulse rounded-lg bg-surface-2" />
        ) : slots.filter((s) => s.available).length === 0 ? (
          <p className="text-[12px] text-muted">{tr("Sem horários livres neste dia.", "No free slots on this day.")}</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {slots.filter((s) => s.available).map((slot) => (
              <button
                key={slot.startAt}
                type="button"
                onClick={() => setSelected(slot.startAt)}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-[12px] font-semibold transition-colors",
                  selected === slot.startAt ? "border-[#2b4f8a] bg-[#2b4f8a] text-white" : "border-line bg-surface text-ink hover:border-[#2b4f8a]",
                )}
              >
                {slot.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {mode.kind === "book" && (
        <div className={cn("grid gap-2", compact ? "grid-cols-1" : "sm:grid-cols-2")}>
          {!mode.threadId && (
            <label className="block text-[11px] font-medium text-muted">
              {tr("Paciente", "Patient")}
              <input value={patientName} onChange={(e) => setPatientName(e.target.value)} placeholder={tr("Nome", "Name")} className={inputClass} maxLength={120} />
            </label>
          )}
          <label className="block text-[11px] font-medium text-muted">
            {tr("Notas (internas)", "Notes (internal)")}
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} maxLength={500} />
          </label>
        </div>
      )}
      {mode.kind === "book" && mode.threadId && (
        <label className="flex items-center gap-2 text-[12px] text-ink">
          <input type="checkbox" checked={askConfirmation} onChange={(e) => setAskConfirmation(e.target.checked)} className="h-4 w-4 accent-[#0a1b33]" />
          <Send size={12} className="text-chip-success-fg" />
          {tr("Enviar pedido de confirmação ao paciente", "Send a confirmation request to the patient")}
        </label>
      )}
      {error && <p className="rounded-lg border border-[#e0533d]/30 bg-chip-danger px-3 py-2 text-[12px] text-chip-danger-fg">{error}</p>}
      <button
        type="button"
        disabled={busy || selected === null || !serviceId}
        onClick={() => void submit()}
        className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-[#2b4f8a] px-3 text-[13px] font-semibold text-white disabled:opacity-50 sm:w-auto"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <CalendarCheck size={14} />}
        {mode.kind === "reschedule" ? tr("Remarcar", "Reschedule") : tr("Reservar horário", "Book slot")}
      </button>
    </div>
  );
}
