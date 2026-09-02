"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  BookOpenText,
  CalendarPlus,
  CheckCircle2,
  Clock3,
  LifeBuoy,
  Loader2,
  Sparkles,
  Stethoscope,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useI18n } from "@/lib/i18n";
import { convexErrorMessage } from "@/lib/convexErrorMessage";
import { relativeTime } from "@/lib/relativeTime";
import { SegmentedTabs } from "@/components/app/SegmentedTabs";

type Notice = { tone: "success" | "error"; text: string } | null;
type KnowledgeKind = "faq" | "service" | "policy" | "hours" | "document" | "instruction";
type FollowUpTrigger =
  | "no_reply"
  | "appointment_unconfirmed"
  | "proposal_no_response"
  | "no_show"
  | "human_case_pending";
type HumanUrgency = "low" | "normal" | "high" | "urgent";
type ClinicTab = "services" | "knowledge" | "followup" | "human";

function todayInputValue() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Maputo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(Date.now());
}

export function ClinicOpsPanel() {
  const workspace = useQuery(api.clinic.listWorkspace, {});
  const bootstrap = useMutation(api.clinic.bootstrapDefaults);
  const createService = useMutation(api.clinic.createService);
  const saveKnowledge = useMutation(api.clinic.saveKnowledgeItem);
  const createFollowUpRule = useMutation(api.clinic.createFollowUpRule);
  const createHumanCase = useMutation(api.clinic.createHumanCase);
  const createAppointment = useMutation(api.clinic.createAppointment);
  const { locale } = useI18n();
  const isPt = locale === "pt";
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [clinicTab, setClinicTab] = useState<ClinicTab>("services");

  const [serviceName, setServiceName] = useState(isPt ? "Consulta inicial" : "Initial consult");
  const [serviceDuration, setServiceDuration] = useState(45);
  const [serviceProfessional, setServiceProfessional] = useState("");

  const [knowledgeKind, setKnowledgeKind] = useState<KnowledgeKind>("faq");
  const [knowledgeTitle, setKnowledgeTitle] = useState(isPt ? "Como marcar consulta" : "How to book");
  const [knowledgeBody, setKnowledgeBody] = useState(
    isPt
      ? "Confirma o serviço pretendido, oferece horários reais e chama a equipa quando faltar informação clínica."
      : "Confirm the requested service, offer real slots, and call the team when clinical information is missing.",
  );

  const [followName, setFollowName] = useState(isPt ? "Lead sem resposta" : "Lead no reply");
  const [followTrigger, setFollowTrigger] = useState<FollowUpTrigger>("no_reply");
  const [followDelay, setFollowDelay] = useState(180);
  const [followMessage, setFollowMessage] = useState(
    isPt
      ? "Olá! Continuamos por aqui para ajudar com o teu pedido. Queres que vejamos um horário?"
      : "Hi! We are still here to help with your request. Should we check a slot for you?",
  );

  const [caseReason, setCaseReason] = useState(isPt ? "Dúvida clínica" : "Clinical question");
  const [caseUrgency, setCaseUrgency] = useState<HumanUrgency>("normal");
  const [caseQuestion, setCaseQuestion] = useState(
    isPt
      ? "Paciente precisa de uma decisão da equipa antes da IA continuar."
      : "Patient needs a team decision before AI continues.",
  );

  const firstServiceId = workspace?.services.find((service) => service.status === "active")
    ?._id as Id<"clinicServices"> | undefined;
  const [slotServiceId, setSlotServiceId] = useState<Id<"clinicServices"> | "">("");
  const selectedSlotServiceId = slotServiceId || firstServiceId;
  const [slotDate, setSlotDate] = useState(todayInputValue());
  const [appointmentName, setAppointmentName] = useState("");
  const slots = useQuery(
    api.clinic.listAvailableSlots,
    selectedSlotServiceId ? { serviceId: selectedSlotServiceId, date: slotDate } : "skip",
  );

  const readiness = workspace?.readiness;
  const readyCount = useMemo(() => {
    if (!readiness) return 0;
    return [
      readiness.hasActiveService,
      readiness.hasActiveKnowledge,
      readiness.hasActiveFollowUp,
    ].filter(Boolean).length;
  }, [readiness]);

  async function runAction(
    key: string,
    action: () => Promise<unknown>,
    success: string,
    precheck?: () => string | null,
  ) {
    // Mirror the server rules before the round trip so the operator sees a
    // plain sentence instead of a validation error.
    const problem = precheck?.();
    if (problem) {
      setNotice({ tone: "error", text: problem });
      return;
    }
    setBusy(key);
    setNotice(null);
    try {
      await action();
      setNotice({ tone: "success", text: success });
    } catch (error) {
      setNotice({
        tone: "error",
        text: convexErrorMessage(
          error,
          locale,
          isPt ? "Não foi possível concluir a ação." : "Could not complete the action.",
        ),
      });
    } finally {
      setBusy(null);
    }
  }

  function textLengthProblem(value: string, label: string, min: number, max: number) {
    const length = value.trim().length;
    if (length >= min && length <= max) return null;
    return isPt
      ? `${label}: use entre ${min} e ${max} caracteres.`
      : `${label}: use between ${min} and ${max} characters.`;
  }

  if (workspace === undefined) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 size={16} className="animate-spin" />
          {isPt ? "A carregar centro da clínica..." : "Loading clinic center..."}
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white" id="clinic-center">
      <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            {isPt ? "Centro da clínica" : "Clinic center"}
          </div>
          <h2 className="mt-1 font-[var(--font-outfit)] text-xl font-medium text-[#0a1b33]">
            {isPt ? "Operação configurável em poucos cliques" : "Configurable operation in a few clicks"}
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
            {isPt
              ? "Serviços, fontes da IA, follow-ups e casos humanos ficam prontos para o atendimento agir sem improviso."
              : "Services, AI sources, follow-ups, and human cases stay ready for care without improvising."}
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            runAction(
              "bootstrap",
              () => bootstrap({}),
              isPt ? "Base da clínica preparada." : "Clinic base prepared.",
            )
          }
          disabled={busy !== null}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#0a152d] px-3 text-sm font-semibold text-white hover:bg-[#0e1f41] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy === "bootstrap" ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
          {isPt ? "Preparar operação" : "Prepare operation"}
        </button>
      </div>

      <div className="border-b border-slate-100 px-5 py-4">
        <SegmentedTabs
          items={[
            {
              key: "services",
              label: isPt ? "Serviço e agenda" : "Service and schedule",
              value: `${workspace.services.filter((service) => service.status === "active").length} ${isPt ? "ativos" : "active"}`,
              icon: Stethoscope,
            },
            {
              key: "knowledge",
              label: isPt ? "Conhecimento" : "Knowledge",
              value: `${workspace.knowledge.filter((item) => item.status === "active").length} ${isPt ? "fontes" : "sources"}`,
              icon: BookOpenText,
            },
            {
              key: "followup",
              label: "Follow-up",
              value: `${workspace.followUpRules.filter((rule) => rule.status === "active").length} ${isPt ? "regras" : "rules"}`,
              icon: Clock3,
            },
            {
              key: "human",
              label: isPt ? "Ajuda humana" : "Human help",
              value: `${workspace.readiness.openHumanCases} ${isPt ? "abertos" : "open"}`,
              icon: LifeBuoy,
            },
          ]}
          selected={clinicTab}
          onChange={(key) => setClinicTab(key as ClinicTab)}
        />
      </div>

      {notice && (
        <div
          className={`mx-5 mt-5 rounded-lg border px-3 py-2 text-sm ${
            notice.tone === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {notice.text}
        </div>
      )}

      <div className="p-5">
        {clinicTab === "services" && (
        <Panel
          icon={Stethoscope}
          title={isPt ? "Serviço e agenda" : "Service and schedule"}
          description={
            isPt
              ? "A IA só pode oferecer horários que existam aqui."
              : "AI can only offer slots that exist here."
          }
        >
          <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
            <Input
              label={isPt ? "Nome do serviço" : "Service name"}
              value={serviceName}
              onChange={setServiceName}
            />
            <NumberInput
              label={isPt ? "Duração" : "Duration"}
              value={serviceDuration}
              onChange={setServiceDuration}
              suffix="min"
            />
          </div>
          <Input
            label={isPt ? "Profissional" : "Professional"}
            value={serviceProfessional}
            onChange={setServiceProfessional}
            placeholder={isPt ? "Opcional" : "Optional"}
          />
          <button
            type="button"
            onClick={() =>
              runAction(
                "service",
                () =>
                  createService({
                    name: serviceName,
                    durationMinutes: serviceDuration,
                    professionalName: serviceProfessional || undefined,
                  }),
                isPt ? "Serviço criado." : "Service created.",
                () =>
                  textLengthProblem(serviceName, isPt ? "Nome do serviço" : "Service name", 2, 80) ??
                  (!Number.isFinite(serviceDuration) || serviceDuration < 10 || serviceDuration > 480
                    ? isPt
                      ? "Duração: entre 10 e 480 minutos."
                      : "Duration: between 10 and 480 minutes."
                    : null),
              )
            }
            disabled={busy !== null}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-[#0a1b33] hover:bg-slate-50 disabled:opacity-60"
          >
            {busy === "service" ? <Loader2 size={14} className="animate-spin" /> : <CalendarPlus size={14} />}
            {isPt ? "Criar serviço" : "Create service"}
          </button>

          <div className="mt-3 rounded-lg bg-[#f8fafc] p-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_150px]">
              <label className="text-xs font-semibold text-slate-500">
                {isPt ? "Serviço" : "Service"}
                <select
                  value={selectedSlotServiceId ?? ""}
                  onChange={(event) => setSlotServiceId(event.target.value as Id<"clinicServices">)}
                  className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-[#0a1b33]"
                >
                  {workspace.services
                    .filter((service) => service.status === "active")
                    .map((service) => (
                      <option key={service._id} value={service._id}>
                        {service.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-500">
                {isPt ? "Dia" : "Day"}
                <input
                  type="date"
                  value={slotDate}
                  onChange={(event) => setSlotDate(event.target.value)}
                  className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-[#0a1b33]"
                />
              </label>
            </div>
            <Input
              label={isPt ? "Paciente para reservar" : "Patient to book"}
              value={appointmentName}
              onChange={setAppointmentName}
              placeholder={isPt ? "Nome opcional" : "Optional name"}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              {(slots ?? []).filter((slot) => slot.available).slice(0, 6).map((slot) => (
                <button
                  key={slot.startAt}
                  type="button"
                  onClick={() =>
                    selectedSlotServiceId &&
                    runAction(
                      `slot-${slot.startAt}`,
                      () =>
                        createAppointment({
                          serviceId: selectedSlotServiceId,
                          startAt: slot.startAt,
                          patientName: appointmentName || undefined,
                        }),
                      isPt ? "Agendamento criado." : "Appointment created.",
                    )
                  }
                  disabled={busy !== null}
                  className="rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
                >
                  {slot.label}
                </button>
              ))}
              {selectedSlotServiceId && slots?.filter((slot) => slot.available).length === 0 && (
                <span className="text-xs text-slate-500">
                  {isPt ? "Sem horários livres neste dia." : "No free slots on this day."}
                </span>
              )}
            </div>
          </div>
        </Panel>
        )}

        {clinicTab === "knowledge" && (
        <Panel
          icon={BookOpenText}
          title={isPt ? "Ensinar agente" : "Teach agent"}
          description={
            isPt
              ? "FAQ, serviços, políticas e instruções ficam versionados."
              : "FAQ, services, policies, and instructions are versioned."
          }
        >
          <div className="grid gap-3 sm:grid-cols-[150px_1fr]">
            <label className="text-xs font-semibold text-slate-500">
              {isPt ? "Tipo" : "Type"}
              <select
                value={knowledgeKind}
                onChange={(event) => setKnowledgeKind(event.target.value as KnowledgeKind)}
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-[#0a1b33]"
              >
                {["faq", "service", "policy", "hours", "document", "instruction"].map((kind) => (
                  <option key={kind} value={kind}>
                    {knowledgeKindLabel(kind as KnowledgeKind, isPt)}
                  </option>
                ))}
              </select>
            </label>
            <Input
              label={isPt ? "Título" : "Title"}
              value={knowledgeTitle}
              onChange={setKnowledgeTitle}
            />
          </div>
          <Textarea
            label={isPt ? "Fonte confiável" : "Trusted source"}
            value={knowledgeBody}
            onChange={setKnowledgeBody}
          />
          <button
            type="button"
            onClick={() =>
              runAction(
                "knowledge",
                () =>
                  saveKnowledge({
                    kind: knowledgeKind,
                    title: knowledgeTitle,
                    body: knowledgeBody,
                    status: "active",
                  }),
                isPt ? "Conhecimento guardado com versão." : "Knowledge saved with version.",
              )
            }
            disabled={busy !== null}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-[#0a1b33] hover:bg-slate-50 disabled:opacity-60"
          >
            {busy === "knowledge" ? <Loader2 size={14} className="animate-spin" /> : <BookOpenText size={14} />}
            {isPt ? "Adicionar conhecimento" : "Add knowledge"}
          </button>
          <MiniList
            empty={isPt ? "Sem fontes ainda." : "No sources yet."}
            rows={workspace.knowledge.slice(0, 4).map((item) => ({
              key: item._id,
              title: item.title,
              detail: `${knowledgeKindLabel(item.kind as KnowledgeKind, isPt)} · v${item.currentVersion}`,
            }))}
          />
        </Panel>
        )}

        {clinicTab === "followup" && (
        <Panel
          icon={Clock3}
          title="Follow-up"
          description={
            isPt
              ? "Agenda lembretes e para sozinho quando o paciente responde."
              : "Schedules reminders and stops when the patient replies."
          }
        >
          <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
            <Input
              label={isPt ? "Nome da regra" : "Rule name"}
              value={followName}
              onChange={setFollowName}
            />
            <NumberInput
              label={isPt ? "Espera" : "Wait"}
              value={followDelay}
              onChange={setFollowDelay}
              suffix="min"
            />
          </div>
          <label className="text-xs font-semibold text-slate-500">
            {isPt ? "Quando disparar" : "Trigger"}
            <select
              value={followTrigger}
              onChange={(event) => setFollowTrigger(event.target.value as FollowUpTrigger)}
              className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-[#0a1b33]"
            >
              {[
                "no_reply",
                "appointment_unconfirmed",
                "proposal_no_response",
                "no_show",
                "human_case_pending",
              ].map((trigger) => (
                <option key={trigger} value={trigger}>
                  {followTriggerLabel(trigger as FollowUpTrigger, isPt)}
                </option>
              ))}
            </select>
          </label>
          <Textarea
            label={isPt ? "Mensagem" : "Message"}
            value={followMessage}
            onChange={setFollowMessage}
          />
          <button
            type="button"
            onClick={() =>
              runAction(
                "follow",
                () =>
                  createFollowUpRule({
                    name: followName,
                    trigger: followTrigger,
                    delayMinutes: followDelay,
                    message: followMessage,
                  }),
                isPt ? "Regra de follow-up criada." : "Follow-up rule created.",
                () =>
                  textLengthProblem(followName, isPt ? "Nome da regra" : "Rule name", 2, 80) ??
                  textLengthProblem(followMessage, isPt ? "Mensagem" : "Message", 5, 1000) ??
                  (!Number.isFinite(followDelay) || followDelay < 5 || followDelay > 60 * 24 * 30
                    ? isPt
                      ? "Atraso: entre 5 minutos e 30 dias."
                      : "Delay: between 5 minutes and 30 days."
                    : null),
              )
            }
            disabled={busy !== null}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-[#0a1b33] hover:bg-slate-50 disabled:opacity-60"
          >
            {busy === "follow" ? <Loader2 size={14} className="animate-spin" /> : <Clock3 size={14} />}
            {isPt ? "Criar follow-up" : "Create follow-up"}
          </button>
          <MiniList
            empty={isPt ? "Sem follow-ups ainda." : "No follow-ups yet."}
            rows={workspace.followUpTasks.slice(0, 4).map((task) => ({
              key: task._id,
              title:
                task.kind === "appointment_confirmation"
                  ? (isPt ? "Pedido de confirmação" : "Confirmation request")
                  : task.kind === "appointment_reminder"
                    ? (isPt ? "Lembrete de consulta" : "Appointment reminder")
                    : (isPt ? "Próximo disparo" : "Next send"),
              detail: `${relativeTime(task.nextAttemptAt ?? task.dueAt, Date.now(), locale)}${task.attempts > 0 ? ` · ${task.attempts}× ${isPt ? "tentativas" : "attempts"}` : ""}`,
            }))}
          />
        </Panel>
        )}

        {clinicTab === "human" && (
        <Panel
          icon={LifeBuoy}
          title={isPt ? "Ajuda humana" : "Human help"}
          description={
            isPt
              ? "Cria um caso quando há decisão, risco ou exceção."
              : "Create a case when there is decision, risk, or exception."
          }
        >
          <div className="grid gap-3 sm:grid-cols-[1fr_150px]">
            <Input
              label={isPt ? "Motivo" : "Reason"}
              value={caseReason}
              onChange={setCaseReason}
            />
            <label className="text-xs font-semibold text-slate-500">
              {isPt ? "Urgência" : "Urgency"}
              <select
                value={caseUrgency}
                onChange={(event) => setCaseUrgency(event.target.value as HumanUrgency)}
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-[#0a1b33]"
              >
                {["low", "normal", "high", "urgent"].map((urgency) => (
                  <option key={urgency} value={urgency}>
                    {urgencyLabel(urgency as HumanUrgency, isPt)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <Textarea
            label={isPt ? "Pergunta para a equipa" : "Question for team"}
            value={caseQuestion}
            onChange={setCaseQuestion}
          />
          <button
            type="button"
            onClick={() =>
              runAction(
                "case",
                () =>
                  createHumanCase({
                    reason: caseReason,
                    urgency: caseUrgency,
                    question: caseQuestion,
                  }),
                isPt ? "Caso humano criado." : "Human case created.",
                () =>
                  textLengthProblem(caseReason, isPt ? "Motivo" : "Reason", 2, 80) ??
                  textLengthProblem(caseQuestion, isPt ? "Pergunta" : "Question", 3, 2000),
              )
            }
            disabled={busy !== null}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-[#0a1b33] hover:bg-slate-50 disabled:opacity-60"
          >
            {busy === "case" ? <Loader2 size={14} className="animate-spin" /> : <LifeBuoy size={14} />}
            {isPt ? "Pedir ajuda humana" : "Ask human help"}
          </button>
          <MiniList
            empty={isPt ? "Nenhum caso aberto." : "No open cases."}
            rows={workspace.humanCases.slice(0, 4).map((humanCase) => ({
              key: humanCase._id,
              title: humanCase.reason,
              detail: `${urgencyLabel(humanCase.urgency as HumanUrgency, isPt)} · ${relativeTime(
                humanCase.slaDueAt,
                Date.now(),
                locale,
              )}`,
            }))}
          />
        </Panel>
        )}
      </div>

      <div className="border-t border-slate-100 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span
            className={`inline-flex h-7 items-center gap-1 rounded-full px-2.5 font-semibold ${
              readyCount === 3
                ? "bg-emerald-50 text-emerald-700"
                : "bg-amber-50 text-amber-700"
            }`}
          >
            {readyCount === 3 ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
            {readyCount}/3 {isPt ? "pronto" : "ready"}
          </span>
          <span>
            {isPt
              ? "Antes de publicar um agente: serviço ativo, fonte confiável e follow-up ativo."
              : "Before publishing an agent: active service, trusted source, and active follow-up."}
          </span>
        </div>
      </div>
    </section>
  );
}

function Panel({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-100 bg-[#fbfcfe] p-4">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-[#0f766e] shadow-sm">
          <Icon size={17} />
        </span>
        <div>
          <h3 className="text-sm font-semibold text-[#0a1b33]">{title}</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
        </div>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block text-xs font-semibold text-slate-500">
      {label}
      <input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-[#0a1b33] outline-none transition focus:border-[#0f766e]"
      />
    </label>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  suffix: string;
}) {
  return (
    <label className="block text-xs font-semibold text-slate-500">
      {label}
      <div className="mt-1 flex h-10 items-center rounded-lg border border-slate-200 bg-white px-3 focus-within:border-[#0f766e]">
        <input
          type="number"
          min={1}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="min-w-0 flex-1 bg-transparent text-sm text-[#0a1b33] outline-none"
        />
        <span className="text-xs text-slate-400">{suffix}</span>
      </div>
    </label>
  );
}

function Textarea({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-xs font-semibold text-slate-500">
      {label}
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        className="mt-1 w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm leading-5 text-[#0a1b33] outline-none transition focus:border-[#0f766e]"
      />
    </label>
  );
}

function MiniList({
  rows,
  empty,
}: {
  rows: Array<{ key: string; title: string; detail: string }>;
  empty: string;
}) {
  if (rows.length === 0) {
    return <p className="rounded-lg bg-white px-3 py-2 text-xs text-slate-500">{empty}</p>;
  }
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.key} className="rounded-lg bg-white px-3 py-2">
          <p className="truncate text-sm font-semibold text-[#0a1b33]">{row.title}</p>
          <p className="mt-0.5 truncate text-xs text-slate-500">{row.detail}</p>
        </div>
      ))}
    </div>
  );
}

function knowledgeKindLabel(kind: KnowledgeKind, isPt: boolean) {
  const labels: Record<KnowledgeKind, { pt: string; en: string }> = {
    faq: { pt: "FAQ", en: "FAQ" },
    service: { pt: "Serviço", en: "Service" },
    policy: { pt: "Política", en: "Policy" },
    hours: { pt: "Horários", en: "Hours" },
    document: { pt: "Documento", en: "Document" },
    instruction: { pt: "Instrução", en: "Instruction" },
  };
  return isPt ? labels[kind].pt : labels[kind].en;
}

function followTriggerLabel(trigger: FollowUpTrigger, isPt: boolean) {
  const labels: Record<FollowUpTrigger, { pt: string; en: string }> = {
    no_reply: { pt: "Sem resposta", en: "No reply" },
    appointment_unconfirmed: { pt: "Consulta não confirmada", en: "Appointment unconfirmed" },
    proposal_no_response: { pt: "Proposta sem retorno", en: "Proposal no response" },
    no_show: { pt: "Faltou à consulta", en: "No-show" },
    human_case_pending: { pt: "Caso humano pendente", en: "Human case pending" },
  };
  return isPt ? labels[trigger].pt : labels[trigger].en;
}

function urgencyLabel(urgency: HumanUrgency, isPt: boolean) {
  const labels: Record<HumanUrgency, { pt: string; en: string }> = {
    low: { pt: "Baixa", en: "Low" },
    normal: { pt: "Normal", en: "Normal" },
    high: { pt: "Alta", en: "High" },
    urgent: { pt: "Urgente", en: "Urgent" },
  };
  return isPt ? labels[urgency].pt : labels[urgency].en;
}
