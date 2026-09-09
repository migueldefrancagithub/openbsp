"use client";

import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { ChevronLeft, ChevronRight, Loader2, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { CrmStage } from "@/components/leads/leadStatuses";
import { convexErrorMessage } from "@/lib/convexErrorMessage";
import { useI18n, type TranslationKey } from "@/lib/i18n";

const NEW_STAGE = {
  name: "",
  color: "#356fc3",
  category: "open" as const,
  requireNextStep: false,
  pauseAi: false,
};

type FormState = typeof NEW_STAGE | {
  name: string;
  color: string;
  category: "open" | "won" | "lost";
  requireNextStep: boolean;
  pauseAi: boolean;
};

function stageLabel(stage: CrmStage, t: (key: TranslationKey) => string) {
  return stage.useSystemLabel && stage.legacyStatus
    ? t(`status.${stage.legacyStatus}` as TranslationKey)
    : stage.name;
}

export function StageManager({ pipelineId, stages }: { pipelineId: Id<"crmPipelines">; stages: CrmStage[] }) {
  const { locale, tr, t } = useI18n();
  const createStage = useMutation(api.crmPipelines.createStage);
  const updateStage = useMutation(api.crmPipelines.updateStage);
  const reorderStages = useMutation(api.crmPipelines.reorderStages);
  const archiveStage = useMutation(api.crmPipelines.archiveStage);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<FormState>(NEW_STAGE);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [targetId, setTargetId] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (deleteId && !stages.some((stage) => stage._id === deleteId)) setDeleteId(null);
  }, [deleteId, stages]);

  function beginEdit(stage: CrmStage) {
    setEditing(stage._id);
    setForm({
      name: stageLabel(stage, t),
      color: stage.color,
      category: stage.rules.category,
      requireNextStep: stage.rules.requireNextStep,
      pauseAi: stage.rules.pauseAi,
    });
    setError(null);
  }

  async function save() {
    if (!editing) return;
    setBusy("save");
    setError(null);
    try {
      const rules = { category: form.category, requireNextStep: form.requireNextStep, pauseAi: form.pauseAi };
      if (editing === "new") {
        await createStage({ pipelineId, name: form.name, color: form.color, rules });
      } else {
        await updateStage({ stageId: editing as Id<"crmStages">, name: form.name, color: form.color, rules });
      }
      setEditing(null);
      setForm(NEW_STAGE);
    } catch (cause) {
      setError(convexErrorMessage(cause, locale));
    } finally {
      setBusy(null);
    }
  }

  async function move(stageId: string, delta: number) {
    const index = stages.findIndex((stage) => stage._id === stageId);
    const nextIndex = index + delta;
    if (index < 0 || nextIndex < 0 || nextIndex >= stages.length) return;
    const ids = stages.map((stage) => stage._id);
    [ids[index], ids[nextIndex]] = [ids[nextIndex], ids[index]];
    setBusy(`move:${stageId}`);
    setError(null);
    try {
      await reorderStages({ pipelineId, stageIds: ids as Id<"crmStages">[] });
    } catch (cause) {
      setError(convexErrorMessage(cause, locale));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!deleteId || !targetId) return;
    setBusy("delete");
    setError(null);
    try {
      await archiveStage({ stageId: deleteId as Id<"crmStages">, targetStageId: targetId as Id<"crmStages"> });
      setDeleteId(null);
      setTargetId("");
    } catch (cause) {
      setError(convexErrorMessage(cause, locale));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-8 sm:px-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-semibold text-ink">{tr("Etapas do funil", "Pipeline stages")}</h2>
          <p className="mt-0.5 text-[12px] text-muted">
            {tr("Defina a ordem, aparência e regras. Ao eliminar, escolha para onde mover os leads.", "Set order, appearance and rules. When removing a stage, choose where its leads move.")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setEditing("new"); setForm(NEW_STAGE); setError(null); }}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand-solid px-3 text-[12px] font-semibold text-white"
        >
          <Plus size={14} /> {tr("Nova etapa", "New stage")}
        </button>
      </div>

      {error && <div className="mb-3 rounded-lg border border-[#f5c2b8] bg-chip-danger px-3 py-2 text-[12px] text-chip-danger-fg">{error}</div>}

      {editing === "new" && (
        <StageForm form={form} setForm={setForm} onSave={() => void save()} onCancel={() => setEditing(null)} busy={busy === "save"} />
      )}

      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        {stages.map((stage, index) => (
          <div key={stage._id} className="border-b border-line-soft last:border-b-0">
            {editing === stage._id ? (
              <StageForm form={form} setForm={setForm} onSave={() => void save()} onCancel={() => setEditing(null)} busy={busy === "save"} />
            ) : (
              <div className="grid items-center gap-3 px-3 py-3 sm:grid-cols-[minmax(180px,1fr)_130px_minmax(220px,1.2fr)_auto]">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: stage.color }} />
                  <span className="truncate text-[13px] font-semibold text-ink">{stageLabel(stage, t)}</span>
                </div>
                <span className="text-[11px] font-medium uppercase text-faint">
                  {stage.rules.category === "open" ? tr("Em aberto", "Open") : stage.rules.category === "won" ? tr("Ganho", "Won") : tr("Perdido", "Lost")}
                </span>
                <div className="flex flex-wrap gap-1.5 text-[10px] text-body">
                  {stage.rules.requireNextStep && <span className="rounded bg-chip-info px-2 py-0.5">{tr("Exige próximo passo", "Requires next step")}</span>}
                  {stage.rules.pauseAi && <span className="rounded bg-chip-warn px-2 py-0.5">{tr("Pausa IA", "Pauses AI")}</span>}
                  {!stage.rules.requireNextStep && !stage.rules.pauseAi && <span className="text-faint">{tr("Sem regras adicionais", "No extra rules")}</span>}
                </div>
                <div className="flex items-center justify-end gap-1">
                  <button type="button" title={tr("Mover para a esquerda", "Move left")} disabled={index === 0 || busy !== null} onClick={() => void move(stage._id, -1)} className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-2 disabled:opacity-30"><ChevronLeft size={15} /></button>
                  <button type="button" title={tr("Mover para a direita", "Move right")} disabled={index === stages.length - 1 || busy !== null} onClick={() => void move(stage._id, 1)} className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-2 disabled:opacity-30"><ChevronRight size={15} /></button>
                  <button type="button" title={tr("Editar etapa", "Edit stage")} disabled={busy !== null} onClick={() => beginEdit(stage)} className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-2"><Pencil size={14} /></button>
                  <button type="button" title={tr("Eliminar etapa", "Remove stage")} disabled={stages.length < 2 || busy !== null} onClick={() => { setDeleteId(stage._id); setTargetId(stages.find((item) => item._id !== stage._id)?._id ?? ""); }} className="grid h-8 w-8 place-items-center rounded-md text-chip-danger-fg hover:bg-chip-danger disabled:opacity-30"><Trash2 size={14} /></button>
                </div>
              </div>
            )}
            {deleteId === stage._id && (
              <div className="flex flex-wrap items-center gap-2 border-t border-line-soft bg-chip-danger px-3 py-2.5 text-[12px]">
                <span className="font-semibold text-chip-danger-fg">{tr("Mover os leads desta etapa para", "Move leads from this stage to")}</span>
                <select value={targetId} onChange={(event) => setTargetId(event.target.value)} className="h-8 rounded-md border border-line bg-surface px-2 text-ink">
                  {stages.filter((item) => item._id !== stage._id).map((item) => <option key={item._id} value={item._id}>{stageLabel(item, t)}</option>)}
                </select>
                <button type="button" onClick={() => void remove()} disabled={busy !== null} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#b3261e] px-3 font-semibold text-white">{busy === "delete" && <Loader2 size={12} className="animate-spin" />}{tr("Confirmar", "Confirm")}</button>
                <button type="button" onClick={() => setDeleteId(null)} className="h-8 px-2 font-semibold text-muted">{tr("Cancelar", "Cancel")}</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function StageForm({ form, setForm, onSave, onCancel, busy }: { form: FormState; setForm: (next: FormState) => void; onSave: () => void; onCancel: () => void; busy: boolean }) {
  const { tr } = useI18n();
  return (
    <div className="mb-3 grid gap-3 rounded-lg border border-brand-solid/25 bg-surface p-3 sm:grid-cols-[minmax(180px,1fr)_120px_150px_auto] sm:items-end">
      <label className="text-[11px] font-semibold text-body">
        {tr("Nome", "Name")}
        <div className="mt-1 flex gap-2">
          <input type="color" value={form.color} onChange={(event) => setForm({ ...form, color: event.target.value })} className="h-9 w-10 rounded-md border border-line bg-surface p-1" aria-label={tr("Cor", "Color")} />
          <input autoFocus aria-label={tr("Nome da etapa", "Stage name")} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="h-9 min-w-0 flex-1 rounded-md border border-line bg-surface px-3 text-[13px] text-ink outline-none focus:border-brand-solid" />
        </div>
      </label>
      <label className="text-[11px] font-semibold text-body">
        {tr("Resultado", "Outcome")}
        <select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value as FormState["category"] })} className="mt-1 h-9 w-full rounded-md border border-line bg-surface px-2 text-[12px] text-ink">
          <option value="open">{tr("Em aberto", "Open")}</option><option value="won">{tr("Ganho", "Won")}</option><option value="lost">{tr("Perdido", "Lost")}</option>
        </select>
      </label>
      <div className="space-y-1.5 pb-0.5 text-[11px] text-body">
        <label className="flex items-center gap-2"><input type="checkbox" checked={form.requireNextStep} onChange={(event) => setForm({ ...form, requireNextStep: event.target.checked })} /> {tr("Exigir próximo passo", "Require next step")}</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={form.pauseAi} onChange={(event) => setForm({ ...form, pauseAi: event.target.checked })} /> {tr("Pausar IA", "Pause AI")}</label>
      </div>
      <div className="flex justify-end gap-1">
        <button type="button" onClick={onCancel} className="grid h-9 w-9 place-items-center rounded-md text-muted hover:bg-surface-2" title={tr("Cancelar", "Cancel")}><X size={15} /></button>
        <button type="button" disabled={busy || form.name.trim().length < 2} onClick={onSave} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-brand-solid px-3 text-[12px] font-semibold text-white disabled:opacity-50">{busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}{tr("Guardar", "Save")}</button>
      </div>
    </div>
  );
}
