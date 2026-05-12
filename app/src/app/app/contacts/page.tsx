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
            className="inline-flex items-center gap-2 bg-[#0a152d] text-white text-[13px] font-medium px-4 py-2 rounded-lg shadow-[0_8px_24px_-8px_rgba(10,21,45,0.5)] hover:bg-[#0a1b33] transition-all"
          >
            <Upload size={14} strokeWidth={2.5} />
            Import CSV
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
