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
            disabled
            title="Requires templates first (E1) and campaigns engine (V1)"
            className="inline-flex items-center gap-2 bg-slate-100 text-slate-400 text-[13px] font-medium px-4 py-2 rounded-lg cursor-not-allowed border border-slate-200"
          >
            <Plus size={14} strokeWidth={2.5} />
            New campaign <span className="text-[10px] uppercase tracking-wider ml-1 text-slate-400">soon</span>
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
