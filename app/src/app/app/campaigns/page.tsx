"use client";

import { FormEvent, useMemo, useState, type ReactNode } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  Ban,
  BarChart3,
  CheckCircle2,
  Clock3,
  Copy,
  Download,
  Filter,
  FileText,
  FolderPlus,
  ListPlus,
  Loader2,
  Megaphone,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Radio,
  RotateCcw,
  Rocket,
  Search,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Table2,
  Upload,
  Users,
  X,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/app/EmptyState";
import { WhatsAppIosPreview } from "@/components/WhatsAppIosPreview";
import { api } from "../../../../convex/_generated/api";
import { relativeTime } from "@/lib/relativeTime";
import type { Id } from "../../../../convex/_generated/dataModel";
import { ImportCsvModal } from "../contacts/ImportCsvModal";
import type { TemplateCategory } from "@/lib/whatsappTemplateAdvisor";

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700 border-slate-200",
  scheduled: "bg-sky-50 text-sky-700 border-sky-200",
  running: "bg-emerald-50 text-emerald-700 border-emerald-200",
  paused: "bg-amber-50 text-amber-700 border-amber-200",
  completed: "bg-indigo-50 text-indigo-700 border-indigo-200",
  failed: "bg-red-50 text-red-700 border-red-200",
  cancelled: "bg-slate-100 text-slate-500 border-slate-200",
};

const BROADCAST_TABS = [
  { key: "all", label: "All", icon: FileText },
  { key: "active", label: "Active", icon: Radio },
  { key: "scheduled", label: "Scheduled", icon: Clock3 },
  { key: "completed", label: "Completed", icon: CheckCircle2 },
  { key: "cancelled", label: "Cancelled", icon: Ban },
  { key: "failed", label: "Failed", icon: XCircle },
] as const;

type BroadcastFilter = (typeof BROADCAST_TABS)[number]["key"];
type AudienceLogic = "all" | "any";
type ConsentFilter = "any" | "granted" | "revoked" | "unknown";
type LeadSourceFilter = "" | "ctwa" | "organic" | "campaign_reply" | "unknown";
type OpportunityStatusFilter =
  | ""
  | "new"
  | "contacted"
  | "replied"
  | "opportunity"
  | "booked"
  | "lost";
type CtwaWindowFilter = "any" | "open" | "expiring_6h" | "expired";
type CampaignOutcomeFilter =
  | ""
  | "clicked"
  | "replied"
  | "failed"
  | "read"
  | "delivered"
  | "sent";

