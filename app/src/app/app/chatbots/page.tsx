"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useMutation, useQuery } from "convex/react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type OnEdgesDelete,
  type OnNodeDrag,
} from "@xyflow/react";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  BrainCircuit,
  CheckCircle2,
  CopyPlus,
  FolderPlus,
  GitBranch,
  History,
  ListTree,
  Loader2,
  MessageSquare,
  PauseCircle,
  PlayCircle,
  Plus,
  Radio,
  Save,
  Send,
  Settings2,
  Smartphone,
  Sparkles,
  Split,
  Tag,
  Trash2,
  UploadCloud,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/app/EmptyState";
import { SegmentedTabs } from "@/components/app/SegmentedTabs";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { relativeTime } from "@/lib/relativeTime";

type ChatbotStatus = "draft" | "active" | "paused";
type TriggerKind = "inbound" | "keyword" | "ctwa" | "handoff";
type StudioTab = "bots" | "flows";
type BuilderTab = "design" | "settings" | "runs";
type FlowNodeType =
  | "start"
  | "send_message"
  | "send_buttons"
  | "send_list"
  | "collect_input"
  | "condition"
  | "set_tag"
  | "handoff"
  | "end";
type ConditionOperator = "equals" | "contains" | "present" | "absent";
type FlowNodePosition = { x: number; y: number };

type FlowNode = {
  key: string;
  type: FlowNodeType;
  title: string;
  body?: string;
  nextKey?: string;
  position?: FlowNodePosition;
  variableKey?: string;
  tag?: string;
  condition?: {
    variableKey: string;
    operator: ConditionOperator;
    value?: string;
    trueNextKey: string;
    falseNextKey: string;
  };
  buttons?: Array<{
    replyId: string;
    label: string;
    nextKey: string;
  }>;
};

type FlowIssue = {
  severity: "error" | "warning";
  scope: "flow" | "trigger" | "node";
  nodeKey?: string;
  field?: string;
  message: string;
};

type FlowTemplate = {
  slug: "welcome_menu" | "clinic_lead_capture" | "faq_handoff";
  name: string;
  description: string;
  triggerKind: TriggerKind;
  nodeCount: number;
};

type BotRow = {
  _id: Id<"chatbots">;
  folderId?: Id<"chatbotFolders">;
  folderName?: string;
  name: string;
  description?: string;
  status: ChatbotStatus;
  triggerKind: TriggerKind;
  triggerKeywords?: string[];
  model?: string;
  entryNodeKey?: string;
  flowNodes?: FlowNode[];
  nodeCount: number;
  flowValidationIssues: FlowIssue[];
  channel: "whatsapp";
  createdAt: number;
  updatedAt: number;
};

type FolderRow = {
  _id: Id<"chatbotFolders">;
  name: string;
  botCount: number;
  createdAt: number;
  updatedAt: number;
};

type FlowRunRow = {
  _id: Id<"chatbotFlowRuns">;
  status: string;
  currentNodeKey?: string;
  vars?: Record<string, string>;
  repromptCount: number;
  startedAt: number;
  lastAdvancedAt: number;
  endedAt?: number;
  endReason?: string;
  contactName?: string;
  contactHandle?: string;
  eventCount: number;
  events: Array<{
    _id: Id<"chatbotFlowEvents">;
    eventType: string;
    nodeKey?: string;
    payload?: unknown;
    createdAt: number;
  }>;
};

const STATUS_STYLES: Record<ChatbotStatus, string> = {
  active: "border-emerald-200 bg-emerald-50 text-emerald-700",
  draft: "border-slate-200 bg-slate-50 text-slate-600",
  paused: "border-amber-200 bg-amber-50 text-amber-700",
};

const TRIGGER_COPY: Record<TriggerKind, string> = {
  inbound: "All inbound messages",
  keyword: "Keyword match",
  ctwa: "Click-to-WhatsApp lead",
  handoff: "Human handoff follow-up",
};

const NODE_TYPE_LABELS: Record<FlowNodeType, string> = {
  start: "Start",
  send_message: "Send message",
  send_buttons: "Button menu",
  send_list: "List menu",
  collect_input: "Collect input",
  condition: "Condition",
  set_tag: "Set tag",
  handoff: "Human handoff",
  end: "End",
};

const FLOW_NODE_TYPES: FlowNodeType[] = [
  "send_message",
  "send_buttons",
  "send_list",
  "collect_input",
  "condition",
  "set_tag",
  "handoff",
  "end",
];

