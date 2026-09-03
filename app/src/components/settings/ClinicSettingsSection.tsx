"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Archive, CalendarCog, Loader2, Plus, Save, Stethoscope } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { cn } from "@/lib/cn";
import { convexErrorMessage } from "@/lib/convexErrorMessage";
import { useI18n } from "@/lib/i18n";

const WEEKDAYS_PT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const WEEKDAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const COLORS = ["#2b4f8a", "#0d6b61", "#b45309", "#7c3aed", "#0a1b33", "#e0533d"];
const TIMEZONES = ["Africa/Maputo", "Africa/Luanda", "Europe/Lisbon", "Africa/Johannesburg", "Africa/Nairobi", "America/Sao_Paulo", "UTC"];

const inputClass = "mt-1 h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-brand-solid/40";

export function ClinicSettingsSection() {
  const { locale, tr } = useI18n();
  const settings = useQuery(api.clinic.getSettings, {});
  const saveSettings = useMutation(api.clinic.saveSettings);
  const workspace = useQuery(api.clinic.listWorkspace, {});
  const channels = useQuery(api.channels.list);
  const hubChannel = useMemo(() => (channels ?? []).find((c) => c.provider === "iasolution_hub" && c.operationalTerritory === "openbsp"), [channels]);
  const templates = useQuery(api.channels.listTemplates, hubChannel ? { channelId: hubChannel._id } : "skip");
  const professionals = useQuery(api.clinic.listProfessionals, { includeArchived: false });
  const saveProfessional = useMutation(api.clinic.saveProfessional);
  const archiveProfessional = useMutation(api.clinic.archiveProfessional);

  const [form, setForm] = useState<{
    timezone: string;
    slotStepMinutes: number;
    minLeadMinutes: number;
    reminderHoursBefore: string;
    confirmationTemplate: string;
    reminderTemplate: string;
    confirmationText: string;
    reminderText: string;
    fallbackText: string;
    humanSlaMinutes: number;
    firstResponseSlaMinutes: number;
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!settings || form) return;
    setForm({
      timezone: settings.timezone,
      slotStepMinutes: settings.slotStepMinutes,
      minLeadMinutes: settings.minLeadMinutes,
      reminderHoursBefore: settings.reminderHoursBefore.join(", "),
      confirmationTemplate: settings.confirmationTemplateName ? `${settings.confirmationTemplateName}|${settings.confirmationTemplateLanguage ?? ""}` : "",
      reminderTemplate: settings.reminderTemplateName ? `${settings.reminderTemplateName}|${settings.reminderTemplateLanguage ?? ""}` : "",
      confirmationText: settings.confirmationText ?? "",
      reminderText: settings.reminderText ?? "",
      fallbackText: settings.fallbackText ?? "",
      humanSlaMinutes: settings.humanSlaMinutes,
      firstResponseSlaMinutes: settings.firstResponseSlaMinutes,
    });
  }, [settings, form]);

  async function run(key: string, action: () => Promise<unknown>, success?: string) {
    setBusy(key);
    setNotice(null);
    setError(null);
    try {
      await action();
      if (success) setNotice(success);
    } catch (err) {
      setError(convexErrorMessage(err, locale));
    } finally {
      setBusy(null);
    }
  }

  async function submitSettings() {
    if (!form) return;
    const [confirmationName, confirmationLang] = form.confirmationTemplate.split("|");
    const [reminderName, reminderLang] = form.reminderTemplate.split("|");
    await run(
      "settings",
      () =>
        saveSettings({
          timezone: form.timezone,
          slotStepMinutes: form.slotStepMinutes,
          minLeadMinutes: form.minLeadMinutes,
          reminderHoursBefore: form.reminderHoursBefore.split(/[,\s]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0),
          confirmationTemplateName: confirmationName || undefined,
          confirmationTemplateLanguage: confirmationLang || undefined,
          reminderTemplateName: reminderName || undefined,
          reminderTemplateLanguage: reminderLang || undefined,
          confirmationText: form.confirmationText || undefined,
          reminderText: form.reminderText || undefined,
          fallbackText: form.fallbackText || undefined,
          humanSlaMinutes: form.humanSlaMinutes,
          firstResponseSlaMinutes: form.firstResponseSlaMinutes,
        }),
      tr("Definições da clínica guardadas.", "Clinic settings saved."),
    );
  }

  // Professional editor
  const [editing, setEditing] = useState<{
    professionalId?: Id<"clinicProfessionals">;
    name: string;
    specialty: string;
    color: string;
    days: number[];
    start: string;
    end: string;
    serviceIds: Id<"clinicServices">[];
  } | null>(null);

  async function submitProfessional() {
    if (!editing) return;
    await run(
      "professional",
      () =>
        saveProfessional({
          professionalId: editing.professionalId,
          name: editing.name,
          specialty: editing.specialty || undefined,
          color: editing.color,
          availability: editing.days.length > 0 ? editing.days.map((weekday) => ({ weekday, start: editing.start, end: editing.end })) : undefined,
          serviceIds: editing.serviceIds,
        }),
      tr("Profissional guardado.", "Professional saved."),
    );
    setEditing(null);
  }

  const weekdays = locale === "pt" ? WEEKDAYS_PT : WEEKDAYS_EN;

  return (
    <div className="space-y-6">
      {(notice || error) && (
        <div className={cn("rounded-lg border px-4 py-3 text-sm", error ? "border-[#e0533d]/30 bg-chip-danger text-chip-danger-fg" : "border-[#0d6b61]/30 bg-chip-success text-chip-success-fg")}>{error ?? notice}</div>
      )}

      <section className="overflow-hidden rounded-lg border border-line bg-surface">
        <div className="flex items-center gap-2 border-b border-line-soft px-6 py-4">
          <CalendarCog size={16} className="text-ink" />
          <div>
            <h2 className="text-[15px] font-semibold text-ink">{tr("Agenda e notificações", "Calendar and notifications")}</h2>
            <p className="text-xs text-muted">{tr("Fuso horário, passo dos horários, antecedência mínima e mensagens de confirmação/lembrete.", "Time zone, slot step, minimum lead time and confirmation/reminder messages.")}</p>
          </div>
        </div>
        {!form ? (
          <div className="px-6 py-6"><Loader2 size={15} className="animate-spin text-faint" /></div>
        ) : (
          <div className="space-y-4 p-6">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <label className="block text-[11px] font-medium text-muted">
                {tr("Fuso horário", "Time zone")}
                <input list="clinic-timezones" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} className={inputClass} />
                <datalist id="clinic-timezones">{TIMEZONES.map((tz) => <option key={tz} value={tz} />)}</datalist>
              </label>
              <label className="block text-[11px] font-medium text-muted">
                {tr("Passo dos horários (min)", "Slot step (min)")}
                <select value={form.slotStepMinutes} onChange={(e) => setForm({ ...form, slotStepMinutes: Number(e.target.value) })} className={inputClass}>
                  {[10, 15, 20, 30, 45, 60].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <label className="block text-[11px] font-medium text-muted">
                {tr("Antecedência mínima (min)", "Minimum lead time (min)")}
                <input type="number" min={0} max={1440} value={form.minLeadMinutes} onChange={(e) => setForm({ ...form, minLeadMinutes: Number(e.target.value) })} className={inputClass} />
              </label>
              <label className="block text-[11px] font-medium text-muted">
                {tr("Lembretes (horas antes)", "Reminders (hours before)")}
                <input value={form.reminderHoursBefore} onChange={(e) => setForm({ ...form, reminderHoursBefore: e.target.value })} placeholder="24, 2" className={inputClass} />
              </label>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-[11px] font-medium text-muted">
                {tr("Template de confirmação (fora da janela 24h)", "Confirmation template (outside the 24h window)")}
                <select value={form.confirmationTemplate} onChange={(e) => setForm({ ...form, confirmationTemplate: e.target.value })} className={inputClass}>
                  <option value="">{tr("Nenhum — só texto na janela", "None — text within the window only")}</option>
                  {(templates ?? []).map((tpl) => <option key={tpl._id} value={`${tpl.name}|${tpl.languageCode}`}>{tpl.name} · {tpl.languageCode}</option>)}
                </select>
              </label>
              <label className="block text-[11px] font-medium text-muted">
                {tr("Template de lembrete", "Reminder template")}
                <select value={form.reminderTemplate} onChange={(e) => setForm({ ...form, reminderTemplate: e.target.value })} className={inputClass}>
                  <option value="">{tr("Nenhum", "None")}</option>
                  {(templates ?? []).map((tpl) => <option key={tpl._id} value={`${tpl.name}|${tpl.languageCode}`}>{tpl.name} · {tpl.languageCode}</option>)}
                </select>
              </label>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-[11px] font-medium text-muted">
                {tr("Texto de confirmação", "Confirmation text")}
                <textarea rows={3} value={form.confirmationText} onChange={(e) => setForm({ ...form, confirmationText: e.target.value })} placeholder={tr("Olá {{nome}}, a sua consulta de {{servico}} está marcada para {{quando}} na {{clinica}}. Responda CONFIRMO para confirmar.", "Hi {{nome}}, your {{servico}} appointment is on {{quando}} at {{clinica}}. Reply CONFIRMO to confirm.")} className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand-solid/40" />
              </label>
              <label className="block text-[11px] font-medium text-muted">
                {tr("Texto de lembrete", "Reminder text")}
                <textarea rows={3} value={form.reminderText} onChange={(e) => setForm({ ...form, reminderText: e.target.value })} placeholder={tr("Olá {{nome}}, lembramos a sua consulta de {{servico}} {{quando}}.", "Hi {{nome}}, a reminder of your {{servico}} appointment {{quando}}.")} className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand-solid/40" />
              </label>
            </div>
            <p className="text-[11px] text-muted">{tr("Variáveis: {{nome}}, {{servico}}, {{quando}}, {{clinica}}.", "Variables: {{nome}}, {{servico}}, {{quando}}, {{clinica}}.")}</p>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <label className="block text-[11px] font-medium text-muted">
                {tr("SLA de casos humanos (min)", "Human case SLA (min)")}
                <input type="number" min={15} max={2880} value={form.humanSlaMinutes} onChange={(e) => setForm({ ...form, humanSlaMinutes: Number(e.target.value) })} className={inputClass} />
              </label>
              <label className="block text-[11px] font-medium text-muted">
                {tr("SLA de primeira resposta (min)", "First response SLA (min)")}
                <input type="number" min={1} max={1440} value={form.firstResponseSlaMinutes} onChange={(e) => setForm({ ...form, firstResponseSlaMinutes: Number(e.target.value) })} className={inputClass} />
              </label>
              <label className="block text-[11px] font-medium text-muted">
                {tr("Texto de recurso (quando a IA não sabe)", "Fallback text (when the AI does not know)")}
                <input value={form.fallbackText} onChange={(e) => setForm({ ...form, fallbackText: e.target.value })} className={inputClass} />
              </label>
            </div>
            <div className="flex justify-end">
              <button type="button" disabled={busy !== null} onClick={() => void submitSettings()} className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-solid px-4 text-[13px] font-semibold text-white disabled:opacity-50">
                {busy === "settings" ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {tr("Guardar", "Save")}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-lg border border-line bg-surface">
        <div className="flex flex-col gap-3 border-b border-line-soft px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Stethoscope size={16} className="text-ink" />
            <div>
              <h2 className="text-[15px] font-semibold text-ink">{tr("Profissionais", "Professionals")}</h2>
              <p className="text-xs text-muted">{tr("Cada profissional tem a sua agenda; sem profissionais a agenda é por serviço.", "Each professional has their own calendar; without professionals the calendar is per service.")}</p>
            </div>
          </div>
          <button type="button" onClick={() => setEditing({ name: "", specialty: "", color: COLORS[(professionals?.length ?? 0) % COLORS.length], days: [1, 2, 3, 4, 5], start: "08:00", end: "17:00", serviceIds: [] })} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-[12px] font-semibold text-ink">
            <Plus size={14} /> {tr("Adicionar", "Add")}
          </button>
        </div>
        <div className="p-6">
          {professionals === undefined ? (
            <Loader2 size={15} className="animate-spin text-faint" />
          ) : professionals.length === 0 && !editing ? (
            <p className="text-[13px] text-muted">{tr("Ainda sem profissionais.", "No professionals yet.")}</p>
          ) : (
            <ul className="divide-y divide-line-soft">
              {professionals?.map((p) => (
                <li key={p._id} className="flex items-center justify-between gap-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: p.color ?? "#2b4f8a" }} />
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-semibold text-ink">{p.name}</div>
                      <div className="text-[11px] text-muted">{p.specialty ?? tr("Sem especialidade", "No specialty")}{p.availability?.length ? ` · ${p.availability.length} ${tr("dias", "days")}` : ""}</div>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <button type="button" onClick={() => setEditing({ professionalId: p._id, name: p.name, specialty: p.specialty ?? "", color: p.color ?? COLORS[0], days: p.availability?.map((a) => a.weekday) ?? [], start: p.availability?.[0]?.start ?? "08:00", end: p.availability?.[0]?.end ?? "17:00", serviceIds: (workspace?.services ?? []).filter((s) => s.professionalIds?.includes(p._id)).map((s) => s._id) })} className="h-8 rounded-md border border-line px-2 text-[11px] font-semibold text-body">{tr("Editar", "Edit")}</button>
                    <button type="button" disabled={busy !== null} onClick={() => { if (window.confirm(tr("Arquivar este profissional?", "Archive this professional?"))) void run(`arch-${p._id}`, () => archiveProfessional({ professionalId: p._id })); }} className="inline-flex h-8 items-center gap-1 rounded-md border border-line px-2 text-[11px] font-semibold text-muted hover:text-chip-danger-fg"><Archive size={12} /></button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {editing && (
            <div className="mt-4 space-y-3 rounded-lg border border-line bg-surface-2 p-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block text-[11px] font-medium text-muted">
                  {tr("Nome", "Name")}
                  <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className={inputClass} maxLength={80} />
                </label>
                <label className="block text-[11px] font-medium text-muted">
                  {tr("Especialidade", "Specialty")}
                  <input value={editing.specialty} onChange={(e) => setEditing({ ...editing, specialty: e.target.value })} className={inputClass} maxLength={80} />
                </label>
                <div className="block text-[11px] font-medium text-muted">
                  {tr("Cor", "Colour")}
                  <div className="mt-2 flex gap-1.5">
                    {COLORS.map((c) => (
                      <button key={c} type="button" onClick={() => setEditing({ ...editing, color: c })} className={cn("h-6 w-6 rounded-full border-2", editing.color === c ? "border-brand-solid" : "border-transparent")} style={{ backgroundColor: c }} aria-label={c} />
                    ))}
                  </div>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-[1fr_120px_120px]">
                <div className="text-[11px] font-medium text-muted">
                  {tr("Dias", "Days")}
                  <div className="mt-2 flex flex-wrap gap-1">
                    {weekdays.map((label, weekday) => {
                      const on = editing.days.includes(weekday);
                      return (
                        <button key={weekday} type="button" onClick={() => setEditing({ ...editing, days: on ? editing.days.filter((d) => d !== weekday) : [...editing.days, weekday].sort() })} className={cn("rounded-md border px-2 py-1 text-[11px] font-semibold", on ? "border-brand-solid bg-brand-solid text-white" : "border-line bg-surface text-body")}>{label}</button>
                      );
                    })}
                  </div>
                </div>
                <label className="block text-[11px] font-medium text-muted">{tr("Início", "Start")}<input type="time" value={editing.start} onChange={(e) => setEditing({ ...editing, start: e.target.value })} className={inputClass} /></label>
                <label className="block text-[11px] font-medium text-muted">{tr("Fim", "End")}<input type="time" value={editing.end} onChange={(e) => setEditing({ ...editing, end: e.target.value })} className={inputClass} /></label>
              </div>
              {(workspace?.services ?? []).length > 0 && (
                <div className="text-[11px] font-medium text-muted">
                  {tr("Serviços que realiza", "Services performed")}
                  <div className="mt-2 flex flex-wrap gap-1">
                    {(workspace?.services ?? []).filter((s) => s.status === "active").map((s) => {
                      const on = editing.serviceIds.includes(s._id);
                      return (
                        <button key={s._id} type="button" onClick={() => setEditing({ ...editing, serviceIds: on ? editing.serviceIds.filter((id) => id !== s._id) : [...editing.serviceIds, s._id] })} className={cn("rounded-full border px-2.5 py-1 text-[11px] font-semibold", on ? "border-[#0d6b61] bg-[#0d6b61] text-white" : "border-line bg-surface text-body")}>{s.name}</button>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setEditing(null)} className="h-9 rounded-lg border border-line px-3 text-[12px] font-semibold text-body">{tr("Cancelar", "Cancel")}</button>
                <button type="button" disabled={busy !== null || editing.name.trim().length < 2} onClick={() => void submitProfessional()} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-solid px-3 text-[12px] font-semibold text-white disabled:opacity-50">
                  {busy === "professional" && <Loader2 size={12} className="animate-spin" />} {tr("Guardar", "Save")}
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
