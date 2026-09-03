"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { Bell, Check } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { alertLabel, severityLabel, severityTone } from "@/lib/alertCopy";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import { relativeTime } from "@/lib/relativeTime";

/**
 * The alerts the engine raises, one click from anywhere. Without a bell, the
 * "we tell you when something needs you" promise depends on the person happening
 * to open the operations screen.
 */
export function AlertsBell() {
  const { locale, tr } = useI18n();
  const [open, setOpen] = useState(false);
  const summary = useQuery(api.ops.summary, {});
  const alerts = useQuery(api.ops.listAlerts, open ? {} : "skip");
  const acknowledge = useMutation(api.ops.acknowledgeAlert);
  const count = summary?.open ?? 0;
  const now = Date.now();

  return (
    <div className="relative hidden lg:block">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        title={tr("Avisos", "Alerts")}
        className="relative flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-[#0a1b33]"
      >
        <Bell size={18} />
        {count > 0 && (
          <span
            className={cn(
              "absolute right-1.5 top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white",
              (summary?.critical ?? 0) > 0 ? "bg-[#b3261e]" : "bg-[#0d6b61]",
            )}
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute bottom-0 left-full z-40 ml-2 w-[360px] rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <span className="text-[12px] font-semibold text-[#0a1b33]">{tr("Avisos abertos", "Open alerts")}</span>
            <Link href="/app?tab=alerts" onClick={() => setOpen(false)} className="text-[11px] font-semibold text-[#2b4f8a] hover:underline">
              {tr("Ver todos", "See all")}
            </Link>
          </div>
          <ul className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto">
            {alerts === undefined ? (
              <li className="px-3 py-6 text-center text-[12px] text-slate-400">…</li>
            ) : alerts.length === 0 ? (
              <li className="px-3 py-8 text-center text-[12px] text-slate-500">
                {tr("Nada precisa de você agora.", "Nothing needs you right now.")}
              </li>
            ) : (
              alerts.map((alert) => (
                <li key={alert._id} className="flex items-start gap-2 px-3 py-2.5">
                  <span className={cn("mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold", severityTone(alert.severity))}>
                    {severityLabel(alert.severity, locale)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-medium text-[#0a1b33]">{alertLabel(alert.kind, locale)}</p>
                    <p className="text-[11px] text-slate-500">{alert.title}</p>
                    <p className="text-[10px] text-slate-400">{relativeTime(alert.createdAt, now, locale)}</p>
                    {alert.href && (
                      <Link href={alert.href} onClick={() => setOpen(false)} className="text-[11px] font-semibold text-[#2b4f8a] hover:underline">
                        {tr("Abrir", "Open")}
                      </Link>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => void acknowledge({ alertId: alert._id })}
                    title={tr("Marcar como visto", "Mark as seen")}
                    className="mt-0.5 text-slate-400 hover:text-[#0d6b61]"
                  >
                    <Check size={14} />
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
