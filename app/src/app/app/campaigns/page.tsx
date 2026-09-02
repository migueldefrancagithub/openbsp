"use client";

import { FormEvent, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAction, useConvex, useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  BadgeCheck,
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
  MousePointerClick,
  MoreHorizontal,
  Pause,
  Play,
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
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/app/EmptyState";
import { SegmentedTabs } from "@/components/app/SegmentedTabs";
import { WhatsAppIosPreview } from "@/components/WhatsAppIosPreview";
import { api } from "../../../../convex/_generated/api";
import { relativeTime } from "@/lib/relativeTime";
import type { Id } from "../../../../convex/_generated/dataModel";
import { ImportCsvModal } from "../contacts/ImportCsvModal";
import type { TemplateCategory } from "@/lib/whatsappTemplateAdvisor";
import { useI18n, type Locale, type TranslationKey } from "@/lib/i18n";
import { convexErrorMessage } from "@/lib/convexErrorMessage";
import { channelStateLabel, sendModeLabel } from "@/lib/operationalLabels";

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

const MICRO_CAMPAIGN_DEFAULT_TEXT = `✨ Micro agenda da clínica

Temos alguns horários a organizar para esta semana.

Responde:
1 — Quero agendar
2 — Quero saber serviços
3 — Falar com a equipa`;

type BroadcastFilter = (typeof BROADCAST_TABS)[number]["key"];
type AudienceLogic = "all" | "any";
type ConsentFilter = "any" | "granted" | "revoked" | "unknown";
type LeadSourceFilter = "" | "ctwa" | "organic" | "campaign_reply" | "unknown";
type OpportunityStatusFilter =
  | ""
  | "new"
  | "interested"
  | "asked_price"
  | "wants_booking"
  | "awaiting_human"
  | "booked"
  | "confirmed"
  | "attended"
  | "no_show"
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
type StudioTabKey =
  | "dashboard"
  | "copy"
  | "lists"
  | "audience"
  | "launch"
  | "micro";

export default function CampaignsPage() {
  const { locale, t } = useI18n();
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
  const pauseCampaign = useMutation(api.campaigns.pauseCampaign);
  const resumeCampaign = useMutation(api.campaigns.resumeCampaign);
  const cancelCampaign = useMutation(api.campaigns.cancelCampaign);
  const retrySafeFailures = useMutation(api.campaigns.retrySafeFailures);
  const recordConversion = useMutation(api.campaigns.recordConversion);
  const sendMicroCampaignText = useAction(
    api.iaSolutionHub.sendMicroCampaignText,
  );
  const channels = useQuery(api.channels.list);

  const approvedTemplates = useMemo(
    () =>
      (templates ?? []).filter(
        (template) =>
          template.status === "approved" && template.parameterCount === 0,
      ),
    [templates],
  );
  const labChannels = useMemo(
    () =>
      (channels ?? []).filter(
        (channel) =>
          channel.provider === "iasolution_hub" &&
          channel.operationalTerritory === "openbsp",
      ),
    [channels],
  );
  const [microChannelId, setMicroChannelId] =
    useState<Id<"channels"> | "">("");
  const microThreads = useQuery(
    api.channels.listThreads,
    microChannelId ? { channelId: microChannelId, limit: 20 } : "skip",
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
  const [studioTab, setStudioTab] = useState<StudioTabKey>("dashboard");
  const [logCampaignId, setLogCampaignId] =
    useState<Id<"campaigns"> | null>(null);
  const [batchSize, setBatchSize] = useState(1000);
  const [microCampaignName, setMicroCampaignName] =
    useState("Micro agenda WhatsApp");
  const [microCampaignText, setMicroCampaignText] = useState(
    MICRO_CAMPAIGN_DEFAULT_TEXT,
  );
  const [selectedMicroThreadKeys, setSelectedMicroThreadKeys] = useState<
    string[]
  >([]);
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
      leadStatuses: audienceOpportunityStatus
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
  const campaignTotals = useMemo(() => {
    const initial = {
      runs: 0,
      total: 0,
      sent: 0,
      delivered: 0,
      read: 0,
      replied: 0,
      clicked: 0,
      converted: 0,
      failed: 0,
    };
    return (campaigns ?? []).reduce((totals, campaign) => {
      const sent = sentLikeCount(campaign.stats);
      return {
        runs: totals.runs + 1,
        total: totals.total + campaign.stats.total,
        sent: totals.sent + sent,
        delivered: totals.delivered + deliveredLikeCount(campaign.stats),
        read: totals.read + readLikeCount(campaign.stats),
        replied: totals.replied + campaign.stats.replied,
        clicked: totals.clicked + campaign.stats.clicked,
        converted: totals.converted + campaign.stats.converted,
        failed: totals.failed + campaign.stats.failed,
      };
    }, initial);
  }, [campaigns]);
  const logCampaign = useMemo(
    () => (campaigns ?? []).find((campaign) => campaign._id === logCampaignId),
    [campaigns, logCampaignId],
  );
  const campaignEvents = useQuery(
    api.campaigns.listEvents,
    logCampaignId ? { campaignId: logCampaignId, limit: 80 } : "skip",
  ) as CampaignEvent[] | undefined;
  const selectedMicroChannel = labChannels.find(
    (channel) => channel._id === microChannelId,
  );
  const selectedMicroThreads = useMemo(
    () =>
      (microThreads ?? []).filter((thread) =>
        selectedMicroThreadKeys.includes(thread.threadKey),
      ),
    [microThreads, selectedMicroThreadKeys],
  );
  const microCampaignReady =
    Boolean(microChannelId) &&
    selectedMicroThreadKeys.length > 0 &&
    microCampaignName.trim().length >= 2 &&
    microCampaignText.trim().length > 0 &&
    microCampaignText.trim().length <= 4_096;

  useEffect(() => {
    if (microChannelId || labChannels.length === 0) return;
    setMicroChannelId(labChannels[0]._id);
  }, [labChannels, microChannelId]);

  useEffect(() => {
    if (!microChannelId) return;
    if (labChannels.some((channel) => channel._id === microChannelId)) return;
    setMicroChannelId(labChannels[0]?._id ?? "");
  }, [labChannels, microChannelId]);

  useEffect(() => {
    if (!microThreads) return;
    setSelectedMicroThreadKeys((current) => {
      const available = new Set(microThreads.map((thread) => thread.threadKey));
      const kept = current.filter((threadKey) => available.has(threadKey));
      if (kept.length > 0) return kept;
      const firstOpen =
        microThreads.find((thread) => isMicroThreadWindowOpen(thread)) ??
        microThreads[0];
      return firstOpen ? [firstOpen.threadKey] : [];
    });
  }, [microThreads]);

  function toggleMicroThread(threadKey: string) {
    setSelectedMicroThreadKeys((current) =>
      current.includes(threadKey)
        ? current.filter((value) => value !== threadKey)
        : [...current, threadKey],
    );
  }

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
      setNotice(locale === "pt" ? "Lista de contactos criada." : "Contact list created.");
    } catch (err) {
      setError(readError(err, locale));
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
      setNotice(result.added
        ? locale === "pt" ? "Contacto adicionado à lista." : "Contact added to list."
        : locale === "pt" ? "O contacto já estava nesta lista." : "Contact was already in this list.");
    } catch (err) {
      setError(readError(err, locale));
    } finally {
      setBusy(null);
    }
  }

  async function handleSendMicroCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!microCampaignReady || !microChannelId) return;
    setBusy("micro-campaign");
    setError(null);
    setNotice(null);
    try {
      const result = await sendMicroCampaignText({
        channelId: microChannelId,
        threadKeys: selectedMicroThreadKeys,
        text: microCampaignText,
        campaignName: microCampaignName,
        clientNonce: crypto.randomUUID(),
      });
      setNotice(
        locale === "pt"
          ? `Teste enviado: ${result.accepted} aceites e ${result.failed} bloqueados pelas regras do canal.`
          : `WhatsApp test sent: ${result.accepted} accepted, ${result.failed} blocked by channel gates.`,
      );
      setStudioTab("dashboard");
    } catch (err) {
      setError(readError(err, locale));
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
      setNotice(locale === "pt" ? "Rascunho criado com os destinatários prontos para envio." : "Draft campaign created with recipients ready for launch.");
    } catch (err) {
      setError(readError(err, locale));
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
        locale === "pt"
          ? `Público guardado com ${result.added} contactos. ${result.excludedMarketingRevoked} recusas de marketing excluídas.`
          : `Audience saved with ${result.added} contacts. ${result.excludedMarketingRevoked} marketing opt-outs excluded.`,
      );
    } catch (err) {
      setError(readError(err, locale));
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
        locale === "pt"
          ? `Campanha iniciada: ${result.queued} na fila, ${result.pendingRemaining} a aguardar, ${result.skippedConsent} sem consentimento e ${result.skippedUnsuitable} incompatíveis.`
          : `Campaign launched: ${result.queued} queued, ${result.pendingRemaining} waiting, ${result.skippedConsent} skipped for consent, ${result.skippedUnsuitable} unsuitable.`,
      );
    } catch (err) {
      setError(readError(err, locale));
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
        locale === "pt"
          ? `Próximo lote em fila: ${result.queued} preparados, ${result.pendingRemaining} ainda a aguardar, ${result.skippedConsent} sem consentimento e ${result.skippedUnsuitable} incompatíveis.`
          : `Next batch queued: ${result.queued} queued, ${result.pendingRemaining} still waiting, ${result.skippedConsent} skipped for consent, ${result.skippedUnsuitable} unsuitable.`,
      );
    } catch (err) {
      setError(readError(err, locale));
    } finally {
      setBusy(null);
    }
  }

  async function handlePause(campaignId: Id<"campaigns">) {
    setBusy(`pause:${campaignId}`);
    setError(null);
    setNotice(null);
    try {
      await pauseCampaign({ campaignId, reason: "Paused by the clinic team." });
      setNotice(locale === "pt" ? "Campanha pausada. Nenhum novo lote será criado." : "Campaign paused. No new batch will be created.");
    } catch (err) {
      setError(readError(err, locale));
    } finally {
      setBusy(null);
    }
  }

  async function handleResume(campaignId: Id<"campaigns">) {
    setBusy(`resume:${campaignId}`);
    setError(null);
    setNotice(null);
    try {
      await resumeCampaign({ campaignId });
      setNotice(locale === "pt" ? "Campanha retomada do ponto em que parou." : "Campaign resumed from where it stopped.");
    } catch (err) {
      setError(readError(err, locale));
    } finally {
      setBusy(null);
    }
  }

  async function handleCancel(campaignId: Id<"campaigns">) {
    const confirmed = window.confirm(
      locale === "pt"
        ? "Cancelar esta campanha? Os envios ainda na fila serão bloqueados."
        : "Cancel this campaign? Sends still queued will be blocked.",
    );
    if (!confirmed) return;
    setBusy(`cancel:${campaignId}`);
    setError(null);
    setNotice(null);
    try {
      await cancelCampaign({ campaignId, reason: "Cancelled by the clinic team." });
      setNotice(locale === "pt" ? "Campanha cancelada com segurança." : "Campaign cancelled safely.");
    } catch (err) {
      setError(readError(err, locale));
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
        locale === "pt"
          ? `Repetição em fila: ${result.retried} falhas seguras, ${result.skippedUnsafe} falhas não seguras ignoradas e ${result.skippedConsent} sem consentimento.`
          : `Retry queued: ${result.retried} safe failures retried, ${result.skippedUnsafe} unsafe skipped, ${result.skippedConsent} skipped for consent.`,
      );
    } catch (err) {
      setError(readError(err, locale));
    } finally {
      setBusy(null);
    }
  }

  async function handleRecordConversion(
    campaignRecipientId: Id<"campaignRecipients">,
  ) {
    setBusy(`convert:${campaignRecipientId}`);
    setError(null);
    setNotice(null);
    try {
      const result = await recordConversion({
        campaignRecipientId,
        label: "Clinic conversion",
      });
      setNotice(
        result.converted
          ? locale === "pt" ? "Conversão registada nesta campanha." : "Conversion recorded for this campaign."
          : locale === "pt" ? "Este destinatário já estava marcado como convertido." : "This recipient was already marked as converted.",
      );
    } catch (err) {
      setError(readError(err, locale));
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
      setNotice(locale === "pt" ? `${rows.length} contactos com falha copiados como CSV.` : `Copied ${rows.length} failed contacts as CSV.`);
    } catch (err) {
      setError(readError(err, locale));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow={locale === "pt" ? "Campanhas" : "Broadcasts"}
        title={locale === "pt" ? "Campanhas" : "Campaigns"}
        description={
          locale === "pt"
            ? "Cria públicos, envia mensagens aprovadas e acompanha entregas, respostas, interações e conversões reais."
            : "Create audiences, send approved messages, and track real delivery, replies, interactions, and conversions."
        }
      />

      <div className="mx-auto max-w-7xl space-y-5 px-4 py-5 sm:px-6 xl:px-8">
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

        <SegmentedTabs
          selected={studioTab}
          onChange={(key) => setStudioTab(key as StudioTabKey)}
          items={[
            {
              key: "dashboard",
              label: locale === "pt" ? "Painel" : "Dashboard",
              value: `${campaigns?.length ?? 0} ${locale === "pt" ? "envios" : "runs"}`,
              icon: BarChart3,
            },
            {
              key: "copy",
              label: locale === "pt" ? "Mensagem" : "Message",
              value: `${approvedTemplates.length} ${locale === "pt" ? "aprovados" : "approved"}`,
              icon: Copy,
            },
            {
              key: "lists",
              label: locale === "pt" ? "Listas" : "Lists",
              value: `${lists?.length ?? 0} ${locale === "pt" ? "listas" : "folders"}`,
              icon: Table2,
            },
            {
              key: "audience",
              label: locale === "pt" ? "Públicos" : "Audiences",
              value: `${audiencePreview?.count ?? 0} ${locale === "pt" ? "encontrados" : "matched"}`,
              icon: Filter,
            },
            {
              key: "launch",
              label: locale === "pt" ? "Enviar" : "Launch",
              value: locale === "pt" ? "seguro" : "safe send",
              icon: Rocket,
            },
            {
              key: "micro",
              label: locale === "pt" ? "Teste WhatsApp" : "WhatsApp test",
              value: `${microThreads?.length ?? 0} ${locale === "pt" ? "conversas" : "threads"}`,
              icon: Zap,
            },
          ]}
        />

        {studioTab === "lists" && (
        <div className="grid gap-4 xl:grid-cols-2">
          <WorkflowPanel
            icon={FolderPlus}
            title={locale === "pt" ? "1. Criar público" : "1. Create audience"}
            subtitle={
              locale === "pt"
                ? "Agrupa pacientes ou leads que devem receber a campanha."
                : "Group patients or leads that should receive the campaign."
            }
          >
            <form className="space-y-3" onSubmit={handleCreateList}>
              <TextInput
                label={locale === "pt" ? "Nome da lista" : "List name"}
                value={listName}
                onChange={setListName}
                placeholder={locale === "pt" ? "Pacientes interessados" : "Interested patients"}
              />
              <TextInput
                label={locale === "pt" ? "Descrição" : "Description"}
                value={listDescription}
                onChange={setListDescription}
                placeholder={locale === "pt" ? "Nota interna opcional" : "Optional internal note"}
              />
              <SubmitButton
                disabled={busy !== null || listName.trim().length < 2}
                loading={busy === "list"}
                icon={Plus}
              >
                {locale === "pt" ? "Criar lista" : "Create list"}
              </SubmitButton>
            </form>
          </WorkflowPanel>

          <WorkflowPanel
            icon={Users}
            title={locale === "pt" ? "2. Adicionar contactos" : "2. Add contacts"}
            subtitle={
              locale === "pt"
                ? "Escolhe contactos existentes ou importa um CSV para esta lista."
                : "Pick existing contacts or import CSV rows into this list."
            }
          >
            <form className="space-y-3" onSubmit={handleAddContact}>
              <SelectBox
                label={locale === "pt" ? "Lista de destino" : "Target list"}
                value={selectedListId}
                onChange={(value) =>
                  setSelectedListId(value as Id<"contactLists"> | "")
                }
                options={(lists ?? []).map((list) => ({
                  value: list._id,
                  label: `${list.name} (${list.memberCount})`,
                }))}
                placeholder={locale === "pt" ? "Escolher lista" : "Choose list"}
              />
              <SelectBox
                label={locale === "pt" ? "Contacto" : "Contact"}
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
                    (locale === "pt" ? "Contacto desconhecido" : "Unknown contact"),
                }))}
                placeholder={locale === "pt" ? "Escolher contacto" : "Choose contact"}
              />
              <SubmitButton
                disabled={
                  busy !== null || !selectedListId || !selectedContactId
                }
                loading={busy === "contact"}
                icon={ListPlus}
              >
                {locale === "pt" ? "Adicionar à lista" : "Add to list"}
              </SubmitButton>
              <button
                type="button"
                onClick={() => setImportOpen(true)}
                disabled={!selectedListId || busy !== null}
                className="w-full inline-flex items-center justify-center gap-2 border border-slate-200 bg-white text-[#0a1b33] text-[13px] font-medium px-4 py-2 rounded-lg hover:border-slate-300 disabled:opacity-50 transition-all"
              >
                <Upload size={14} />
                {locale === "pt" ? "Importar CSV para lista" : "Import CSV to list"}
              </button>
            </form>
          </WorkflowPanel>
        </div>
        )}

        {studioTab === "launch" && (
          <WorkflowPanel
            icon={Megaphone}
            title={locale === "pt" ? "3. Confirmar envio seguro" : "3. Confirm safe send"}
            subtitle={
              locale === "pt"
                ? "Escolhe público e template aprovado antes de criar o rascunho."
                : "Choose audience and approved template before creating the draft."
            }
          >
            {templates !== undefined &&
              approvedTemplates.length === 0 &&
              labChannels.length > 0 && (
                <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] text-amber-900">
                  <div className="font-semibold">
                    {locale === "pt"
                      ? "Campanhas por template ainda exigem uma ligação WhatsApp direta (Meta)."
                      : "Template campaigns still require a direct WhatsApp (Meta) connection."}
                  </div>
                  <p className="mt-0.5 leading-relaxed">
                    {locale === "pt"
                      ? "No canal do piloto, use a micro-campanha: texto livre para até 10 conversas com a janela de 24h aberta. As campanhas em massa no canal chegam na próxima fase."
                      : "On the pilot channel, use the micro campaign: free text to up to 10 conversations with an open 24h window. Bulk campaigns on the channel arrive in the next phase."}
                  </p>
                  <button
                    type="button"
                    onClick={() => setStudioTab("micro")}
                    className="mt-2 inline-flex h-8 items-center rounded-md bg-[#0a152d] px-3 text-[11px] font-semibold text-white hover:bg-[#0a1b33]"
                  >
                    {locale === "pt" ? "Abrir micro-campanha" : "Open micro campaign"}
                  </button>
                </div>
              )}
            <form className="space-y-3" onSubmit={handleCreateCampaign}>
              <TextInput
                label={locale === "pt" ? "Nome da campanha" : "Campaign name"}
                value={campaignName}
                onChange={setCampaignName}
                placeholder={locale === "pt" ? "Agenda da semana" : "Weekly agenda"}
              />
              <SelectBox
                label={locale === "pt" ? "Público" : "Audience"}
                value={selectedListId}
                onChange={(value) =>
                  setSelectedListId(value as Id<"contactLists"> | "")
                }
                options={(lists ?? []).map((list) => ({
                  value: list._id,
                  label: `${list.name} (${list.memberCount})`,
                }))}
                placeholder={locale === "pt" ? "Escolher lista" : "Choose list"}
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
                placeholder={locale === "pt" ? "Escolher template aprovado" : "Choose approved template"}
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
                {locale === "pt" ? "Criar rascunho" : "Create draft"}
              </SubmitButton>
            </form>
          </WorkflowPanel>
        )}

        {studioTab === "micro" && (
          <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <WorkflowPanel
              icon={Zap}
              title={locale === "pt" ? "Teste WhatsApp" : "WhatsApp test"}
              subtitle={
                locale === "pt"
                  ? "Envio pequeno pelo canal Hub isolado, só para validar campanha real."
                  : "Small send through the isolated Hub channel, only to validate a real campaign."
              }
            >
              <form className="space-y-4" onSubmit={handleSendMicroCampaign}>
                <div className="grid gap-3 lg:grid-cols-2">
                  <TextInput
                    label={locale === "pt" ? "Nome da campanha" : "Campaign name"}
                    value={microCampaignName}
                    onChange={setMicroCampaignName}
                    placeholder={locale === "pt" ? "Micro agenda WhatsApp" : "Micro agenda WhatsApp"}
                  />
                  <SelectBox
                    label={locale === "pt" ? "Canal" : "Channel"}
                    value={microChannelId}
                    onChange={(value) => {
                      setMicroChannelId(value as Id<"channels"> | "");
                      setSelectedMicroThreadKeys([]);
                    }}
                    options={labChannels.map((channel) => ({
                      value: channel._id,
                      label: `${channel.displayName} · ${sendModeLabel(channel.sendMode, locale)}`,
                    }))}
                    placeholder={locale === "pt" ? "Escolher canal isolado" : "Choose isolated channel"}
                  />
                </div>

                <div>
                  <span className="mb-2 block text-[11px] font-medium text-slate-500">
                    {locale === "pt" ? "Destinatários" : "Recipients"}
                  </span>
                  <div className="grid max-h-64 gap-2 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-2">
                    {channels === undefined || microThreads === undefined ? (
                      <div className="rounded-lg bg-white px-3 py-3 text-sm text-slate-400">
                        {locale === "pt" ? "A carregar destinatários..." : "Loading recipients..."}
                      </div>
                    ) : labChannels.length === 0 ? (
                      <div className="rounded-lg bg-white px-3 py-3 text-sm text-slate-500">
                        {locale === "pt" ? "Sem canal Hub isolado conectado." : "No isolated Hub channel connected."}
                      </div>
                    ) : microThreads.length === 0 ? (
                      <div className="rounded-lg bg-white px-3 py-3 text-sm text-slate-500">
                        {locale === "pt" ? "Ainda não há conversas inbound com mensagens." : "No inbound threads with message events yet."}
                      </div>
                    ) : (
                      microThreads.map((thread) => {
                        const selected = selectedMicroThreadKeys.includes(
                          thread.threadKey,
                        );
                        const windowOpen = isMicroThreadWindowOpen(thread);
                        return (
                          <button
                            key={thread.threadKey}
                            type="button"
                            onClick={() => toggleMicroThread(thread.threadKey)}
                            className={`flex min-h-16 w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                              selected
                                ? "border-[#0a152d] bg-white"
                                : "border-slate-200 bg-white hover:border-slate-300"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => toggleMicroThread(thread.threadKey)}
                              onClick={(event) => event.stopPropagation()}
                              className="h-4 w-4 shrink-0 accent-[#0a152d]"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold text-[#0a1b33]">
                                {thread.displayName ??
                                  thread.phone ??
                                  thread.threadKey}
                              </span>
                              <span className="mt-0.5 block truncate text-xs text-slate-500">
                                {thread.lastPreview ?? thread.lastEventKind}
                              </span>
                            </span>
                            <span
                              className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold ${
                                windowOpen
                                  ? "bg-emerald-50 text-emerald-700"
                                  : "bg-amber-50 text-amber-700"
                              }`}
                            >
                              {windowOpen
                                ? locale === "pt"
                                  ? "24h aberta"
                                  : "24h open"
                                : locale === "pt"
                                  ? "precisa template"
                                  : "template needed"}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>

                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-slate-500">
                    {locale === "pt" ? "Mensagem" : "Message"}
                  </span>
                  <textarea
                    value={microCampaignText}
                    onChange={(event) => setMicroCampaignText(event.target.value)}
                    rows={8}
                    className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm leading-6 text-[#0a1b33] outline-none transition-colors placeholder:text-slate-300 focus:border-slate-400"
                  />
                </label>

                <div className="grid gap-2 sm:grid-cols-3">
                  <Metric
                    label={locale === "pt" ? "selecionados" : "selected"}
                    value={selectedMicroThreadKeys.length}
                  />
                  <Metric
                    label={locale === "pt" ? "24h aberta" : "24h open"}
                    value={selectedMicroThreads.filter(isMicroThreadWindowOpen).length}
                  />
                  <Metric label={locale === "pt" ? "caracteres" : "chars"} value={microCampaignText.length} />
                </div>

                {selectedMicroChannel && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
                    {selectedMicroChannel.displayName} ·{" "}
                    {channelStateLabel(selectedMicroChannel.connectionState, locale)} ·{" "}
                    Webhook {channelStateLabel(selectedMicroChannel.webhookStatus, locale)}
                  </div>
                )}

                <SubmitButton
                  disabled={busy !== null || !microCampaignReady}
                  loading={busy === "micro-campaign"}
                  icon={Zap}
                >
                  {locale === "pt" ? "Enviar teste" : "Send test"}
                </SubmitButton>
              </form>
            </WorkflowPanel>

            <WhatsAppIosPreview
              title={locale === "pt" ? "Prévia da campanha" : "Campaign preview"}
              subtitle={microCampaignName}
              category="marketing"
              bodyText={
                microCampaignText.trim() ||
                (locale === "pt"
                  ? "Escreve a mensagem da campanha para pré-visualizar aqui."
                  : "Write the campaign message to preview it here.")
              }
              buttons={[]}
              examples={{}}
              hasMarketingOptIn={selectedMicroThreads.some(isMicroThreadWindowOpen)}
              serviceWindowOpen={selectedMicroThreads.some(
                isMicroThreadWindowOpen,
              )}
              freeEntryWindowOpen={false}
            />
          </section>
        )}

        {studioTab === "copy" && (
        <section className="grid gap-4 xl:grid-cols-[360px_1fr]">
          <WhatsAppIosPreview
            title={locale === "pt" ? "Prévia no WhatsApp" : "WhatsApp preview"}
            subtitle={
              locale === "pt"
                ? "Confirma como a mensagem aparece antes do envio."
                : "Check how the message feels before launch."
            }
            category={asTemplateCategory(selectedTemplate?.category)}
            bodyText={
              selectedTemplate?.bodyText ??
              (locale === "pt"
                ? "Escolhe um template aprovado para pré-visualizar a mensagem."
                : "Choose an approved template to preview the message here.")
            }
            buttons={selectedTemplate?.buttons ?? []}
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
            title={locale === "pt" ? "Mensagem e regras de envio" : "Message and send rules"}
            subtitle={
              locale === "pt"
                ? "Valida consentimento, janela de atendimento e categoria antes de enviar."
                : "Validate consent, service window, and category before sending."
            }
          >
            <div className="grid gap-3 md:grid-cols-3">
              <Toggle
                label={locale === "pt" ? "Público aceitou campanha" : "Audience has opt-in"}
                checked={campaignHasMarketingOptIn}
                onChange={setCampaignHasMarketingOptIn}
              />
              <Toggle
                label={locale === "pt" ? "Janela 24h aberta" : "Customer 24h window open"}
                checked={campaignServiceWindowOpen}
                onChange={setCampaignServiceWindowOpen}
              />
              <Toggle
                label={locale === "pt" ? "Entrada WhatsApp aberta" : "WhatsApp entry window open"}
                checked={campaignFreeEntryOpen}
                onChange={setCampaignFreeEntryOpen}
              />
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              <StrategyTile
                title={locale === "pt" ? "Janela primeiro" : "Window first"}
                body={
                  locale === "pt"
                    ? "Se o paciente já conversou, responde dentro da janela aberta antes de criar novo envio."
                    : "If the patient already talked to you, use the open service window before a new broadcast."
                }
              />
              <StrategyTile
                title={locale === "pt" ? "Pequeno, depois escala" : "Small, then scale"}
                body={
                  locale === "pt"
                    ? "Começa com poucos contactos, verifica entregas, respostas e bloqueios, depois aumenta."
                    : "Start with a small cohort, inspect delivery, replies, and blocks, then increase."
                }
              />
              <StrategyTile
                title={locale === "pt" ? "Segmentar intenção" : "Segment intent"}
                body={
                  locale === "pt"
                    ? "Prioriza interessados, quem pediu preço, quem quer agendar e quem já respondeu."
                    : "Prioritize interested leads, price requests, booking intent, and recent responders."
                }
              />
            </div>
          </WorkflowPanel>
        </section>
        )}

        {studioTab === "audience" && (
        <WorkflowPanel
          icon={SlidersHorizontal}
          title={locale === "pt" ? "Construtor de públicos" : "Audience builder"}
          subtitle={locale === "pt" ? "Cria segmentos reutilizáveis por consentimento, tags, origem, etapa e comportamento em campanhas." : "Build reusable lead segments from consent, tags, source, pipeline stage, and campaign behavior."}
        >
          <form className="space-y-4" onSubmit={handleSaveAudience}>
            <div className="grid gap-3 lg:grid-cols-[1.2fr_0.7fr_1.1fr]">
              <TextInput
                label={locale === "pt" ? "Nome do público" : "Saved list name"}
                value={audienceName}
                onChange={setAudienceName}
                placeholder={locale === "pt" ? "Interessados em agendamento" : "Booking intent audience"}
              />
              <SelectBox
                label={locale === "pt" ? "Combinação" : "Match mode"}
                value={audienceLogic}
                onChange={(value) => setAudienceLogic(value as AudienceLogic)}
                options={[
                  { value: "all", label: locale === "pt" ? "Todos os filtros" : "All filters" },
                  { value: "any", label: locale === "pt" ? "Qualquer filtro" : "Any filter" },
                ]}
                placeholder={locale === "pt" ? "Como combinar" : "Match mode"}
              />
              <TextInput
                label={locale === "pt" ? "Pesquisa" : "Search"}
                value={audienceSearch}
                onChange={setAudienceSearch}
                placeholder={locale === "pt" ? "Nome, telefone ou username" : "Name, phone, or username"}
              />
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <TextInput
                label={locale === "pt" ? "Incluir tags" : "Include tags"}
                value={audienceIncludeTags}
                onChange={setAudienceIncludeTags}
                placeholder={locale === "pt" ? "vip, interessados" : "vip, interested"}
              />
              <TextInput
                label={locale === "pt" ? "Excluir tags" : "Exclude tags"}
                value={audienceExcludeTags}
                onChange={setAudienceExcludeTags}
                placeholder={locale === "pt" ? "não_contactar, menor" : "do_not_contact, minor"}
              />
              <SelectBox
                label={locale === "pt" ? "Consentimento de marketing" : "Marketing consent"}
                value={audienceMarketingConsent}
                onChange={(value) =>
                  setAudienceMarketingConsent(value as ConsentFilter)
                }
                options={[
                  { value: "any", label: locale === "pt" ? "Qualquer" : "Any" },
                  { value: "granted", label: locale === "pt" ? "Concedido" : "Granted" },
                  { value: "unknown", label: locale === "pt" ? "Desconhecido" : "Unknown" },
                  { value: "revoked", label: locale === "pt" ? "Revogado" : "Revoked" },
                ]}
                placeholder={locale === "pt" ? "Qualquer" : "Any"}
              />
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <SelectBox
                label={locale === "pt" ? "Consentimento de atendimento" : "Service consent"}
                value={audienceTransactionalConsent}
                onChange={(value) =>
                  setAudienceTransactionalConsent(value as ConsentFilter)
                }
                options={[
                  { value: "any", label: locale === "pt" ? "Qualquer" : "Any" },
                  { value: "granted", label: locale === "pt" ? "Concedido" : "Granted" },
                  { value: "unknown", label: locale === "pt" ? "Desconhecido" : "Unknown" },
                  { value: "revoked", label: locale === "pt" ? "Revogado" : "Revoked" },
                ]}
                placeholder={locale === "pt" ? "Qualquer" : "Any"}
              />
              <SelectBox
                label={locale === "pt" ? "Origem do lead" : "Lead source"}
                value={audienceLeadSource}
                onChange={(value) =>
                  setAudienceLeadSource(value as LeadSourceFilter)
                }
                options={[
                  { value: "ctwa", label: locale === "pt" ? "Anúncio WhatsApp" : "CTWA ad lead" },
                  { value: "organic", label: locale === "pt" ? "Entrada orgânica" : "Organic inbound" },
                  { value: "campaign_reply", label: locale === "pt" ? "Resposta de campanha" : "Campaign reply" },
                  { value: "unknown", label: locale === "pt" ? "Desconhecida" : "Unknown" },
                ]}
                placeholder={locale === "pt" ? "Qualquer origem" : "Any source"}
              />
              <SelectBox
                label={locale === "pt" ? "Etapa do lead" : "Lead stage"}
                value={audienceOpportunityStatus}
                onChange={(value) =>
                  setAudienceOpportunityStatus(value as OpportunityStatusFilter)
                }
                options={(
                  ["new", "interested", "asked_price", "wants_booking", "awaiting_human", "booked", "confirmed", "attended", "no_show", "lost"] as const
                ).map((status) => ({ value: status, label: t(`status.${status}` as TranslationKey) }))}
                placeholder={locale === "pt" ? "Qualquer etapa" : "Any stage"}
              />
              <SelectBox
                label={locale === "pt" ? "Janela do anúncio" : "CTWA window"}
                value={audienceCtwaWindow}
                onChange={(value) =>
                  setAudienceCtwaWindow(value as CtwaWindowFilter)
                }
                options={[
                  { value: "any", label: locale === "pt" ? "Qualquer" : "Any" },
                  { value: "open", label: locale === "pt" ? "Aberta" : "Open" },
                  { value: "expiring_6h", label: locale === "pt" ? "Expira em 6h" : "Expiring in 6h" },
                  { value: "expired", label: locale === "pt" ? "Expirada" : "Expired" },
                ]}
                placeholder={locale === "pt" ? "Qualquer" : "Any"}
              />
            </div>

            <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr]">
              <SelectBox
                label={locale === "pt" ? "Comportamento na campanha" : "Campaign behavior"}
                value={audienceCampaignOutcome}
                onChange={(value) =>
                  setAudienceCampaignOutcome(value as CampaignOutcomeFilter)
                }
                options={[
                  { value: "clicked", label: locale === "pt" ? "Interagiu" : "Clicked" },
                  { value: "replied", label: locale === "pt" ? "Respondeu" : "Replied" },
                  { value: "failed", label: locale === "pt" ? "Falhou" : "Failed" },
                  { value: "read", label: locale === "pt" ? "Leu" : "Read" },
                  { value: "delivered", label: locale === "pt" ? "Recebeu" : "Delivered" },
                  { value: "sent", label: locale === "pt" ? "Enviado" : "Sent" },
                ]}
                placeholder={locale === "pt" ? "Qualquer resultado" : "Any outcome"}
              />
              <DateInput
                label={locale === "pt" ? "Criado depois de" : "Created after"}
                value={audienceCreatedAfter}
                onChange={setAudienceCreatedAfter}
              />
              <DateInput
                label={locale === "pt" ? "Última mensagem depois de" : "Last message after"}
                value={audienceLastMessageAfter}
                onChange={setAudienceLastMessageAfter}
              />
            </div>

            <div className="grid gap-3 lg:grid-cols-[1fr_2fr_auto] lg:items-stretch">
              <Toggle
                label={locale === "pt" ? "Excluir recusas de marketing" : "Exclude marketing opt-outs"}
                checked={audienceExcludeMarketingRevoked}
                onChange={setAudienceExcludeMarketingRevoked}
              />
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="inline-flex items-center gap-2 font-semibold text-[#0a1b33]">
                    <Users size={15} />
                    {audiencePreview?.count ?? 0} {locale === "pt" ? "encontrados" : "matched"}
                  </span>
                  <span className="inline-flex items-center gap-2 font-medium text-emerald-700">
                    <ShieldCheck size={15} />
                    {audiencePreview?.excludedMarketingRevoked ?? 0} {locale === "pt" ? "recusas excluídas" : "opt-outs excluded"}
                  </span>
                  <span className="inline-flex items-center gap-2 font-medium text-slate-500">
                    <Filter size={15} />
                    {audiencePreview?.activeFilters ?? 0} {locale === "pt" ? "filtros" : "filters"}
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
                      {locale === "pt" ? "Ainda sem contactos correspondentes." : "No matching contacts yet."}
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
                  {locale === "pt" ? "Guardar público" : "Save audience"}
                </SubmitButton>
              </div>
            </div>
          </form>
        </WorkflowPanel>
        )}

        {studioTab === "dashboard" && (
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="px-5 py-4 border-b border-slate-100 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="font-[var(--font-outfit)] text-[18px] font-medium text-[#0a1b33]">
                {locale === "pt" ? "Campanhas reais" : "Real campaigns"}
              </h2>
              <p className="text-sm text-slate-500 mt-0.5">
                {locale === "pt"
                  ? "Acompanha estado por destinatário, falhas, respostas, interações e conversões."
                  : "Track per-recipient state, failures, replies, interactions, and conversions."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setStudioTab("launch")}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#0a152d] px-3 text-sm font-medium text-white transition-colors hover:bg-[#0a1b33]"
            >
              <Plus size={15} />
              {locale === "pt" ? "Criar campanha" : "Create campaign"}
            </button>
          </div>

          <div className="grid gap-3 border-b border-slate-100 p-5 sm:grid-cols-2 xl:grid-cols-5">
            <DashboardMetric
              icon={Radio}
              label={locale === "pt" ? "Envios" : "Runs"}
              value={campaignTotals.runs}
              detail={`${campaignTotals.total.toLocaleString()} ${
                locale === "pt" ? "destinatários" : "recipients"
              }`}
            />
            <DashboardMetric
              icon={Send}
              label={locale === "pt" ? "Enviados" : "Sent"}
              value={campaignTotals.sent}
              detail={`${rate(campaignTotals.sent, campaignTotals.total).toFixed(1)}% ${
                locale === "pt" ? "alcance" : "reach"
              }`}
            />
            <DashboardMetric
              icon={MousePointerClick}
              label={locale === "pt" ? "Interações" : "Clicks"}
              value={campaignTotals.clicked}
              detail={`${rate(campaignTotals.clicked, Math.max(campaignTotals.sent, 1)).toFixed(1)}% CTR`}
            />
            <DashboardMetric
              icon={MessageSquare}
              label={locale === "pt" ? "Respostas" : "Replies"}
              value={campaignTotals.replied}
              detail={`${rate(campaignTotals.replied, Math.max(campaignTotals.sent, 1)).toFixed(1)}% ${
                locale === "pt" ? "resposta" : "response"
              }`}
            />
            <DashboardMetric
              icon={BadgeCheck}
              label={locale === "pt" ? "Conversões" : "Conversions"}
              value={campaignTotals.converted}
              detail={`${rate(campaignTotals.converted, Math.max(campaignTotals.sent, 1)).toFixed(1)}% CVR`}
            />
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
                  placeholder={locale === "pt" ? "Pesquisar campanhas..." : "Search campaigns..."}
                  className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-3 text-sm text-[#0a1b33] outline-none transition-colors placeholder:text-slate-400 focus:border-slate-400"
                />
              </label>
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50">
                <span className="h-3 w-3 rounded-full bg-emerald-500" />
              </span>
              <select className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-[#0a1b33] outline-none focus:border-slate-400">
                <option>{locale === "pt" ? "6 por página" : "6 per page"}</option>
                <option>{locale === "pt" ? "12 por página" : "12 per page"}</option>
                <option>{locale === "pt" ? "24 por página" : "24 per page"}</option>
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
                        ? "bg-[#0a152d] text-white"
                        : "bg-white text-[#0a1b33] hover:bg-slate-50"
                    }`}
                  >
                    <Icon size={15} />
                    {locale === "pt" ? broadcastTabLabelPt(tab.key) : tab.label}
                  </button>
                );
              })}
            </div>
            <div className="mt-4 max-w-xs">
              <label className="text-xs font-medium text-slate-500">
                {locale === "pt" ? "Tamanho do lote manual" : "Manual batch size"}
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
            <div className="p-8 text-sm text-slate-400">
              {locale === "pt" ? "A carregar campanhas..." : "Loading campaigns..."}
            </div>
          ) : campaigns.length === 0 ? (
            <div className="p-10 text-center">
              <Send size={26} className="mx-auto text-slate-300 mb-3" />
              <h3 className="font-[var(--font-outfit)] text-[18px] font-medium text-[#0a1b33]">
                {locale === "pt" ? "Ainda sem campanhas" : "No campaign drafts yet"}
              </h3>
              <p className="text-sm text-slate-500 mt-1">
                {locale === "pt"
                  ? "Cria um rascunho com template ou envia um teste WhatsApp para começar a medir eventos reais."
                  : "Create a template broadcast or send a WhatsApp test to start tracking real events."}
              </p>
            </div>
          ) : filteredCampaigns.length === 0 ? (
            <div className="p-10 text-center">
              <Search size={26} className="mx-auto text-slate-300 mb-3" />
              <h3 className="font-[var(--font-outfit)] text-[18px] font-medium text-[#0a1b33]">
                {locale === "pt" ? "Nenhuma campanha encontrada" : "No campaigns match"}
              </h3>
              <p className="text-sm text-slate-500 mt-1">
                {locale === "pt"
                  ? "Limpa a pesquisa ou muda o filtro de estado."
                  : "Clear search or switch status filters."}
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
                  onPause={handlePause}
                  onResume={handleResume}
                  onCancel={handleCancel}
                  onRetrySafe={handleRetrySafe}
                  onCopyFailed={handleCopyFailedContacts}
                  onOpenLog={() => setLogCampaignId(campaign._id)}
                />
              ))}
            </div>
          )}
        </section>
        )}
      </div>

      {logCampaign && (
        <CampaignLogDrawer
          campaign={logCampaign}
          events={campaignEvents}
          busy={busy}
          onRecordConversion={handleRecordConversion}
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
  converted: number;
  failed: number;
  skipped: number;
};

type CampaignSummary = {
  _id: Id<"campaigns">;
  name: string;
  kind: "template_broadcast" | "micro_lab" | "channel_template" | "channel_text";
  status: string;
  channelName?: string;
  contentPreview?: string;
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
  startedAt?: number;
  completedAt?: number;
  createdAt: number;
  updatedAt?: number;
};

type CampaignEvent = {
  _id: Id<"campaignEvents">;
  type: string;
  createdAt: number;
  messageId?: Id<"messages">;
  campaignRecipientId?: Id<"campaignRecipients">;
  payload?: unknown;
  recipient?: {
    contactId: Id<"contacts">;
    displayName: string;
    identityKind: "phone" | "bsuid";
    identityValue: string;
    status: string;
    failureCode?: string;
    failureReason?: string;
    metaErrorCategory?: string;
    sentAt?: number;
    deliveredAt?: number;
    readAt?: number;
    repliedAt?: number;
    clickedAt?: number;
    convertedAt?: number;
    conversionLabel?: string;
  };
};

function BroadcastCard({
  campaign,
  busy,
  onLaunch,
  onSendNextBatch,
  onPause,
  onResume,
  onCancel,
  onRetrySafe,
  onCopyFailed,
  onOpenLog,
}: {
  campaign: CampaignSummary;
  busy: string | null;
  onLaunch: (campaignId: Id<"campaigns">) => void;
  onSendNextBatch: (campaignId: Id<"campaigns">) => void;
  onPause: (campaignId: Id<"campaigns">) => void;
  onResume: (campaignId: Id<"campaigns">) => void;
  onCancel: (campaignId: Id<"campaigns">) => void;
  onRetrySafe: (campaignId: Id<"campaigns">) => void;
  onCopyFailed: (campaignId: Id<"campaigns">) => void;
  onOpenLog: () => void;
}) {
  const { locale } = useI18n();
  const sent = sentLikeCount(campaign.stats);
  const delivered = deliveredLikeCount(campaign.stats);
  const read = readLikeCount(campaign.stats);
  const clicked = campaign.stats.clicked;
  const converted = campaign.stats.converted;
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
        ? "border-l-[#0a152d]"
          : "border-l-slate-300";
  const statusLabel =
    campaign.status === "paused" && pendingBatch > 0
      ? locale === "pt" ? "envio parcial" : "partially sent"
      : campaignStatusLabel(campaign.status, locale);

  return (
    <article
      className={`flex min-h-[520px] flex-col rounded-lg border border-l-4 border-slate-200 bg-white shadow-[0_18px_70px_-48px_rgba(15,23,42,0.55)] ${stripe}`}
    >
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-[#0a1b33]">
              {campaign.name}
            </h3>
            <p className="mt-1 text-xs font-medium text-slate-500">
              # {friendlyCampaignId(campaign._id)} · {relativeTime(campaign.createdAt, Date.now(), locale)}
            </p>
          </div>
          <button type="button" onClick={onOpenLog} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-[#0a1b33]" aria-label={locale === "pt" ? "Abrir log da campanha" : "Open campaign log"}><MoreHorizontal size={17} /></button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {campaign.status === "draft" && (
            <ActionPill
              icon={Send}
              label={locale === "pt" ? "Iniciar" : "Launch"}
              loading={busy === `launch:${campaign._id}`}
              onClick={() => onLaunch(campaign._id)}
              disabled={busy !== null}
              tone="dark"
            />
          )}
          {campaign.status === "running" && pendingRecipients > 0 && (
            <ActionPill
              icon={Radio}
              label={locale === "pt" ? "Enviar próximo lote" : "Send next batch"}
              loading={busy === `next:${campaign._id}`}
              onClick={() => onSendNextBatch(campaign._id)}
              disabled={busy !== null}
              tone="orange"
            />
          )}
          {campaign.status === "running" && (
            <ActionPill
              icon={Pause}
              label={locale === "pt" ? "Pausar" : "Pause"}
              loading={busy === `pause:${campaign._id}`}
              onClick={() => onPause(campaign._id)}
              disabled={busy !== null}
            />
          )}
          {campaign.status === "paused" && (
            <ActionPill
              icon={Play}
              label={locale === "pt" ? "Retomar" : "Resume"}
              loading={busy === `resume:${campaign._id}`}
              onClick={() => onResume(campaign._id)}
              disabled={busy !== null}
              tone="dark"
            />
          )}
          {["draft", "scheduled", "running", "paused"].includes(campaign.status) && (
            <ActionPill
              icon={Ban}
              label={locale === "pt" ? "Cancelar" : "Cancel"}
              loading={busy === `cancel:${campaign._id}`}
              onClick={() => onCancel(campaign._id)}
              disabled={busy !== null}
            />
          )}
          {campaign.failureBreakdown.some((failure) => failure.retrySafe) && (
            <ActionPill
              icon={RotateCcw}
              label={locale === "pt" ? "Repetir falhas seguras" : "Retry safe failures"}
              loading={busy === `retry:${campaign._id}`}
              onClick={() => onRetrySafe(campaign._id)}
              disabled={busy !== null}
            />
          )}
          <ActionPill icon={BarChart3} label={locale === "pt" ? "Atividade" : "Activity"} onClick={onOpenLog} />
        </div>

        {(pendingRecipients > 0 || campaign.pauseReason) && (
          <div className="mt-4 rounded-xl border border-orange-200 bg-orange-50 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-orange-600" />
              <div>
                <div className="text-sm font-semibold text-orange-800">
                  {locale === "pt" ? "Controlo de lotes" : "Batch control"}
                </div>
                <p className="mt-1 text-sm leading-6 text-orange-700">
                  {campaign.pauseReason ??
                    (locale === "pt"
                      ? `${(campaign.stats.total - pendingRecipients).toLocaleString()} de ${campaign.stats.total.toLocaleString()} contactos processados. ${pendingRecipients.toLocaleString()} aguardam o próximo lote.`
                      : `${(campaign.stats.total - pendingRecipients).toLocaleString()} of ${campaign.stats.total.toLocaleString()} contacts processed. ${pendingRecipients.toLocaleString()} waiting for the next manual batch.`)}
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
            {locale === "pt" ? "Medição real" : "Real tracking"}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
            {campaign.kind === "micro_lab" ? (locale === "pt" ? "Teste WhatsApp" : "WhatsApp test") : "Template"}
          </span>
        </div>

        <div className="mt-4 flex items-center gap-2 text-sm font-semibold text-slate-500">
          <FileText size={15} />
          <span className="truncate">
            {campaign.kind === "micro_lab"
              ? campaign.channelName ?? (locale === "pt" ? "Canal de teste" : "Test channel")
              : campaign.templateName ?? (locale === "pt" ? "Sem template" : "No template")}
          </span>
          <span className="text-xs">
            {campaign.kind === "micro_lab" ? "(hub)" : "(template)"}
          </span>
        </div>

        {campaign.contentPreview && (
          <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500">
            {campaign.contentPreview}
          </p>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2 xl:grid-cols-3">
          <BroadcastMetric icon={Send} label={locale === "pt" ? "Enviados" : "Sent"} value={`${sent}/${campaign.stats.total}`} />
          <BroadcastMetric icon={CheckCircle2} label={locale === "pt" ? "Entregues" : "Delivered"} value={delivered} />
          <BroadcastMetric icon={MessageSquare} label={locale === "pt" ? "Lidos" : "Read"} value={read} />
          <BroadcastMetric icon={MousePointerClick} label={locale === "pt" ? "Interações" : "Clicks"} value={clicked} />
          <BroadcastMetric icon={BadgeCheck} label={locale === "pt" ? "Conversões" : "Converted"} value={converted} />
          <BroadcastMetric
            icon={XCircle}
            label={locale === "pt" ? "Falhas" : "Failed"}
            value={campaign.stats.failed}
            danger
          />
        </div>

        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <ProgressRow label={locale === "pt" ? "Taxa de envio" : "Sent rate"} value={rate(sent, campaign.stats.total)} />
          <ProgressRow
            label={locale === "pt" ? "Taxa de entrega" : "Delivery rate"}
            value={rate(delivered, Math.max(sent, 1))}
          />
          <ProgressRow label={locale === "pt" ? "Taxa de leitura" : "Read rate"} value={rate(read, Math.max(delivered, 1))} />
          <ProgressRow
            label={locale === "pt" ? "Taxa de interação" : "Click rate"}
            value={rate(clicked, Math.max(sent, 1))}
          />
          <ProgressRow
            label={locale === "pt" ? "Taxa de conversão" : "Conversion rate"}
            value={rate(converted, Math.max(sent, 1))}
          />
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
            {locale === "pt" ? "criada" : "created"} {relativeTime(campaign.createdAt, Date.now(), locale)}
          </div>
          <button
            type="button"
            onClick={() => onOpenLog()}
            className="mt-3 flex w-full items-center justify-between rounded-xl border border-violet-100 bg-violet-50 px-3 py-3 text-sm font-medium text-violet-700"
          >
            <span className="inline-flex items-center gap-2">
              <MessageSquare size={15} />
              {locale === "pt" ? "Respostas e conversões" : "Replies and conversions"}
            </span>
            <span>{campaign.stats.replied + campaign.stats.clicked + converted}</span>
          </button>
        </div>
      </div>

      <div className="border-t border-slate-100 px-5 py-3 text-xs font-medium text-slate-500">
        {locale === "pt" ? "Criada" : "Created"}: {new Date(campaign.createdAt).toLocaleString(locale === "pt" ? "pt-MZ" : "en-GB")}
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
            {locale === "pt" ? "Copiar falhas em CSV" : "Copy failed CSV"}
          </button>
        </div>
      )}
    </article>
  );
}

function CampaignLogDrawer({
  campaign,
  events,
  busy,
  onRecordConversion,
  onClose,
}: {
  campaign: CampaignSummary;
  events: CampaignEvent[] | undefined;
  busy: string | null;
  onRecordConversion: (campaignRecipientId: Id<"campaignRecipients">) => void;
  onClose: () => void;
}) {
  const { locale } = useI18n();
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
                {locale === "pt" ? "Atividade em tempo real" : "Real-time activity"} · ID: {friendlyCampaignId(campaign._id)}
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

        <div className="grid grid-cols-3 gap-y-4 border-b border-slate-100 px-6 py-5 text-center sm:grid-cols-6">
          <DrawerStat label="Total" value={campaign.stats.total} />
          <DrawerStat label={locale === "pt" ? "Enviados" : "Sent"} value={sent} tone="emerald" />
          <DrawerStat label={locale === "pt" ? "Interações" : "Clicks"} value={campaign.stats.clicked} tone="blue" />
          <DrawerStat label="Conv." value={campaign.stats.converted} tone="emerald" />
          <DrawerStat label={locale === "pt" ? "Falhas" : "Failed"} value={campaign.stats.failed} tone="red" />
          <DrawerStat label={locale === "pt" ? "Progresso" : "Progress"} value={`${progress.toFixed(1)}%`} tone="blue" />
        </div>

        <div className="max-h-[calc(100vh-260px)] space-y-3 overflow-y-auto p-6 pb-28">
          {events === undefined ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm font-medium text-slate-500">
              {locale === "pt" ? "A carregar eventos da campanha..." : "Loading campaign events..."}
            </div>
          ) : events.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-semibold text-[#0a1b33]">
                {locale === "pt" ? "Ainda sem eventos registados" : "No events recorded yet"}
              </div>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                {locale === "pt" ? "Inicia ou processa a campanha para preencher esta atividade." : "Launch or process this campaign to populate the event stream."}
              </p>
            </div>
          ) : (
            events.map((event) => {
              const tone = eventTone(event);
              const canConvert =
                Boolean(event.campaignRecipientId) &&
                Boolean(event.recipient) &&
                !event.recipient?.convertedAt &&
                !["failed", "skipped"].includes(event.recipient?.status ?? "") &&
                (event.type.includes("clicked") ||
                  event.type.includes("replied") ||
                  event.type.includes("read") ||
                  event.type.includes("delivered"));
              return (
                <LogEvent
                  key={event._id}
                  kind={eventKind(event, locale)}
                  time={new Date(event.createdAt).toLocaleTimeString()}
                  message={eventMessage(event, locale)}
                  detail={eventDetail(event, locale)}
                  tone={tone}
                  action={
                    canConvert && event.campaignRecipientId ? (
                      <button
                        type="button"
                        onClick={() => onRecordConversion(event.campaignRecipientId!)}
                        disabled={busy !== null}
                        className="mt-3 inline-flex h-8 items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-700 transition-colors hover:border-emerald-300 disabled:opacity-50"
                      >
                        {busy === `convert:${event.campaignRecipientId}` ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <BadgeCheck size={13} />
                        )}
                        {locale === "pt" ? "Marcar conversão" : "Mark converted"}
                      </button>
                    ) : undefined
                  }
                />
              );
            })
          )}
        </div>

        <div className="absolute bottom-0 right-0 flex w-full max-w-xl items-center justify-between border-t border-slate-100 bg-white px-6 py-4 text-sm text-slate-500">
          <span>
            {events === undefined ? (locale === "pt" ? "A carregar eventos" : "Loading events") : `${events.length} ${locale === "pt" ? "eventos" : "events"}`}
          </span>
          <span>{locale === "pt" ? "Última atualização" : "Last update"}: {new Date(campaign.updatedAt ?? campaign.createdAt).toLocaleTimeString(locale === "pt" ? "pt-MZ" : "en-GB")}</span>
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

function DashboardMetric({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: LucideIcon;
  label: string;
  value: number | string;
  detail: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          {label}
        </span>
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white text-[#0a1b33]">
          <Icon size={15} />
        </span>
      </div>
      <div className="mt-2 text-xl font-semibold text-[#0a1b33]">{value}</div>
      <div className="mt-1 text-xs font-medium text-slate-500">{detail}</div>
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
            className="h-full rounded-full bg-[#0a152d]"
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
  detail,
  tone,
  action,
}: {
  kind: string;
  time: string;
  message: string;
  detail?: string;
  tone: "good" | "warn" | "bad" | "neutral";
  action?: ReactNode;
}) {
  const toneClass =
    tone === "bad"
      ? "bg-red-50 text-red-700"
      : tone === "warn"
        ? "bg-amber-50 text-amber-700"
        : tone === "good"
          ? "bg-emerald-50 text-emerald-700"
          : "bg-slate-100 text-slate-600";
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <span className={`rounded-lg px-2 py-1 text-xs font-semibold ${toneClass}`}>
          {kind}
        </span>
        <span className="text-xs font-medium text-slate-500">{time}</span>
      </div>
      <p className="mt-2 text-sm font-medium text-[#0a1b33]">{message}</p>
      {detail && (
        <p className="mt-1 break-words text-xs leading-5 text-slate-500">
          {detail}
        </p>
      )}
      {action}
    </div>
  );
}

function eventTone(event: CampaignEvent): "good" | "warn" | "bad" | "neutral" {
  if (
    event.type.includes("failed") ||
    event.type.includes("auto_paused") ||
    event.recipient?.status === "failed"
  ) {
    return "bad";
  }
  if (event.type.includes("skipped") || event.type.includes("retry")) {
    return "warn";
  }
  if (
    event.type.includes("sent") ||
    event.type.includes("delivered") ||
    event.type.includes("read") ||
    event.type.includes("replied") ||
    event.type.includes("clicked") ||
    event.type.includes("converted")
  ) {
    return "good";
  }
  return "neutral";
}

function eventKind(event: CampaignEvent, locale: "pt" | "en"): string {
  if (event.type.includes("auto_paused")) return locale === "pt" ? "Pausa de segurança" : "Safety pause";
  if (event.type.includes("failed")) return locale === "pt" ? "Falha" : "Failure";
  if (event.type.includes("retry")) return locale === "pt" ? "Repetição" : "Retry";
  if (event.type.includes("skipped")) return locale === "pt" ? "Ignorado" : "Skipped";
  if (event.type.includes("converted")) return locale === "pt" ? "Conversão" : "Conversion";
  if (event.type.includes("replied") || event.type.includes("clicked")) {
    return locale === "pt" ? "Interação" : "Engagement";
  }
  if (
    event.type.includes("sent") ||
    event.type.includes("delivered") ||
    event.type.includes("read")
  ) {
    return locale === "pt" ? "Entrega" : "Delivery";
  }
  return locale === "pt" ? "Evento" : "Event";
}

function eventMessage(event: CampaignEvent, locale: "pt" | "en"): string {
  const label = humanizeEventType(event.type, locale);
  if (!event.recipient) return label;
  return `${label} · ${event.recipient.displayName}`;
}

function eventDetail(event: CampaignEvent, locale: "pt" | "en"): string | undefined {
  const parts: string[] = [];
  if (event.recipient) {
    const identityLabel =
      event.recipient.identityKind === "bsuid" ? "ID" : event.recipient.identityKind.toUpperCase();
    parts.push(
      `${identityLabel}: ${event.recipient.identityValue}`,
    );
    parts.push(`${locale === "pt" ? "estado" : "status"}: ${campaignStatusLabel(event.recipient.status, locale)}`);
    if (event.recipient.metaErrorCategory) {
      parts.push(`${locale === "pt" ? "categoria" : "category"}: ${event.recipient.metaErrorCategory}`);
    }
    if (event.recipient.sentAt) {
      parts.push(`${locale === "pt" ? "enviado" : "sent"}: ${new Date(event.recipient.sentAt).toLocaleString(locale === "pt" ? "pt-MZ" : "en-GB")}`);
    }
    if (event.recipient.deliveredAt) {
      parts.push(
        `${locale === "pt" ? "entregue" : "delivered"}: ${new Date(event.recipient.deliveredAt).toLocaleString(locale === "pt" ? "pt-MZ" : "en-GB")}`,
      );
    }
    if (event.recipient.readAt) {
      parts.push(`${locale === "pt" ? "lido" : "read"}: ${new Date(event.recipient.readAt).toLocaleString(locale === "pt" ? "pt-MZ" : "en-GB")}`);
    }
    if (event.recipient.clickedAt) {
      parts.push(
        `${locale === "pt" ? "interação" : "clicked"}: ${new Date(event.recipient.clickedAt).toLocaleString(locale === "pt" ? "pt-MZ" : "en-GB")}`,
      );
    }
    if (event.recipient.convertedAt) {
      parts.push(
        `${locale === "pt" ? "convertido" : "converted"}: ${new Date(event.recipient.convertedAt).toLocaleString(locale === "pt" ? "pt-MZ" : "en-GB")}`,
      );
    }
    if (event.recipient.conversionLabel) {
      parts.push(`${locale === "pt" ? "conversão" : "conversion"}: ${event.recipient.conversionLabel}`);
    }
    if (event.recipient.failureCode) {
      parts.push(`Meta code: ${event.recipient.failureCode}`);
    }
    if (event.recipient.failureReason) {
      parts.push(event.recipient.failureReason);
    }
  }
  const payload = compactPayload(event.payload);
  if (payload) parts.push(payload);
  return parts.length ? parts.join(" · ") : undefined;
}

function humanizeEventType(type: string, locale: "pt" | "en"): string {
  const clean = type
    .replace(/^campaign\./, "")
    .replace(/^recipient\./, "")
    .replace(/\./g, " ")
    .replace(/_/g, " ");
  const normalized = clean.toLowerCase();
  const labels: Record<string, [string, string]> = {
    sent: ["Mensagem enviada", "Message sent"],
    delivered: ["Mensagem entregue", "Message delivered"],
    read: ["Mensagem lida", "Message read"],
    replied: ["Paciente respondeu", "Patient replied"],
    clicked: ["Paciente interagiu", "Patient clicked"],
    converted: ["Conversão registada", "Conversion recorded"],
    failed: ["Envio falhou", "Send failed"],
    queued: ["Envio na fila", "Send queued"],
  };
  const translated = labels[normalized];
  return translated ? translated[locale === "pt" ? 0 : 1] : clean.charAt(0).toUpperCase() + clean.slice(1);
}

function campaignStatusLabel(status: string, locale: "pt" | "en"): string {
  const labels: Record<string, [string, string]> = {
    draft: ["rascunho", "draft"],
    scheduled: ["agendada", "scheduled"],
    running: ["em execução", "running"],
    paused: ["pausada", "paused"],
    completed: ["concluída", "completed"],
    cancelled: ["cancelada", "cancelled"],
    failed: ["falhou", "failed"],
    pending: ["pendente", "pending"],
    queued: ["na fila", "queued"],
    dispatching: ["a enviar", "sending"],
    sent: ["enviada", "sent"],
    delivered: ["entregue", "delivered"],
    read: ["lida", "read"],
    replied: ["respondeu", "replied"],
    clicked: ["interagiu", "clicked"],
    converted: ["convertida", "converted"],
    skipped: ["ignorada", "skipped"],
  };
  const translated = labels[status];
  return translated ? translated[locale === "pt" ? 0 : 1] : status.replace(/_/g, " ");
}

function compactPayload(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const entries = Object.entries(payload as Record<string, unknown>)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${String(value).slice(0, 80)}`);
  return entries.length ? entries.join(" · ") : undefined;
}

function matchesBroadcastFilter(status: string, filter: BroadcastFilter): boolean {
  if (filter === "all") return true;
  if (filter === "active") return status === "running" || status === "paused";
  return status === filter;
}

function broadcastTabLabelPt(filter: BroadcastFilter): string {
  switch (filter) {
    case "all":
      return "Todas";
    case "active":
      return "Ativas";
    case "scheduled":
      return "Agendadas";
    case "completed":
      return "Concluídas";
    case "cancelled":
      return "Canceladas";
    case "failed":
      return "Falhadas";
  }
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
  return Math.min(100, Math.max(0, (value / total) * 100));
}

function normalizedBatchSize(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(5000, Math.max(1, Math.floor(value)));
}

function isMicroThreadWindowOpen(thread: { serviceWindowExpiresAt?: number }) {
  return (
    thread.serviceWindowExpiresAt !== undefined &&
    thread.serviceWindowExpiresAt > Date.now()
  );
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
    <section id={id} className="scroll-mt-24 rounded-lg border border-slate-200 bg-white p-5">
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

function readError(err: unknown, locale: Locale = "pt"): string {
  return convexErrorMessage(err, locale, locale === "pt" ? "Algo correu mal." : "Something went wrong.");
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
