"use client";

import { useQuery } from "convex/react";
import { Users } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import { roleLabel } from "@/lib/operationalLabels";
import { relativeTime } from "@/lib/relativeTime";

export function TeamPresence() {
  const { locale, tr } = useI18n();
  const team = useQuery(api.presence.listTeam, {});
  const now = Date.now();
  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 text-[13px] font-semibold text-[#0a1b33]">
        <Users size={14} /> {tr("Equipa agora", "Team right now")}
        {team && <span className="text-[11px] font-normal text-slate-400">{team.filter((m) => m.status === "online").length} {tr("online", "online")}</span>}
      </div>
      {team === undefined ? (
        <div className="h-16 animate-pulse bg-slate-50" />
      ) : team.length === 0 ? (
        <p className="px-4 py-4 text-[12px] text-slate-500">{tr("Sem membros ativos.", "No active members.")}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {team.map((member) => (
            <li key={member.memberId} className="flex items-center gap-3 px-4 py-2">
              <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", member.status === "online" ? "bg-[#0d6b61]" : member.status === "away" ? "bg-amber-400" : "bg-slate-300")} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-[#0a1b33]">{member.name ?? member.email ?? "—"}</div>
                <div className="text-[11px] text-slate-500">
                  {roleLabel(member.role, locale)} · {member.status === "online" ? tr("online", "online") : member.status === "away" ? tr("ausente", "away") : member.lastSeenAt ? `${tr("visto", "seen")} ${relativeTime(member.lastSeenAt, now, locale)}` : tr("nunca entrou", "never seen")}
                </div>
              </div>
              <span className="text-[11px] text-slate-500">{member.openThreads} {tr("abertas", "open")}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