export default function CampaignsPage() {
  const convex = useConvex();
  const campaigns = useQuery(api.campaigns.listCampaigns, {});
  const lists = useQuery(api.campaigns.listContactLists, {});
  const contacts = useQuery(api.contacts.list, { limit: 500 });
  const templates = useQuery(api.templates.list);
  const createContactList = useMutation(api.campaigns.createContactList);
  const addContactToList = useMutation(api.campaigns.addContactToList);
  const importContactsToList = useMutation(api.campaigns.importContactsToList);
  const saveAudienceList = useMutation(api.audiences.saveAsList);
  const createDraftCampaign = useMutation(api.campaigns.createDraftCampaign);
  const launchCampaign = useMutation(api.campaigns.launchCampaign);
  const sendNextBatch = useMutation(api.campaigns.sendNextBatch);
  const retrySafeFailures = useMutation(api.campaigns.retrySafeFailures);

  const approvedTemplates = useMemo(
    () =>
      (templates ?? []).filter(
        (template) =>
          template.status === "approved" && template.parameterCount === 0,
      ),
    [templates],
  );
  const [listName, setListName] = useState("");
  const [listDescription, setListDescription] = useState("");
  const [selectedListId, setSelectedListId] =
    useState<Id<"contactLists"> | "">("");
  const [selectedContactId, setSelectedContactId] =
    useState<Id<"contacts"> | "">("");
  const [campaignName, setCampaignName] = useState("");
  const [audienceName, setAudienceName] = useState("");
  const [audienceSearch, setAudienceSearch] = useState("");
  const [audienceLogic, setAudienceLogic] = useState<AudienceLogic>("all");
  const [audienceIncludeTags, setAudienceIncludeTags] = useState("");
  const [audienceExcludeTags, setAudienceExcludeTags] = useState("");
  const [audienceMarketingConsent, setAudienceMarketingConsent] =
    useState<ConsentFilter>("any");
  const [audienceTransactionalConsent, setAudienceTransactionalConsent] =
    useState<ConsentFilter>("any");
  const [audienceLeadSource, setAudienceLeadSource] =
    useState<LeadSourceFilter>("");
  const [audienceOpportunityStatus, setAudienceOpportunityStatus] =
    useState<OpportunityStatusFilter>("");
  const [audienceCtwaWindow, setAudienceCtwaWindow] =
    useState<CtwaWindowFilter>("any");
  const [audienceCampaignOutcome, setAudienceCampaignOutcome] =
    useState<CampaignOutcomeFilter>("");
  const [audienceCreatedAfter, setAudienceCreatedAfter] = useState("");
  const [audienceLastMessageAfter, setAudienceLastMessageAfter] = useState("");
  const [audienceExcludeMarketingRevoked, setAudienceExcludeMarketingRevoked] =
    useState(true);
  const [selectedTemplateId, setSelectedTemplateId] =
    useState<Id<"templates"> | "">("");
  const selectedTemplate = useMemo(
    () =>
      (templates ?? []).find((template) => template._id === selectedTemplateId),
    [templates, selectedTemplateId],
  );
  const [campaignHasMarketingOptIn, setCampaignHasMarketingOptIn] =
    useState(false);
  const [campaignServiceWindowOpen, setCampaignServiceWindowOpen] =
    useState(false);
  const [campaignFreeEntryOpen, setCampaignFreeEntryOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [campaignSearch, setCampaignSearch] = useState("");
  const [campaignStatusFilter, setCampaignStatusFilter] =
    useState<BroadcastFilter>("all");
  const [logCampaignId, setLogCampaignId] =
    useState<Id<"campaigns"> | null>(null);
  const [batchSize, setBatchSize] = useState(1000);
  const audienceCriteria = useMemo(
    () => ({
      logic: audienceLogic,
      search: audienceSearch.trim() || undefined,
      includeTags: commaList(audienceIncludeTags),
      excludeTags: commaList(audienceExcludeTags),
      marketingConsent: audienceMarketingConsent,
      transactionalConsent: audienceTransactionalConsent,
      leadSources: audienceLeadSource
        ? [audienceLeadSource as Exclude<LeadSourceFilter, "">]
        : undefined,
      opportunityStatuses: audienceOpportunityStatus
        ? [audienceOpportunityStatus as Exclude<OpportunityStatusFilter, "">]
        : undefined,
      ctwaWindow: audienceCtwaWindow,
      campaignRecipientStatuses: audienceCampaignOutcome
        ? [audienceCampaignOutcome as Exclude<CampaignOutcomeFilter, "">]
        : undefined,
      createdAfter: dateStart(audienceCreatedAfter),
      lastMessageAfter: dateStart(audienceLastMessageAfter),
      excludeMarketingRevoked: audienceExcludeMarketingRevoked,
    }),
    [
      audienceCampaignOutcome,
      audienceCreatedAfter,
      audienceCtwaWindow,
      audienceExcludeMarketingRevoked,
      audienceExcludeTags,
      audienceIncludeTags,
      audienceLastMessageAfter,
      audienceLeadSource,
      audienceLogic,
      audienceMarketingConsent,
      audienceOpportunityStatus,
      audienceSearch,
      audienceTransactionalConsent,
    ],
  );
  const audiencePreview = useQuery(api.audiences.preview, {
    criteria: audienceCriteria,
  });

  const filteredCampaigns = useMemo(() => {
    const term = campaignSearch.trim().toLowerCase();
    return (campaigns ?? []).filter((campaign) => {
      const matchesSearch =
        term.length === 0 ||
        campaign.name.toLowerCase().includes(term) ||
        (campaign.listName ?? "").toLowerCase().includes(term) ||
        (campaign.templateName ?? "").toLowerCase().includes(term);
      return (
        matchesSearch &&
        matchesBroadcastFilter(campaign.status, campaignStatusFilter)
      );
    });
  }, [campaigns, campaignSearch, campaignStatusFilter]);
  const logCampaign = useMemo(
    () => (campaigns ?? []).find((campaign) => campaign._id === logCampaignId),
    [campaigns, logCampaignId],
  );

  async function handleCreateList(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("list");
    setError(null);
    setNotice(null);
    try {
      const listId = await createContactList({
        name: listName,
        description: listDescription || undefined,
      });
      setSelectedListId(listId);
      setListName("");
      setListDescription("");
      setNotice("Contact list created.");
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleAddContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedListId || !selectedContactId) return;
    setBusy("contact");
    setError(null);
    setNotice(null);
    try {
      const result = await addContactToList({
        listId: selectedListId,
        contactId: selectedContactId,
      });
      setSelectedContactId("");
      setNotice(result.added ? "Contact added to list." : "Contact was already in this list.");
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleCreateCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedListId || !selectedTemplateId) return;
    setBusy("campaign");
    setError(null);
    setNotice(null);
    try {
      await createDraftCampaign({
        name: campaignName,
        listId: selectedListId,
        templateId: selectedTemplateId,
      });
      setCampaignName("");
      setNotice("Draft campaign created with recipients ready for launch.");
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleSaveAudience(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("audience");
    setError(null);
    setNotice(null);
    try {
      const result = await saveAudienceList({
        name: audienceName,
        criteria: audienceCriteria,
      });
      setSelectedListId(result.listId);
      setAudienceName("");
      setNotice(
        `Audience saved with ${result.added} contacts. ${result.excludedMarketingRevoked} marketing opt-outs excluded.`,
      );
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleLaunch(campaignId: Id<"campaigns">) {
    setBusy(`launch:${campaignId}`);
    setError(null);
    setNotice(null);
    try {
      const result = await launchCampaign({
        campaignId,
        batchSize: normalizedBatchSize(batchSize),
      });
      setNotice(
        `Campaign launched: ${result.queued} queued, ${result.pendingRemaining} waiting, ${result.skippedConsent} skipped for consent, ${result.skippedUnsuitable} unsuitable.`,
      );
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleSendNextBatch(campaignId: Id<"campaigns">) {
    setBusy(`next:${campaignId}`);
    setError(null);
    setNotice(null);
    try {
      const result = await sendNextBatch({
        campaignId,
        batchSize: normalizedBatchSize(batchSize),
      });
      setNotice(
        `Next batch queued: ${result.queued} queued, ${result.pendingRemaining} still waiting, ${result.skippedConsent} skipped for consent, ${result.skippedUnsuitable} unsuitable.`,
      );
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleRetrySafe(campaignId: Id<"campaigns">) {
    setBusy(`retry:${campaignId}`);
    setError(null);
    setNotice(null);
    try {
      const result = await retrySafeFailures({ campaignId });
      setNotice(
        `Retry queued: ${result.retried} safe failures retried, ${result.skippedUnsafe} unsafe skipped, ${result.skippedConsent} skipped for consent.`,
      );
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleCopyFailedContacts(campaignId: Id<"campaigns">) {
    setBusy(`export:${campaignId}`);
    setError(null);
    setNotice(null);
    try {
      const rows = await convex.query(api.campaigns.exportFailedContacts, {
        campaignId,
      });
      const csv = toCsv([
        [
          "contact_id",
          "display_name",
          "phone",
          "bsuid",
          "status",
          "failure_code",
          "meta_error_category",
          "failure_reason",
        ],
        ...rows.map((row) => [
          row.contactId,
          row.displayName,
          row.phone ?? "",
          row.bsuid ?? "",
          row.status,
          row.failureCode ?? "",
          row.metaErrorCategory ?? "",
          row.failureReason ?? "",
        ]),
      ]);
      await navigator.clipboard.writeText(csv);
      setNotice(`Copied ${rows.length} failed contacts as CSV.`);
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Broadcasts"
        title="Campaigns"
        description="Build reusable contact folders, attach approved templates, and materialize recipients for campaign analytics."
      />

      <div className="px-8 py-8 max-w-7xl space-y-6">
        {(notice || error) && (
          <div
            className={`rounded-lg border px-4 py-3 text-sm ${
              error
                ? "bg-red-50 border-red-200 text-red-700"
                : "bg-emerald-50 border-emerald-200 text-emerald-700"
            }`}
          >
            {error ?? notice}
          </div>
        )}

        <section className="rounded-2xl border border-slate-200 bg-white p-2">
          <div className="grid gap-1 md:grid-cols-5">
            <StudioTab
              href="#campaign-dashboard"
              icon={BarChart3}
              label="Dashboard"
              value={`${campaigns?.length ?? 0} runs`}
            />
            <StudioTab
              href="#campaign-copy"
              icon={Copy}
              label="Sua copy"
              value={`${approvedTemplates.length} approved`}
            />
            <StudioTab
              href="#campaign-lists"
              icon={Table2}
              label="Lista de clientes"
              value={`${lists?.length ?? 0} folders`}
            />
            <StudioTab
              href="#audience-builder"
              icon={Filter}
              label="Audiências"
              value={`${audiencePreview?.count ?? 0} matched`}
            />
            <StudioTab
              href="#campaign-launch"
              icon={Rocket}
              label="Iniciar campanha"
              value="Safe launch"
            />
          </div>
        </section>

        <div
          id="campaign-lists"
          className="grid scroll-mt-24 gap-4 xl:grid-cols-[1fr_1fr_1.2fr]"
        >
          <WorkflowPanel
            icon={FolderPlus}
            title="1. Create folder"
            subtitle="Use the live's folder/list model as the campaign audience."
          >
            <form className="space-y-3" onSubmit={handleCreateList}>
              <TextInput
                label="List name"
                value={listName}
                onChange={setListName}
                placeholder="Promo Botox"
              />
              <TextInput
                label="Description"
                value={listDescription}
                onChange={setListDescription}
                placeholder="Optional internal note"
              />
              <SubmitButton
                disabled={busy !== null || listName.trim().length < 2}
                loading={busy === "list"}
                icon={Plus}
              >
                Create list
              </SubmitButton>
            </form>
          </WorkflowPanel>

          <WorkflowPanel
            icon={Users}
            title="2. Add contacts"
            subtitle="Pick existing contacts or import CSV rows straight into this folder."
          >
            <form className="space-y-3" onSubmit={handleAddContact}>
              <SelectBox
                label="Target list"
                value={selectedListId}
                onChange={(value) =>
                  setSelectedListId(value as Id<"contactLists"> | "")
                }
                options={(lists ?? []).map((list) => ({
                  value: list._id,
                  label: `${list.name} (${list.memberCount})`,
                }))}
                placeholder="Choose list"
              />
              <SelectBox
                label="Contact"
                value={selectedContactId}
                onChange={(value) =>
                  setSelectedContactId(value as Id<"contacts"> | "")
                }
                options={(contacts ?? []).map((contact) => ({
                  value: contact._id,
                  label:
                    contact.name ??
                    contact.whatsappUsername ??
                    contact.e164 ??
                    contact.bsuid ??
                    "Unknown contact",
                }))}
                placeholder="Choose contact"
              />
              <SubmitButton
                disabled={
                  busy !== null || !selectedListId || !selectedContactId
                }
                loading={busy === "contact"}
                icon={ListPlus}
              >
                Add to list
              </SubmitButton>
              <button
                type="button"
                onClick={() => setImportOpen(true)}
                disabled={!selectedListId || busy !== null}
                className="w-full inline-flex items-center justify-center gap-2 border border-slate-200 bg-white text-[#0a1b33] text-[13px] font-medium px-4 py-2 rounded-lg hover:border-slate-300 disabled:opacity-50 transition-all"
              >
                <Upload size={14} />
                Import CSV to list
              </button>
            </form>
          </WorkflowPanel>

          <WorkflowPanel
            id="campaign-launch"
            icon={Megaphone}
            title="3. Create draft campaign"
            subtitle="Approved templates without variables are supported in this first build."
          >
            <form className="space-y-3" onSubmit={handleCreateCampaign}>
              <TextInput
                label="Campaign name"
                value={campaignName}
                onChange={setCampaignName}
                placeholder="Campanha Maio"
              />
              <SelectBox
                label="Audience"
                value={selectedListId}
                onChange={(value) =>
                  setSelectedListId(value as Id<"contactLists"> | "")
                }
                options={(lists ?? []).map((list) => ({
                  value: list._id,
                  label: `${list.name} (${list.memberCount})`,
                }))}
                placeholder="Choose list"
              />
              <SelectBox
                label="Template"
                value={selectedTemplateId}
                onChange={(value) =>
                  setSelectedTemplateId(value as Id<"templates"> | "")
                }
                options={approvedTemplates.map((template) => ({
                  value: template._id,
                  label: `${template.name} · ${template.language}`,
                }))}
                placeholder="Choose approved template"
              />
              <SubmitButton
                disabled={
                  busy !== null ||
                  campaignName.trim().length < 2 ||
                  !selectedListId ||
                  !selectedTemplateId
                }
                loading={busy === "campaign"}
                icon={Send}
              >
                Create draft
              </SubmitButton>
            </form>
          </WorkflowPanel>
        </div>

        <section
          id="campaign-copy"
          className="grid scroll-mt-24 gap-4 xl:grid-cols-[360px_1fr]"
        >
          <WhatsAppIosPreview
            title="Campaign iOS preview"
            subtitle="See what the selected template feels like before you launch."
            category={asTemplateCategory(selectedTemplate?.category)}
            bodyText={
              selectedTemplate?.bodyText ??
              "Choose an approved template to preview the message here."
            }
            examples={Object.fromEntries(
              (selectedTemplate?.parameterSchema ?? []).map((param) => [
                param.index,
                param.example,
              ]),
            )}
            hasMarketingOptIn={campaignHasMarketingOptIn}
            serviceWindowOpen={campaignServiceWindowOpen}
            freeEntryWindowOpen={campaignFreeEntryOpen}
          />

          <WorkflowPanel
            icon={AlertTriangle}
            title="Cost and quality planner"
            subtitle="Mock the send context before creating a campaign, then choose the cheapest safe path."
          >
            <div className="grid gap-3 md:grid-cols-3">
              <Toggle
                label="Audience has marketing opt-in"
                checked={campaignHasMarketingOptIn}
                onChange={setCampaignHasMarketingOptIn}
              />
              <Toggle
                label="Customer 24h window open"
                checked={campaignServiceWindowOpen}
                onChange={setCampaignServiceWindowOpen}
              />
              <Toggle
                label="CTWA 72h free entry open"
                checked={campaignFreeEntryOpen}
                onChange={setCampaignFreeEntryOpen}
              />
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              <StrategyTile
                title="Save money first"
                body="Use utility inside the 24h service window or CTWA free-entry before paying for marketing sends."
              />
              <StrategyTile
                title="Ramp, then scale"
                body="Launch one use case to a small cohort, inspect read/block signals for 7-10 days, then increase volume."
              />
              <StrategyTile
                title="Segment intent"
                body="Prioritize CTWA leads, recent responders, booked customers, and cart recovery before broad broadcasts."
              />
            </div>
          </WorkflowPanel>
        </section>

        <WorkflowPanel
          id="audience-builder"
          icon={SlidersHorizontal}
          title="Audience Builder"
          subtitle="Build reusable lead segments from consent, tags, CTWA intent, pipeline stage, and campaign behavior."
        >
          <form className="space-y-4" onSubmit={handleSaveAudience}>
            <div className="grid gap-3 lg:grid-cols-[1.2fr_0.7fr_1.1fr]">
              <TextInput
                label="Saved list name"
                value={audienceName}
                onChange={setAudienceName}
                placeholder="VIP clicked retargeting"
              />
              <SelectBox
                label="Match mode"
                value={audienceLogic}
                onChange={(value) => setAudienceLogic(value as AudienceLogic)}
                options={[
                  { value: "all", label: "All filters" },
                  { value: "any", label: "Any filter" },
                ]}
                placeholder="Match mode"
              />
              <TextInput
                label="Search"
                value={audienceSearch}
                onChange={setAudienceSearch}
                placeholder="Name, phone, BSUID, username"
              />
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <TextInput
                label="Include tags"
                value={audienceIncludeTags}
                onChange={setAudienceIncludeTags}
                placeholder="vip, injectables"
              />
              <TextInput
                label="Exclude tags"
                value={audienceExcludeTags}
                onChange={setAudienceExcludeTags}
                placeholder="do_not_promote, minor"
              />
              <SelectBox
                label="Marketing consent"
                value={audienceMarketingConsent}
                onChange={(value) =>
                  setAudienceMarketingConsent(value as ConsentFilter)
                }
                options={[
                  { value: "any", label: "Any" },
                  { value: "granted", label: "Granted" },
                  { value: "unknown", label: "Unknown" },
                  { value: "revoked", label: "Revoked" },
                ]}
                placeholder="Any"
              />
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <SelectBox
                label="Transactional consent"
                value={audienceTransactionalConsent}
                onChange={(value) =>
                  setAudienceTransactionalConsent(value as ConsentFilter)
                }
                options={[
                  { value: "any", label: "Any" },
                  { value: "granted", label: "Granted" },
                  { value: "unknown", label: "Unknown" },
                  { value: "revoked", label: "Revoked" },
                ]}
                placeholder="Any"
              />
              <SelectBox
                label="Lead source"
                value={audienceLeadSource}
                onChange={(value) =>
                  setAudienceLeadSource(value as LeadSourceFilter)
                }
                options={[
                  { value: "ctwa", label: "CTWA ad lead" },
                  { value: "organic", label: "Organic inbound" },
                  { value: "campaign_reply", label: "Campaign reply" },
                  { value: "unknown", label: "Unknown" },
                ]}
                placeholder="Any source"
              />
              <SelectBox
                label="Pipeline status"
                value={audienceOpportunityStatus}
                onChange={(value) =>
                  setAudienceOpportunityStatus(value as OpportunityStatusFilter)
                }
                options={[
                  { value: "new", label: "New" },
                  { value: "contacted", label: "Contacted" },
                  { value: "replied", label: "Replied" },
                  { value: "opportunity", label: "Opportunity" },
                  { value: "booked", label: "Booked" },
                  { value: "lost", label: "Lost" },
                ]}
                placeholder="Any status"
              />
              <SelectBox
                label="CTWA window"
                value={audienceCtwaWindow}
                onChange={(value) =>
                  setAudienceCtwaWindow(value as CtwaWindowFilter)
                }
                options={[
                  { value: "any", label: "Any" },
                  { value: "open", label: "Open" },
                  { value: "expiring_6h", label: "Expiring 6h" },
                  { value: "expired", label: "Expired" },
                ]}
                placeholder="Any"
              />
            </div>

            <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr]">
              <SelectBox
                label="Campaign behavior"
                value={audienceCampaignOutcome}
                onChange={(value) =>
                  setAudienceCampaignOutcome(value as CampaignOutcomeFilter)
                }
                options={[
                  { value: "clicked", label: "Clicked" },
                  { value: "replied", label: "Replied" },
                  { value: "failed", label: "Failed" },
                  { value: "read", label: "Read" },
                  { value: "delivered", label: "Delivered" },
                  { value: "sent", label: "Sent" },
                ]}
                placeholder="Any outcome"
              />
              <DateInput
                label="Created after"
                value={audienceCreatedAfter}
                onChange={setAudienceCreatedAfter}
              />
              <DateInput
                label="Last message after"
                value={audienceLastMessageAfter}
                onChange={setAudienceLastMessageAfter}
              />
            </div>

            <div className="grid gap-3 lg:grid-cols-[1fr_2fr_auto] lg:items-stretch">
              <Toggle
                label="Exclude marketing opt-outs"
                checked={audienceExcludeMarketingRevoked}
                onChange={setAudienceExcludeMarketingRevoked}
              />
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="inline-flex items-center gap-2 font-semibold text-[#0a1b33]">
                    <Users size={15} />
                    {audiencePreview?.count ?? 0} matched
                  </span>
                  <span className="inline-flex items-center gap-2 font-medium text-emerald-700">
                    <ShieldCheck size={15} />
                    {audiencePreview?.excludedMarketingRevoked ?? 0} opt-outs excluded
                  </span>
                  <span className="inline-flex items-center gap-2 font-medium text-slate-500">
                    <Filter size={15} />
                    {audiencePreview?.activeFilters ?? 0} filters
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(audiencePreview?.sample ?? []).slice(0, 4).map((contact) => (
                    <span
                      key={contact.contactId}
                      className="inline-flex max-w-full items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600"
                    >
                      <span className="truncate">{contact.displayName}</span>
                      {contact.matchReasons.slice(0, 2).map((reason) => (
                        <span
                          key={reason}
                          className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700"
                        >
                          {reason}
                        </span>
                      ))}
                    </span>
                  ))}
                  {audiencePreview && audiencePreview.sample.length === 0 && (
                    <span className="text-xs font-medium text-slate-400">
                      No matching contacts yet.
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-end">
                <SubmitButton
                  disabled={
                    busy !== null ||
                    audienceName.trim().length < 2 ||
                    (audiencePreview?.count ?? 0) === 0
                  }
                  loading={busy === "audience"}
                  icon={ListPlus}
                >
                  Save audience
                </SubmitButton>
              </div>
            </div>
          </form>
        </WorkflowPanel>

        <section
          id="campaign-dashboard"
          className="scroll-mt-24 bg-white border border-slate-200 rounded-2xl overflow-hidden"
        >
          <div className="px-5 py-4 border-b border-slate-100 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="font-[var(--font-outfit)] text-[18px] font-medium text-[#0a1b33]">
                Campaign broadcasts
              </h2>
              <p className="text-sm text-slate-500 mt-0.5">
                Batch-aware broadcast cards with per-recipient delivery state,
                failure recovery, and response tracking.
              </p>
            </div>
            <a
              href="#campaign-launch"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-violet-600 px-3 text-sm font-medium text-white transition-colors hover:bg-violet-700"
            >
              <Plus size={15} />
              Create broadcast
            </a>
          </div>

          <div className="border-b border-slate-100 p-5">
            <div className="grid gap-3 lg:grid-cols-[1fr_auto_auto]">
              <label className="relative block">
                <Search
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  value={campaignSearch}
                  onChange={(event) => setCampaignSearch(event.target.value)}
                  placeholder="Search broadcasts..."
                  className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-3 text-sm text-[#0a1b33] outline-none transition-colors placeholder:text-slate-400 focus:border-slate-400"
                />
              </label>
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50">
                <span className="h-3 w-3 rounded-full bg-emerald-500" />
              </span>
              <select className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-[#0a1b33] outline-none focus:border-slate-400">
                <option>6 per page</option>
                <option>12 per page</option>
                <option>24 per page</option>
              </select>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {BROADCAST_TABS.map((tab) => {
                const Icon = tab.icon;
                const active = campaignStatusFilter === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setCampaignStatusFilter(tab.key)}
                    className={`inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold transition-colors ${
                      active
                        ? "bg-violet-600 text-white"
                        : "bg-white text-[#0a1b33] hover:bg-slate-50"
                    }`}
                  >
                    <Icon size={15} />
                    {tab.label}
                  </button>
                );
              })}
            </div>
            <div className="mt-4 max-w-xs">
              <label className="text-xs font-medium text-slate-500">
                Manual batch size
              </label>
              <input
                type="number"
                min={1}
                max={5000}
                value={batchSize}
                onChange={(event) => setBatchSize(Number(event.target.value))}
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-[#0a1b33] outline-none focus:border-slate-400"
              />
            </div>
          </div>

          {campaigns === undefined ? (
            <div className="p-8 text-sm text-slate-400">Loading campaigns…</div>
          ) : campaigns.length === 0 ? (
            <div className="p-10 text-center">
              <Send size={26} className="mx-auto text-slate-300 mb-3" />
              <h3 className="font-[var(--font-outfit)] text-[18px] font-medium text-[#0a1b33]">
                No campaign drafts yet
              </h3>
              <p className="text-sm text-slate-500 mt-1">
                Create a list, add contacts, then attach an approved template.
              </p>
            </div>
          ) : filteredCampaigns.length === 0 ? (
            <div className="p-10 text-center">
              <Search size={26} className="mx-auto text-slate-300 mb-3" />
              <h3 className="font-[var(--font-outfit)] text-[18px] font-medium text-[#0a1b33]">
                No broadcasts match
              </h3>
              <p className="text-sm text-slate-500 mt-1">
                Clear search or switch status filters.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 p-5 lg:grid-cols-2 2xl:grid-cols-3">
              {filteredCampaigns.map((campaign) => (
                <BroadcastCard
                  key={campaign._id}
                  campaign={campaign}
                  busy={busy}
                  onLaunch={handleLaunch}
                  onSendNextBatch={handleSendNextBatch}
                  onRetrySafe={handleRetrySafe}
                  onCopyFailed={handleCopyFailedContacts}
                  onOpenLog={() => setLogCampaignId(campaign._id)}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {logCampaign && (
        <CampaignLogDrawer
          campaign={logCampaign}
          onClose={() => setLogCampaignId(null)}
        />
      )}

      {importOpen && selectedListId && (
        <ImportCsvModal
          onClose={() => setImportOpen(false)}
          onImport={async (rows) =>
            importContactsToList({ listId: selectedListId, rows })
          }
        />
      )}
    </>
  );
}

type CampaignStats = {
  total: number;
  pending: number;
  queued: number;
  dispatching: number;
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  clicked: number;
  failed: number;
  skipped: number;
};

type CampaignSummary = {
  _id: Id<"campaigns">;
  name: string;
  status: string;
  listName?: string;
  templateName?: string;
  pauseReason?: string;
  stats: CampaignStats;
  failureBreakdown: Array<{
    category: string;
    count: number;
    retrySafe: boolean;
    title: string;
    action: string;
  }>;
  createdAt: number;
  updatedAt?: number;
};

function BroadcastCard({
  campaign,
  busy,
  onLaunch,
  onSendNextBatch,
  onRetrySafe,
  onCopyFailed,
  onOpenLog,
}: {
  campaign: CampaignSummary;
  busy: string | null;
  onLaunch: (campaignId: Id<"campaigns">) => void;
  onSendNextBatch: (campaignId: Id<"campaigns">) => void;
  onRetrySafe: (campaignId: Id<"campaigns">) => void;
  onCopyFailed: (campaignId: Id<"campaigns">) => void;
  onOpenLog: () => void;
}) {
  const sent = sentLikeCount(campaign.stats);
  const delivered = deliveredLikeCount(campaign.stats);
  const read = readLikeCount(campaign.stats);
  const pendingBatch =
    campaign.stats.pending + campaign.stats.queued + campaign.stats.dispatching;
  const pendingRecipients = campaign.stats.pending;
  const progress = rate(sent + campaign.stats.failed + campaign.stats.skipped, campaign.stats.total);
  const stripe =
    campaign.status === "completed"
      ? "border-l-emerald-500"
      : campaign.status === "failed" || campaign.stats.failed > 0
        ? "border-l-orange-500"
        : campaign.status === "running"
          ? "border-l-violet-500"
          : "border-l-slate-300";
  const statusLabel =
    campaign.status === "paused" && pendingBatch > 0
      ? "partially sent"
      : campaign.status;

  return (
    <article
      className={`flex min-h-[520px] flex-col rounded-2xl border border-l-4 border-slate-200 bg-white shadow-[0_18px_70px_-48px_rgba(15,23,42,0.55)] ${stripe}`}
    >
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-[#0a1b33]">
              {campaign.name}
            </h3>
            <p className="mt-1 text-xs font-medium text-slate-500">
              # {friendlyCampaignId(campaign._id)} · {relativeTime(campaign.createdAt)}
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-[#0a1b33]"
            aria-label="More broadcast actions"
          >
            <MoreHorizontal size={17} />
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {campaign.status === "draft" && (
            <ActionPill
              icon={Send}
              label="Launch"
              loading={busy === `launch:${campaign._id}`}
              onClick={() => onLaunch(campaign._id)}
              disabled={busy !== null}
              tone="dark"
            />
          )}
          {campaign.status === "running" && pendingRecipients > 0 && (
            <ActionPill
              icon={Radio}
              label="Send Next Batch"
              loading={busy === `next:${campaign._id}`}
              onClick={() => onSendNextBatch(campaign._id)}
              disabled={busy !== null}
              tone="orange"
            />
          )}
          {campaign.failureBreakdown.some((failure) => failure.retrySafe) && (
            <ActionPill
              icon={RotateCcw}
              label="Retry safe"
              loading={busy === `retry:${campaign._id}`}
              onClick={() => onRetrySafe(campaign._id)}
              disabled={busy !== null}
            />
          )}
          <ActionPill icon={BarChart3} label="Log" onClick={onOpenLog} />
        </div>

        {(pendingRecipients > 0 || campaign.pauseReason) && (
          <div className="mt-4 rounded-xl border border-orange-200 bg-orange-50 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-orange-600" />
              <div>
                <div className="text-sm font-semibold text-orange-800">
                  Batch control
                </div>
                <p className="mt-1 text-sm leading-6 text-orange-700">
                  {campaign.pauseReason ??
                    `${(campaign.stats.total - pendingRecipients).toLocaleString()} of ${campaign.stats.total.toLocaleString()} contacts processed. ${pendingRecipients.toLocaleString()} waiting for the next manual batch.`}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${
              STATUS_STYLES[campaign.status] ?? STATUS_STYLES.draft
            }`}
          >
            {statusLabel}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
            <Radio size={12} />
            Condition tracking
          </span>
        </div>

        <div className="mt-4 flex items-center gap-2 text-sm font-semibold text-slate-500">
          <FileText size={15} />
          <span className="truncate">
            {campaign.templateName ?? "No template"}
          </span>
          <span className="text-xs">(en)</span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <BroadcastMetric icon={Send} label="Sent" value={`${sent}/${campaign.stats.total}`} />
          <BroadcastMetric icon={CheckCircle2} label="Delivered" value={delivered} />
          <BroadcastMetric icon={MessageSquare} label="Read" value={read} />
          <BroadcastMetric
            icon={XCircle}
            label="Failed"
            value={campaign.stats.failed}
            danger
          />
        </div>

        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <ProgressRow label="Sent Rate" value={rate(sent, campaign.stats.total)} />
          <ProgressRow
            label="Delivery Rate"
            value={rate(delivered, Math.max(sent, 1))}
          />
          <ProgressRow label="Read Rate" value={rate(read, Math.max(delivered, 1))} />
        </div>

        {campaign.failureBreakdown.length > 0 && (
          <div className="mt-4 space-y-2">
            {campaign.failureBreakdown.slice(0, 2).map((failure) => (
              <div
                key={failure.category}
                className="rounded-xl border border-red-100 bg-red-50 px-3 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-red-800">
                    {failure.title}
                  </span>
                  <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-red-600">
                    {failure.count}
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-5 text-red-700">
                  {failure.action}
                </p>
              </div>
            ))}
          </div>
        )}

        <div className="mt-auto pt-4">
          <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-3 text-sm font-semibold text-blue-700">
            created {relativeTime(campaign.createdAt)}
          </div>
          <button
            type="button"
            onClick={() => onOpenLog()}
            className="mt-3 flex w-full items-center justify-between rounded-xl border border-violet-100 bg-violet-50 px-3 py-3 text-sm font-medium text-violet-700"
          >
            <span className="inline-flex items-center gap-2">
              <MessageSquare size={15} />
              Responses
            </span>
            <span>{campaign.stats.replied + campaign.stats.clicked}</span>
          </button>
        </div>
      </div>

      <div className="border-t border-slate-100 px-5 py-3 text-xs font-medium text-slate-500">
        Created: {new Date(campaign.createdAt).toLocaleString()}
      </div>

      {campaign.stats.failed > 0 && (
        <div className="border-t border-slate-100 px-5 py-3">
          <button
            type="button"
            onClick={() => onCopyFailed(campaign._id)}
            disabled={busy !== null}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-[#0a1b33] transition-colors hover:border-slate-300 disabled:opacity-50"
          >
            {busy === `export:${campaign._id}` ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Download size={13} />
            )}
            Copy failed CSV
          </button>
        </div>
      )}
    </article>
  );
}

function CampaignLogDrawer({
  campaign,
  onClose,
}: {
  campaign: CampaignSummary;
  onClose: () => void;
}) {
  const sent = sentLikeCount(campaign.stats);
  const progress = rate(sent + campaign.stats.failed + campaign.stats.skipped, campaign.stats.total);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/60">
      <aside className="h-full w-full max-w-xl border-l border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-6">
          <div className="flex items-start gap-3">
            <span className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
              <Radio size={19} />
              <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-emerald-500" />
            </span>
            <div>
              <h2 className="font-[var(--font-outfit)] text-2xl font-semibold text-[#0a1b33]">
                {campaign.name}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Real-time activity log · ID: {friendlyCampaignId(campaign._id)}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"
          >
            <X size={17} />
          </button>
        </div>

        <div className="grid grid-cols-4 border-b border-slate-100 px-6 py-5 text-center">
          <DrawerStat label="Total" value={campaign.stats.total} />
          <DrawerStat label="Sent" value={sent} tone="emerald" />
          <DrawerStat label="Failed" value={campaign.stats.failed} tone="red" />
          <DrawerStat label="Progress" value={`${progress.toFixed(1)}%`} tone="blue" />
        </div>

        <div className="space-y-3 p-6">
          <LogEvent
            kind="Info"
            time={new Date(campaign.updatedAt ?? campaign.createdAt).toLocaleTimeString()}
            message="Loaded from API"
          />
          {campaign.failureBreakdown.map((failure) => (
            <LogEvent
              key={failure.category}
              kind="Failure"
              time={new Date(campaign.updatedAt ?? campaign.createdAt).toLocaleTimeString()}
              message={`${failure.title}: ${failure.count} contacts`}
              danger
            />
          ))}
        </div>

        <div className="absolute bottom-0 right-0 flex w-full max-w-xl items-center justify-between border-t border-slate-100 bg-white px-6 py-4 text-sm text-slate-500">
          <span>{1 + campaign.failureBreakdown.length} events</span>
          <span>Last update: {new Date(campaign.updatedAt ?? campaign.createdAt).toLocaleTimeString()}</span>
        </div>
      </aside>
    </div>
  );
}

function ActionPill({
  icon: Icon,
  label,
  loading,
  onClick,
  disabled,
  tone = "light",
}: {
  icon: LucideIcon;
  label: string;
  loading?: boolean;
  onClick: () => void;
  disabled?: boolean;
  tone?: "light" | "dark" | "orange";
}) {
  const toneClass =
    tone === "dark"
      ? "border-[#0a152d] bg-[#0a152d] text-white"
      : tone === "orange"
        ? "border-orange-200 bg-orange-50 text-orange-700"
        : "border-slate-200 bg-white text-[#0a1b33]";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-semibold transition-colors hover:border-slate-300 disabled:opacity-50 ${toneClass}`}
    >
      {loading ? <Loader2 size={13} className="animate-spin" /> : <Icon size={14} />}
      {label}
    </button>
  );
}

function BroadcastMetric({
  icon: Icon,
  label,
  value,
  danger,
}: {
  icon: LucideIcon;
  label: string;
  value: number | string;
  danger?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Icon size={15} />
        <span>{label}</span>
      </div>
      <div
        className={`mt-1 text-sm font-semibold ${
          danger ? "text-red-600" : "text-[#0a1b33]"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function ProgressRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="text-slate-500">{label}</span>
        <span className="font-semibold text-[#0a1b33]">{value.toFixed(1)}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white">
        <div
          className="h-full rounded-full bg-violet-600"
          style={{ width: `${Math.min(value, 100)}%` }}
        />
      </div>
    </div>
  );
}

function DrawerStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: "emerald" | "red" | "blue";
}) {
  const toneClass =
    tone === "emerald"
      ? "text-emerald-600"
      : tone === "red"
        ? "text-red-600"
        : tone === "blue"
          ? "text-blue-600"
          : "text-[#0a1b33]";
  return (
    <div>
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

function LogEvent({
  kind,
  time,
  message,
  danger,
}: {
  kind: string;
  time: string;
  message: string;
  danger?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <span
          className={`rounded-lg px-2 py-1 text-xs font-semibold ${
            danger ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-600"
          }`}
        >
          {kind}
        </span>
        <span className="text-xs font-medium text-slate-500">{time}</span>
      </div>
      <p className="mt-2 text-sm font-medium text-[#0a1b33]">{message}</p>
    </div>
  );
}

function matchesBroadcastFilter(status: string, filter: BroadcastFilter): boolean {
  if (filter === "all") return true;
  if (filter === "active") return status === "running" || status === "paused";
  return status === filter;
}

function sentLikeCount(stats: CampaignStats): number {
  return (
    stats.sent +
    stats.delivered +
    stats.read +
    stats.replied +
    stats.clicked
  );
}

function deliveredLikeCount(stats: CampaignStats): number {
  return stats.delivered + stats.read + stats.replied + stats.clicked;
}

function readLikeCount(stats: CampaignStats): number {
  return stats.read + stats.replied + stats.clicked;
}

function rate(value: number, total: number): number {
  if (total <= 0) return 0;
  return (value / total) * 100;
}

function normalizedBatchSize(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(5000, Math.max(1, Math.floor(value)));
}

function commaList(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function dateStart(value: string): number | undefined {
  if (!value) return undefined;
  const time = new Date(`${value}T00:00:00`).getTime();
  return Number.isFinite(time) ? time : undefined;
}

function friendlyCampaignId(id: string): string {
  return id.slice(-6).toUpperCase();
}

function WorkflowPanel({
  id,
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  id?: string;
  icon: LucideIcon;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 bg-white border border-slate-200 rounded-2xl p-5">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center text-[#0a1b33]">
          <Icon size={17} />
        </div>
        <div>
          <h2 className="font-[var(--font-outfit)] text-[17px] font-medium text-[#0a1b33]">
            {title}
          </h2>
          <p className="text-[12px] text-slate-500 mt-0.5 leading-relaxed">
            {subtitle}
          </p>
        </div>
      </div>
      {children}
    </section>
  );
}

function StudioTab({
  href,
  icon: Icon,
  label,
  value,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <a
      href={href}
      className="group flex items-center gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-slate-50"
    >
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 transition-colors group-hover:bg-[#0a152d] group-hover:text-white">
        <Icon size={16} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold text-[#0a1b33]">
          {label}
        </span>
        <span className="block truncate text-[11px] font-medium text-slate-400">
          {value}
        </span>
      </span>
    </a>
  );
}

function TextInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium text-slate-500 mb-1">
        {label}
      </span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-[#0a1b33] outline-none transition-colors placeholder:text-slate-300 focus:border-slate-400"
      />
    </label>
  );
}

function DateInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium text-slate-500 mb-1">
        {label}
      </span>
      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-[#0a1b33] outline-none transition-colors focus:border-slate-400"
      />
    </label>
  );
}

function SelectBox({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder: string;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium text-slate-500 mb-1">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-[#0a1b33] outline-none transition-colors focus:border-slate-400"
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function SubmitButton({
  disabled,
  loading,
  icon: Icon,
  children,
}: {
  disabled: boolean;
  loading: boolean;
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="w-full inline-flex items-center justify-center gap-2 bg-[#0a152d] text-white text-[13px] font-medium px-4 py-2 rounded-lg shadow-[0_8px_24px_-8px_rgba(10,21,45,0.35)] hover:bg-[#0a1b33] disabled:opacity-50 disabled:shadow-none transition-all"
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />}
      {children}
    </button>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-16 items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] font-medium text-[#0a1b33]">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-[#0a152d]"
      />
    </label>
  );
}

function StrategyTile({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="text-[13px] font-semibold text-[#0a1b33]">{title}</div>
      <p className="mt-1 text-[12px] leading-relaxed text-slate-500">{body}</p>
    </div>
  );
}

function asTemplateCategory(category: string | undefined): TemplateCategory {
  if (
    category === "utility" ||
    category === "marketing" ||
    category === "authentication"
  ) {
    return category;
  }
  return "marketing";
}

function Metric({
  label,
  value,
  danger,
  muted,
}: {
  label: string;
  value: number;
  danger?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-2">
      <div
        className={`text-[16px] font-semibold ${
          danger ? "text-red-600" : muted ? "text-slate-500" : "text-[#0a1b33]"
        }`}
      >
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-slate-400">
        {label}
      </div>
    </div>
  );
}

function readError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}

function toCsv(rows: string[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => `"${cell.replaceAll('"', '""')}"`)
        .join(","),
    )
    .join("\n");
}