export default function ChatbotsPage() {
  const studio = useQuery(api.chatbots.list);
  const createFolder = useMutation(api.chatbots.createFolder);
  const createBot = useMutation(api.chatbots.createBot);
  const updateFlow = useMutation(api.chatbots.updateFlow);
  const applyTemplate = useMutation(api.chatbots.applyTemplate);
  const updateStatus = useMutation(api.chatbots.updateStatus);
  const [folderName, setFolderName] = useState("");
  const [botName, setBotName] = useState("");
  const [botDescription, setBotDescription] = useState("");
  const [selectedFolderId, setSelectedFolderId] =
    useState<Id<"chatbotFolders"> | "">("");
  const [triggerKind, setTriggerKind] = useState<TriggerKind>("ctwa");
  const [templateSlug, setTemplateSlug] =
    useState<FlowTemplate["slug"]>("clinic_lead_capture");
  const [studioTab, setStudioTab] = useState<StudioTab>("flows");
  const [selectedBotId, setSelectedBotId] =
    useState<Id<"chatbots"> | "">("");
  const [flowEntryNodeKey, setFlowEntryNodeKey] = useState("");
  const [flowTriggerKind, setFlowTriggerKind] = useState<TriggerKind>("ctwa");
  const [flowKeywords, setFlowKeywords] = useState("");
  const [flowNodes, setFlowNodes] = useState<FlowNode[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const folders = (studio?.folders ?? []) as FolderRow[];
  const bots = (studio?.bots ?? []) as BotRow[];
  const templates = (studio?.templates ?? []) as FlowTemplate[];
  const selectedFolder = useMemo(
    () => folders.find((folder) => folder._id === selectedFolderId),
    [folders, selectedFolderId],
  );
  const visibleBots = selectedFolderId
    ? bots.filter((bot) => bot.folderId === selectedFolderId)
    : bots;
  const selectedBot = useMemo(
    () => bots.find((bot) => bot._id === selectedBotId) ?? visibleBots[0],
    [bots, selectedBotId, visibleBots],
  );
  const flowRuns = useQuery(
    api.chatbotFlows.listRuns,
    selectedBot ? { chatbotId: selectedBot._id, limit: 12 } : "skip",
  ) as FlowRunRow[] | undefined;
  const flowIssues = selectedBot?.flowValidationIssues ?? [];
  const flowErrors = flowIssues.filter((issue) => issue.severity === "error");
  const flowWarnings = flowIssues.filter((issue) => issue.severity === "warning");

  useEffect(() => {
    if (!selectedBotId && visibleBots[0]) {
      setSelectedBotId(visibleBots[0]._id);
    }
  }, [selectedBotId, visibleBots]);

  useEffect(() => {
    if (!selectedBot) return;
    setFlowEntryNodeKey(selectedBot.entryNodeKey ?? selectedBot.flowNodes?.[0]?.key ?? "");
    setFlowTriggerKind(selectedBot.triggerKind);
    setFlowKeywords((selectedBot.triggerKeywords ?? []).join(", "));
    setFlowNodes(selectedBot.flowNodes ?? []);
  }, [selectedBot]);

  async function handleCreateFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("folder");
    setNotice(null);
    setError(null);
    try {
      const id = await createFolder({ name: folderName });
      setSelectedFolderId(id);
      setFolderName("");
      setNotice("Folder created.");
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleCreateBot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("bot");
    setNotice(null);
    setError(null);
    try {
      const template = templates.find((item) => item.slug === templateSlug);
      await createBot({
        name: botName,
        description: botDescription || undefined,
        folderId: selectedFolderId || undefined,
        triggerKind: template?.triggerKind ?? triggerKind,
        model: "CXCast guardrail bot",
        templateSlug,
      });
      setBotName("");
      setBotDescription("");
      setStudioTab("flows");
      setNotice("Bot drafted with a flow template.");
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleSaveFlow() {
    if (!selectedBot) return;
    setBusy("flow");
    setNotice(null);
    setError(null);
    try {
      const issues = await updateFlow({
        chatbotId: selectedBot._id,
        triggerKind: flowTriggerKind,
        triggerKeywords: commaList(flowKeywords),
        entryNodeKey: flowEntryNodeKey,
        nodes: flowNodes,
      });
      const errors = issues.filter((issue) => issue.severity === "error");
      setNotice(
        errors.length > 0
          ? `Flow saved as draft with ${errors.length} blocker(s).`
          : "Flow saved and ready to activate.",
      );
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(null);
    }
  }

  async function handlePublishFlow() {
    if (!selectedBot) return;
    setBusy("publish");
    setNotice(null);
    setError(null);
    try {
      const issues = await updateFlow({
        chatbotId: selectedBot._id,
        triggerKind: flowTriggerKind,
        triggerKeywords: commaList(flowKeywords),
        entryNodeKey: flowEntryNodeKey,
        nodes: flowNodes,
      });
      const errors = issues.filter((issue) => issue.severity === "error");
      if (errors.length > 0) {
        setNotice(`Flow saved as draft with ${errors.length} blocker(s).`);
        return;
      }
      await updateStatus({ chatbotId: selectedBot._id, status: "active" });
      setNotice("Flow validated and published.");
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleApplyTemplate(slug: FlowTemplate["slug"]) {
    if (!selectedBot) return;
    setBusy(`template:${slug}`);
    setNotice(null);
    setError(null);
    try {
      await applyTemplate({ chatbotId: selectedBot._id, templateSlug: slug });
      setNotice("Template applied to flow.");
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(null);
    }
  }

  function updateNode(index: number, patch: Partial<FlowNode>) {
    setFlowNodes((nodes) =>
      nodes.map((node, itemIndex) =>
        itemIndex === index ? { ...node, ...patch } : node,
      ),
    );
  }

  function addNode(type: FlowNodeType, position?: FlowNodePosition) {
    const key = uniqueNodeKey(flowNodes, type);
    const node = { ...defaultNode(key, type), position };
    setFlowNodes((nodes) => [...nodes, node]);
    if (!flowEntryNodeKey) setFlowEntryNodeKey(node.key);
    return node.key;
  }

  function removeNode(index: number) {
    setFlowNodes((nodes) => nodes.filter((_, itemIndex) => itemIndex !== index));
  }

  async function setBotStatus(botId: Id<"chatbots">, status: ChatbotStatus) {
    setBusy(`status:${botId}`);
    setNotice(null);
    setError(null);
    try {
      await updateStatus({ chatbotId: botId, status });
      setNotice(status === "active" ? "Bot activated." : "Bot updated.");
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(null);
    }
  }

  const flowBuilder = (
    <FlowBuilder
      bots={visibleBots}
      selectedBot={selectedBot}
      selectedBotId={selectedBotId}
      onSelectBot={setSelectedBotId}
      templates={templates}
      busy={busy}
      triggerKind={flowTriggerKind}
      onTriggerKindChange={setFlowTriggerKind}
      keywords={flowKeywords}
      onKeywordsChange={setFlowKeywords}
      entryNodeKey={flowEntryNodeKey}
      onEntryNodeKeyChange={setFlowEntryNodeKey}
      nodes={flowNodes}
      issues={flowIssues}
      errors={flowErrors}
      warnings={flowWarnings}
      onUpdateNode={updateNode}
      onRemoveNode={removeNode}
      onAddNode={addNode}
      onSave={handleSaveFlow}
      onPublish={handlePublishFlow}
      onApplyTemplate={handleApplyTemplate}
      onOpenBots={() => setStudioTab("bots")}
      runs={flowRuns ?? []}
      runsLoading={Boolean(selectedBot && flowRuns === undefined)}
    />
  );

  if (studioTab === "flows") {
    return (
      <div className="min-h-[calc(100vh-64px)] bg-[#f4f7fb] p-3 sm:p-4">
        <div className="space-y-3">
          {(notice || error) && (
            <div
              className={`rounded-lg border px-4 py-3 text-sm ${
                error
                  ? "border-red-200 bg-red-50 text-red-700"
                  : "border-emerald-200 bg-emerald-50 text-emerald-700"
              }`}
            >
              {error ?? notice}
            </div>
          )}
          {flowBuilder}
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Automation studio"
        title="Chatbots"
        description="Build WhatsApp bots that qualify leads, respect DND, and hand off safely to humans."
        action={
          <div className="flex flex-wrap gap-2">
            <a
              href="#create-folder"
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-[#0a1b33] transition-colors hover:border-slate-300"
            >
              <FolderPlus size={15} />
              Create folder
            </a>
            <a
              href="#create-bot"
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-emerald-600 px-3 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
            >
              <Plus size={15} />
              Create bot
            </a>
            <button
              type="button"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-emerald-600 text-white transition-colors hover:bg-emerald-700"
              aria-label="Import bot"
            >
              <UploadCloud size={17} />
            </button>
          </div>
        }
      />

      <div className="min-h-[calc(100vh-105px)] bg-[#f7f9fc] px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl space-y-5">
          {(notice || error) && (
            <div
              className={`rounded-xl border px-4 py-3 text-sm ${
                error
                  ? "border-red-200 bg-red-50 text-red-700"
                  : "border-emerald-200 bg-emerald-50 text-emerald-700"
              }`}
            >
              {error ?? notice}
            </div>
          )}

          <SegmentedTabs
            selected={studioTab}
            onChange={(key) => setStudioTab(key as StudioTab)}
            items={[
              {
                key: "flows",
                label: "Flow Builder",
                value: `${selectedBot?.nodeCount ?? 0} nodes`,
                icon: Workflow,
              },
              {
                key: "bots",
                label: "Bot Library",
                value: `${bots.length} bots`,
                icon: Bot,
              },
            ]}
          />

          <section className="grid gap-3 md:grid-cols-4">
            <StatCard
              icon={Bot}
              label="Bots"
              value={studio?.stats.total ?? 0}
              note="WhatsApp automations"
            />
            <StatCard
              icon={Radio}
              label="Active"
              value={studio?.stats.active ?? 0}
              note="Responding now"
            />
            <StatCard
              icon={PauseCircle}
              label="Paused"
              value={studio?.stats.paused ?? 0}
              note="Manual review"
            />
            <StatCard
              icon={Sparkles}
              label="Draft"
              value={studio?.stats.draft ?? 0}
              note="Ready to refine"
            />
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-[var(--font-outfit)] text-lg font-semibold text-[#0a1b33]">
                  Folders
                </h2>
                <p className="text-sm text-slate-500">
                  Keep campaign bots, support bots, and qualification bots
                  separated.
                </p>
              </div>
              {selectedFolder && (
                <button
                  type="button"
                  onClick={() => setSelectedFolderId("")}
                  className="text-sm font-medium text-violet-600"
                >
                  Show all bots
                </button>
              )}
            </div>

            {studio === undefined ? (
              <div className="grid gap-3 md:grid-cols-3">
                {[0, 1, 2].map((item) => (
                  <div
                    key={item}
                    className="h-20 animate-pulse rounded-xl border border-slate-100 bg-slate-50"
                  />
                ))}
              </div>
            ) : folders.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center">
                <FolderPlus size={24} className="mx-auto text-slate-300" />
                <p className="mt-3 text-sm font-semibold text-[#0a1b33]">
                  No folders yet
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  Create a folder for campaigns, support, or CTWA lead flows.
                </p>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-3">
                {folders.map((folder) => {
                  const active = selectedFolderId === folder._id;
                  return (
                    <button
                      key={folder._id}
                      type="button"
                      onClick={() => setSelectedFolderId(folder._id)}
                      className={`flex min-h-20 items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all ${
                        active
                          ? "border-violet-200 bg-violet-50"
                          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                        <FolderPlus size={17} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-[#0a1b33]">
                          {folder.name}
                        </span>
                        <span className="mt-0.5 block text-xs text-slate-500">
                          {folder.botCount} bot{folder.botCount === 1 ? "" : "s"}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
            <aside className="space-y-5">
              <section
                id="create-folder"
                className="scroll-mt-24 rounded-2xl border border-slate-200 bg-white p-5"
              >
                <PanelTitle
                  icon={FolderPlus}
                  title="Create a folder"
                  body="A folder is the operational home for related bots."
                />
                <form className="mt-4 space-y-3" onSubmit={handleCreateFolder}>
                  <TextInput
                    label="Folder name"
                    value={folderName}
                    onChange={setFolderName}
                    placeholder="Campanhas"
                  />
                  <SubmitButton
                    disabled={busy !== null || folderName.trim().length < 2}
                    loading={busy === "folder"}
                    icon={FolderPlus}
                  >
                    Create folder
                  </SubmitButton>
                </form>
              </section>

              <section
                id="create-bot"
                className="scroll-mt-24 rounded-2xl border border-slate-200 bg-white p-5"
              >
                <PanelTitle
                  icon={Bot}
                  title="Create a bot"
                  body="Start with a guarded WhatsApp automation, then tune the flow."
                />
                <form className="mt-4 space-y-3" onSubmit={handleCreateBot}>
                  <TextInput
                    label="Bot name"
                    value={botName}
                    onChange={setBotName}
                    placeholder="Campanha LPG qualifier"
                  />
                  <TextInput
                    label="Description"
                    value={botDescription}
                    onChange={setBotDescription}
                    placeholder="Qualifies CTWA leads before agent handoff"
                  />
                  <SelectBox
                    label="Folder"
                    value={selectedFolderId}
                    onChange={(value) =>
                      setSelectedFolderId(value as Id<"chatbotFolders"> | "")
                    }
                    options={folders.map((folder) => ({
                      value: folder._id,
                      label: folder.name,
                    }))}
                    placeholder="No folder"
                  />
                  <SelectBox
                    label="Starter flow"
                    value={templateSlug}
                    onChange={(value) =>
                      setTemplateSlug(value as FlowTemplate["slug"])
                    }
                    options={templates.map((template) => ({
                      value: template.slug,
                      label: `${template.name} (${template.nodeCount})`,
                    }))}
                    placeholder="Blank"
                  />
                  <SelectBox
                    label="Trigger"
                    value={triggerKind}
                    onChange={(value) => setTriggerKind(value as TriggerKind)}
                    options={[
                      { value: "ctwa", label: TRIGGER_COPY.ctwa },
                      { value: "inbound", label: TRIGGER_COPY.inbound },
                      { value: "keyword", label: TRIGGER_COPY.keyword },
                      { value: "handoff", label: TRIGGER_COPY.handoff },
                    ]}
                    placeholder="Choose trigger"
                  />
                  <SubmitButton
                    disabled={busy !== null || botName.trim().length < 2}
                    loading={busy === "bot"}
                    icon={Plus}
                  >
                    Draft bot
                  </SubmitButton>
                </form>
              </section>
            </aside>

            <section className="rounded-2xl border border-slate-200 bg-white">
              <div className="flex flex-col gap-2 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="font-[var(--font-outfit)] text-lg font-semibold text-[#0a1b33]">
                    {selectedFolder ? selectedFolder.name : "All bots"}
                  </h2>
                  <p className="text-sm text-slate-500">
                    Activation stays explicit so a bot never takes over a human
                    conversation by accident.
                  </p>
                </div>
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                  {visibleBots.length} total
                </span>
              </div>

              {studio === undefined ? (
                <div className="p-5">
                  <div className="h-40 animate-pulse rounded-xl bg-slate-50" />
                </div>
              ) : visibleBots.length === 0 ? (
                <div className="p-10 text-center">
                  <Bot size={28} className="mx-auto text-slate-300" />
                  <h3 className="mt-3 font-[var(--font-outfit)] text-lg font-semibold text-[#0a1b33]">
                    No bots in this view
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Draft a CTWA, inbound, keyword, or handoff automation.
                  </p>
                </div>
              ) : (
                <div className="grid gap-4 p-5 2xl:grid-cols-2">
                  {visibleBots.map((bot) => (
                    <article
                      key={bot._id}
                      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_18px_60px_-44px_rgba(15,23,42,0.45)]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 gap-3">
                          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
                            <Bot size={19} />
                          </span>
                          <div className="min-w-0">
                            <h3 className="truncate text-base font-semibold text-[#0a1b33]">
                              {bot.name}
                            </h3>
                            <p className="mt-1 text-sm leading-6 text-slate-500">
                              {bot.description ??
                                "No description yet. Add a purpose before activation."}
                            </p>
                          </div>
                        </div>
                        <span
                          className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${STATUS_STYLES[bot.status]}`}
                        >
                          {bot.status}
                        </span>
                      </div>

                      <div className="mt-5 grid gap-2 sm:grid-cols-3">
                        <BotMeta icon={Zap} label="Trigger" value={TRIGGER_COPY[bot.triggerKind]} />
                        <BotMeta icon={BrainCircuit} label="Model" value={bot.model ?? "CXCast guardrail bot"} />
                        <BotMeta icon={Radio} label="Updated" value={relativeTime(bot.updatedAt)} />
                      </div>

                      <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                        {bot.status !== "active" && (
                          <button
                            type="button"
                            onClick={() => setBotStatus(bot._id, "active")}
                            disabled={busy !== null}
                            className="inline-flex h-9 items-center gap-2 rounded-lg bg-emerald-600 px-3 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
                          >
                            {busy === `status:${bot._id}` ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <CheckCircle2 size={14} />
                            )}
                            Activate
                          </button>
                        )}
                        {bot.status === "active" && (
                          <button
                            type="button"
                            onClick={() => setBotStatus(bot._id, "paused")}
                            disabled={busy !== null}
                            className="inline-flex h-9 items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-100 disabled:opacity-50"
                          >
                            {busy === `status:${bot._id}` ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <PauseCircle size={14} />
                            )}
                            Pause
                          </button>
                        )}
                        {bot.status !== "draft" && (
                          <button
                            type="button"
                            onClick={() => setBotStatus(bot._id, "draft")}
                            disabled={busy !== null}
                            className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-[#0a1b33] transition-colors hover:border-slate-300 disabled:opacity-50"
                          >
                            Move to draft
                          </button>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </>
  );
}

type FlowCanvasNodeData = {
  flowNode: FlowNode;
  isEntry: boolean;
  issueCount: number;
  hasError: boolean;
};

type FlowCanvasNode = Node<FlowCanvasNodeData, "flowStep">;

const STEP_CATALOG: Array<{
  type: FlowNodeType;
  label: string;
  detail: string;
  icon: LucideIcon;
}> = [
  {
    type: "send_message",
    label: "Send Message",
    detail: "Plain WhatsApp text with a next step.",
    icon: MessageSquare,
  },
  {
    type: "collect_input",
    label: "Ask Question",
    detail: "Collect a reply into a variable.",
    icon: Send,
  },
  {
    type: "send_buttons",
    label: "Button Menu",
    detail: "1-3 quick replies with branches.",
    icon: GitBranch,
  },
  {
    type: "send_list",
    label: "List",
    detail: "Up to 10 list rows with branches.",
    icon: ListTree,
  },
  {
    type: "condition",
    label: "Condition",
    detail: "Route true and false paths.",
    icon: Split,
  },
  {
    type: "set_tag",
    label: "Set Tag",
    detail: "Mark the lead before continuing.",
    icon: Tag,
  },
  {
    type: "handoff",
    label: "Handoff",
    detail: "Pause automation for a human.",
    icon: UploadCloud,
  },
  {
    type: "end",
    label: "End",
    detail: "Finish the automation path.",
    icon: CheckCircle2,
  },
];

const FLOW_CANVAS_NODE_TYPES = { flowStep: FlowCanvasStepNode };

function FlowBuilder({
  bots,
  selectedBot,
  selectedBotId,
  onSelectBot,
  templates,
  busy,
  triggerKind,
  onTriggerKindChange,
  keywords,
  onKeywordsChange,
  entryNodeKey,
  onEntryNodeKeyChange,
  nodes,
  issues,
  errors,
  warnings,
  onUpdateNode,
  onRemoveNode,
  onAddNode,
  onSave,
  onPublish,
  onApplyTemplate,
  onOpenBots,
  runs,
  runsLoading,
}: {
  bots: BotRow[];
  selectedBot?: BotRow;
  selectedBotId: Id<"chatbots"> | "";
  onSelectBot: (id: Id<"chatbots">) => void;
  templates: FlowTemplate[];
  busy: string | null;
  triggerKind: TriggerKind;
  onTriggerKindChange: (kind: TriggerKind) => void;
  keywords: string;
  onKeywordsChange: (value: string) => void;
  entryNodeKey: string;
  onEntryNodeKeyChange: (value: string) => void;
  nodes: FlowNode[];
  issues: FlowIssue[];
  errors: FlowIssue[];
  warnings: FlowIssue[];
  onUpdateNode: (index: number, patch: Partial<FlowNode>) => void;
  onRemoveNode: (index: number) => void;
  onAddNode: (type: FlowNodeType, position?: FlowNodePosition) => string;
  onSave: () => void;
  onPublish: () => void;
  onApplyTemplate: (slug: FlowTemplate["slug"]) => void;
  onOpenBots: () => void;
  runs: FlowRunRow[];
  runsLoading: boolean;
}) {
  const [selectedNodeKey, setSelectedNodeKey] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [testMode, setTestMode] = useState(true);
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);
  const [canvasNodes, setCanvasNodes, onCanvasNodesChange] =
    useNodesState<FlowCanvasNode>([]);

  useEffect(() => {
    if (nodes.length === 0) {
      setSelectedNodeKey("");
      return;
    }
    const preferredKey =
      entryNodeKey && nodes.some((node) => node.key === entryNodeKey)
        ? entryNodeKey
        : nodes[0].key;
    if (!selectedNodeKey || !nodes.some((node) => node.key === selectedNodeKey)) {
      setSelectedNodeKey(preferredKey);
    }
  }, [entryNodeKey, nodes, selectedNodeKey]);

  const selectedNodeIndex = nodes.findIndex((node) => node.key === selectedNodeKey);
  const selectedNode = selectedNodeIndex >= 0 ? nodes[selectedNodeIndex] : undefined;
  const issuesByNode = useMemo(() => groupIssuesByNode(issues), [issues]);
  const canvasEdges = useMemo(() => buildFlowEdges(nodes), [nodes]);
  const derivedCanvasNodes = useMemo<FlowCanvasNode[]>(() => {
    const autoPositions = autoLayoutPositions(nodes, entryNodeKey);
    return nodes.map((node, index) => {
      const nodeIssues = issuesByNode.get(node.key) ?? [];
      return {
        id: node.key,
        type: "flowStep",
        position:
          node.position ??
          autoPositions.get(node.key) ?? {
            x: 80 + (index % 3) * 320,
            y: 90 + Math.floor(index / 3) * 190,
          },
        selected: node.key === selectedNodeKey,
        data: {
          flowNode: node,
          isEntry: node.key === entryNodeKey,
          issueCount: nodeIssues.length,
          hasError: nodeIssues.some((issue) => issue.severity === "error"),
        },
      };
    });
  }, [entryNodeKey, issuesByNode, nodes, selectedNodeKey]);

  useEffect(() => {
    setCanvasNodes(derivedCanvasNodes);
  }, [derivedCanvasNodes, setCanvasNodes]);

  const patchConnection = useCallback(
    (sourceKey: string, sourceHandle: string | null | undefined, targetKey?: string) => {
      const sourceIndex = nodes.findIndex((node) => node.key === sourceKey);
      const sourceNode = nodes[sourceIndex];
      if (!sourceNode) return;
      const nextTarget = targetKey ?? "";

      if (!sourceHandle || sourceHandle === "next") {
        if (needsNextNode(sourceNode.type)) {
          onUpdateNode(sourceIndex, { nextKey: nextTarget || undefined });
        }
        return;
      }

      if (sourceHandle.startsWith("choice:")) {
        const replyId = sourceHandle.replace("choice:", "");
        const buttonIndex = (sourceNode.buttons ?? []).findIndex(
          (button) => button.replyId === replyId,
        );
        if (buttonIndex >= 0) {
          const button = sourceNode.buttons?.[buttonIndex];
          if (!button) return;
          onUpdateNode(sourceIndex, {
            buttons: replaceButton(sourceNode.buttons, buttonIndex, {
              ...button,
              nextKey: nextTarget,
            }),
          });
        }
        return;
      }

      if (sourceHandle === "condition:true" || sourceHandle === "condition:false") {
        const current = defaultCondition(sourceNode.condition);
        onUpdateNode(sourceIndex, {
          condition:
            sourceHandle === "condition:true"
              ? { ...current, trueNextKey: nextTarget }
              : { ...current, falseNextKey: nextTarget },
        });
      }
    },
    [nodes, onUpdateNode],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      if (connection.source === connection.target) return;
      patchConnection(connection.source, connection.sourceHandle, connection.target);
    },
    [patchConnection],
  );

  const handleEdgesDelete = useCallback<OnEdgesDelete>(
    (deletedEdges) => {
      for (const edge of deletedEdges) {
        patchConnection(edge.source, edge.sourceHandle, undefined);
      }
    },
    [patchConnection],
  );

  const handleNodeDragStop = useCallback<OnNodeDrag<FlowCanvasNode>>(
    (_event, node) => {
      const index = nodes.findIndex((item) => item.key === node.id);
      if (index < 0) return;
      onUpdateNode(index, {
        position: {
          x: Math.round(node.position.x),
          y: Math.round(node.position.y),
        },
      });
    },
    [nodes, onUpdateNode],
  );

  const handleAddStep = useCallback(
    (type: FlowNodeType) => {
      const position = nextNodePosition(nodes, selectedNode);
      const key = onAddNode(type, position);
      setSelectedNodeKey(key);
      setPaletteOpen(false);
    },
    [nodes, onAddNode, selectedNode],
  );

  if (!selectedBot) {
    return (
      <section className="rounded-lg border border-dashed border-slate-200 bg-white p-10 text-center">
        <Workflow size={32} className="mx-auto text-slate-300" />
        <h2 className="mt-3 font-[var(--font-outfit)] text-xl font-semibold text-[#0a1b33]">
          Create a bot to open the flow builder
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Use a starter flow, then edit the nodes before activation.
        </p>
        <button
          type="button"
          onClick={onOpenBots}
          className="mt-5 inline-flex h-10 items-center gap-2 rounded-lg bg-[#0a152d] px-4 text-sm font-semibold text-white hover:bg-[#0a1b33]"
        >
          <Plus size={15} />
          Create bot
        </button>
      </section>
    );
  }

  return (
    <main className="space-y-4">
      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_24px_80px_-64px_rgba(15,23,42,0.8)]">
        <div className="flex flex-col gap-3 border-b border-slate-200 bg-white px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#0a152d] text-white">
              <Workflow size={17} />
            </span>
            <div className="min-w-[220px] flex-1">
              <select
                value={selectedBotId || selectedBot._id}
                onChange={(event) =>
                  onSelectBot(event.target.value as Id<"chatbots">)
                }
                className="h-9 max-w-full rounded-md border border-slate-200 bg-white px-2 text-sm font-semibold text-[#0a1b33] outline-none focus:border-slate-400"
                aria-label="Select bot"
              >
                {bots.map((bot) => (
                  <option key={bot._id} value={bot._id}>
                    {bot.name}
                  </option>
                ))}
              </select>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span>{TRIGGER_COPY[triggerKind]}</span>
                <span className="h-1 w-1 rounded-full bg-slate-300" />
                <span>{nodes.length} blocks</span>
                <span className="h-1 w-1 rounded-full bg-slate-300" />
                <span>{runsLoading ? "Runs loading" : `${runs.length} runs`}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onOpenBots}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-[#0a1b33] hover:bg-slate-50"
            >
              <Bot size={15} />
              Bot Library
            </button>
            <div className="relative">
              <button
                type="button"
                onClick={() => setTemplateMenuOpen((open) => !open)}
                disabled={busy !== null}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-[#0a1b33] hover:bg-slate-50 disabled:opacity-50"
              >
                <CopyPlus size={15} />
                Templates
              </button>
              {templateMenuOpen && (
                <div className="absolute right-0 top-11 z-30 w-80 rounded-lg border border-slate-200 bg-white p-2 shadow-[0_20px_60px_-28px_rgba(15,23,42,0.6)]">
                  {templates.map((template) => (
                    <button
                      key={template.slug}
                      type="button"
                      onClick={() => {
                        onApplyTemplate(template.slug);
                        setTemplateMenuOpen(false);
                      }}
                      disabled={busy !== null}
                      className="block w-full rounded-md px-3 py-2 text-left hover:bg-slate-50 disabled:opacity-50"
                    >
                      <span className="block text-sm font-semibold text-[#0a1b33]">
                        {template.name}
                      </span>
                      <span className="mt-0.5 block text-xs leading-5 text-slate-500">
                        {template.description}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setTestMode((enabled) => !enabled)}
              className={`inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-semibold transition-colors ${
                testMode
                  ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                  : "bg-white text-[#0a1b33] ring-1 ring-slate-200"
              }`}
            >
              <PlayCircle size={15} />
              Test Bot
            </button>

            <span
              className={`inline-flex h-9 items-center gap-2 rounded-md px-3 text-xs font-semibold ${
                errors.length > 0
                  ? "bg-red-50 text-red-700 ring-1 ring-red-200"
                  : warnings.length > 0
                    ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
                    : "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
              }`}
            >
              {errors.length > 0 ? (
                <AlertTriangle size={14} />
              ) : (
                <CheckCircle2 size={14} />
              )}
              {errors.length > 0
                ? `${errors.length} blockers`
                : warnings.length > 0
                  ? `${warnings.length} warnings`
                  : "Valid"}
            </span>

            <button
              type="button"
              onClick={onSave}
              disabled={busy !== null}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-[#0a1b33] hover:bg-slate-50 disabled:opacity-50"
            >
              {busy === "flow" ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Save size={15} />
              )}
              Save
            </button>
            <button
              type="button"
              onClick={onPublish}
              disabled={busy !== null}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy === "publish" ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <CheckCircle2 size={15} />
              )}
              Validate & Publish
            </button>
          </div>
        </div>

        <div className="grid min-h-[760px] bg-[#eef3f8] xl:grid-cols-[minmax(0,1fr)_320px_330px]">
          <section className="relative min-h-[620px] min-w-0 border-b border-slate-200 bg-[#f7fafc] xl:border-b-0 xl:border-r">
            <div className="absolute left-4 top-4 z-20 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setPaletteOpen((open) => !open)}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-[#0a152d] px-3 text-sm font-semibold text-white shadow-[0_14px_40px_-22px_rgba(15,23,42,0.9)] hover:bg-[#0a1b33]"
              >
                <Plus size={16} />
                Add step
              </button>
              {nodes.length === 0 && (
                <span className="rounded-md bg-white/90 px-3 py-2 text-xs font-medium text-slate-500 ring-1 ring-slate-200">
                  Start by adding one block.
                </span>
              )}
            </div>

            {paletteOpen && (
              <div className="absolute left-4 top-16 z-30 w-[330px] rounded-lg border border-slate-200 bg-white p-2 shadow-[0_24px_90px_-40px_rgba(15,23,42,0.75)]">
                <div className="flex items-center justify-between px-2 py-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                    Add step
                  </span>
                  <button
                    type="button"
                    onClick={() => setPaletteOpen(false)}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-50 hover:text-[#0a1b33]"
                    aria-label="Close add step palette"
                  >
                    <X size={14} />
                  </button>
                </div>
                <div className="mt-1 grid gap-1">
                  {STEP_CATALOG.map((step) => {
                    const Icon = step.icon;
                    return (
                      <button
                        key={step.type}
                        type="button"
                        onClick={() => handleAddStep(step.type)}
                        className="flex items-start gap-3 rounded-md px-3 py-2 text-left hover:bg-slate-50"
                      >
                        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
                          <Icon size={15} />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-[#0a1b33]">
                            {step.label}
                          </span>
                          <span className="mt-0.5 block text-xs leading-5 text-slate-500">
                            {step.detail}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <ReactFlow
              nodes={canvasNodes}
              edges={canvasEdges}
              nodeTypes={FLOW_CANVAS_NODE_TYPES}
              onNodesChange={onCanvasNodesChange}
              onNodeClick={(_event, node) => setSelectedNodeKey(node.id)}
              onNodeDragStop={handleNodeDragStop}
              onConnect={handleConnect}
              onEdgesDelete={handleEdgesDelete}
              defaultViewport={{ x: 36, y: 172, zoom: 0.72 }}
              minZoom={0.18}
              maxZoom={1.35}
              defaultEdgeOptions={{
                type: "smoothstep",
                markerEnd: { type: MarkerType.ArrowClosed },
              }}
              proOptions={{ hideAttribution: true }}
              className="flow-builder-canvas"
            >
              <Background
                variant={BackgroundVariant.Dots}
                gap={22}
                size={1}
                color="#cbd5e1"
              />
              <Controls
                position="bottom-left"
                showInteractive={false}
                className="rounded-md border border-slate-200 bg-white shadow-sm"
              />
              <MiniMap
                position="bottom-right"
                pannable
                zoomable
                nodeColor={(node) =>
                  (node.data as FlowCanvasNodeData).hasError
                    ? "#ef4444"
                    : (node.data as FlowCanvasNodeData).isEntry
                      ? "#10b981"
                      : "#64748b"
                }
                maskColor="rgba(241,245,249,0.72)"
                className="hidden rounded-md border border-slate-200 bg-white shadow-sm lg:block"
              />
            </ReactFlow>
          </section>

          <FlowInspectorPanel
            selectedNode={selectedNode}
            nodes={nodes}
            issues={selectedNode ? issuesByNode.get(selectedNode.key) ?? [] : []}
            triggerKind={triggerKind}
            onTriggerKindChange={onTriggerKindChange}
            keywords={keywords}
            onKeywordsChange={onKeywordsChange}
            entryNodeKey={entryNodeKey}
            onEntryNodeKeyChange={onEntryNodeKeyChange}
            onUpdate={(patch) => {
              if (selectedNodeIndex < 0) return;
              onUpdateNode(selectedNodeIndex, patch);
              if (patch.key) setSelectedNodeKey(patch.key);
            }}
            onRemove={() => {
              if (selectedNodeIndex < 0) return;
              onRemoveNode(selectedNodeIndex);
              const nextNode =
                nodes[selectedNodeIndex + 1] ?? nodes[selectedNodeIndex - 1];
              setSelectedNodeKey(nextNode?.key ?? "");
            }}
          />

          <WhatsAppFlowPreview
            nodes={nodes}
            entryNodeKey={entryNodeKey}
            selectedNodeKey={selectedNodeKey}
            botName={selectedBot.name}
            triggerKind={triggerKind}
            keywords={keywords}
            testMode={testMode}
          />
        </div>
      </section>

      <FlowValidationPanel
        issues={issues}
        errors={errors}
        warnings={warnings}
      />
    </main>
  );
}

function FlowCanvasStepNode({
  data,
  selected,
}: NodeProps<FlowCanvasNode>) {
  const { flowNode, isEntry, issueCount, hasError } = data;
  const Icon = flowNodeIcon(flowNode.type);
  const outgoingHandles = outgoingHandleLabels(flowNode);
  const preview =
    flowNode.body ??
    flowNode.tag ??
    (flowNode.condition
      ? `${flowNode.condition.variableKey} ${flowNode.condition.operator}`
      : flowNode.variableKey) ??
    "";

  return (
    <div
      className={`min-w-[250px] max-w-[292px] rounded-lg border bg-white shadow-[0_20px_60px_-40px_rgba(15,23,42,0.85)] ${
        selected
          ? "border-[#0a152d] ring-2 ring-[#0a152d]/12"
          : hasError
            ? "border-red-200"
            : "border-slate-200"
      }`}
    >
      <Handle
        id="in"
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-white !bg-slate-400"
      />
      <div className="flex items-start gap-3 border-b border-slate-100 px-3 py-3">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${
            isEntry
              ? "bg-emerald-50 text-emerald-700"
              : hasError
                ? "bg-red-50 text-red-700"
                : "bg-slate-100 text-[#0a1b33]"
          }`}
        >
          <Icon size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-[#0a1b33]">
              {flowNode.title}
            </span>
            {isEntry && (
              <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-emerald-700">
                Entry
              </span>
            )}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-slate-500">
            {NODE_TYPE_LABELS[flowNode.type]} · {flowNode.key}
          </div>
        </div>
        {issueCount > 0 && (
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              hasError ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
            }`}
          >
            {issueCount}
          </span>
        )}
      </div>
      <div className="px-3 py-3">
        {preview ? (
          <p className="line-clamp-3 text-xs leading-5 text-slate-600">
            {preview}
          </p>
        ) : (
          <p className="text-xs text-slate-400">No content yet</p>
        )}
        {flowNode.buttons && flowNode.buttons.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {flowNode.buttons.slice(0, 4).map((button) => (
              <div
                key={button.replyId}
                className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-2 py-1.5 text-[11px]"
              >
                <span className="truncate font-medium text-[#0a1b33]">
                  {button.label || button.replyId}
                </span>
                <span className="truncate text-slate-400">
                  {button.nextKey || "No target"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      {outgoingHandles.map((handle, index) => (
        <Handle
          key={handle.id}
          id={handle.id}
          type="source"
          position={Position.Right}
          className={`!h-3 !w-3 !border-2 !border-white ${
            handle.kind === "error"
              ? "!bg-red-500"
              : handle.kind === "condition"
                ? "!bg-violet-500"
                : "!bg-emerald-500"
          }`}
          style={{
            top:
              outgoingHandles.length === 1
                ? "50%"
                : `${28 + index * (44 / Math.max(outgoingHandles.length - 1, 1))}%`,
          }}
        />
      ))}
    </div>
  );
}

function FlowInspectorPanel({
  selectedNode,
  nodes,
  issues,
  triggerKind,
  onTriggerKindChange,
  keywords,
  onKeywordsChange,
  entryNodeKey,
  onEntryNodeKeyChange,
  onUpdate,
  onRemove,
}: {
  selectedNode?: FlowNode;
  nodes: FlowNode[];
  issues: FlowIssue[];
  triggerKind: TriggerKind;
  onTriggerKindChange: (kind: TriggerKind) => void;
  keywords: string;
  onKeywordsChange: (value: string) => void;
  entryNodeKey: string;
  onEntryNodeKeyChange: (value: string) => void;
  onUpdate: (patch: Partial<FlowNode>) => void;
  onRemove: () => void;
}) {
  const targetOptions = nodes
    .filter((item) => item.key !== selectedNode?.key)
    .map((item) => ({ value: item.key, label: `${item.title} · ${item.key}` }));

  return (
    <aside className="min-w-0 border-b border-slate-200 bg-white xl:border-b-0 xl:border-r">
      <div className="max-h-[760px] overflow-y-auto">
        <section className="border-b border-slate-100 p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-100 text-[#0a1b33]">
              <Settings2 size={15} />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-[#0a1b33]">Flow settings</h3>
              <p className="text-xs text-slate-500">Trigger and entry path.</p>
            </div>
          </div>
          <div className="space-y-3">
            <SelectBox
              label="Trigger"
              value={triggerKind}
              onChange={(value) => onTriggerKindChange(value as TriggerKind)}
              options={[
                { value: "ctwa", label: TRIGGER_COPY.ctwa },
                { value: "inbound", label: TRIGGER_COPY.inbound },
                { value: "keyword", label: TRIGGER_COPY.keyword },
                { value: "handoff", label: TRIGGER_COPY.handoff },
              ]}
              placeholder="Choose trigger"
            />
            <TextInput
              label="Keywords"
              value={keywords}
              onChange={onKeywordsChange}
              placeholder="olá, menu, ajuda"
            />
            <SelectBox
              label="Entry node"
              value={entryNodeKey}
              onChange={onEntryNodeKeyChange}
              options={nodes.map((node) => ({
                value: node.key,
                label: `${node.title} · ${node.key}`,
              }))}
              placeholder="Pick entry"
            />
          </div>
        </section>

        {!selectedNode ? (
          <section className="p-8 text-center">
            <Workflow size={24} className="mx-auto text-slate-300" />
            <p className="mt-3 text-sm font-semibold text-[#0a1b33]">
              Select a block
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Click any node on the canvas to edit content and routing.
            </p>
          </section>
        ) : (
          <section className="p-4">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#0a152d] text-white">
                  {(() => {
                    const Icon = flowNodeIcon(selectedNode.type);
                    return <Icon size={16} />;
                  })()}
                </span>
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-[#0a1b33]">
                    {selectedNode.title}
                  </h3>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {NODE_TYPE_LABELS[selectedNode.type]} · {selectedNode.key}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onRemove}
                disabled={selectedNode.type === "start"}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 text-slate-400 hover:bg-slate-50 disabled:opacity-40"
                aria-label={`Remove ${selectedNode.title}`}
              >
                <Trash2 size={14} />
              </button>
            </div>

            <div className="space-y-3">
              <TextInput
                label="Node key"
                value={selectedNode.key}
                onChange={(value) => onUpdate({ key: value })}
                placeholder="ask_budget"
              />
              <TextInput
                label="Title"
                value={selectedNode.title}
                onChange={(value) => onUpdate({ title: value })}
                placeholder="Ask budget"
              />
              <SelectBox
                label="Type"
                value={selectedNode.type}
                onChange={(value) =>
                  onUpdate({
                    type: value as FlowNodeType,
                    ...defaultNodePatch(value as FlowNodeType),
                  })
                }
                options={[
                  { value: "start", label: NODE_TYPE_LABELS.start },
                  ...FLOW_NODE_TYPES.map((type) => ({
                    value: type,
                    label: NODE_TYPE_LABELS[type],
                  })),
                ]}
                placeholder="Choose type"
              />
              {needsNextNode(selectedNode.type) && (
                <SelectBox
                  label="Next node"
                  value={selectedNode.nextKey ?? ""}
                  onChange={(value) => onUpdate({ nextKey: value || undefined })}
                  options={targetOptions}
                  placeholder="Stop here"
                />
              )}
            </div>

            {needsBody(selectedNode.type) && (
              <label className="mt-3 block">
                <span className="mb-1 block text-[11px] font-medium text-slate-500">
                  Message / prompt
                </span>
                <textarea
                  value={selectedNode.body ?? ""}
                  onChange={(event) => onUpdate({ body: event.target.value })}
                  rows={4}
                  className="w-full resize-none rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-[#0a1b33] outline-none transition-colors placeholder:text-slate-300 focus:border-slate-400"
                  placeholder="Mensagem enviada ao cliente..."
                />
              </label>
            )}

            {selectedNode.type === "collect_input" && (
              <div className="mt-3">
                <TextInput
                  label="Variable key"
                  value={selectedNode.variableKey ?? ""}
                  onChange={(value) => onUpdate({ variableKey: value })}
                  placeholder="budget_mt"
                />
              </div>
            )}

            {selectedNode.type === "set_tag" && (
              <div className="mt-3">
                <TextInput
                  label="Tag"
                  value={selectedNode.tag ?? ""}
                  onChange={(value) => onUpdate({ tag: value })}
                  placeholder="qualified_lead"
                />
              </div>
            )}

            {(selectedNode.type === "send_buttons" ||
              selectedNode.type === "send_list") && (
              <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50 p-3">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-500">
                    {selectedNode.type === "send_buttons" ? "Buttons" : "List rows"}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdate({
                        buttons: [
                          ...(selectedNode.buttons ?? []),
                          {
                            replyId: `choice_${(selectedNode.buttons ?? []).length + 1}`,
                            label:
                              selectedNode.type === "send_buttons"
                                ? "Option"
                                : "Row",
                            nextKey: targetOptions[0]?.value ?? "",
                          },
                        ],
                      })
                    }
                    disabled={
                      (selectedNode.buttons ?? []).length >=
                      (selectedNode.type === "send_buttons" ? 3 : 10)
                    }
                    className="inline-flex h-8 items-center gap-1 rounded-md bg-white px-2 text-xs font-semibold text-[#0a1b33] ring-1 ring-slate-200 disabled:opacity-50"
                  >
                    <Plus size={12} />
                    Add
                  </button>
                </div>
                <TextInput
                  label="Save reply as"
                  value={selectedNode.variableKey ?? ""}
                  onChange={(value) =>
                    onUpdate({ variableKey: value || undefined })
                  }
                  placeholder="service_interest"
                />
                <div className="mt-3 space-y-2">
                  {(selectedNode.buttons ?? []).map((button, buttonIndex) => (
                    <div
                      key={`${button.replyId}-${buttonIndex}`}
                      className="grid gap-2"
                    >
                      <input
                        value={button.replyId}
                        onChange={(event) =>
                          onUpdate({
                            buttons: replaceButton(
                              selectedNode.buttons,
                              buttonIndex,
                              {
                                ...button,
                                replyId: event.target.value,
                              },
                            ),
                          })
                        }
                        className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs outline-none"
                        placeholder="reply_id"
                      />
                      <input
                        value={button.label}
                        onChange={(event) =>
                          onUpdate({
                            buttons: replaceButton(
                              selectedNode.buttons,
                              buttonIndex,
                              {
                                ...button,
                                label: event.target.value,
                              },
                            ),
                          })
                        }
                        className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs outline-none"
                        placeholder="Label"
                      />
                      <div className="grid grid-cols-[1fr_auto] gap-2">
                        <select
                          value={button.nextKey}
                          onChange={(event) =>
                            onUpdate({
                              buttons: replaceButton(
                                selectedNode.buttons,
                                buttonIndex,
                                {
                                  ...button,
                                  nextKey: event.target.value,
                                },
                              ),
                            })
                          }
                          className="min-w-0 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs outline-none"
                        >
                          <option value="">Next</option>
                          {targetOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() =>
                            onUpdate({
                              buttons: (selectedNode.buttons ?? []).filter(
                                (_, itemIndex) => itemIndex !== buttonIndex,
                              ),
                            })
                          }
                          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-400"
                          aria-label="Remove button"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedNode.type === "condition" && (
              <div className="mt-4 grid gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
                <TextInput
                  label="Variable"
                  value={selectedNode.condition?.variableKey ?? ""}
                  onChange={(value) =>
                    onUpdate({
                      condition: {
                        ...defaultCondition(selectedNode.condition),
                        variableKey: value,
                      },
                    })
                  }
                  placeholder="budget_mt"
                />
                <SelectBox
                  label="Operator"
                  value={selectedNode.condition?.operator ?? "present"}
                  onChange={(value) =>
                    onUpdate({
                      condition: {
                        ...defaultCondition(selectedNode.condition),
                        operator: value as ConditionOperator,
                      },
                    })
                  }
                  options={[
                    { value: "present", label: "Present" },
                    { value: "absent", label: "Absent" },
                    { value: "equals", label: "Equals" },
                    { value: "contains", label: "Contains" },
                  ]}
                  placeholder="Operator"
                />
                <TextInput
                  label="Value"
                  value={selectedNode.condition?.value ?? ""}
                  onChange={(value) =>
                    onUpdate({
                      condition: {
                        ...defaultCondition(selectedNode.condition),
                        value,
                      },
                    })
                  }
                  placeholder="premium"
                />
                <SelectBox
                  label="True next"
                  value={selectedNode.condition?.trueNextKey ?? ""}
                  onChange={(value) =>
                    onUpdate({
                      condition: {
                        ...defaultCondition(selectedNode.condition),
                        trueNextKey: value,
                      },
                    })
                  }
                  options={targetOptions}
                  placeholder="Choose"
                />
                <SelectBox
                  label="False next"
                  value={selectedNode.condition?.falseNextKey ?? ""}
                  onChange={(value) =>
                    onUpdate({
                      condition: {
                        ...defaultCondition(selectedNode.condition),
                        falseNextKey: value,
                      },
                    })
                  }
                  options={targetOptions}
                  placeholder="Choose"
                />
              </div>
            )}

            {issues.length > 0 && (
              <div className="mt-4 space-y-2">
                {issues.map((issue, issueIndex) => (
                  <p
                    key={`${issue.message}-${issueIndex}`}
                    className={`rounded-md px-3 py-2 text-xs ${
                      issue.severity === "error"
                        ? "bg-red-50 text-red-700"
                        : "bg-amber-50 text-amber-700"
                    }`}
                  >
                    {issue.message}
                  </p>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </aside>
  );
}

function WhatsAppFlowPreview({
  nodes,
  entryNodeKey,
  selectedNodeKey,
  botName,
  triggerKind,
  keywords,
  testMode,
}: {
  nodes: FlowNode[];
  entryNodeKey: string;
  selectedNodeKey: string;
  botName: string;
  triggerKind: TriggerKind;
  keywords: string;
  testMode: boolean;
}) {
  const previewNodes = useMemo(
    () =>
      walkFlowPath(
        nodes,
        testMode ? selectedNodeKey || entryNodeKey : entryNodeKey,
        7,
      ),
    [entryNodeKey, nodes, selectedNodeKey, testMode],
  );
  const keyword = keywords.split(",").map((item) => item.trim()).find(Boolean);
  const startCopy =
    triggerKind === "keyword"
      ? `#${keyword ?? "menu"}`
      : triggerKind === "ctwa"
        ? "Tenho interesse"
        : "Olá";

  return (
    <aside className="min-w-0 bg-[#eef3f8] p-4">
      <div className="mx-auto max-w-[330px]">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
              <Smartphone size={15} />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-[#0a1b33]">
                WhatsApp preview
              </h3>
              <p className="text-xs text-slate-500">
                {testMode ? "Testing selected path" : "Entry path"}
              </p>
            </div>
          </div>
          <span className="rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-slate-500 ring-1 ring-slate-200">
            Local
          </span>
        </div>

        <div className="overflow-hidden rounded-lg border border-slate-300 bg-[#111827] shadow-[0_28px_90px_-48px_rgba(15,23,42,0.9)]">
          <div className="flex items-center gap-3 border-b border-white/10 bg-[#1f2937] px-4 py-3 text-white">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold">
              {botName.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{botName}</p>
              <p className="text-xs text-emerald-200">OpenBSP Bot</p>
            </div>
          </div>

          <div
            className="min-h-[560px] space-y-3 px-3 py-4"
            style={{
              backgroundColor: "#10231f",
              backgroundImage:
                "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.08) 1px, transparent 0)",
              backgroundSize: "18px 18px",
            }}
          >
            <div className="ml-auto max-w-[78%] rounded-lg bg-[#0b7a5f] px-3 py-2 text-sm leading-5 text-white">
              {startCopy}
              <div className="mt-1 text-right text-[10px] text-white/70">9:42</div>
            </div>

            {previewNodes.length === 0 ? (
              <div className="rounded-lg bg-white/90 px-3 py-2 text-sm text-slate-600">
                Add and select a block to preview the conversation.
              </div>
            ) : (
              previewNodes.map((node) => (
                <PreviewBubble key={node.key} node={node} />
              ))
            )}
          </div>

          <div className="flex items-center gap-2 bg-[#111827] px-3 py-3">
            <span className="h-9 flex-1 rounded-full bg-white/10" />
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-600 text-white">
              <Send size={14} />
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
}

function PreviewBubble({ node }: { node: FlowNode }) {
  if (node.type === "start") {
    return (
      <div className="mx-auto w-fit rounded-full bg-black/20 px-3 py-1 text-[11px] font-medium text-emerald-100">
        Start
      </div>
    );
  }
  if (node.type === "condition") {
    return (
      <div className="rounded-lg border border-violet-200/40 bg-violet-50/95 px-3 py-2 text-xs leading-5 text-violet-900">
        Condition: {node.condition?.variableKey || "variable"}{" "}
        {node.condition?.operator ?? "present"}
      </div>
    );
  }
  if (node.type === "set_tag") {
    return (
      <div className="rounded-lg border border-amber-200/40 bg-amber-50/95 px-3 py-2 text-xs leading-5 text-amber-900">
        Tag set: {node.tag || "untitled_tag"}
      </div>
    );
  }
  if (node.type === "handoff") {
    return (
      <div className="rounded-lg bg-white/95 px-3 py-2 text-sm leading-5 text-slate-700">
        {node.body || "A human agent will continue from here."}
      </div>
    );
  }
  if (node.type === "end") {
    return (
      <div className="mx-auto w-fit rounded-full bg-black/20 px-3 py-1 text-[11px] font-medium text-emerald-100">
        End
      </div>
    );
  }

  return (
    <div className="max-w-[88%] rounded-lg bg-white/95 px-3 py-2 text-sm leading-5 text-slate-800">
      <p>{node.body || "Message text..."}</p>
      {(node.type === "send_buttons" || node.type === "send_list") &&
        (node.buttons ?? []).length > 0 && (
          <div className="mt-3 space-y-1.5 border-t border-slate-200 pt-2">
            {(node.buttons ?? []).map((button) => (
              <div
                key={button.replyId}
                className="rounded-md bg-[#e8f7f2] px-2 py-1.5 text-center text-xs font-semibold text-[#0b7a5f]"
              >
                {button.label || button.replyId}
              </div>
            ))}
          </div>
        )}
      {node.type === "collect_input" && (
        <div className="mt-3 rounded-md bg-slate-100 px-2 py-1.5 text-xs font-medium text-slate-500">
          Saves reply as {node.variableKey || "answer"}
        </div>
      )}
      <div className="mt-1 text-right text-[10px] text-slate-400">9:42</div>
    </div>
  );
}

function FlowValidationPanel({
  issues,
  errors,
  warnings,
}: {
  issues: FlowIssue[];
  errors: FlowIssue[];
  warnings: FlowIssue[];
}) {
  const clean = errors.length === 0;
  return (
    <section
      className={`rounded-2xl border p-4 ${
        clean ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"
      }`}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
              clean ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
            }`}
          >
            {clean ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}
          </span>
          <div>
            <h3 className="font-semibold text-[#0a1b33]">
              {clean ? "Ready to activate" : "Activation blocked"}
            </h3>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              {clean
                ? warnings.length > 0
                  ? `${warnings.length} warning(s), no blockers.`
                  : "No validator issues detected."
                : `${errors.length} blocker(s), ${warnings.length} warning(s).`}
            </p>
          </div>
        </div>
        {issues.length > 0 && (
          <div className="grid gap-2 lg:w-[56%]">
            {issues.slice(0, 3).map((issue, index) => (
              <div
                key={`${issue.message}-${index}`}
                className={`rounded-lg border px-3 py-2 text-xs ${
                  issue.severity === "error"
                    ? "border-red-100 bg-white text-red-800"
                    : "border-amber-100 bg-white text-amber-800"
                }`}
              >
                <span className="font-semibold uppercase">
                  {issue.nodeKey ?? issue.scope}
                </span>
                <span className="mx-1 opacity-50">·</span>
                {issue.message}
              </div>
            ))}
            {issues.length > 3 && (
              <p className="text-xs font-medium text-slate-500">
                +{issues.length - 3} more issue(s)
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function FlowMapPanel({
  nodes,
  selectedNodeKey,
  entryNodeKey,
  issues,
  onSelect,
  onAddNode,
}: {
  nodes: FlowNode[];
  selectedNodeKey: string;
  entryNodeKey: string;
  issues: FlowIssue[];
  onSelect: (key: string) => void;
  onAddNode: (type: FlowNodeType) => void;
}) {
  const [newNodeType, setNewNodeType] = useState<FlowNodeType>("send_message");
  const issuesByNode = useMemo(() => {
    const map = new Map<string, FlowIssue[]>();
    for (const issue of issues) {
      if (!issue.nodeKey) continue;
      map.set(issue.nodeKey, [...(map.get(issue.nodeKey) ?? []), issue]);
    }
    return map;
  }, [issues]);

  return (
    <aside className="border-b border-slate-100 bg-slate-50/70 lg:border-b-0 lg:border-r">
      <div className="border-b border-slate-100 bg-white px-4 py-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="font-[var(--font-outfit)] text-base font-semibold text-[#0a1b33]">
              Flow map
            </h3>
            <p className="text-xs text-slate-500">Pick a block to edit.</p>
          </div>
          <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-500">
            {nodes.length}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
          <select
            value={newNodeType}
            onChange={(event) => setNewNodeType(event.target.value as FlowNodeType)}
            className="h-10 min-w-0 rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-[#0a1b33] outline-none focus:border-slate-400"
          >
            {FLOW_NODE_TYPES.map((type) => (
              <option key={type} value={type}>
                {NODE_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => onAddNode(newNodeType)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[#0a152d] text-white hover:bg-[#0a1b33]"
            aria-label="Add node"
          >
            <Plus size={15} />
          </button>
        </div>
      </div>

      <div className="max-h-[720px] space-y-2 overflow-y-auto p-3">
        {nodes.map((node, index) => {
          const active = node.key === selectedNodeKey;
          const nodeIssues = issuesByNode.get(node.key) ?? [];
          const hasError = nodeIssues.some((issue) => issue.severity === "error");
          const NodeIcon =
            node.type === "send_list"
              ? ListTree
              : node.type === "set_tag"
                ? Tag
                : node.type === "handoff"
                  ? UploadCloud
                  : GitBranch;
          return (
            <button
              key={`${node.key}-${index}`}
              type="button"
              onClick={() => onSelect(node.key)}
              className={`group w-full rounded-xl border px-3 py-3 text-left transition-colors ${
                active
                  ? "border-[#0a152d] bg-white shadow-sm"
                  : "border-transparent bg-white/70 hover:border-slate-200 hover:bg-white"
              }`}
            >
              <div className="flex items-center gap-3">
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                    active
                      ? "bg-[#0a152d] text-white"
                      : "bg-slate-100 text-slate-500 group-hover:text-[#0a1b33]"
                  }`}
                >
                  <NodeIcon size={15} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold text-[#0a1b33]">
                      {node.title}
                    </span>
                    {node.key === entryNodeKey && (
                      <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-emerald-700">
                        Entry
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-slate-500">
                    {NODE_TYPE_LABELS[node.type]} · {node.key}
                  </span>
                </span>
                {hasError ? (
                  <AlertTriangle size={15} className="shrink-0 text-red-500" />
                ) : (
                  <ArrowRight size={14} className="shrink-0 text-slate-300" />
                )}
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function FlowNodeCard({
  node,
  index,
  nodes,
  issues,
  onUpdate,
  onRemove,
}: {
  node: FlowNode;
  index: number;
  nodes: FlowNode[];
  issues: FlowIssue[];
  onUpdate: (patch: Partial<FlowNode>) => void;
  onRemove: () => void;
}) {
  const NodeIcon =
    node.type === "send_list" ? ListTree : node.type === "set_tag" ? Tag : GitBranch;
  const targetOptions = nodes
    .filter((item) => item.key !== node.key)
    .map((item) => ({ value: item.key, label: `${item.title} · ${item.key}` }));

  return (
    <article className="p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-[#0a1b33]">
            <NodeIcon size={17} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="font-semibold text-[#0a1b33]">{node.title}</h4>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                {NODE_TYPE_LABELS[node.type]}
              </span>
              <span className="rounded-full bg-slate-50 px-2 py-0.5 text-[11px] font-mono text-slate-500">
                {node.key}
              </span>
            </div>
            {node.body && (
              <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-500">
                {node.body}
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onRemove}
          disabled={node.type === "start" && index === 0}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:bg-slate-50 disabled:opacity-40"
          aria-label={`Remove ${node.title}`}
        >
          <Trash2 size={15} />
        </button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <TextInput
          label="Node key"
          value={node.key}
          onChange={(value) => onUpdate({ key: value })}
          placeholder="ask_budget"
        />
        <TextInput
          label="Title"
          value={node.title}
          onChange={(value) => onUpdate({ title: value })}
          placeholder="Ask budget"
        />
        <SelectBox
          label="Type"
          value={node.type}
          onChange={(value) =>
            onUpdate({ type: value as FlowNodeType, ...defaultNodePatch(value as FlowNodeType) })
          }
          options={[
            { value: "start", label: NODE_TYPE_LABELS.start },
            ...FLOW_NODE_TYPES.map((type) => ({
              value: type,
              label: NODE_TYPE_LABELS[type],
            })),
          ]}
          placeholder="Choose type"
        />
        {needsNextNode(node.type) && (
          <SelectBox
            label="Next node"
            value={node.nextKey ?? ""}
            onChange={(value) => onUpdate({ nextKey: value || undefined })}
            options={targetOptions}
            placeholder="Stop here"
          />
        )}
      </div>

      {needsBody(node.type) && (
        <label className="mt-3 block">
          <span className="mb-1 block text-[11px] font-medium text-slate-500">
            Message / prompt
          </span>
          <textarea
            value={node.body ?? ""}
            onChange={(event) => onUpdate({ body: event.target.value })}
            rows={3}
            className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-[#0a1b33] outline-none transition-colors placeholder:text-slate-300 focus:border-slate-400"
            placeholder="Mensagem enviada ao cliente..."
          />
        </label>
      )}

      {node.type === "collect_input" && (
        <div className="mt-3">
          <TextInput
            label="Variable key"
            value={node.variableKey ?? ""}
            onChange={(value) => onUpdate({ variableKey: value })}
            placeholder="budget_mt"
          />
        </div>
      )}

      {node.type === "set_tag" && (
        <div className="mt-3">
          <TextInput
            label="Tag"
            value={node.tag ?? ""}
            onChange={(value) => onUpdate({ tag: value })}
            placeholder="qualified_lead or lead:{{vars.name}}"
          />
        </div>
      )}

      {(node.type === "send_buttons" || node.type === "send_list") && (
        <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-3">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">
              {node.type === "send_buttons" ? "Buttons" : "List rows"}
            </span>
            <button
              type="button"
              onClick={() =>
                onUpdate({
                  buttons: [
                    ...(node.buttons ?? []),
                    {
                      replyId: `choice_${(node.buttons ?? []).length + 1}`,
                      label: node.type === "send_buttons" ? "Option" : "Row",
                      nextKey: targetOptions[0]?.value ?? "",
                    },
                  ],
                })
              }
              disabled={
                (node.buttons ?? []).length >=
                (node.type === "send_buttons" ? 3 : 10)
              }
              className="inline-flex h-8 items-center gap-1 rounded-lg bg-white px-2 text-xs font-semibold text-[#0a1b33] ring-1 ring-slate-200 disabled:opacity-50"
            >
              <Plus size={12} />
              Add
            </button>
          </div>
          <div className="mb-3">
            <TextInput
              label="Save reply as"
              value={node.variableKey ?? ""}
              onChange={(value) => onUpdate({ variableKey: value || undefined })}
              placeholder="service_interest"
            />
          </div>
          <div className="space-y-2">
            {(node.buttons ?? []).map((button, buttonIndex) => (
              <div key={`${button.replyId}-${buttonIndex}`} className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto]">
                <input
                  value={button.replyId}
                  onChange={(event) =>
                    onUpdate({
                      buttons: replaceButton(node.buttons, buttonIndex, {
                        ...button,
                        replyId: event.target.value,
                      }),
                    })
                  }
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs outline-none"
                  placeholder="reply_id"
                />
                <input
                  value={button.label}
                  onChange={(event) =>
                    onUpdate({
                      buttons: replaceButton(node.buttons, buttonIndex, {
                        ...button,
                        label: event.target.value,
                      }),
                    })
                  }
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs outline-none"
                  placeholder="Label"
                />
                <select
                  value={button.nextKey}
                  onChange={(event) =>
                    onUpdate({
                      buttons: replaceButton(node.buttons, buttonIndex, {
                        ...button,
                        nextKey: event.target.value,
                      }),
                    })
                  }
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs outline-none"
                >
                  <option value="">Next</option>
                  {targetOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() =>
                    onUpdate({
                      buttons: (node.buttons ?? []).filter(
                        (_, itemIndex) => itemIndex !== buttonIndex,
                      ),
                    })
                  }
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400"
                  aria-label="Remove button"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {node.type === "condition" && (
        <div className="mt-4 grid gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3 md:grid-cols-2">
          <TextInput
            label="Variable"
            value={node.condition?.variableKey ?? ""}
            onChange={(value) =>
              onUpdate({
                condition: {
                  ...defaultCondition(node.condition),
                  variableKey: value,
                },
              })
            }
            placeholder="budget_mt"
          />
          <SelectBox
            label="Operator"
            value={node.condition?.operator ?? "present"}
            onChange={(value) =>
              onUpdate({
                condition: {
                  ...defaultCondition(node.condition),
                  operator: value as ConditionOperator,
                },
              })
            }
            options={[
              { value: "present", label: "Present" },
              { value: "absent", label: "Absent" },
              { value: "equals", label: "Equals" },
              { value: "contains", label: "Contains" },
            ]}
            placeholder="Operator"
          />
          <TextInput
            label="Value"
            value={node.condition?.value ?? ""}
            onChange={(value) =>
              onUpdate({
                condition: { ...defaultCondition(node.condition), value },
              })
            }
            placeholder="premium"
          />
          <SelectBox
            label="True next"
            value={node.condition?.trueNextKey ?? ""}
            onChange={(value) =>
              onUpdate({
                condition: {
                  ...defaultCondition(node.condition),
                  trueNextKey: value,
                },
              })
            }
            options={targetOptions}
            placeholder="Choose"
          />
          <SelectBox
            label="False next"
            value={node.condition?.falseNextKey ?? ""}
            onChange={(value) =>
              onUpdate({
                condition: {
                  ...defaultCondition(node.condition),
                  falseNextKey: value,
                },
              })
            }
            options={targetOptions}
            placeholder="Choose"
          />
        </div>
      )}

      {issues.length > 0 && (
        <div className="mt-4 space-y-2">
          {issues.map((issue, issueIndex) => (
            <p
              key={`${issue.message}-${issueIndex}`}
              className={`rounded-lg px-3 py-2 text-xs ${
                issue.severity === "error"
                  ? "bg-red-50 text-red-700"
                  : "bg-amber-50 text-amber-700"
              }`}
            >
              {issue.message}
            </p>
          ))}
        </div>
      )}
    </article>
  );
}

function FlowRuntimePanel({
  runs,
  loading,
}: {
  runs: FlowRunRow[];
  loading: boolean;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <PanelTitle
        icon={History}
        title="Runtime history"
        body="Live flow runs, replies, tags, handoffs, and timeouts."
      />
      <div className="mt-4 space-y-3">
        {loading ? (
          <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-500">
            <Loader2 size={14} className="animate-spin" />
            Loading runs
          </div>
        ) : runs.length === 0 ? (
          <p className="rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-500">
            No runs yet. Send a matching WhatsApp message to start this flow.
          </p>
        ) : (
          runs.map((run) => (
            <div
              key={run._id}
              className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[#0a1b33]">
                    {run.contactName ?? run.contactHandle ?? "Unknown contact"}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {run.currentNodeKey
                      ? `At ${run.currentNodeKey}`
                      : run.endReason ?? "Finished"}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    run.status === "active"
                      ? "bg-emerald-100 text-emerald-700"
                      : run.status === "failed" || run.status === "timed_out"
                        ? "bg-red-100 text-red-700"
                        : "bg-slate-200 text-slate-700"
                  }`}
                >
                  {run.status.replace("_", " ")}
                </span>
              </div>
              <div className="mt-3 space-y-1">
                {run.events.slice(-4).map((event) => (
                  <div
                    key={event._id}
                    className="flex items-center justify-between gap-2 text-xs text-slate-500"
                  >
                    <span className="truncate">
                      {event.eventType.replace("_", " ")}
                      {event.nodeKey ? ` · ${event.nodeKey}` : ""}
                    </span>
                    <span className="shrink-0">{relativeTime(event.createdAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  note,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  note: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-[#0a1b33]">
        <Icon size={18} />
      </span>
      <div className="mt-4 text-3xl font-semibold tracking-tight text-[#0a1b33]">
        {value}
      </div>
      <div className="mt-1 text-sm font-medium text-slate-600">{label}</div>
      <p className="mt-1 text-xs text-slate-500">{note}</p>
    </div>
  );
}

function PanelTitle({
  icon: Icon,
  title,
  body,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[#0a1b33]">
        <Icon size={16} />
      </span>
      <div>
        <h2 className="font-[var(--font-outfit)] text-lg font-semibold text-[#0a1b33]">
          {title}
        </h2>
        <p className="mt-0.5 text-sm leading-6 text-slate-500">{body}</p>
      </div>
    </div>
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
      <span className="mb-1 block text-[11px] font-medium text-slate-500">
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
      <span className="mb-1 block text-[11px] font-medium text-slate-500">
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
      className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#0a152d] px-4 py-2 text-sm font-medium text-white transition-all hover:bg-[#0a1b33] disabled:opacity-50"
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />}
      {children}
    </button>
  );
}

function BotMeta({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
        <Icon size={12} />
        {label}
      </div>
      <div className="mt-1 truncate text-xs font-semibold text-[#0a1b33]">
        {value}
      </div>
    </div>
  );
}

function readError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}

function commaList(value: string): string[] | undefined {
  const items = value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return items.length > 0 ? Array.from(new Set(items)) : undefined;
}

function uniqueNodeKey(nodes: FlowNode[], type: FlowNodeType): string {
  const base = type.replace(/^send_/, "");
  const taken = new Set(nodes.map((node) => node.key));
  let index = nodes.length + 1;
  let key = `${base}_${index}`;
  while (taken.has(key)) {
    index += 1;
    key = `${base}_${index}`;
  }
  return key;
}

function defaultNode(key: string, type: FlowNodeType): FlowNode {
  return {
    key,
    type,
    title: NODE_TYPE_LABELS[type],
    ...defaultNodePatch(type),
  };
}

function defaultNodePatch(type: FlowNodeType): Partial<FlowNode> {
  if (type === "send_message") {
    return { body: "", nextKey: undefined, buttons: undefined };
  }
  if (type === "send_buttons") {
    return {
      body: "",
      nextKey: undefined,
      buttons: [{ replyId: "option_1", label: "Option", nextKey: "" }],
    };
  }
  if (type === "send_list") {
    return {
      body: "",
      nextKey: undefined,
      variableKey: "selected_option",
      buttons: [{ replyId: "option_1", label: "Row", nextKey: "" }],
    };
  }
  if (type === "collect_input") {
    return {
      body: "",
      variableKey: "answer",
      nextKey: undefined,
      buttons: undefined,
    };
  }
  if (type === "condition") {
    return {
      nextKey: undefined,
      body: undefined,
      buttons: undefined,
      condition: defaultCondition(),
    };
  }
  if (type === "start") {
    return { nextKey: undefined, body: undefined, buttons: undefined };
  }
  if (type === "set_tag") {
    return { tag: "", nextKey: undefined, body: undefined, buttons: undefined };
  }
  return { nextKey: undefined, body: undefined, buttons: undefined };
}

function defaultCondition(condition?: FlowNode["condition"]) {
  return {
    variableKey: condition?.variableKey ?? "",
    operator: condition?.operator ?? "present",
    value: condition?.value ?? "",
    trueNextKey: condition?.trueNextKey ?? "",
    falseNextKey: condition?.falseNextKey ?? "",
  };
}

function replaceButton(
  buttons: FlowNode["buttons"],
  index: number,
  nextButton: NonNullable<FlowNode["buttons"]>[number],
): NonNullable<FlowNode["buttons"]> {
  return (buttons ?? []).map((button, itemIndex) =>
    itemIndex === index ? nextButton : button,
  );
}

function needsNextNode(type: FlowNodeType): boolean {
  return (
    type === "start" ||
    type === "send_message" ||
    type === "collect_input" ||
    type === "set_tag"
  );
}

function needsBody(type: FlowNodeType): boolean {
  return (
    type === "send_message" ||
    type === "send_buttons" ||
    type === "send_list" ||
    type === "collect_input"
  );
}

function groupIssuesByNode(issues: FlowIssue[]): Map<string, FlowIssue[]> {
  const grouped = new Map<string, FlowIssue[]>();
  for (const issue of issues) {
    if (!issue.nodeKey) continue;
    grouped.set(issue.nodeKey, [...(grouped.get(issue.nodeKey) ?? []), issue]);
  }
  return grouped;
}

function flowNodeIcon(type: FlowNodeType): LucideIcon {
  if (type === "send_message") return MessageSquare;
  if (type === "send_buttons") return GitBranch;
  if (type === "send_list") return ListTree;
  if (type === "collect_input") return Send;
  if (type === "condition") return Split;
  if (type === "set_tag") return Tag;
  if (type === "handoff") return UploadCloud;
  if (type === "end") return CheckCircle2;
  return Workflow;
}

function outgoingHandleLabels(node: FlowNode): Array<{
  id: string;
  label: string;
  kind: "default" | "condition" | "error";
}> {
  if (needsNextNode(node.type)) {
    return [{ id: "next", label: "Next", kind: "default" }];
  }
  if (node.type === "send_buttons" || node.type === "send_list") {
    return (node.buttons ?? []).map((button) => ({
      id: `choice:${button.replyId}`,
      label: button.label || button.replyId,
      kind: button.nextKey ? "default" : "error",
    }));
  }
  if (node.type === "condition") {
    return [
      {
        id: "condition:true",
        label: "True",
        kind: node.condition?.trueNextKey ? "condition" : "error",
      },
      {
        id: "condition:false",
        label: "False",
        kind: node.condition?.falseNextKey ? "condition" : "error",
      },
    ];
  }
  return [];
}

function buildFlowEdges(nodes: FlowNode[]): Edge[] {
  const keys = new Set(nodes.map((node) => node.key));
  const edges: Edge[] = [];
  const pushEdge = (
    node: FlowNode,
    sourceHandle: string,
    targetKey: string | undefined,
    label: string,
    color: string,
  ) => {
    if (!targetKey || !keys.has(targetKey)) return;
    edges.push({
      id: `${node.key}:${sourceHandle}:${targetKey}`,
      source: node.key,
      target: targetKey,
      sourceHandle,
      targetHandle: "in",
      type: "smoothstep",
      label,
      markerEnd: { type: MarkerType.ArrowClosed, color },
      style: { stroke: color, strokeWidth: 2 },
      labelStyle: {
        fill: "#0f172a",
        fontSize: 11,
        fontWeight: 700,
      },
      labelBgStyle: { fill: "#ffffff", fillOpacity: 0.88 },
      labelBgPadding: [6, 3],
      labelBgBorderRadius: 6,
    });
  };

  for (const node of nodes) {
    if (needsNextNode(node.type)) {
      pushEdge(node, "next", node.nextKey, "next", "#10b981");
    }
    if (node.type === "send_buttons" || node.type === "send_list") {
      for (const button of node.buttons ?? []) {
        pushEdge(
          node,
          `choice:${button.replyId}`,
          button.nextKey,
          button.label || button.replyId,
          "#0ea5e9",
        );
      }
    }
    if (node.type === "condition") {
      pushEdge(
        node,
        "condition:true",
        node.condition?.trueNextKey,
        "true",
        "#8b5cf6",
      );
      pushEdge(
        node,
        "condition:false",
        node.condition?.falseNextKey,
        "false",
        "#f97316",
      );
    }
  }

  return edges;
}

function nodeTargets(node: FlowNode): string[] {
  const targets: string[] = [];
  if (node.nextKey) targets.push(node.nextKey);
  for (const button of node.buttons ?? []) {
    if (button.nextKey) targets.push(button.nextKey);
  }
  if (node.condition?.trueNextKey) targets.push(node.condition.trueNextKey);
  if (node.condition?.falseNextKey) targets.push(node.condition.falseNextKey);
  return targets;
}

function autoLayoutPositions(
  nodes: FlowNode[],
  entryNodeKey: string,
): Map<string, FlowNodePosition> {
  const byKey = new Map(nodes.map((node) => [node.key, node]));
  const levels = new Map<string, number>();
  const queue: Array<{ key: string; level: number }> = [];
  const entry = entryNodeKey && byKey.has(entryNodeKey) ? entryNodeKey : nodes[0]?.key;
  if (entry) queue.push({ key: entry, level: 0 });

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    const previous = levels.get(current.key);
    if (previous !== undefined && previous <= current.level) continue;
    levels.set(current.key, current.level);
    const node = byKey.get(current.key);
    if (!node) continue;
    for (const target of nodeTargets(node)) {
      if (byKey.has(target)) queue.push({ key: target, level: current.level + 1 });
    }
  }

  let fallbackLevel = Math.max(0, ...levels.values()) + 1;
  for (const node of nodes) {
    if (!levels.has(node.key)) {
      levels.set(node.key, fallbackLevel);
      fallbackLevel += 1;
    }
  }

  const buckets = new Map<number, FlowNode[]>();
  for (const node of nodes) {
    const level = levels.get(node.key) ?? 0;
    buckets.set(level, [...(buckets.get(level) ?? []), node]);
  }

  const positions = new Map<string, FlowNodePosition>();
  const sortedLevels = Array.from(buckets.keys()).sort((a, b) => a - b);
  for (const level of sortedLevels) {
    const bucket = buckets.get(level) ?? [];
    bucket.forEach((node, row) => {
      positions.set(node.key, {
        x: 80 + level * 275,
        y: 90 + row * 190,
      });
    });
  }
  return positions;
}

function nextNodePosition(
  nodes: FlowNode[],
  selectedNode?: FlowNode,
): FlowNodePosition {
  if (selectedNode?.position) {
    return {
      x: selectedNode.position.x + 290,
      y: selectedNode.position.y,
    };
  }
  const layout = autoLayoutPositions(nodes, nodes[0]?.key ?? "");
  if (selectedNode) {
    const selectedPosition = layout.get(selectedNode.key);
    if (selectedPosition) {
      return { x: selectedPosition.x + 290, y: selectedPosition.y };
    }
  }
  return {
    x: 80 + (nodes.length % 4) * 290,
    y: 100 + Math.floor(nodes.length / 4) * 190,
  };
}

function walkFlowPath(
  nodes: FlowNode[],
  startKey: string,
  limit: number,
): FlowNode[] {
  const byKey = new Map(nodes.map((node) => [node.key, node]));
  const path: FlowNode[] = [];
  const seen = new Set<string>();
  let currentKey = startKey || nodes[0]?.key;

  while (currentKey && path.length < limit && !seen.has(currentKey)) {
    const node = byKey.get(currentKey);
    if (!node) break;
    path.push(node);
    seen.add(currentKey);
    currentKey =
      node.nextKey ??
      node.buttons?.find((button) => button.nextKey)?.nextKey ??
      node.condition?.trueNextKey ??
      node.condition?.falseNextKey ??
      "";
  }

  return path;
}
