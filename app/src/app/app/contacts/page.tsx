import { Users, Upload } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app/EmptyState";

export default function ContactsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Audience"
        title="Contacts"
        description="People you can reach via WhatsApp, with consent provenance per contact."
        action={
          <button
            type="button"
            disabled
            title="CSV import ships in V1"
            className="inline-flex items-center gap-2 bg-slate-100 text-slate-400 text-[13px] font-medium px-4 py-2 rounded-lg cursor-not-allowed border border-slate-200"
          >
            <Upload size={14} strokeWidth={2.5} />
            Import CSV <span className="text-[10px] uppercase tracking-wider ml-1 text-slate-400">soon</span>
          </button>
        }
      />
      <EmptyState
        icon={Users}
        title="No contacts yet"
        description="Import a CSV with one row per contact. Each row must include a consent proof URL or text — we store it for RGPD compliance."
      />
    </>
  );
}
