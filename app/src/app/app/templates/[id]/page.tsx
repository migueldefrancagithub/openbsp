"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useAction } from "convex/react";
import {
  ChevronLeft,
  Send,
  Loader2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Clock,
} from "lucide-react";
import { PageHeader } from "@/components/app/EmptyState";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { friendlyId } from "@/lib/friendlyId";
import { relativeTime } from "@/lib/relativeTime";

type Props = { params: Promise<{ id: string }> };

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600 border-slate-200",
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected: "bg-red-50 text-red-700 border-red-200",
  paused: "bg-slate-100 text-slate-500 border-slate-200",
  disabled: "bg-slate-100 text-slate-400 border-slate-200",
};

function StatusIcon({ status }: { status: string }) {
  if (status === "approved") return <CheckCircle2 size={14} className="text-emerald-600" />;
  if (status === "rejected") return <XCircle size={14} className="text-red-600" />;
  if (status === "pending") return <Clock size={14} className="text-amber-600" />;
  return <span className="w-3 h-3 rounded-full bg-slate-300" />;
}

export default function TemplateDetailPage({ params }: Props) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const templateId = id as Id<"templates">;
  const tpl = useQuery(api.templates.getById, { templateId });
  const submit = useAction(api.templates.submitForApproval);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function onSubmit() {
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const r = await submit({ templateId });
      setSuccess(`Submitted to Meta · status: ${r.status}`);
    } catch (err: unknown) {
      const data =
        err && typeof err === "object" && "data" in err
          ? (err as { data: unknown }).data
          : null;
      const msg =
        data && typeof data === "object" && "message" in data
          ? String((data as { message: unknown }).message)
          : err instanceof Error
            ? err.message
            : "Submit failed";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  if (tpl === undefined) {
    return (
      <div className="px-8 py-12 text-slate-400 text-sm">Loading…</div>
    );
  }
  if (tpl === null) {
    return (
      <div className="px-8 py-12 text-slate-500 text-sm">Template not found.</div>
    );
  }

  const currentVersion = tpl.versions.find((v) => v.version === tpl.currentVersion);
  const isDraft = tpl.status === "draft";
  const submissionNotice = searchParams.get("submission");
  const submissionReason = searchParams.get("reason");

  return (
    <>
      <PageHeader
        eyebrow={`Template · ${friendlyId("TPL", tpl._id)}`}
        title={tpl.name}
        description={`${tpl.category} · ${tpl.language} · v${tpl.currentVersion}`}
        action={
          <Link
            href="/app/templates"
            className="inline-flex items-center gap-1 text-[13px] text-slate-600 hover:text-[#0a1b33] transition-colors"
          >
            <ChevronLeft size={14} />
            Back
          </Link>
        }
      />

      <div className="px-8 py-8 max-w-3xl space-y-6">
        {/* Status card */}
        <section className="bg-white rounded-2xl border border-slate-200 p-5">
          {submissionNotice === "submitted" && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700">
              <CheckCircle2 size={12} className="mt-0.5 flex-shrink-0" />
              <span>Template created and submitted to Meta.</span>
            </div>
          )}
          {submissionNotice === "draft_saved" && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
              <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
              <span>
                Draft saved, but Meta did not accept the submission
                {submissionReason ? `: ${submissionReason}` : "."}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <StatusIcon status={tpl.status} />
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-[#0a1b33] text-sm">
                    Status
                  </span>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium border ${STATUS_STYLES[tpl.status] ?? STATUS_STYLES.draft}`}
                  >
                    {tpl.status}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {tpl.syncedAt
                    ? `Last synced ${relativeTime(tpl.syncedAt)}`
                    : "Not yet submitted to Meta"}
                  {tpl.qualityScore && ` · Quality: ${tpl.qualityScore}`}
                </div>
              </div>
            </div>
            {isDraft && (
              <button
                type="button"
                onClick={onSubmit}
                disabled={busy}
                className="inline-flex items-center gap-2 bg-[#0a152d] text-white text-[13px] font-medium px-4 py-2 rounded-lg shadow-[0_8px_24px_-8px_rgba(10,21,45,0.5)] hover:bg-[#0a1b33] disabled:opacity-50 transition-all"
              >
                {busy ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Send size={14} strokeWidth={2.5} />
                )}
                Submit to Meta
              </button>
            )}
          </div>
          {tpl.rejectionReason && (
            <div className="mt-3 flex items-start gap-2 text-[12px] text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-lg">
              <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
              <span>{tpl.rejectionReason}</span>
            </div>
          )}
          {error && (
            <div className="mt-3 flex items-start gap-2 text-[12px] text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-lg">
              <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          {success && (
            <div className="mt-3 flex items-start gap-2 text-[12px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-2 rounded-lg">
              <CheckCircle2 size={12} className="flex-shrink-0 mt-0.5" />
              <span>{success}</span>
            </div>
          )}
        </section>

        {/* Body preview */}
        {currentVersion && (
          <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-semibold text-[#0a1b33] text-sm">
                Body (v{currentVersion.version})
              </h3>
              <span className="text-[11px] text-slate-400">
                {currentVersion.isLocked ? "Locked (submitted)" : "Editable"}
              </span>
            </div>
            <div className="p-5 space-y-4">
              <pre className="bg-slate-50 border border-slate-100 rounded-lg p-3 text-[13px] text-[#0a1b33] whitespace-pre-wrap font-mono">
                {currentVersion.bodyText}
              </pre>
              {currentVersion.parameterSchema.length > 0 && (
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-slate-400 mb-2">
                    Variables
                  </div>
                  <ul className="space-y-1.5">
                    {currentVersion.parameterSchema.map((p) => (
                      <li
                        key={p.index}
                        className="flex items-center gap-3 text-[12px]"
                      >
                        <span className="font-[var(--font-mono)] text-slate-500 w-12">
                          {`{{${p.index}}}`}
                        </span>
                        <span className="text-[#0a1b33]">{p.example}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
