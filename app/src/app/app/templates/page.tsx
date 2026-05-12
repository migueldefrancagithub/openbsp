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
            className="inline-flex items-center gap-2 bg-[#0a152d] text-white text-[13px] font-medium px-4 py-2 rounded-lg shadow-[0_8px_24px_-8px_rgba(10,21,45,0.5)] hover:bg-[#0a1b33] transition-all"
          >
            <Plus size={14} strokeWidth={2.5} />
            New template
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
