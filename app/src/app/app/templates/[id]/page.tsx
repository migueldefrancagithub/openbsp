"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useAction } from "convex/react";
import {
  AlertTriangle,
  ChevronLeft,
  Send,
  Loader2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Clock,
  FileText,
  MessageSquare,
  ShieldCheck,
} from "lucide-react";
import { PageHeader } from "@/components/app/EmptyState";
import { WhatsAppIosPreview } from "@/components/WhatsAppIosPreview";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { friendlyId } from "@/lib/friendlyId";
import { relativeTime } from "@/lib/relativeTime";
import type { TemplateCategory } from "@/lib/whatsappTemplateAdvisor";

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

      <div className="grid gap-6 px-8 py-8 xl:grid-cols-[minmax(0,760px)_360px]">
        <div className="space-y-6">
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

        <ApprovalReadinessCard
          status={tpl.status}
          qualityScore={tpl.qualityScore}
          rejectionReason={tpl.rejectionReason}
          syncedAt={tpl.syncedAt}
        />

        {currentVersion && (
          <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-semibold text-[#0a1b33] text-sm">
                Meta payload (v{currentVersion.version})
              </h3>
              <span className="text-[11px] text-slate-400">
                {currentVersion.isLocked ? "Locked (submitted)" : "Editable"}
              </span>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <PayloadMetric
                  icon={FileText}
                  label="Language"
                  value={tpl.language}
                />
                <PayloadMetric
                  icon={ShieldCheck}
                  label="Category"
                  value={tpl.category}
                />
                <PayloadMetric
                  icon={MessageSquare}
                  label="Buttons"
                  value={String(currentVersion.buttons?.length ?? 0)}
                />
              </div>
              <pre className="bg-slate-50 border border-slate-100 rounded-lg p-3 text-[13px] text-[#0a1b33] whitespace-pre-wrap font-mono">
                {currentVersion.bodyText}
              </pre>
              <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-[13px] leading-6 text-emerald-800">
                <span className="font-semibold">Rendered with examples:</span>{" "}
                {renderTemplateText(
                  currentVersion.bodyText,
                  examplesFromSchema(currentVersion.parameterSchema),
                )}
              </div>
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

        {currentVersion && (
          <WhatsAppIosPreview
            title="Exact WhatsApp preview"
            subtitle="Rendered with the examples submitted to Meta."
            category={tpl.category as TemplateCategory}
            bodyText={currentVersion.bodyText}
            buttons={currentVersion.buttons ?? []}
            examples={examplesFromSchema(currentVersion.parameterSchema)}
            hasMarketingOptIn={tpl.category !== "marketing"}
            serviceWindowOpen={tpl.category === "utility"}
            freeEntryWindowOpen={false}
          />
        )}
      </div>
    </>
  );
}

function ApprovalReadinessCard({
  status,
  qualityScore,
  rejectionReason,
  syncedAt,
}: {
  status: string;
  qualityScore?: string;
  rejectionReason?: string;
  syncedAt?: number;
}) {
  const readiness = approvalReadiness(status, rejectionReason);
  const Icon = readiness.tone === "good" ? CheckCircle2 : readiness.tone === "bad" ? XCircle : AlertTriangle;
  return (
    <section className={`rounded-2xl border p-5 ${readinessClass(readiness.tone)}`}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/80">
          <Icon size={18} />
        </span>
        <div>
          <h2 className="font-[var(--font-outfit)] text-lg font-semibold">
            {readiness.title}
          </h2>
          <p className="mt-1 text-sm leading-6">{readiness.body}</p>
          <div className="mt-3 grid gap-2 text-xs font-semibold sm:grid-cols-3">
            <span className="rounded-lg bg-white/70 px-2.5 py-2">
              Status: {status}
            </span>
            <span className="rounded-lg bg-white/70 px-2.5 py-2">
              Quality: {qualityScore ?? "unknown"}
            </span>
            <span className="rounded-lg bg-white/70 px-2.5 py-2">
              Sync: {syncedAt ? relativeTime(syncedAt) : "not synced"}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

function PayloadMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof FileText;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
      <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-white text-slate-500">
        <Icon size={15} />
      </div>
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
        {label}
      </div>
      <div className="mt-1 truncate text-sm font-semibold text-[#0a1b33] capitalize">
        {value}
      </div>
    </div>
  );
}

function approvalReadiness(status: string, rejectionReason?: string) {
  if (status === "approved") {
    return {
      tone: "good" as const,
      title: "Ready to use",
      body:
        "Meta approved this template. It can be used for campaigns and conversations outside the 24h service window.",
    };
  }
  if (status === "pending") {
    return {
      tone: "warn" as const,
      title: "Waiting for Meta review",
      body:
        "Do not attach this template to a campaign yet. Sync from Meta or wait for the status webhook before launch.",
    };
  }
  if (status === "draft") {
    return {
      tone: "warn" as const,
      title: "Draft only",
      body:
        "This template still needs Meta approval before production sends. Review the preview and submit it when ready.",
    };
  }
  if (status === "rejected") {
    return {
      tone: "bad" as const,
      title: "Rejected by Meta",
      body:
        rejectionReason ??
        "Fix policy/category/copy issues, then create or submit a corrected version before using it.",
    };
  }
  return {
    tone: "bad" as const,
    title: "Not safe for campaigns",
    body:
      "Meta has paused or disabled this template. Remove it from active campaign plans until it is approved again.",
  };
}

function readinessClass(tone: "good" | "warn" | "bad") {
  if (tone === "good") return "border-emerald-100 bg-emerald-50 text-emerald-800";
  if (tone === "warn") return "border-amber-100 bg-amber-50 text-amber-900";
  return "border-red-100 bg-red-50 text-red-800";
}

function examplesFromSchema(
  schema: Array<{ index: number; name: string; example: string }>,
) {
  return Object.fromEntries(schema.map((param) => [param.index, param.example]));
}

function renderTemplateText(bodyText: string, examples: Record<number, string>) {
  return bodyText.replace(/\{\{(\d+)\}\}/g, (_, index: string) => {
    return examples[Number(index)] || `{{${index}}}`;
  });
}
