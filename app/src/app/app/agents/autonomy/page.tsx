"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowLeft,
  Bot,
  Check,
  CheckCircle2,
  ExternalLink,
  Loader2,
  MessageSquareText,
  Pause,
  PhoneCall,
  Play,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  UserRoundCheck,
  Users,
  X,
  Zap,
} from "lucide-react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { PageHeader } from "@/components/app/EmptyState";
import { cn } from "@/lib/cn";
import { convexErrorMessage } from "@/lib/convexErrorMessage";
import { useI18n } from "@/lib/i18n";
import { relativeTime } from "@/lib/relativeTime";

type Tab = "decisions" | "routines" | "team";
type TriggerMode = "event" | "schedule" | "both";
type DecisionMode = "suggest" | "approval" | "automatic";
type RoutineAction =
  | "assign_owner"
  | "create_task"
  | "open_human_case"
  | "send_staff_briefing";

const ACTIONS: Array<{
  key: RoutineAction;
  pt: string;
  en: string;
  detailPt: string;
  detailEn: string;
}> = [
  {
    key: "assign_owner",
    pt: "Escolher responsável",
    en: "Choose an owner",
    detailPt: "Usa responsabilidades, presença e carga pendente.",
    detailEn: "Uses responsibilities, presence and pending workload.",
  },
  {
    key: "create_task",
    pt: "Criar tarefa de chamada",
    en: "Create a call task",
    detailPt: "Cria um lembrete devido e auditável.",
    detailEn: "Creates a due, auditable reminder.",
  },
  {
    key: "open_human_case",
    pt: "Passar para a equipa",
    en: "Hand off to the team",
    detailPt: "Pausa a IA e abre um pedido humano com contexto.",
    detailEn: "Pauses AI and opens a human request with context.",
  },
  {
    key: "send_staff_briefing",
    pt: "Enviar briefing interno",
    en: "Send an internal briefing",
    detailPt: "Entrega o resumo no WhatsApp interno configurado.",
    detailEn: "Delivers the summary to the configured internal WhatsApp.",
  },
];

const inputClass =
  "h-10 w-full rounded-lg border border-line bg-surface px-3 text-[13px] text-ink outline-none transition-colors focus:border-[#2b4f8a]";

