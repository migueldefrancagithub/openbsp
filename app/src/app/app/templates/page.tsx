import { FileText, Plus } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app/EmptyState";

export default function TemplatesPage() {
  return (
    <>
      <PageHeader
        eyebrow="Meta-approved messages"
        title="Templates"
        description="Versioned message templates submitted to Meta. Healthcare-mode allowlist enforced."
        action={
          <button
            type="button"
            disabled
            title="Shipping in Chunk E1"
            className="inline-flex items-center gap-2 bg-slate-100 text-slate-400 text-[13px] font-medium px-4 py-2 rounded-lg cursor-not-allowed border border-slate-200"
          >
            <Plus size={14} strokeWidth={2.5} />
            New template <span className="text-[10px] uppercase tracking-wider ml-1 text-slate-400">soon</span>
          </button>
        }
      />
      <EmptyState
        icon={FileText}
        title="No templates yet"
        description="Templates are versioned. Once submitted to Meta they lock — edits become a new version. Pre-built appointment_reminder available for clinics."
      />
    </>
  );
}
