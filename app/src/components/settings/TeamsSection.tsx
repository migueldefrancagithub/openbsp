"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Check, Loader2, Shield, Users, UserRoundCog } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

export function TeamsSection() {
  const teams = useQuery(api.teams.list, {});
  const members = useQuery(api.memberInvites.listMembers, {});
  const createTeam = useMutation(api.teams.create);
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
      setNotice("Team created.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create team.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex flex-col gap-3 border-b border-slate-100 px-6 py-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-[#0a1b33]">
            Teams &amp; queues
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Route conversations by company team while team leads keep visibility
            over their members.
          </p>
        </div>
      </div>

      <div className="grid gap-5 p-6 xl:grid-cols-[1fr_1.15fr]">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#0a1b33]">
            <UserRoundCog size={16} />
            Create team
          </div>
          <label className="block">
            <span className="text-[11px] font-medium text-slate-500">
              Team name
            </span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Sales Team"
              className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-[#0a1b33] outline-none focus:border-slate-400"
            />
          </label>

          <div className="mt-4">
            <div className="mb-2 text-[11px] font-medium text-slate-500">
              Members
            </div>
            <div className="max-h-56 space-y-1 overflow-y-auto">
              {activeMembers.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 bg-white px-3 py-4 text-center text-xs text-slate-500">
                  Invite members before creating teams.
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
                        aria-label={`Toggle ${member.email ?? member.role}`}
                      >
                        {checked && <Check size={12} />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium text-[#0a1b33]">
                          {member.email ?? member.role}
                        </div>
                        <div className="text-[10px] uppercase tracking-wider text-slate-400">
                          {member.role}
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
                          Lead
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
            Create team
          </button>
        </div>

        <div>
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#0a1b33]">
            <Shield size={16} />
            Active teams
          </div>
          {teams === undefined ? (
            <div className="h-28 animate-pulse rounded-xl border border-slate-100 bg-slate-50" />
          ) : teams.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
              No teams yet.
            </div>
          ) : (
            <div className="space-y-2">
              {teams.map((team) => (
                <div
                  key={team._id}
                  className="rounded-xl border border-slate-200 px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-semibold text-[#0a1b33]">
                      {team.name}
                    </div>
                    <span className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-500">
                      {team.members.length} members
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {team.members.map((member) => (
                      <span
                        key={member.memberId}
                        className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600"
                      >
                        {member.email ?? member.name ?? member.role}
                        {member.teamRole === "lead" ? " · lead" : ""}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