export default function AutonomyPage() {
  const { locale, tr } = useI18n();
  const tenant = useQuery(api.tenantsQueries.getActiveOptional);
  const routines = useQuery(api.agentRoutines.listRoutines, {});
  const decisions = useQuery(api.agentRoutines.listDecisions, {});
  const team = useQuery(api.teamOperations.list, {});
  const canManage = tenant?.role === "owner" || tenant?.role === "admin";
  const connection = useQuery(
    api.staffNotifications.getConnection,
    canManage ? {} : "skip",
  );
  const deliveries = useQuery(
    api.staffNotifications.listRecent,
    canManage ? {} : "skip",
  );
  const decide = useMutation(api.agentRoutines.decide);
  const createRoutine = useMutation(api.agentRoutines.create);
  const setRoutineStatus = useMutation(api.agentRoutines.setStatus);
  const runNow = useMutation(api.agentRoutines.runNow);
  const [tab, setTab] = useState<Tab>("decisions");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);

  const pendingCount =
    decisions?.filter((item) => item.status === "pending").length ?? 0;
  const tabs = [
    {
      key: "decisions" as const,
      label: tr("Decisões", "Decisions"),
      count: pendingCount,
      icon: Sparkles,
    },
    {
      key: "routines" as const,
      label: tr("Rotinas", "Routines"),
      count: routines?.length ?? 0,
      icon: Zap,
    },
    {
      key: "team" as const,
      label: tr("Equipa e canal interno", "Team & internal channel"),
      icon: Users,
    },
  ];

  async function perform(
    key: string,
    action: () => Promise<unknown>,
    success: string,
  ) {
    setBusy(key);
    setNotice(null);
    try {
      await action();
      setNotice({ tone: "ok", text: success });
    } catch (error) {
      setNotice({ tone: "error", text: convexErrorMessage(error, locale) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        eyebrow={tr("Agentes", "Agents")}
        title={tr("Centro de autonomia", "Autonomy center")}
        description={tr(
          "Decisões pendentes, rotinas ativas e trabalho entregue à equipa.",
          "Pending decisions, active routines and work handed to the team.",
        )}
        action={
          <Link
            href="/app/agents"
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-[13px] font-semibold text-body hover:bg-surface-2"
          >
            <ArrowLeft size={15} />
            {tr("Voltar aos agentes", "Back to agents")}
          </Link>
        }
      />

      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 overflow-y-auto px-4 py-5 sm:px-6 xl:px-8">
        <div className="flex gap-1 overflow-x-auto border-b border-line" role="tablist">
          {tabs.map(({ key, label, count, icon: Icon }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cn(
                "flex h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-[13px] font-semibold",
                tab === key
                  ? "border-[#0d6b61] text-ink"
                  : "border-transparent text-muted hover:text-ink",
              )}
            >
              <Icon size={15} />
              {label}
              {count !== undefined && count > 0 ? (
                <span className="min-w-5 rounded-full bg-surface-3 px-1.5 py-0.5 text-center text-[10px] text-body">
                  {count}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        {notice ? (
          <div
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3 py-2 text-[12px]",
              notice.tone === "ok"
                ? "border-[#0d6b61]/25 bg-chip-success text-chip-success-fg"
                : "border-[#e0533d]/25 bg-chip-danger text-chip-danger-fg",
            )}
          >
            {notice.tone === "ok" ? (
              <CheckCircle2 size={14} />
            ) : (
              <X size={14} />
            )}
            {notice.text}
          </div>
        ) : null}

        {tab === "decisions" ? (
          <DecisionsPanel
            decisions={decisions}
            canAuthorize={canManage}
            busy={busy}
            onDecision={(decisionId, choice) =>
              perform(
                `${choice}:${decisionId}`,
                () => decide({ decisionId, decision: choice }),
                choice === "dismiss"
                  ? tr("Decisão dispensada.", "Decision dismissed.")
                  : choice === "authorize_routine"
                    ? tr(
                        "Rotina autorizada e decisão executada.",
                        "Routine authorized and decision executed.",
                      )
                    : tr("Decisão executada.", "Decision executed."),
              )
            }
          />
        ) : null}
        {tab === "routines" ? (
          <RoutinesPanel
            routines={routines}
            canManage={canManage}
            busy={busy}
            onCreate={(args) =>
              perform(
                "create-routine",
                () => createRoutine(args),
                tr("Rotina criada.", "Routine created."),
              )
            }
            onRun={(routineId) =>
              perform(
                `run:${routineId}`,
                () => runNow({ routineId }),
                tr("Análise colocada na fila.", "Analysis queued."),
              )
            }
            onStatus={(routineId, status) =>
              perform(
                `status:${routineId}`,
                () => setRoutineStatus({ routineId, status }),
                status === "active"
                  ? tr("Rotina ativa.", "Routine active.")
                  : tr("Rotina pausada.", "Routine paused."),
              )
            }
          />
        ) : null}
        {tab === "team" ? (
          <TeamPanel
            team={team}
            connection={connection}
            deliveries={deliveries}
            canManage={canManage}
            busy={busy}
            perform={perform}
          />
        ) : null}
      </div>
    </div>
  );
}

function DecisionsPanel({
  decisions,
  canAuthorize,
  busy,
  onDecision,
}: {
  decisions: ReturnType<
    typeof useQuery<typeof api.agentRoutines.listDecisions>
  >;
  canAuthorize: boolean;
  busy: string | null;
  onDecision: (
    id: Id<"agentDecisions">,
    choice: "approve" | "dismiss" | "authorize_routine",
  ) => void;
}) {
  const { locale, tr } = useI18n();
  if (decisions === undefined) return <Loading />;
  const pending = decisions.filter((item) => item.status === "pending");
  const history = decisions
    .filter((item) => item.status !== "pending")
    .slice(0, 12);

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(280px,0.7fr)]">
      <section className="min-w-0">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-ink">
            {tr("Precisa de decisão", "Needs a decision")}
          </h2>
          <span className="text-[11px] text-muted">
            {pending.length} {tr("pendentes", "pending")}
          </span>
        </div>
        {pending.length === 0 ? (
          <div className="flex min-h-52 items-center justify-center rounded-lg border border-dashed border-line bg-surface text-center">
            <div>
              <CheckCircle2 className="mx-auto text-[#0d6b61]" size={24} />
              <p className="mt-2 text-[13px] font-semibold text-ink">
                {tr("Fila limpa", "Queue clear")}
              </p>
              <p className="mt-1 text-[12px] text-muted">
                {tr(
                  "Nenhuma decisão aguarda aprovação.",
                  "No decision is waiting for approval.",
                )}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {pending.map((decision) => (
              <article
                key={decision._id}
                className="rounded-lg border border-line bg-surface p-4 shadow-[var(--shadow-card)]"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-chip-warn text-chip-warn-fg">
                      <PhoneCall size={16} />
                    </span>
                    <div className="min-w-0">
                      <h3 className="truncate text-[14px] font-semibold text-ink">
                        {decision.title}
                      </h3>
                      <p className="text-[11px] text-muted">
                        {decision.routineName} ·{" "}
                        {relativeTime(decision.createdAt, Date.now(), locale)}
                      </p>
                    </div>
                  </div>
                  <DecisionModeBadge mode={decision.decisionMode} />
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
                      {tr("Evidência", "Evidence")}
                    </p>
                    <ul className="mt-2 space-y-1.5 text-[12px] text-body">
                      {decision.evidence.map((line) => (
                        <li key={line} className="flex gap-2">
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#2b4f8a]" />
                          {line}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
                      {tr("Decisão proposta", "Proposed decision")}
                    </p>
                    <p className="mt-2 text-[12px] leading-5 text-body">
                      {decision.reason}
                    </p>
                    <div className="mt-2 flex items-center gap-2 text-[12px] font-medium text-ink">
                      <UserRoundCheck size={14} className="text-[#0d6b61]" />
                      {decision.assignedMemberName ??
                        tr("Por atribuir", "Unassigned")}
                    </div>
                  </div>
                </div>
                <div className="mt-4 border-t border-line-soft pt-3">
                  <p className="text-[11px] text-muted">
                    <strong className="text-body">
                      {tr("Resultado esperado:", "Expected outcome:")}
                    </strong>{" "}
                    {decision.expectedOutcome}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => onDecision(decision._id, "approve")}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#0d6b61] px-3 text-[12px] font-semibold text-white disabled:opacity-50"
                    >
                      <Check size={14} />
                      {tr("Aprovar esta vez", "Approve once")}
                    </button>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => onDecision(decision._id, "dismiss")}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-[12px] font-semibold text-body disabled:opacity-50"
                    >
                      <X size={14} />
                      {tr("Dispensar", "Dismiss")}
                    </button>
                    {canAuthorize ? (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() =>
                          onDecision(decision._id, "authorize_routine")
                        }
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#2b4f8a]/30 bg-chip-info px-3 text-[12px] font-semibold text-chip-info-fg disabled:opacity-50"
                      >
                        <ShieldCheck size={14} />
                        {tr(
                          "Autorizar esta rotina",
                          "Authorize this routine",
                        )}
                      </button>
                    ) : null}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <aside className="min-w-0 border-t border-line pt-4 xl:border-l xl:border-t-0 xl:pl-5 xl:pt-0">
        <h2 className="text-[15px] font-semibold text-ink">
          {tr("Atividade recente", "Recent activity")}
        </h2>
        <div className="mt-3 divide-y divide-line-soft">
          {history.length === 0 ? (
            <p className="py-6 text-[12px] text-muted">
              {tr(
                "Ainda sem decisões concluídas.",
                "No completed decisions yet.",
              )}
            </p>
          ) : (
            history.map((item) => (
              <div key={item._id} className="py-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-[12px] font-semibold text-ink">
                    {item.title}
                  </p>
                  <DecisionStatus status={item.status} />
                </div>
                <p className="mt-1 text-[11px] text-muted">
                  {item.assignedMemberName ?? item.routineName}
                </p>
              </div>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}

function RoutinesPanel({
  routines,
  canManage,
  busy,
  onCreate,
  onRun,
  onStatus,
}: {
  routines: ReturnType<
    typeof useQuery<typeof api.agentRoutines.listRoutines>
  >;
  canManage: boolean;
  busy: string | null;
  onCreate: (args: {
    name: string;
    objective: "hot_lead_call" | "stale_lead_recovery";
    triggerMode: TriggerMode;
    decisionMode: DecisionMode;
    allowedActions: RoutineAction[];
    staleAfterHours: number;
    intervalMinutes: number;
    maxItemsPerRun: number;
    maxAttemptsPerContact: number;
    workingHoursOnly: boolean;
  }) => void;
  onRun: (id: Id<"agentRoutines">) => void;
  onStatus: (
    id: Id<"agentRoutines">,
    status: "active" | "paused",
  ) => void;
}) {
  const { tr } = useI18n();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState(
    tr(
      "Recuperar oportunidades quentes",
      "Recover hot opportunities",
    ),
  );
  const [objective, setObjective] = useState<
    "hot_lead_call" | "stale_lead_recovery"
  >("hot_lead_call");
  const [triggerMode, setTriggerMode] = useState<TriggerMode>("both");
  const [decisionMode, setDecisionMode] =
    useState<DecisionMode>("suggest");
  const [hours, setHours] = useState(24);
  const [actions, setActions] = useState<RoutineAction[]>(
    ACTIONS.map((item) => item.key),
  );

  if (routines === undefined) return <Loading />;

  function toggleAction(action: RoutineAction) {
    setActions((current) =>
      current.includes(action)
        ? current.filter((item) => item !== action)
        : [...current, action],
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">
            {tr("Rotinas ativas", "Active routines")}
          </h2>
          <p className="mt-0.5 text-[12px] text-muted">
            {tr(
              "Executadas no servidor, mesmo com o app fechado.",
              "Runs on the server, even when the app is closed.",
            )}
          </p>
        </div>
        {canManage ? (
          <button
            type="button"
            onClick={() => setCreating((value) => !value)}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-solid px-4 text-[13px] font-semibold text-white"
          >
            <Plus size={15} />
            {tr("Nova rotina", "New routine")}
          </button>
        ) : null}
      </div>

      {creating ? (
        <section className="border-y border-line bg-surface py-5 sm:rounded-lg sm:border sm:p-5">
          <div className="grid gap-4 lg:grid-cols-3">
            <label className="text-[11px] font-medium text-muted lg:col-span-2">
              {tr("Nome", "Name")}
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className={cn(inputClass, "mt-1")}
              />
            </label>
            <label className="text-[11px] font-medium text-muted">
              {tr("Objetivo", "Objective")}
              <select
                value={objective}
                onChange={(event) =>
                  setObjective(event.target.value as typeof objective)
                }
                className={cn(inputClass, "mt-1")}
              >
                <option value="hot_lead_call">
                  {tr("Ligar para lead quente", "Call a hot lead")}
                </option>
                <option value="stale_lead_recovery">
                  {tr(
                    "Recuperar oportunidade parada",
                    "Recover a stalled opportunity",
                  )}
                </option>
              </select>
            </label>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <fieldset>
              <legend className="text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">
                {tr("Quando trabalha", "When it works")}
              </legend>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {(["event", "schedule", "both"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setTriggerMode(mode)}
                    className={cn(
                      "min-h-16 rounded-lg border px-2 text-[12px] font-semibold",
                      triggerMode === mode
                        ? "border-[#2b4f8a] bg-chip-info text-chip-info-fg"
                        : "border-line text-body",
                    )}
                  >
                    <span className="block">
                      {mode === "event"
                        ? tr("Ao receber", "On event")
                        : mode === "schedule"
                          ? tr("Por horário", "Scheduled")
                          : tr("Ambos", "Both")}
                    </span>
                    <span className="mt-1 block text-[10px] font-normal opacity-75">
                      {mode === "event"
                        ? "WhatsApp"
                        : mode === "schedule"
                          ? tr("Verificação periódica", "Periodic check")
                          : tr(
                              "Imediato + periódico",
                              "Immediate + periodic",
                            )}
                    </span>
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">
                {tr("Como decide", "How it decides")}
              </legend>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {(["suggest", "approval", "automatic"] as const).map(
                  (mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setDecisionMode(mode)}
                      className={cn(
                        "min-h-16 rounded-lg border px-2 text-[12px] font-semibold",
                        decisionMode === mode
                          ? "border-[#0d6b61] bg-chip-success text-chip-success-fg"
                          : "border-line text-body",
                      )}
                    >
                      <span className="block">
                        {mode === "suggest"
                          ? tr("Sugerir", "Suggest")
                          : mode === "approval"
                            ? tr("Pedir aprovação", "Ask approval")
                            : tr("Executar", "Execute")}
                      </span>
                      <span className="mt-1 block text-[10px] font-normal opacity-75">
                        {mode === "automatic"
                          ? tr("Dentro dos limites", "Within limits")
                          : tr("Fila de decisões", "Decision queue")}
                      </span>
                    </button>
                  ),
                )}
              </div>
            </fieldset>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-[220px_1fr]">
            <label className="text-[11px] font-medium text-muted">
              {tr("Sem avanço por", "No progress for")}
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={720}
                  value={hours}
                  onChange={(event) => setHours(Number(event.target.value))}
                  className={inputClass}
                />
                <span className="text-[12px] text-muted">
                  {tr("horas", "hours")}
                </span>
              </div>
            </label>
            <fieldset>
              <legend className="text-[11px] font-medium text-muted">
                {tr("Ações permitidas", "Allowed actions")}
              </legend>
              <div className="mt-1 grid gap-2 sm:grid-cols-2">
                {ACTIONS.map((action) => (
                  <label
                    key={action.key}
                    className={cn(
                      "flex cursor-pointer gap-2 rounded-lg border p-3",
                      actions.includes(action.key)
                        ? "border-[#0d6b61]/40 bg-chip-success"
                        : "border-line bg-surface",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={actions.includes(action.key)}
                      onChange={() => toggleAction(action.key)}
                      className="mt-0.5 h-4 w-4 accent-[#0d6b61]"
                    />
                    <span>
                      <span className="block text-[12px] font-semibold text-ink">
                        {tr(action.pt, action.en)}
                      </span>
                      <span className="mt-0.5 block text-[10px] leading-4 text-muted">
                        {tr(action.detailPt, action.detailEn)}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="h-9 rounded-lg border border-line px-3 text-[12px] font-semibold text-body"
            >
              {tr("Cancelar", "Cancel")}
            </button>
            <button
              type="button"
              disabled={
                busy !== null ||
                name.trim().length < 2 ||
                actions.length === 0
              }
              onClick={() => {
                onCreate({
                  name,
                  objective,
                  triggerMode,
                  decisionMode,
                  allowedActions: actions,
                  staleAfterHours: hours,
                  intervalMinutes: 60,
                  maxItemsPerRun: 10,
                  maxAttemptsPerContact: 3,
                  workingHoursOnly: false,
                });
                setCreating(false);
              }}
              className="h-9 rounded-lg bg-brand-solid px-4 text-[12px] font-semibold text-white disabled:opacity-50"
            >
              {tr("Criar rotina", "Create routine")}
            </button>
          </div>
        </section>
      ) : null}

      <div className="divide-y divide-line rounded-lg border border-line bg-surface">
        {routines.length === 0 ? (
          <div className="py-16 text-center">
            <Bot className="mx-auto text-faint" size={24} />
            <p className="mt-2 text-[13px] font-semibold text-ink">
              {tr("Ainda sem rotinas", "No routines yet")}
            </p>
          </div>
        ) : (
          routines.map((routine) => (
            <div
              key={routine._id}
              className="flex flex-col gap-3 p-4 md:flex-row md:items-center"
            >
              <span
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                  routine.status === "active"
                    ? "bg-chip-success text-chip-success-fg"
                    : "bg-surface-3 text-muted",
                )}
              >
                <Zap size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[13px] font-semibold text-ink">
                    {routine.name}
                  </h3>
                  <DecisionModeBadge mode={routine.decisionMode} />
                </div>
                <p className="mt-1 text-[11px] text-muted">
                  {routine.triggerMode === "event"
                    ? tr("Ao receber eventos", "On events")
                    : routine.triggerMode === "schedule"
                      ? tr("A cada hora", "Every hour")
                      : tr("Eventos + a cada hora", "Events + hourly")}
                  {" · "}
                  {tr("limite", "limit")} {routine.maxItemsPerRun}
                  {" · "}
                  {tr("máx.", "max.")} {routine.maxAttemptsPerContact}/
                  {tr("contacto", "contact")}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy !== null || routine.status !== "active"}
                  onClick={() => onRun(routine._id)}
                  title={tr("Analisar agora", "Analyze now")}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line text-body disabled:opacity-40"
                >
                  <RefreshCw size={14} />
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    onStatus(
                      routine._id,
                      routine.status === "active" ? "paused" : "active",
                    )
                  }
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-[12px] font-semibold text-body"
                >
                  {routine.status === "active" ? (
                    <Pause size={13} />
                  ) : (
                    <Play size={13} />
                  )}
                  {routine.status === "active"
                    ? tr("Pausar", "Pause")
                    : tr("Ativar", "Activate")}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function TeamPanel({
  team,
  connection,
  deliveries,
  canManage,
  busy,
  perform,
}: {
  team: ReturnType<typeof useQuery<typeof api.teamOperations.list>>;
  connection: ReturnType<
    typeof useQuery<typeof api.staffNotifications.getConnection>
  >;
  deliveries: ReturnType<
    typeof useQuery<typeof api.staffNotifications.listRecent>
  >;
  canManage: boolean;
  busy: string | null;
  perform: (
    key: string,
    action: () => Promise<unknown>,
    success: string,
  ) => Promise<void>;
}) {
  const { tr } = useI18n();
  const saveProfile = useMutation(api.teamOperations.save);
  const saveConnection = useMutation(api.staffNotifications.saveConnection);
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!connection) return;
    setBaseUrl(connection.baseUrl);
    setActive(connection.active);
  }, [connection]);

  if (team === undefined) return <Loading />;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.75fr)]">
      <section>
        <div className="mb-3">
          <h2 className="text-[15px] font-semibold text-ink">
            {tr("Quem recebe o trabalho", "Who receives the work")}
          </h2>
          <p className="mt-0.5 text-[12px] text-muted">
            {tr(
              "Responsabilidades e prioridade usadas na atribuição automática.",
              "Responsibilities and priority used for automatic assignment.",
            )}
          </p>
        </div>
        <div className="divide-y divide-line rounded-lg border border-line bg-surface">
          {team.map((member) => (
            <TeamMemberRow
              key={member.memberId}
              member={member}
              canManage={canManage}
              busy={busy}
              onSave={(args) =>
                perform(
                  `member:${member.memberId}`,
                  () => saveProfile(args),
                  tr(
                    "Responsabilidades guardadas.",
                    "Responsibilities saved.",
                  ),
                )
              }
            />
          ))}
        </div>
      </section>

      <aside className="space-y-5">
        <section className="rounded-lg border border-line bg-surface p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-[14px] font-semibold text-ink">
                <MessageSquareText size={16} />
                {tr("WhatsApp interno", "Internal WhatsApp")}
              </h2>
              <p className="mt-1 text-[11px] leading-4 text-muted">
                {tr(
                  "UAZAPI envia briefings apenas para membros da equipa.",
                  "UAZAPI sends briefings only to team members.",
                )}
              </p>
            </div>
            {connection ? (
              <span
                className={cn(
                  "rounded-md px-2 py-1 text-[10px] font-semibold",
                  connection.active && !connection.pausedAt
                    ? "bg-chip-success text-chip-success-fg"
                    : "bg-chip-warn text-chip-warn-fg",
                )}
              >
                {connection.active && !connection.pausedAt
                  ? tr("Ativo", "Active")
                  : tr("Pausado", "Paused")}
              </span>
            ) : null}
          </div>

          {canManage ? (
            <div className="mt-4 space-y-3">
              <label className="block text-[11px] font-medium text-muted">
                Endpoint
                <input
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder="https://sua-instancia.uazapi.com"
                  className={cn(inputClass, "mt-1")}
                />
              </label>
              <label className="block text-[11px] font-medium text-muted">
                Token
                <input
                  type="password"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder={
                    connection
                      ? `${tr("Guardado", "Saved")} ····${connection.tokenLast4}`
                      : tr("Token da instância", "Instance token")
                  }
                  className={cn(inputClass, "mt-1")}
                  autoComplete="new-password"
                />
              </label>
              <label className="flex items-center gap-2 text-[12px] font-medium text-ink">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(event) => setActive(event.target.checked)}
                  className="h-4 w-4 accent-[#0d6b61]"
                />
                {tr(
                  "Permitir briefings internos",
                  "Allow internal briefings",
                )}
              </label>
              <button
                type="button"
                disabled={busy !== null || !baseUrl.trim()}
                onClick={() =>
                  void perform(
                    "save-connection",
                    () =>
                      saveConnection({
                        baseUrl,
                        token: token.trim() || undefined,
                        active,
                      }),
                    tr(
                      "Canal interno guardado.",
                      "Internal channel saved.",
                    ),
                  ).then(() => setToken(""))
                }
                className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-brand-solid px-3 text-[12px] font-semibold text-white disabled:opacity-50"
              >
                <Save size={14} />
                {tr("Guardar ligação", "Save connection")}
              </button>
            </div>
          ) : (
            <p className="mt-4 text-[12px] text-muted">
              {tr(
                "Apenas proprietários e administradores podem alterar esta ligação.",
                "Only owners and administrators can change this connection.",
              )}
            </p>
          )}
          <a
            href="https://docs.uazapi.com/"
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-chip-info-fg"
          >
            {tr(
              "Documentação do provedor",
              "Provider documentation",
            )}
            <ExternalLink size={11} />
          </a>
        </section>

        {canManage ? (
          <section>
            <h2 className="text-[13px] font-semibold text-ink">
              {tr("Entregas recentes", "Recent deliveries")}
            </h2>
            <div className="mt-2 divide-y divide-line-soft rounded-lg border border-line bg-surface px-3">
              {deliveries === undefined ? (
                <Loading compact />
              ) : deliveries.length === 0 ? (
                <p className="py-5 text-[11px] text-muted">
                  {tr(
                    "Ainda sem briefings enviados.",
                    "No briefings sent yet.",
                  )}
                </p>
              ) : (
                deliveries.slice(0, 8).map((delivery) => (
                  <div
                    key={delivery._id}
                    className="flex items-center justify-between gap-2 py-2.5"
                  >
                    <span className="text-[11px] text-body">
                      {tr("Briefing de chamada", "Call briefing")} ·{" "}
                      {delivery.attempts}{" "}
                      {tr("tentativa(s)", "attempt(s)")}
                    </span>
                    <DecisionStatus status={delivery.status} />
                  </div>
                ))
              )}
            </div>
          </section>
        ) : null}
      </aside>
    </div>
  );
}

type TeamMember = NonNullable<
  ReturnType<typeof useQuery<typeof api.teamOperations.list>>
>[number];
type Responsibility = TeamMember["responsibilities"][number];

function TeamMemberRow({
  member,
  canManage,
  busy,
  onSave,
}: {
  member: TeamMember;
  canManage: boolean;
  busy: string | null;
  onSave: (args: {
    memberId: Id<"members">;
    phoneE164?: string;
    responsibilities: Responsibility[];
    receivesWhatsappBriefings: boolean;
    priority: number;
    active: boolean;
  }) => void;
}) {
  const { tr } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [phone, setPhone] = useState("");
  const [receives, setReceives] = useState(
    member.receivesWhatsappBriefings,
  );
  const [priority, setPriority] = useState(member.priority);
  const [responsibilities, setResponsibilities] = useState<
    Responsibility[]
  >(member.responsibilities);
  const choices: Array<[Responsibility, string]> = [
    ["sales_calls", tr("Vendas e propostas", "Sales and proposals")],
    ["support_calls", tr("Suporte", "Support")],
    ["appointment_calls", tr("Compromissos", "Appointments")],
    ["follow_up_calls", "Follow-up"],
    ["owner_updates", tr("Resumo ao responsável", "Owner summary")],
  ];

  function toggleResponsibility(key: Responsibility) {
    setResponsibilities((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    );
  }

  return (
    <div className="p-4">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-3 text-left"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[12px] font-semibold text-body">
          {(member.name ?? member.email ?? "?").slice(0, 2).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-ink">
            {member.name ?? member.email}
          </span>
          <span className="block truncate text-[11px] text-muted">
            {member.responsibilities.length
              ? choices
                  .filter(([key]) =>
                    member.responsibilities.includes(key),
                  )
                  .map(([, label]) => label)
                  .join(" · ")
              : tr(
                  "Sem responsabilidade operacional",
                  "No operational responsibility",
                )}
          </span>
        </span>
        {member.receivesWhatsappBriefings ? (
          <span className="rounded-md bg-chip-success px-2 py-1 text-[10px] font-semibold text-chip-success-fg">
            WhatsApp
          </span>
        ) : null}
        <span className="text-[11px] text-faint">#{member.priority}</span>
      </button>

      {expanded ? (
        <div className="mt-4 border-t border-line-soft pt-4">
          <div className="grid gap-2 sm:grid-cols-2">
            {choices.map(([key, label]) => (
              <label
                key={key}
                className="flex items-center gap-2 text-[12px] text-body"
              >
                <input
                  type="checkbox"
                  checked={responsibilities.includes(key)}
                  disabled={!canManage}
                  onChange={() => toggleResponsibility(key)}
                  className="h-4 w-4 accent-[#0d6b61]"
                />
                {label}
              </label>
            ))}
          </div>
          {canManage ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_100px_auto]">
              <label className="text-[10px] font-medium text-muted">
                {tr("Número para briefing", "Briefing number")}
                <input
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder={member.phoneMasked ?? "+258..."}
                  className={cn(inputClass, "mt-1")}
                />
              </label>
              <label className="text-[10px] font-medium text-muted">
                {tr("Prioridade", "Priority")}
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={priority}
                  onChange={(event) =>
                    setPriority(Number(event.target.value))
                  }
                  className={cn(inputClass, "mt-1")}
                />
              </label>
              <div className="flex items-end">
                <button
                  type="button"
                  disabled={
                    busy !== null ||
                    (receives && !member.phoneConfigured && !phone.trim())
                  }
                  onClick={() =>
                    onSave({
                      memberId: member.memberId,
                      phoneE164: phone.trim() || undefined,
                      responsibilities,
                      receivesWhatsappBriefings: receives,
                      priority,
                      active: member.active,
                    })
                  }
                  className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-brand-solid px-3 text-[12px] font-semibold text-white disabled:opacity-50"
                >
                  <Save size={13} />
                  {tr("Guardar", "Save")}
                </button>
              </div>
            </div>
          ) : null}
          <label className="mt-3 flex items-center gap-2 text-[12px] font-medium text-ink">
            <input
              type="checkbox"
              checked={receives}
              disabled={!canManage}
              onChange={(event) => setReceives(event.target.checked)}
              className="h-4 w-4 accent-[#0d6b61]"
            />
            {tr(
              "Receber briefings internos no WhatsApp",
              "Receive internal WhatsApp briefings",
            )}
          </label>
        </div>
      ) : null}
    </div>
  );
}

function DecisionStatus({ status }: { status: string }) {
  const { tr } = useI18n();
  const label =
    status === "completed" || status === "delivered"
      ? tr("Concluído", "Completed")
      : status === "cancelled" || status === "dismissed"
        ? tr("Encerrado", "Closed")
        : status === "dead" || status === "failed"
          ? tr("Falhou", "Failed")
          : status === "pending" || status === "claimed"
            ? tr("Pendente", "Pending")
            : status;
  return (
    <span
      className={cn(
        "shrink-0 rounded-md px-2 py-0.5 text-[9px] font-semibold",
        status === "completed" || status === "delivered"
          ? "bg-chip-success text-chip-success-fg"
          : status === "dead" || status === "failed"
            ? "bg-chip-danger text-chip-danger-fg"
            : "bg-surface-3 text-muted",
      )}
    >
      {label}
    </span>
  );
}

function DecisionModeBadge({ mode }: { mode: string }) {
  const { tr } = useI18n();
  return (
    <span
      className={cn(
        "rounded-md px-2 py-0.5 text-[9px] font-semibold",
        mode === "automatic"
          ? "bg-chip-success text-chip-success-fg"
          : mode === "approval"
            ? "bg-chip-warn text-chip-warn-fg"
            : "bg-chip-info text-chip-info-fg",
      )}
    >
      {mode === "automatic"
        ? tr("Automática", "Automatic")
        : mode === "approval"
          ? tr("Aprovação", "Approval")
          : tr("Sugestão", "Suggestion")}
    </span>
  );
}

function Loading({ compact = false }: { compact?: boolean }) {
  const { tr } = useI18n();
  return (
    <div
      className={cn(
        "flex items-center gap-2 text-[12px] text-muted",
        compact ? "py-4" : "py-12",
      )}
    >
      <Loader2 size={14} className="animate-spin" />
      {tr("A carregar…", "Loading…")}
    </div>
  );
}

