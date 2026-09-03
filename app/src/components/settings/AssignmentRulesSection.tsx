"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Loader2, Plus, Route, Trash2 } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { LEAD_STATUSES } from "@/components/leads/leadStatuses";
import { leadStatusLabel } from "@/components/campaigns/campaignLabels";
import { cn } from "@/lib/cn";
import { convexErrorMessage } from "@/lib/convexErrorMessage";
import { useI18n } from "@/lib/i18n";

const inputClass = "mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-[#0a1b33] outline-none focus:border-slate-400";

export function AssignmentRulesSection() {
  const { locale, tr } = useI18n();
  const rules = useQuery(api.assignmentRules.list, {});
  const teams = useQuery(api.teams.list, {});
  const channels = useQuery(api.channels.list);
  const save = useMutation(api.assignmentRules.save);
  const remove = useMutation(api.assignmentRules.remove);
  const productChannels = useMemo(() => (channels ?? []).filter((c) => c.provider === "iasolution_hub" && c.operationalTerritory === "openbsp"), [channels]);
  const [editing, setEditing] = useState<{
    ruleId?: Id<"assignmentRules">;
    name: string;
    teamId: Id<"teams"> | "";
    channelId: Id<"channels"> | "";
    strategy: "round_robin" | "least_open";
    onlyOnline: boolean;
    leadStatuses: string[];
    active: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!editing || !editing.teamId) return;
    setBusy(true);
    setError(null);
    try {
      await save({
        ruleId: editing.ruleId,
        name: editing.name,
        teamId: editing.teamId,
        channelId: editing.channelId || undefined,
        strategy: editing.strategy,
        onlyOnline: editing.onlyOnline,
        leadStatuses: editing.leadStatuses.length > 0 ? editing.leadStatuses : undefined,
        active: editing.active,
      });
      setEditing(null);
    } catch (err) {
      setError(convexErrorMessage(err, locale));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-col gap-3 border-b border-slate-100 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Route size={16} className="text-[#0a1b33]" />
          <div>
            <h2 className="text-[15px] font-semibold text-[#0a1b33]">{tr("Atribuição automática", "Automatic assignment")}</h2>
            <p className="text-xs text-slate-500">{tr("Novas conversas recebem um responsável da equipa: rotativo ou quem tem menos conversas abertas.", "New conversations get an owner from the team: round-robin or whoever has fewer open conversations.")}</p>
          </div>
        </div>
        <button
          type="button"
          disabled={(teams ?? []).length === 0}
          onClick={() => setEditing({ name: "", teamId: (teams?.[0]?._id ?? "") as Id<"teams"> | "", channelId: "", strategy: "round_robin", onlyOnline: true, leadStatuses: [], active: true })}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-[12px] font-semibold text-[#0a1b33] disabled:opacity-50"
        >
          <Plus size={14} /> {tr("Nova regra", "New rule")}
        </button>
      </div>
      <div className="p-6">
        {error && <p className="mb-3 rounded-lg border border-[#e0533d]/30 bg-[#fdf1ef] px-3 py-2 text-[12px] text-[#b3261e]">{error}</p>}
        {(teams ?? []).length === 0 && <p className="text-[13px] text-slate-500">{tr("Crie uma equipa primeiro.", "Create a team first.")}</p>}
        {rules === undefined ? (
          <Loader2 size={15} className="animate-spin text-slate-300" />
        ) : rules.length === 0 ? (
          (teams ?? []).length > 0 && !editing && <p className="text-[13px] text-slate-500">{tr("Sem regras: as conversas ficam por atribuir até alguém as assumir.", "No rules: conversations stay unassigned until someone takes them.")}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rules.map((rule) => (
              <li key={rule._id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-[13px] font-semibold text-[#0a1b33]">
                    <span className={cn("h-2 w-2 rounded-full", rule.active ? "bg-[#0d6b61]" : "bg-slate-300")} />
                    <span className="truncate">{rule.name}</span>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {rule.teamName} · {rule.strategy === "round_robin" ? tr("rotativo", "round-robin") : tr("menos abertas", "fewest open")}{rule.onlyOnline ? ` · ${tr("só online", "online only")}` : ""}{rule.leadStatuses?.length ? ` · ${rule.leadStatuses.map((s) => leadStatusLabel(s, locale)).join(", ")}` : ""} · {rule.assignedCount} {tr("atribuídas", "assigned")}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <button type="button" onClick={() => setEditing({ ruleId: rule._id, name: rule.name, teamId: rule.teamId, channelId: rule.channelId ?? "", strategy: rule.strategy, onlyOnline: rule.onlyOnline, leadStatuses: rule.leadStatuses ?? [], active: rule.active })} className="h-8 rounded-md border border-slate-200 px-2 text-[11px] font-semibold text-slate-600">{tr("Editar", "Edit")}</button>
                  <button type="button" onClick={() => { if (window.confirm(tr("Remover esta regra?", "Remove this rule?"))) void remove({ ruleId: rule._id }); }} className="inline-flex h-8 items-center rounded-md border border-slate-200 px-2 text-[11px] font-semibold text-slate-500 hover:text-[#b3261e]"><Trash2 size={12} /></button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {editing && (
          <div className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <label className="block text-[11px] font-medium text-slate-500">{tr("Nome", "Name")}<input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className={inputClass} maxLength={80} /></label>
              <label className="block text-[11px] font-medium text-slate-500">{tr("Equipa", "Team")}
                <select value={editing.teamId} onChange={(e) => setEditing({ ...editing, teamId: e.target.value as Id<"teams"> })} className={inputClass}>
                  {(teams ?? []).map((team) => <option key={team._id} value={team._id}>{team.name}</option>)}
                </select>
              </label>
              <label className="block text-[11px] font-medium text-slate-500">{tr("Canal", "Channel")}
                <select value={editing.channelId} onChange={(e) => setEditing({ ...editing, channelId: e.target.value as Id<"channels"> | "" })} className={inputClass}>
                  <option value="">{tr("Todos", "All")}</option>
                  {productChannels.map((c) => <option key={c._id} value={c._id}>{c.displayName}</option>)}
                </select>
              </label>
              <label className="block text-[11px] font-medium text-slate-500">{tr("Estratégia", "Strategy")}
                <select value={editing.strategy} onChange={(e) => setEditing({ ...editing, strategy: e.target.value as "round_robin" | "least_open" })} className={inputClass}>
                  <option value="round_robin">{tr("Rotativo", "Round-robin")}</option>
                  <option value="least_open">{tr("Menos conversas abertas", "Fewest open conversations")}</option>
                </select>
              </label>
            </div>
            <div className="text-[11px] font-medium text-slate-500">
              {tr("Só para etapas (opcional)", "Only for stages (optional)")}
              <div className="mt-2 flex flex-wrap gap-1">
                {LEAD_STATUSES.map((status) => {
                  const on = editing.leadStatuses.includes(status);
                  return <button key={status} type="button" onClick={() => setEditing({ ...editing, leadStatuses: on ? editing.leadStatuses.filter((s) => s !== status) : [...editing.leadStatuses, status] })} className={cn("rounded-full border px-2.5 py-1 text-[11px] font-semibold", on ? "border-[#0a1b33] bg-[#0a1b33] text-white" : "border-slate-200 bg-white text-slate-600")}>{leadStatusLabel(status, locale)}</button>;
                })}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-[13px] text-[#0a1b33]">
              <label className="flex items-center gap-2"><input type="checkbox" checked={editing.onlyOnline} onChange={(e) => setEditing({ ...editing, onlyOnline: e.target.checked })} className="h-4 w-4 accent-[#0a1b33]" />{tr("Só membros online", "Online members only")}</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} className="h-4 w-4 accent-[#0a1b33]" />{tr("Ativa", "Active")}</label>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)} className="h-9 rounded-lg border border-slate-200 px-3 text-[12px] font-semibold text-slate-600">{tr("Cancelar", "Cancel")}</button>
              <button type="button" disabled={busy || editing.name.trim().length < 2 || !editing.teamId} onClick={() => void submit()} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#0a1b33] px-3 text-[12px] font-semibold text-white disabled:opacity-50">{busy && <Loader2 size={12} className="animate-spin" />} {tr("Guardar", "Save")}</button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
