"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery, useAction } from "convex/react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Eye,
  FileText,
  FilterX,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  XCircle,
} from "lucide-react";
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
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");

  const filteredTemplates = useMemo(() => {
    const term = query.trim().toLowerCase();
    return (templates ?? []).filter((template) => {
      const matchesQuery =
        term.length === 0 ||
        template.name.toLowerCase().includes(term) ||
        template.language.toLowerCase().includes(term);
      const matchesCategory =
        category === "all" || template.category === category;
      const matchesStatus = status === "all" || template.status === status;
      return matchesQuery && matchesCategory && matchesStatus;
    });
  }, [templates, query, category, status]);
  const templateStats = useMemo(() => {
    const rows = templates ?? [];
    return {
      approved: rows.filter((template) => template.status === "approved").length,
      pending: rows.filter((template) => template.status === "pending").length,
      blocked: rows.filter((template) =>
        ["rejected", "paused", "disabled"].includes(template.status),
      ).length,
      withVariables: rows.filter((template) => template.parameterCount > 0).length,
    };
  }, [templates]);

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

      <div className="px-8 py-8 max-w-7xl space-y-5">
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
          <>
            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="mb-4 grid gap-3 md:grid-cols-4">
                <TemplateStat
                  icon={CheckCircle2}
                  label="Approved"
                  value={templateStats.approved}
                  tone="good"
                />
                <TemplateStat
                  icon={Clock3}
                  label="Pending Meta"
                  value={templateStats.pending}
                  tone="warn"
                />
                <TemplateStat
                  icon={XCircle}
                  label="Blocked"
                  value={templateStats.blocked}
                  tone="bad"
                />
                <TemplateStat
                  icon={FileText}
                  label="With variables"
                  value={templateStats.withVariables}
                  tone="neutral"
                />
              </div>
              <div className="grid gap-3 lg:grid-cols-[1fr_220px_220px_auto]">
                <label className="relative block">
                  <Search
                    size={16}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search templates..."
                    className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-3 text-sm text-[#0a1b33] outline-none transition-colors placeholder:text-slate-400 focus:border-slate-400"
                  />
                </label>
                <select
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-[#0a1b33] outline-none focus:border-slate-400"
                >
                  <option value="all">All categories</option>
                  <option value="marketing">Marketing</option>
                  <option value="utility">Utility</option>
                  <option value="authentication">Authentication</option>
                </select>
                <select
                  value={status}
                  onChange={(event) => setStatus(event.target.value)}
                  className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-[#0a1b33] outline-none focus:border-slate-400"
                >
                  <option value="all">All statuses</option>
                  <option value="draft">Draft</option>
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                  <option value="paused">Paused</option>
                  <option value="disabled">Disabled</option>
                </select>
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setCategory("all");
                    setStatus("all");
                  }}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-[#0a1b33] transition-colors hover:border-slate-300"
                >
                  <FilterX size={15} />
                  Reset filters
                </button>
              </div>
            </section>

            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <ul className="divide-y divide-slate-100">
                {filteredTemplates.map((t) => (
                  <li
                    key={t._id}
                    className="grid gap-4 px-5 py-4 transition-colors hover:bg-slate-50 lg:grid-cols-[1fr_auto]"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-[15px] font-semibold text-[#0a1b33]">
                          {t.name}
                        </span>
                        <span className="text-[10px] text-slate-400 font-[var(--font-mono)]">
                          {friendlyId("TPL", t._id)}
                        </span>
                        <span className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase text-violet-700">
                          {t.category}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase ${STATUS_STYLES[t.status] ?? STATUS_STYLES.draft}`}
                        >
                          {t.status === "approved" && <CheckCircle2 size={12} />}
                          {t.status}
                        </span>
                      </div>
                      <div className="mt-1 text-[12px] text-slate-500 capitalize">
                        {t.language} · v{t.currentVersion}
                        {t.syncedAt && ` · synced ${relativeTime(t.syncedAt)}`}
                        {t.parameterCount > 0 &&
                          ` · ${t.parameterCount} variable${t.parameterCount === 1 ? "" : "s"}`}
                      </div>
                      {templateReadiness(t.status, t.rejectionReason) && (
                        <div
                          className={`mt-2 inline-flex max-w-full items-start gap-2 rounded-lg border px-2.5 py-1.5 text-[12px] ${templateReadinessClass(
                            t.status,
                          )}`}
                        >
                          {templateReadinessIcon(t.status)}
                          <span className="min-w-0 truncate">
                            {templateReadiness(t.status, t.rejectionReason)}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                      <Link
                        href={`/app/templates/${t._id}`}
                        className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-[#0a1b33] transition-colors hover:border-slate-300"
                      >
                        <Eye size={15} />
                        Preview
                      </Link>
                      <Link
                        href={`/app/templates/${t._id}`}
                        className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-[#0a1b33] transition-colors hover:border-slate-300"
                      >
                        <Pencil size={15} />
                        Edit
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
              {filteredTemplates.length === 0 && (
                <div className="p-10 text-center">
                  <FileText size={26} className="mx-auto text-slate-300" />
                  <h2 className="mt-3 font-[var(--font-outfit)] text-lg font-semibold text-[#0a1b33]">
                    No templates match
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Clear filters or sync from Meta again.
                  </p>
                </div>
              )}
            </div>
            <div className="text-sm text-slate-500">
              Showing {filteredTemplates.length} of {templates.length} templates
            </div>
          </>
        )}
      </div>
    </>
  );
}

function TemplateStat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof CheckCircle2;
  label: string;
  value: number;
  tone: "good" | "warn" | "bad" | "neutral";
}) {
  const toneClass =
    tone === "good"
      ? "border-emerald-100 bg-emerald-50 text-emerald-700"
      : tone === "warn"
        ? "border-amber-100 bg-amber-50 text-amber-700"
        : tone === "bad"
          ? "border-red-100 bg-red-50 text-red-700"
          : "border-slate-200 bg-slate-50 text-slate-600";
  return (
    <div className={`rounded-xl border p-3 ${toneClass}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-[0.12em] opacity-75">
          {label}
        </span>
        <Icon size={15} />
      </div>
      <div className="mt-2 text-xl font-semibold">{value}</div>
    </div>
  );
}

function templateReadiness(status: string, reason?: string) {
  if (status === "approved") return "Ready for campaigns and service-window sends.";
  if (status === "pending") return "Waiting for Meta review. Do not use in launches yet.";
  if (status === "rejected") {
    return reason ? `Rejected: ${reason}` : "Rejected by Meta. Fix copy and submit a new version.";
  }
  if (status === "paused") return "Paused by Meta. Avoid campaigns until quality recovers.";
  if (status === "disabled") return "Disabled by Meta. Remove from campaign flows.";
  if (status === "draft") return "Draft only. Submit to Meta before using outside 24h windows.";
  return "";
}

function templateReadinessClass(status: string) {
  if (status === "approved") return "border-emerald-100 bg-emerald-50 text-emerald-700";
  if (status === "pending" || status === "draft") {
    return "border-amber-100 bg-amber-50 text-amber-800";
  }
  return "border-red-100 bg-red-50 text-red-700";
}

function templateReadinessIcon(status: string) {
  if (status === "approved") return <CheckCircle2 size={14} className="mt-0.5 shrink-0" />;
  if (status === "pending" || status === "draft") {
    return <AlertTriangle size={14} className="mt-0.5 shrink-0" />;
  }
  return <XCircle size={14} className="mt-0.5 shrink-0" />;
}
