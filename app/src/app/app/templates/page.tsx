"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useAction } from "convex/react";
import { Plus, FileText, RefreshCw, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/app/EmptyState";
import { api } from "../../../../convex/_generated/api";
import { friendlyId } from "@/lib/friendlyId";
import { relativeTime } from "@/lib/relativeTime";

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600 border-slate-200",
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected: "bg-red-50 text-red-700 border-red-200",
  paused: "bg-slate-100 text-slate-500 border-slate-200",
  disabled: "bg-slate-100 text-slate-400 border-slate-200",
};

export default function TemplatesPage() {
  const templates = useQuery(api.templates.list);
  const sync = useAction(api.templates.syncFromMeta);
  const [syncing, setSyncing] = useState(false);

  async function onSync() {
    setSyncing(true);
    try {
      await sync({});
    } finally {
      setSyncing(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Meta-approved messages"
        title="Templates"
        description="Versioned message templates submitted to Meta for approval."
        action={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onSync}
              disabled={syncing || (templates?.length ?? 0) === 0}
              className="inline-flex items-center gap-2 bg-white text-[#0a1b33] text-[13px] font-medium px-3 py-2 rounded-lg border border-slate-200 hover:border-slate-300 disabled:opacity-50 transition-all"
            >
              {syncing ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} strokeWidth={2} />
              )}
              Sync from Meta
            </button>
            <Link
              href="/app/templates/new"
              className="inline-flex items-center gap-2 bg-[#0a152d] text-white text-[13px] font-medium px-4 py-2 rounded-lg shadow-[0_8px_24px_-8px_rgba(10,21,45,0.5)] hover:bg-[#0a1b33] transition-all"
            >
              <Plus size={14} strokeWidth={2.5} />
              New template
            </Link>
          </div>
        }
      />

      <div className="px-8 py-8 max-w-5xl">
        {templates === undefined ? (
          <div className="text-slate-400 text-sm">Loading…</div>
        ) : templates.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center">
            <FileText size={28} className="mx-auto text-slate-300 mb-3" />
            <h2 className="font-[var(--font-outfit)] text-[18px] font-medium text-[#0a1b33]">
              No templates yet
            </h2>
            <p className="text-slate-500 text-sm mt-1.5 max-w-md mx-auto leading-relaxed">
              Templates are required to start conversations outside the 24h
              service window. Create one and we&apos;ll submit it to Meta for
              approval.
            </p>
            <Link
              href="/app/templates/new"
              className="inline-flex items-center gap-2 bg-[#0a152d] text-white text-[13px] font-medium px-4 py-2 rounded-lg mt-5 hover:bg-[#0a1b33] transition-all"
            >
              <Plus size={14} strokeWidth={2.5} />
              Create your first template
            </Link>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <ul className="divide-y divide-slate-100">
              {templates.map((t) => (
                <li key={t._id}>
                  <Link
                    href={`/app/templates/${t._id}`}
                    className="flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50 transition-colors"
                  >
                    <FileText size={16} className="text-slate-400 flex-shrink-0" strokeWidth={2} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[14px] font-medium text-[#0a1b33] truncate">
                          {t.name}
                        </span>
                        <span className="text-[10px] text-slate-400 font-[var(--font-mono)]">
                          {friendlyId("TPL", t._id)}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5 capitalize">
                        {t.category} · {t.language} · v{t.currentVersion}
                        {t.syncedAt &&
                          ` · synced ${relativeTime(t.syncedAt)}`}
                      </div>
                    </div>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium border ${STATUS_STYLES[t.status] ?? STATUS_STYLES.draft}`}
                    >
                      {t.status}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}
