import { Send, Plus } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app/EmptyState";

export default function CampaignsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Broadcasts"
        title="Campaigns"
        description="Segmented template broadcasts with quality circuit breaker and per-batch dispatch."
        action={
          <button
            type="button"
            className="inline-flex items-center gap-2 bg-[#0a152d] text-white text-[13px] font-medium px-4 py-2 rounded-lg shadow-[0_8px_24px_-8px_rgba(10,21,45,0.5)] hover:bg-[#0a1b33] transition-all"
          >
            <Plus size={14} strokeWidth={2.5} />
            New campaign
          </button>
        }
      />
      <EmptyState
        icon={Send}
        title="No campaigns yet"
        description="Create a campaign by picking an approved template and a contact segment. Cost preview shows Meta per-message price by country before you ship."
      />
    </>
  );
}
