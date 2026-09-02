"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Check, Loader2, Pencil, Shield, Trash2, Users, UserRoundCog } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { convexErrorMessage } from "@/lib/convexErrorMessage";
import { useI18n } from "@/lib/i18n";
import { roleLabel } from "@/lib/operationalLabels";

type TeamRow = {
  _id: Id<"teams">;
  name: string;
  members: Array<{ memberId: Id<"members">; teamRole: string; email?: string; name?: string; role: string }>;
};

export function TeamsSection() {
  const { locale, tr, t } = useI18n();
  const teams = useQuery(api.teams.list, {});
  const members = useQuery(api.memberInvites.listMembers, {});
  const me = useQuery(api.tenantsQueries.getActiveOptional);
  const createTeam = useMutation(api.teams.create);
  const updateTeam = useMutation(api.teams.update);
  const removeTeam = useMutation(api.teams.remove);
  const canManage = me?.role === "owner" || me?.role === "admin";
  const [editing, setEditing] = useState<{
    teamId: Id<"teams">;
    name: string;
    memberIds: Array<Id<"members">>;
    leadMemberId: Id<"members"> | "";
  } | null>(null);
  const [name, setName] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<
    Array<Id<"members">>
  >([]);
  const [leadMemberId, setLeadMemberId] = useState<Id<"members"> | "">("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeMembers = useMemo(
    () => (members ?? []).filter((member) => member.status === "active"),
    [members],
  );

  function toggleMember(memberId: Id<"members">) {
    setSelectedMemberIds((current) => {
      if (current.includes(memberId)) {
        if (leadMemberId === memberId) setLeadMemberId("");
        return current.filter((id) => id !== memberId);
      }
      if (!leadMemberId) setLeadMemberId(memberId);
      return [...current, memberId];
    });
  }

  function startEditing(team: TeamRow) {
    setNotice(null);
    setError(null);
    setEditing({
      teamId: team._id,
      name: team.name,
      memberIds: team.members.map((member) => member.memberId),
      leadMemberId: team.members.find((member) => member.teamRole === "lead")?.memberId ?? "",
    });
  }

  async function handleSaveEdit(team: TeamRow) {
    if (!editing) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const current = new Set(team.members.map((member) => member.memberId));
      const next = new Set(editing.memberIds);
      await updateTeam({
        teamId: editing.teamId,
        name: editing.name,
        add: editing.memberIds.filter((id) => !current.has(id)),
        remove: team.members.map((member) => member.memberId).filter((id) => !next.has(id)),
        leadMemberId: editing.leadMemberId || undefined,
      });
      setEditing(null);
      setNotice(t("teams.saved"));
    } catch (err) {
      setError(convexErrorMessage(err, locale));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(team: TeamRow) {
    if (!window.confirm(t("teams.deleteConfirm"))) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      await removeTeam({ teamId: team._id });
      if (editing?.teamId === team._id) setEditing(null);
    } catch (err) {
      setError(convexErrorMessage(err, locale));
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateTeam() {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      await createTeam({
        name,
        members: selectedMemberIds.map((memberId) => ({
          memberId,
          teamRole: memberId === leadMemberId ? "lead" : "member",
        })),
      });
      setName("");
      setSelectedMemberIds([]);
      setLeadMemberId("");
      setNotice(tr("Equipa criada.", "Team created."));
    } catch (err) {
      setError(convexErrorMessage(err, locale, tr("Não foi possível criar a equipa.", "Could not create team.")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-col gap-3 border-b border-slate-100 px-6 py-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-[#0a1b33]">
            {tr("Equipas e filas", "Teams & queues")}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {tr(
              "Encaminhe conversas por equipa e mantenha responsáveis e SLAs visíveis.",
              "Route conversations by team while leads keep members and SLAs visible.",
            )}
          </p>
        </div>
      </div>

      <div className="grid gap-5 p-6 xl:grid-cols-[1fr_1.15fr]">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#0a1b33]">
            <UserRoundCog size={16} />
            {tr("Criar equipa", "Create team")}
          </div>
          <label className="block">
            <span className="text-[11px] font-medium text-slate-500">
              {tr("Nome da equipa", "Team name")}
            </span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={tr("Equipa comercial", "Sales team")}
              className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-[#0a1b33] outline-none focus:border-slate-400"
            />
          </label>

          <div className="mt-4">
            <div className="mb-2 text-[11px] font-medium text-slate-500">
              {tr("Membros", "Members")}
            </div>
            <div className="grid gap-1 sm:grid-cols-2">
              {activeMembers.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 bg-white px-3 py-4 text-center text-xs text-slate-500">
                  {tr("Convide membros antes de criar equipas.", "Invite members before creating teams.")}
                </div>
              ) : (
                activeMembers.map((member) => {
                  const checked = selectedMemberIds.includes(member._id);
                  const lead = leadMemberId === member._id;
                  return (
                    <div
                      key={member._id}
                      className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2"
                    >
                      <button
                        type="button"
                        onClick={() => toggleMember(member._id)}
                        className={`flex h-5 w-5 items-center justify-center rounded border ${
                          checked
                            ? "border-[#0a152d] bg-[#0a152d] text-white"
                            : "border-slate-300 bg-white"
                        }`}
                        aria-label={`${tr("Selecionar", "Toggle")} ${member.email ?? roleLabel(member.role, locale)}`}
                      >
                        {checked && <Check size={12} />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium text-[#0a1b33]">
                          {member.email ?? roleLabel(member.role, locale)}
                        </div>
                        <div className="text-[10px] uppercase tracking-wider text-slate-400">
                          {roleLabel(member.role, locale)}
                        </div>
                      </div>
                      {checked && (
                        <button
                          type="button"
                          onClick={() => setLeadMemberId(member._id)}
                          className={`rounded-md border px-2 py-1 text-[10px] font-semibold ${
                            lead
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border-slate-200 bg-slate-50 text-slate-500"
                          }`}
                        >
                          {tr("Líder", "Lead")}
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {(notice || error) && (
            <div
              className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
                error
                  ? "border-red-200 bg-red-50 text-red-700"
                  : "border-emerald-200 bg-emerald-50 text-emerald-700"
              }`}
            >
              {error ?? notice}
            </div>
          )}

          <button
            type="button"
            onClick={handleCreateTeam}
            disabled={busy || name.trim().length < 2 || selectedMemberIds.length === 0}
            className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#0a152d] px-3 text-[13px] font-medium text-white transition-colors hover:bg-[#0a1b33] disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Users size={14} />}
            {tr("Criar equipa", "Create team")}
          </button>
        </div>

        <div>
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#0a1b33]">
            <Shield size={16} />
            {tr("Equipas ativas", "Active teams")}
          </div>
          {teams === undefined ? (
            <div className="h-28 animate-pulse rounded-lg border border-slate-100 bg-slate-50" />
          ) : teams.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
              {tr("Ainda não existem equipas.", "No teams yet.")}
            </div>
          ) : (
            <div className="space-y-2">
              {teams.map((team) => (
                <div
                  key={team._id}
                  className="rounded-lg border border-slate-200 px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-semibold text-[#0a1b33]">
                      {team.name}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-500">
                        {team.members.length} {locale === "pt"
                          ? team.members.length === 1 ? "membro" : "membros"
                          : team.members.length === 1 ? "member" : "members"}
                      </span>
                      {canManage && (
                        <>
                          <button
                            type="button"
                            onClick={() => (editing?.teamId === team._id ? setEditing(null) : startEditing(team))}
                            className="rounded-md border border-slate-200 p-1.5 text-slate-500 hover:border-slate-300 hover:text-[#0a1b33]"
                            aria-label={t("teams.edit")}
                            title={t("teams.edit")}
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDelete(team)}
                            disabled={busy}
                            className="rounded-md border border-slate-200 p-1.5 text-slate-500 hover:border-rose-300 hover:text-rose-600 disabled:opacity-50"
                            aria-label={t("teams.delete")}
                            title={t("teams.delete")}
                          >
                            <Trash2 size={13} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {editing?.teamId === team._id ? (
                    <div className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <label className="block">
                        <span className="text-[11px] font-medium text-slate-500">{t("teams.rename")}</span>
                        <input
                          value={editing.name}
                          onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                          className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-[#0a1b33] outline-none focus:border-slate-400"
                        />
                      </label>
                      <div>
                        <div className="mb-1.5 text-[11px] font-medium text-slate-500">{t("teams.members")}</div>
                        <div className="grid gap-1 sm:grid-cols-2">
                          {activeMembers.map((member) => {
                            const checked = editing.memberIds.includes(member._id);
                            const lead = editing.leadMemberId === member._id;
                            return (
                              <div key={member._id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setEditing({
                                      ...editing,
                                      memberIds: checked
                                        ? editing.memberIds.filter((id) => id !== member._id)
                                        : [...editing.memberIds, member._id],
                                      leadMemberId: checked && lead ? "" : editing.leadMemberId,
                                    })
                                  }
                                  className={`flex h-4.5 w-4.5 items-center justify-center rounded border ${
                                    checked ? "border-[#0a1b33] bg-[#0a1b33] text-white" : "border-slate-300 bg-white"
                                  }`}
                                  aria-pressed={checked}
                                >
                                  {checked && <Check size={11} />}
                                </button>
                                <span className="min-w-0 flex-1 truncate text-[12px] text-[#0a1b33]">
                                  {member.email ?? member.name ?? roleLabel(member.role, locale)}
                                </span>
                                {checked && (
                                  <button
                                    type="button"
                                    onClick={() => setEditing({ ...editing, leadMemberId: lead ? "" : member._id })}
                                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                      lead ? "bg-amber-100 text-amber-800" : "text-slate-400 hover:text-slate-600"
                                    }`}
                                  >
                                    {t("teams.lead")}
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditing(null)}
                          className="h-8 rounded-md border border-slate-200 px-3 text-[12px] font-semibold text-slate-600"
                        >
                          {tr("Cancelar", "Cancel")}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleSaveEdit(team)}
                          disabled={busy || editing.name.trim().length < 2}
                          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#0a1b33] px-3 text-[12px] font-semibold text-white disabled:opacity-50"
                        >
                          {busy && <Loader2 size={12} className="animate-spin" />}
                          {t("teams.save")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {team.members.map((member) => (
                        <span
                          key={member.memberId}
                          className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600"
                        >
                          {member.email ?? member.name ?? roleLabel(member.role, locale)}
                          {member.teamRole === "lead" ? ` · ${tr("líder", "lead")}` : ""}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
