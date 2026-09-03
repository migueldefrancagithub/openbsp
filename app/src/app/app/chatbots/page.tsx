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
  BaseEdge,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  useNodesState,
  type Connection,
  type Edge,
  type EdgeProps,
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
import Link from "next/link";
import { PageHeader } from "@/components/app/EmptyState";
import { SegmentedTabs } from "@/components/app/SegmentedTabs";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { relativeTime } from "@/lib/relativeTime";
import { useI18n, type Locale } from "@/lib/i18n";
import { convexErrorMessage } from "@/lib/convexErrorMessage";
import { channelStateLabel } from "@/lib/operationalLabels";

type ChatbotStatus = "draft" | "active" | "paused";
type TriggerKind = "inbound" | "keyword" | "ctwa" | "handoff";
type StudioTab = "bots" | "flows";
type BuilderTab = "design" | "settings" | "runs";
type FlowNodeType =
  | "start"
  | "send_message"
  | "send_template"
  | "send_buttons"
  | "send_list"
  | "collect_input"
  | "condition"
  | "set_tag"
  | "handoff"
  | "end";
type ConditionOperator =
  | "equals"
  | "contains"
  | "starts_with"
  | "ends_with"
  | "present"
  | "absent";
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
  template?: {
    templateId: Id<"templates">;
    variables: Record<string, string>;
  };
  channelTemplate?: {
    templateId: Id<"channelTemplates">;
    variables: Record<string, string>;
  };
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
  channelId?: Id<"channels">;
  channelDisplayName?: string;
  channelConnectionState?: string;
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

type AutomationChannelRow = {
  _id: Id<"channels">;
  displayName: string;
  connectionState?: string;
  status: string;
  sendMode: string;
  phoneNumber?: string;
};

type FlowRunRow = {
  _id: string;
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
    _id: string;
    eventType: string;
    nodeKey?: string;
    payload?: unknown;
    createdAt: number;
  }>;
};

const STATUS_STYLES: Record<ChatbotStatus, string> = {
  active: "border-emerald-200 bg-emerald-50 text-emerald-700",
  draft: "border-line bg-surface-2 text-body",
  paused: "border-amber-200 bg-amber-50 text-amber-700",
};

function pick(locale: Locale, pt: string, en: string) {
  return locale === "pt" ? pt : en;
}

function triggerLabel(kind: TriggerKind, locale: Locale) {
  const labels: Record<TriggerKind, [string, string]> = {
    inbound: ["Todas as mensagens recebidas", "All inbound messages"],
    keyword: ["Correspondência por palavra-chave", "Keyword match"],
    ctwa: ["Lead de anúncio Click-to-WhatsApp", "Click-to-WhatsApp lead"],
    handoff: ["Continuação após atendimento humano", "Human handoff follow-up"],
  };
  return pick(locale, ...labels[kind]);
}

function nodeTypeLabel(type: FlowNodeType, locale: Locale) {
  const labels: Record<FlowNodeType, [string, string]> = {
    start: ["Início", "Start"],
    send_message: ["Enviar mensagem", "Send message"],
    send_template: ["Enviar template", "Send template"],
    send_buttons: ["Menu de botões", "Button menu"],
    send_list: ["Menu de lista", "List menu"],
    collect_input: ["Recolher resposta", "Collect input"],
    condition: ["Condição", "Condition"],
    set_tag: ["Aplicar etiqueta", "Set tag"],
    handoff: ["Passar à equipa", "Human handoff"],
    end: ["Fim", "End"],
  };
  return pick(locale, ...labels[type]);
}

function botStatusLabel(status: ChatbotStatus, locale: Locale) {
  const labels: Record<ChatbotStatus, [string, string]> = {
    active: ["Ativo", "Active"],
    draft: ["Rascunho", "Draft"],
    paused: ["Pausado", "Paused"],
  };
  return pick(locale, ...labels[status]);
}

function localizeFlowIssue(message: string, locale: Locale) {
  if (locale === "en") return message;
  const exact: Record<string, string> = {
    "Bot name is required.": "O nome do agente é obrigatório.",
    "Keyword-triggered flows need at least one keyword.":
      "Fluxos por palavra-chave precisam de pelo menos uma palavra.",
    "Add at least one node before activation.":
      "Adicione pelo menos um passo antes de ativar.",
    "Pick an entry node.": "Escolha um passo de entrada.",
    "Each node needs a stable key.": "Cada passo precisa de uma chave estável.",
    "Each button needs a reply id.": "Cada botão precisa de um identificador de resposta.",
    "Condition nodes need a variable key.":
      "Passos de condição precisam de uma variável.",
    "Button nodes need 1-3 buttons for Meta.":
      "Menus de botões precisam de 1 a 3 botões.",
    "List nodes need 1-10 rows.": "Menus de lista precisam de 1 a 10 opções.",
  };
  if (exact[message]) return exact[message];
  return message
    .replace(" needs a next node.", " precisa de um próximo passo.")
    .replace(" needs message text.", " precisa do texto da mensagem.")
    .replace(" needs an approved template.", " precisa de um template aprovado.")
    .replace(" needs a prompt.", " precisa de uma pergunta.")
    .replace(" needs a variable key.", " precisa de uma variável.")
    .replace(" needs menu message text.", " precisa do texto do menu.")
    .replace(" needs a tag value.", " precisa de uma etiqueta.")
    .replace(" does not exist.", " não existe.")
    .replace(" is not reachable from the entry node.", " não é alcançável a partir da entrada.")
    .replace(" references a template that does not exist.", " referencia um template inexistente.")
    .replace(" must use an approved template", " deve usar um template aprovado")
    .replace(" points to missing node ", " aponta para um passo inexistente ")
    .replace("Choice labels must be ", "Os rótulos devem ter ")
    .replace(" characters.", " caracteres.");
}

const FLOW_NODE_TYPES: FlowNodeType[] = [
  "send_message",
  "send_template",
  "send_buttons",
  "send_list",
  "collect_input",
  "condition",
  "set_tag",
  "handoff",
  "end",
];

export default function ChatbotsPage() {
  const { locale, tr } = useI18n();
  const studio = useQuery(api.chatbots.list);
  const createFolder = useMutation(api.chatbots.createFolder);
  const createBot = useMutation(api.chatbots.createBot);
  const updateFlow = useMutation(api.chatbots.updateFlow);
  const applyTemplate = useMutation(api.chatbots.applyTemplate);
  const updateStatus = useMutation(api.chatbots.updateStatus);
  const bindChannel = useMutation(api.chatbots.bindChannel);
  const [folderName, setFolderName] = useState("");
  const [botName, setBotName] = useState("");
  const [botDescription, setBotDescription] = useState("");
  const [selectedFolderId, setSelectedFolderId] = useState<
    Id<"chatbotFolders"> | ""
  >("");
  const [triggerKind, setTriggerKind] = useState<TriggerKind>("ctwa");
  const [templateSlug, setTemplateSlug] = useState<
    FlowTemplate["slug"] | ""
  >("clinic_lead_capture");
  const [botChannelId, setBotChannelId] = useState<Id<"channels"> | "">("");
  const [studioTab, setStudioTab] = useState<StudioTab>("flows");
  const [selectedBotId, setSelectedBotId] = useState<Id<"chatbots"> | "">("");
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
  const automationChannels = (studio?.automationChannels ?? []) as AutomationChannelRow[];
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
  const legacyFlowRuns = useQuery(
    api.chatbotFlows.listRuns,
    selectedBot && !selectedBot.channelId
      ? { chatbotId: selectedBot._id, limit: 12 }
      : "skip",
  ) as FlowRunRow[] | undefined;
  const neutralFlowRuns = useQuery(
    api.channelAutomation.listRuns,
    selectedBot?.channelId
      ? { chatbotId: selectedBot._id, limit: 12 }
      : "skip",
  ) as FlowRunRow[] | undefined;
  const flowRuns = selectedBot?.channelId ? neutralFlowRuns : legacyFlowRuns;
  const flowIssues = selectedBot?.flowValidationIssues ?? [];
  const flowErrors = flowIssues.filter((issue) => issue.severity === "error");
  const flowWarnings = flowIssues.filter(
    (issue) => issue.severity === "warning",
  );

  useEffect(() => {
    if (!selectedBotId && visibleBots[0]) {
      setSelectedBotId(visibleBots[0]._id);
    }
  }, [selectedBotId, visibleBots]);

  useEffect(() => {
    if (!botChannelId && automationChannels[0]) {
      setBotChannelId(automationChannels[0]._id);
    }
  }, [automationChannels, botChannelId]);

  useEffect(() => {
    if (!selectedBot) return;
    setFlowEntryNodeKey(
      selectedBot.entryNodeKey ?? selectedBot.flowNodes?.[0]?.key ?? "",
    );
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
      setNotice(tr("Pasta criada.", "Folder created."));
    } catch (err) {
      setError(readError(err, locale));
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
        templateSlug: templateSlug || undefined,
        channelId: botChannelId || undefined,
      });
      setBotName("");
      setBotDescription("");
      setStudioTab("flows");
      setNotice(
        tr(
          "Agente criado como rascunho com um fluxo inicial.",
          "Bot drafted with a flow template.",
        ),
      );
    } catch (err) {
      setError(readError(err, locale));
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
          ? tr(
              `Fluxo guardado como rascunho com ${errors.length} bloqueio(s).`,
              `Flow saved as draft with ${errors.length} blocker(s).`,
            )
          : tr(
              "Fluxo guardado e pronto para ativar.",
              "Flow saved and ready to activate.",
            ),
      );
    } catch (err) {
      setError(readError(err, locale));
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
        setNotice(
          tr(
            `Fluxo guardado como rascunho com ${errors.length} bloqueio(s).`,
            `Flow saved as draft with ${errors.length} blocker(s).`,
          ),
        );
        return;
      }
      await updateStatus({ chatbotId: selectedBot._id, status: "active" });
      setNotice(tr("Fluxo validado e publicado.", "Flow validated and published."));
    } catch (err) {
      setError(readError(err, locale));
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
      setNotice(tr("Template aplicado ao fluxo.", "Template applied to flow."));
    } catch (err) {
      setError(readError(err, locale));
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
    const node = { ...defaultNode(key, type, locale), position };
    setFlowNodes((nodes) => [...nodes, node]);
    if (!flowEntryNodeKey) setFlowEntryNodeKey(node.key);
    return node.key;
  }

  function removeNode(index: number) {
    setFlowNodes((nodes) =>
      nodes.filter((_, itemIndex) => itemIndex !== index),
    );
  }

  async function setBotStatus(botId: Id<"chatbots">, status: ChatbotStatus) {
    setBusy(`status:${botId}`);
    setNotice(null);
    setError(null);
    try {
      await updateStatus({ chatbotId: botId, status });
      setNotice(
        status === "active"
          ? tr("Agente ativado.", "Bot activated.")
          : tr("Agente atualizado.", "Bot updated."),
      );
    } catch (err) {
      setError(readError(err, locale));
    } finally {
      setBusy(null);
    }
  }

  async function handleBindChannel(
    chatbotId: Id<"chatbots">,
    channelId: Id<"channels">,
  ) {
    setBusy(`channel:${chatbotId}`);
    setNotice(null);
    setError(null);
    try {
      await bindChannel({ chatbotId, channelId });
      setNotice(
        tr(
          "Canal isolado selecionado. Reveja e publique o fluxo quando o piloto estiver pronto.",
          "Isolated channel selected. Review and publish the flow when the pilot is ready.",
        ),
      );
    } catch (err) {
      setError(readError(err, locale));
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
      automationChannels={automationChannels}
      onBindChannel={handleBindChannel}
      runs={flowRuns ?? []}
      runsLoading={Boolean(selectedBot && flowRuns === undefined)}
    />
  );

  if (studioTab === "flows") {
    return (
      <div className="min-h-screen bg-[#eef6ef]">
        <div>
          {(notice || error) && (
            <div
              className={`fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-lg border px-4 py-3 text-sm shadow-lg ${
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
        eyebrow={tr("AUTOMAÇÃO CLÍNICA", "CLINIC AUTOMATION")}
        title={tr("Agentes", "Agents")}
        description={tr(
          "Configure agentes que qualificam pacientes, executam tarefas autorizadas e chamam a equipa quando necessário.",
          "Configure agents that qualify patients, run authorized tasks, and call the team when needed.",
        )}
        action={
          <div className="flex flex-wrap gap-2">
            <a
              href="#create-folder"
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-ink transition-colors hover:border-line"
            >
              <FolderPlus size={15} />
              {tr("Nova pasta", "New folder")}
            </a>
            <a
              href="#create-bot"
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-emerald-600 px-3 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
            >
              <Plus size={15} />
              {tr("Novo agente", "New agent")}
            </a>
            <button
              type="button"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-emerald-600 text-white transition-colors hover:bg-emerald-700"
              aria-label={tr("Importar agente", "Import agent")}
              title={tr("Importar agente", "Import agent")}
            >
              <UploadCloud size={17} />
            </button>
          </div>
        }
      />

      <div className="min-h-[calc(100vh-105px)] bg-[#f7fafc] px-4 py-5 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl space-y-4">
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
                label: tr("Editor de fluxos", "Flow builder"),
                value: tr(
                  `${selectedBot?.nodeCount ?? 0} passos`,
                  `${selectedBot?.nodeCount ?? 0} nodes`,
                ),
                icon: Workflow,
              },
              {
                key: "bots",
                label: tr("Biblioteca de agentes", "Agent library"),
                value: tr(`${bots.length} agentes`, `${bots.length} agents`),
                icon: Bot,
              },
            ]}
          />

          <section className="grid gap-3 md:grid-cols-4">
            <StatCard
              icon={Bot}
              label={tr("Agentes", "Agents")}
              value={studio?.stats.total ?? 0}
              note={tr("Automações WhatsApp", "WhatsApp automations")}
            />
            <StatCard
              icon={Radio}
              label={tr("Ativos", "Active")}
              value={studio?.stats.active ?? 0}
              note={tr("A responder agora", "Responding now")}
            />
            <StatCard
              icon={PauseCircle}
              label={tr("Pausados", "Paused")}
              value={studio?.stats.paused ?? 0}
              note={tr("Aguardam revisão", "Manual review")}
            />
            <StatCard
              icon={Sparkles}
              label={tr("Rascunhos", "Draft")}
              value={studio?.stats.draft ?? 0}
              note={tr("Em preparação", "Ready to refine")}
            />
          </section>

          <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
            <div>
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="font-[var(--font-outfit)] text-lg font-semibold text-ink">
                    {tr("Pastas", "Folders")}
                  </h2>
                  <p className="text-sm text-muted">
                    {tr(
                      "Separe receção, vendas, confirmações e suporte.",
                      "Separate reception, sales, confirmations, and support.",
                    )}
                  </p>
                </div>
                {selectedFolder && (
                  <button
                    type="button"
                    onClick={() => setSelectedFolderId("")}
                    className="text-sm font-medium text-violet-600"
                  >
                    {tr("Mostrar todos", "Show all")}
                  </button>
                )}
              </div>

              {studio === undefined ? (
                <div className="grid gap-3 md:grid-cols-3">
                  {[0, 1, 2].map((item) => (
                    <div
                      key={item}
                      className="h-20 animate-pulse rounded-xl border border-line-soft bg-surface-2"
                    />
                  ))}
                </div>
              ) : folders.length === 0 ? (
                <div className="rounded-xl border border-dashed border-line p-6 text-center">
                  <FolderPlus size={24} className="mx-auto text-faint" />
                  <p className="mt-3 text-sm font-semibold text-ink">
                    {tr("Ainda não há pastas", "No folders yet")}
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    {tr(
                      "Crie uma pasta para organizar os agentes por objetivo.",
                      "Create a folder to organize agents by objective.",
                    )}
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
                        className={`flex min-h-20 items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
                          active
                            ? "border-emerald-300 bg-emerald-50"
                            : "border-line bg-surface hover:border-emerald-200 hover:bg-surface-2"
                        }`}
                      >
                        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                          <FolderPlus size={17} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-ink">
                            {folder.name}
                          </span>
                          <span className="mt-0.5 block text-xs text-muted">
                            {folder.botCount} {tr("agente", "agent")}
                            {folder.botCount === 1 ? "" : "s"}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          <div className="grid gap-4 xl:grid-cols-[340px_1fr]">
            <aside className="space-y-4">
              <section
                id="create-folder"
                className="scroll-mt-24 rounded-lg border border-line bg-surface p-4 shadow-sm"
              >
                <PanelTitle
                  icon={FolderPlus}
                  title={tr("Criar pasta", "Create folder")}
                  body={tr(
                    "Agrupe agentes que trabalham no mesmo objetivo.",
                    "Group agents that work toward the same objective.",
                  )}
                />
                <form className="mt-4 space-y-3" onSubmit={handleCreateFolder}>
                  <TextInput
                    label={tr("Nome da pasta", "Folder name")}
                    value={folderName}
                    onChange={setFolderName}
                    placeholder={tr("Campanhas", "Campaigns")}
                  />
                  <SubmitButton
                    disabled={busy !== null || folderName.trim().length < 2}
                    loading={busy === "folder"}
                    icon={FolderPlus}
                  >
                    {tr("Criar pasta", "Create folder")}
                  </SubmitButton>
                </form>
              </section>

              <section
                id="create-bot"
                className="scroll-mt-24 rounded-lg border border-line bg-surface p-4 shadow-sm"
              >
                <PanelTitle
                  icon={Bot}
                  title={tr("Criar agente", "Create agent")}
                  body={tr(
                    "Escolha um objetivo e ajuste o fluxo antes de publicar.",
                    "Choose an objective and tune the flow before publishing.",
                  )}
                />
                <form className="mt-4 space-y-3" onSubmit={handleCreateBot}>
                  <TextInput
                    label={tr("Nome do agente", "Agent name")}
                    value={botName}
                    onChange={setBotName}
                    placeholder={tr("Qualificador da campanha LPG", "LPG campaign qualifier")}
                  />
                  <TextInput
                    label={tr("Objetivo", "Objective")}
                    value={botDescription}
                    onChange={setBotDescription}
                    placeholder={tr(
                      "Qualifica leads CTWA antes de entregar à equipa",
                      "Qualifies CTWA leads before agent handoff",
                    )}
                  />
                  <SelectBox
                    label={tr("Pasta", "Folder")}
                    value={selectedFolderId}
                    onChange={(value) =>
                      setSelectedFolderId(value as Id<"chatbotFolders"> | "")
                    }
                    options={folders.map((folder) => ({
                      value: folder._id,
                      label: folder.name,
                    }))}
                    placeholder={tr("Sem pasta", "No folder")}
                  />
                  <SelectBox
                    label={tr("Fluxo inicial", "Starter flow")}
                    value={templateSlug}
                    onChange={(value) =>
                      setTemplateSlug(value as FlowTemplate["slug"] | "")
                    }
                    options={templates.map((template) => ({
                      value: template.slug,
                      label: `${template.name} (${template.nodeCount})`,
                    }))}
                    placeholder={tr("Em branco", "Blank")}
                  />
                  <SelectBox
                    label="Trigger"
                    value={triggerKind}
                    onChange={(value) => setTriggerKind(value as TriggerKind)}
                    options={[
                      { value: "ctwa", label: triggerLabel("ctwa", locale) },
                      { value: "inbound", label: triggerLabel("inbound", locale) },
                      { value: "keyword", label: triggerLabel("keyword", locale) },
                      { value: "handoff", label: triggerLabel("handoff", locale) },
                    ]}
                    placeholder={tr("Escolha o gatilho", "Choose trigger")}
                  />
                  <SelectBox
                    label={tr("Canal WhatsApp", "WhatsApp channel")}
                    value={botChannelId}
                    onChange={(value) =>
                      setBotChannelId(value as Id<"channels"> | "")
                    }
                    options={automationChannels.map((channel) => ({
                      value: channel._id,
                      label: `${channel.displayName} · ${channelStateLabel(channel.connectionState ?? channel.status, locale)}`,
                    }))}
                    placeholder={tr("Selecione um canal", "Select a channel")}
                  />
                  <SubmitButton
                    disabled={busy !== null || botName.trim().length < 2 || automationChannels.length === 0}
                    loading={busy === "bot"}
                    icon={Plus}
                  >
                    {tr("Criar rascunho", "Create draft")}
                  </SubmitButton>
                </form>
              </section>
            </aside>

            <section className="overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
              <div className="flex flex-col gap-2 border-b border-line-soft px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="font-[var(--font-outfit)] text-lg font-semibold text-ink">
                    {selectedFolder ? selectedFolder.name : tr("Todos os agentes", "All agents")}
                  </h2>
                  <p className="text-sm text-muted">
                    {tr(
                      "A ativação é explícita: nenhum agente assume uma conversa humana por acidente.",
                      "Activation is explicit so an agent never takes over a human conversation by accident.",
                    )}
                  </p>
                </div>
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-faint">
                  {visibleBots.length} {tr("no total", "total")}
                </span>
              </div>

              {studio === undefined ? (
                <div className="p-5">
                  <div className="h-40 animate-pulse rounded-xl bg-surface-2" />
                </div>
              ) : visibleBots.length === 0 ? (
                <div className="p-10 text-center">
                  <Bot size={28} className="mx-auto text-faint" />
                  <h3 className="mt-3 font-[var(--font-outfit)] text-lg font-semibold text-ink">
                    {tr("Não há agentes nesta vista", "No agents in this view")}
                  </h3>
                  <p className="mt-1 text-sm text-muted">
                    {tr(
                      "Crie um agente de receção, vendas, confirmação ou suporte.",
                      "Create a reception, sales, confirmation, or support agent.",
                    )}
                  </p>
                </div>
              ) : (
                <div className="grid gap-4 p-5 2xl:grid-cols-2">
                  {visibleBots.map((bot) => (
                    <article
                      key={bot._id}
                      className="rounded-lg border border-line bg-surface p-4 transition-colors hover:border-line hover:bg-slate-50/40"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 gap-3">
                            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/70 bg-white/62 text-emerald-700 shadow-inner">
                              <Bot size={19} />
                            </span>
                            <div className="min-w-0">
                              <h3 className="truncate text-base font-semibold text-ink">
                                {bot.name}
                              </h3>
                              <p className="mt-1 text-sm leading-6 text-muted">
                                {bot.description ??
                                  tr(
                                    "Ainda sem objetivo. Defina-o antes de ativar.",
                                    "No objective yet. Add one before activation.",
                                  )}
                              </p>
                            </div>
                          </div>
                          <span
                            className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${STATUS_STYLES[bot.status]}`}
                          >
                            {botStatusLabel(bot.status, locale)}
                          </span>
                        </div>

                        <div className="mt-5 grid gap-2 sm:grid-cols-3">
                          <BotMeta
                            icon={Zap}
                            label={tr("Gatilho", "Trigger")}
                            value={triggerLabel(bot.triggerKind, locale)}
                          />
                          <BotMeta
                            icon={BrainCircuit}
                            label={tr("Modelo", "Model")}
                            value={bot.model ?? "CXCast guardrail bot"}
                          />
                          <BotMeta
                            icon={Radio}
                            label={tr("Canal", "Channel")}
                            value={bot.channelDisplayName ?? tr("Não ligado", "Not bound")}
                          />
                        </div>

                        <div className="mt-4 rounded-xl border border-line-soft bg-white/55 p-3">
                          <SelectBox
                            label={tr("Canal de automação", "Automation channel")}
                            value={bot.channelId ?? ""}
                            onChange={(value) => {
                              if (value) {
                                void handleBindChannel(
                                  bot._id,
                                  value as Id<"channels">,
                                );
                              }
                            }}
                            options={automationChannels.map((channel) => ({
                              value: channel._id,
                              label: `${channel.displayName} · ${channelStateLabel(channel.connectionState ?? channel.status, locale)}`,
                            }))}
                            placeholder={tr("Obrigatório para ativar", "Required before activation")}
                          />
                          <p className="mt-2 text-[11px] leading-5 text-muted">
                            {tr(
                              "Alterar o canal devolve o agente a rascunho. Só aparecem canais ativos.",
                              "Changing channel returns the agent to draft. Only active channels appear here.",
                            )}
                          </p>
                        </div>

                        <div className="mt-5 flex flex-wrap gap-2 border-t border-line-soft pt-4">
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
                              {tr("Ativar", "Activate")}
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
                              {tr("Pausar", "Pause")}
                            </button>
                          )}
                          {bot.status !== "draft" && (
                            <button
                              type="button"
                              onClick={() => setBotStatus(bot._id, "draft")}
                              disabled={busy !== null}
                              className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-ink transition-colors hover:border-line disabled:opacity-50"
                            >
                              {tr("Voltar a rascunho", "Move to draft")}
                            </button>
                          )}
                        </div>
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

function stepCatalog(locale: Locale): Array<{
  type: FlowNodeType;
  label: string;
  detail: string;
  icon: LucideIcon;
}> {
  return [
  {
    type: "send_message",
    label: pick(locale, "Enviar mensagem", "Send message"),
    detail: pick(locale, "Texto WhatsApp com próximo passo.", "WhatsApp text with a next step."),
    icon: MessageSquare,
  },
  {
    type: "send_template",
    label: pick(locale, "Enviar template", "Send template"),
    detail: pick(locale, "Template aprovado, inclusive fora da janela de 24h.", "Approved template, including outside the 24h window."),
    icon: Sparkles,
  },
  {
    type: "collect_input",
    label: pick(locale, "Fazer pergunta", "Ask question"),
    detail: pick(locale, "Guarda a resposta numa variável.", "Stores the reply in a variable."),
    icon: Send,
  },
  {
    type: "send_buttons",
    label: pick(locale, "Menu de botões", "Button menu"),
    detail: pick(locale, "1 a 3 respostas rápidas com caminhos.", "1-3 quick replies with branches."),
    icon: GitBranch,
  },
  {
    type: "send_list",
    label: pick(locale, "Lista", "List"),
    detail: pick(locale, "Até 10 opções com caminhos.", "Up to 10 options with branches."),
    icon: ListTree,
  },
  {
    type: "condition",
    label: pick(locale, "Condição", "Condition"),
    detail: pick(locale, "Encaminha pelos caminhos verdadeiro e falso.", "Routes true and false paths."),
    icon: Split,
  },
  {
    type: "set_tag",
    label: pick(locale, "Aplicar etiqueta", "Set tag"),
    detail: pick(locale, "Marca o paciente antes de continuar.", "Marks the patient before continuing."),
    icon: Tag,
  },
  {
    type: "handoff",
    label: pick(locale, "Chamar equipa", "Handoff"),
    detail: pick(locale, "Pausa a automação para atendimento humano.", "Pauses automation for a human."),
    icon: UploadCloud,
  },
  {
    type: "end",
    label: pick(locale, "Fim", "End"),
    detail: pick(locale, "Termina este caminho da automação.", "Finishes this automation path."),
    icon: CheckCircle2,
  },
  ];
}

const FLOW_CANVAS_NODE_TYPES = { flowStep: FlowCanvasStepNode };
const FLOW_CANVAS_EDGE_TYPES = { whatsappCurve: WhatsAppCurveEdge };
const FLOW_DEFAULT_EDGE_OPTIONS = {
  type: "whatsappCurve",
  markerEnd: { type: MarkerType.ArrowClosed },
};
const FLOW_LAYOUT_X_STEP = 430;
const FLOW_LAYOUT_BASE_Y = 220;
const FLOW_LAYOUT_BRANCH_GAP = 206;
const FLOW_LAYOUT_SWAY = [0, -64, 64, -30, 96, -88, 38];
const FLOW_DEFAULT_VIEWPORT = { x: 44, y: 94, zoom: 0.64 };

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
  automationChannels,
  onBindChannel,
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
  automationChannels: AutomationChannelRow[];
  onBindChannel: (
    chatbotId: Id<"chatbots">,
    channelId: Id<"channels">,
  ) => void;
  runs: FlowRunRow[];
  runsLoading: boolean;
}) {
  const { locale, tr } = useI18n();
  const availableSteps = useMemo(() => stepCatalog(locale), [locale]);
  const [selectedNodeKey, setSelectedNodeKey] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<
    "edit" | "preview" | "runs" | null
  >(
    "edit",
  );
  const [canvasNodes, setCanvasNodes, onCanvasNodesChange] =
    useNodesState<FlowCanvasNode>([]);
  const flowNodeTypes = useMemo(() => FLOW_CANVAS_NODE_TYPES, []);
  const flowEdgeTypes = useMemo(() => FLOW_CANVAS_EDGE_TYPES, []);
  const flowDefaultEdgeOptions = useMemo(() => FLOW_DEFAULT_EDGE_OPTIONS, []);

  useEffect(() => {
    if (nodes.length === 0) {
      setSelectedNodeKey("");
      return;
    }
    const preferredKey =
      entryNodeKey && nodes.some((node) => node.key === entryNodeKey)
        ? entryNodeKey
        : nodes[0].key;
    if (
      !selectedNodeKey ||
      !nodes.some((node) => node.key === selectedNodeKey)
    ) {
      setSelectedNodeKey(preferredKey);
    }
  }, [entryNodeKey, nodes, selectedNodeKey]);

  const selectedNodeIndex = nodes.findIndex(
    (node) => node.key === selectedNodeKey,
  );
  const selectedNode =
    selectedNodeIndex >= 0 ? nodes[selectedNodeIndex] : undefined;
  const issuesByNode = useMemo(() => groupIssuesByNode(issues), [issues]);
  const canvasEdges = useMemo(() => buildFlowEdges(nodes), [nodes]);
  const derivedCanvasNodes = useMemo<FlowCanvasNode[]>(() => {
    const autoPositions = autoLayoutPositions(nodes, entryNodeKey);
    return nodes.map((node, index) => {
      const nodeIssues = issuesByNode.get(node.key) ?? [];
      return {
        id: node.key,
        type: "flowStep",
        position: node.position ??
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
    (
      sourceKey: string,
      sourceHandle: string | null | undefined,
      targetKey?: string,
    ) => {
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

      if (
        sourceHandle === "condition:true" ||
        sourceHandle === "condition:false"
      ) {
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
      patchConnection(
        connection.source,
        connection.sourceHandle,
        connection.target,
      );
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
      setDrawerMode("edit");
      setPaletteOpen(false);
    },
    [nodes, onAddNode, selectedNode],
  );

  if (!selectedBot) {
    return (
      <main className="flex min-h-screen flex-col overflow-hidden bg-[#f7fafc] lg:h-screen">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-line bg-surface px-5">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-faint">
              {tr("AUTOMAÇÕES", "AUTOMATIONS")}
            </div>
            <h1 className="text-sm font-semibold text-ink">
              {tr("Editor de fluxos", "Flow builder")}
            </h1>
          </div>
          <button
            type="button"
            onClick={onOpenBots}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-nav-active px-4 text-sm font-semibold text-white shadow-[0_18px_44px_-24px_rgba(15,23,42,0.8)] hover:bg-brand-solid"
          >
            <Plus size={15} />
            {tr("Criar agente", "Create agent")}
          </button>
        </header>
        <section className="flow-builder-canvas grid flex-1 place-items-center px-4 py-8">
          <div className="max-w-md rounded-lg border border-line bg-surface p-8 text-center shadow-sm">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-nav-active text-white">
              <Workflow size={21} />
            </span>
            <h2 className="mt-4 font-[var(--font-outfit)] text-xl font-semibold text-ink">
              {tr("Crie um agente para abrir o editor", "Create an agent to open the editor")}
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              {tr(
                "Escolha um fluxo inicial e ajuste passos, caminhos e a pré-visualização do WhatsApp no mesmo espaço.",
                "Choose a starter flow and tune steps, paths, and the WhatsApp preview in one workspace.",
              )}
            </p>
            <button
              type="button"
              onClick={onOpenBots}
              className="mt-6 inline-flex h-10 items-center gap-2 rounded-lg bg-nav-active px-4 text-sm font-semibold text-white hover:bg-brand-solid"
            >
              <Plus size={15} />
              {tr("Criar agente", "Create agent")}
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col overflow-hidden bg-[#f7fafc] lg:h-screen">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-line bg-surface px-4">
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted">
          <span className="font-medium text-muted">{tr("Automações", "Automations")}</span>
          <ArrowRight size={12} className="text-faint" />
          <select
            value={selectedBotId || selectedBot._id}
            onChange={(event) =>
              onSelectBot(event.target.value as Id<"chatbots">)
            }
            className="h-8 max-w-[260px] truncate rounded-md border border-transparent bg-transparent px-1 text-sm font-semibold text-ink outline-none hover:border-white/80 hover:bg-white/60"
            aria-label={tr("Selecionar agente", "Select agent")}
          >
            {bots.map((bot) => (
              <option key={bot._id} value={bot._id}>
                {bot.name}
              </option>
            ))}
          </select>
          <span className="hidden h-1 w-1 rounded-full bg-faint/50 sm:inline-block" />
          <select
            value={selectedBot.channelId ?? ""}
            onChange={(event) => {
              if (event.target.value) {
                onBindChannel(
                  selectedBot._id,
                  event.target.value as Id<"channels">,
                );
              }
            }}
            className="hidden h-8 max-w-[220px] truncate rounded-md border border-transparent bg-transparent px-1 text-xs font-medium text-body outline-none hover:border-white/80 hover:bg-white/60 md:block"
            aria-label={tr("Selecionar canal da automação", "Select automation channel")}
          >
            <option value="">{tr("Sem canal", "No channel")}</option>
            {automationChannels.map((channel) => (
              <option key={channel._id} value={channel._id}>
                {channel.displayName} · {channelStateLabel(channel.connectionState ?? channel.status, locale)}
              </option>
            ))}
          </select>
          <span className="hidden h-1 w-1 rounded-full bg-faint/50 md:inline-block" />
          <span className="hidden whitespace-nowrap sm:inline">
            {nodes.length} {tr("passos", "steps")}
          </span>
          <span className="hidden h-1 w-1 rounded-full bg-faint/50 sm:inline-block" />
          <span className="hidden whitespace-nowrap sm:inline">
            {runsLoading
              ? tr("A carregar execuções", "Loading runs")
              : tr(`${runs.length} execuções`, `${runs.length} runs`)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-1.5 text-xs font-medium text-muted sm:inline-flex">
            <CheckCircle2 size={13} className="text-faint" />
            {tr("Guardado", "Saved")}
          </span>
          <div className="relative">
            <button
              type="button"
              onClick={() => setTemplateMenuOpen((open) => !open)}
              disabled={busy !== null}
              className="hidden h-8 items-center gap-2 rounded-md border border-white/80 bg-white/68 px-3 text-sm font-semibold text-ink shadow-sm backdrop-blur-xl hover:bg-white/88 disabled:opacity-50 md:inline-flex"
            >
              <CopyPlus size={15} />
              Templates
            </button>
            {templateMenuOpen && (
              <div className="absolute right-0 top-11 z-30 w-80 rounded-lg border border-white/80 bg-white/76 p-2 shadow-[0_26px_80px_-34px_rgba(15,23,42,0.62)] ring-1 ring-white/70 backdrop-blur-2xl">
                {templates.map((template) => (
                  <button
                    key={template.slug}
                    type="button"
                    onClick={() => {
                      onApplyTemplate(template.slug);
                      setTemplateMenuOpen(false);
                    }}
                    disabled={busy !== null}
                    className="block w-full rounded-xl px-3 py-2 text-left hover:bg-white/72 disabled:opacity-50"
                  >
                    <span className="block text-sm font-semibold text-ink">
                      {template.name}
                    </span>
                    <span className="mt-0.5 block text-xs leading-5 text-muted">
                      {template.description}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              setDrawerMode("preview");
            }}
            className="inline-flex h-8 items-center gap-2 rounded-md border border-blue-100/90 bg-white/70 px-3 text-sm font-semibold text-blue-600 shadow-sm backdrop-blur-xl hover:bg-blue-50/82"
          >
            <PlayCircle size={15} />
            {tr("Pré-visualizar", "Preview")}
          </button>

          <button
            type="button"
            onClick={() => setDrawerMode("runs")}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line bg-surface text-body hover:bg-surface-2"
            aria-label={tr("Abrir execuções", "Open runs")}
            title={tr("Execuções", "Runs")}
          >
            <History size={15} />
          </button>

          <span
            className={`hidden h-8 items-center gap-2 rounded-md px-3 text-xs font-semibold md:inline-flex ${
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
              ? tr(`${errors.length} bloqueios`, `${errors.length} blockers`)
              : warnings.length > 0
                ? tr(`${warnings.length} avisos`, `${warnings.length} warnings`)
                : tr("Válido", "Valid")}
          </span>

          <button
            type="button"
            onClick={onSave}
            disabled={busy !== null}
            className="hidden h-8 items-center gap-2 rounded-md border border-white/80 bg-white/68 px-3 text-sm font-semibold text-ink shadow-sm backdrop-blur-xl hover:bg-white/88 disabled:opacity-50 sm:inline-flex"
          >
            {busy === "flow" ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Save size={15} />
            )}
            {tr("Guardar", "Save")}
          </button>
          <button
            type="button"
            onClick={onPublish}
            disabled={busy !== null}
            className="inline-flex h-8 items-center gap-2 rounded-md bg-blue-500 px-4 text-sm font-semibold text-white shadow-[0_16px_38px_-24px_rgba(37,99,235,0.9)] hover:bg-blue-600 disabled:opacity-50"
          >
            {busy === "publish" ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <CheckCircle2 size={15} />
            )}
            {tr("Publicar", "Publish")}
          </button>
          <button
            type="button"
            onClick={onOpenBots}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/80 bg-white/68 text-muted shadow-sm backdrop-blur-xl hover:bg-white/88"
            aria-label={tr("Abrir biblioteca de agentes", "Open agent library")}
          >
            <Bot size={15} />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 bg-[#eef3f7] p-3">
        <section className="grid h-full min-h-[680px] min-w-0 overflow-hidden rounded-lg border border-line bg-surface shadow-sm lg:grid-cols-[minmax(0,1fr)_392px]">
          <div className="relative min-h-[680px] min-w-0 overflow-hidden">
          {selectedNode && drawerMode === null && (
            <button
              type="button"
              onClick={() => setDrawerMode("edit")}
              className="absolute left-1/2 top-3 z-20 inline-flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/80 bg-white/72 px-3 py-1.5 text-xs font-semibold text-muted shadow-[0_16px_42px_-30px_rgba(15,23,42,0.7)] ring-1 ring-white/70 backdrop-blur-xl hover:text-ink lg:hidden"
            >
              {tr("Editar passo", "Edit step")}
            </button>
          )}

          {paletteOpen && (
            <div className="absolute right-20 top-16 z-30 w-[336px] overflow-hidden rounded-lg border border-white/78 bg-white/72 shadow-[0_28px_90px_-42px_rgba(15,23,42,0.72)] ring-1 ring-white/70 backdrop-blur-2xl">
              <div className="flex items-center justify-between px-2 py-1">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-faint">
                  {tr("Adicionar passo", "Add step")}
                </span>
                <button
                  type="button"
                  onClick={() => setPaletteOpen(false)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-faint hover:bg-white/72 hover:text-ink"
                  aria-label={tr("Fechar lista de passos", "Close step list")}
                >
                  <X size={14} />
                </button>
              </div>
              <div className="grid gap-0.5 p-2">
                {availableSteps.map((step) => {
                  const Icon = step.icon;
                  return (
                    <button
                      key={step.type}
                      type="button"
                      onClick={() => handleAddStep(step.type)}
                      className="flex items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-white/72"
                    >
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-emerald-100/80 bg-emerald-50/88 text-emerald-700 shadow-inner">
                        <Icon size={15} />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-ink">
                          {step.label}
                        </span>
                        <span className="mt-0.5 block text-xs leading-5 text-muted">
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
            nodeTypes={flowNodeTypes}
            edgeTypes={flowEdgeTypes}
            onNodesChange={onCanvasNodesChange}
            onNodeClick={(_event, node) => setSelectedNodeKey(node.id)}
            onNodeDragStop={handleNodeDragStop}
            onConnect={handleConnect}
            onEdgesDelete={handleEdgesDelete}
            defaultViewport={FLOW_DEFAULT_VIEWPORT}
            minZoom={0.32}
            maxZoom={1.45}
            defaultEdgeOptions={flowDefaultEdgeOptions}
            proOptions={{ hideAttribution: true }}
            className="flow-builder-canvas"
          >
            <Controls
              position="bottom-left"
              showInteractive={false}
              className="rounded-xl border border-white/80 bg-white/72 shadow-[0_18px_50px_-36px_rgba(15,23,42,0.72)] backdrop-blur-xl"
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
              maskColor="rgba(236,253,245,0.68)"
              className="hidden rounded-lg border border-white/80 bg-white/72 shadow-[0_24px_70px_-48px_rgba(15,23,42,0.68)] backdrop-blur-xl lg:block"
            />
          </ReactFlow>
          <div className="absolute right-5 top-5 z-20 flex flex-col gap-3">
            <button
              type="button"
              onClick={() => setPaletteOpen((open) => !open)}
              className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-blue-500 text-white shadow-[0_22px_48px_-22px_rgba(37,99,235,0.9)] ring-1 ring-white/60 transition-colors hover:bg-blue-600"
              aria-label={tr("Adicionar passo", "Add step")}
            >
              <Plus size={25} />
            </button>
            <button
              type="button"
              onClick={() => setDrawerMode("edit")}
              disabled={!selectedNode}
              className={`inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/80 bg-white/72 text-muted shadow-[0_16px_42px_-32px_rgba(15,23,42,0.78)] backdrop-blur-xl hover:text-ink disabled:opacity-40 ${
                drawerMode === "edit" ? "ring-2 ring-[#0a152d]/10" : ""
              }`}
              aria-label={tr("Editar passo selecionado", "Edit selected step")}
            >
              <Settings2 size={17} />
            </button>
            <button
              type="button"
              onClick={() => setDrawerMode("preview")}
              className={`inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/80 bg-white/72 text-muted shadow-[0_16px_42px_-32px_rgba(15,23,42,0.78)] backdrop-blur-xl hover:text-ink ${
                drawerMode === "preview" ? "ring-2 ring-blue-500/20" : ""
              }`}
              aria-label={tr("Abrir pré-visualização", "Open preview")}
            >
              <Smartphone size={17} />
            </button>
          </div>
          <FlowIssueDock issues={issues} />

          {drawerMode === "edit" && (
            <div className="absolute bottom-4 right-4 top-4 z-40 w-[380px] overflow-hidden rounded-lg border border-line bg-surface shadow-[0_26px_90px_-42px_rgba(15,23,42,0.9)] lg:hidden">
              <button
                type="button"
                onClick={() => setDrawerMode(null)}
                className="absolute right-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-md text-faint hover:bg-surface-2 hover:text-ink"
                aria-label={tr("Fechar editor", "Close editor")}
              >
                <X size={16} />
              </button>
              <FlowInspectorPanel
                selectedNode={selectedNode}
                nodes={nodes}
                issues={
                  selectedNode ? (issuesByNode.get(selectedNode.key) ?? []) : []
                }
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
                    nodes[selectedNodeIndex + 1] ??
                    nodes[selectedNodeIndex - 1];
                  setSelectedNodeKey(nextNode?.key ?? "");
                }}
              />
            </div>
          )}

          {drawerMode === "preview" && (
            <div className="absolute bottom-4 right-4 top-4 z-40 w-[380px] overflow-y-auto rounded-lg border border-line bg-[#eef3f8] shadow-[0_26px_90px_-42px_rgba(15,23,42,0.9)] lg:hidden">
              <button
                type="button"
                onClick={() => setDrawerMode(null)}
                className="absolute right-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-md bg-white/90 text-faint hover:bg-surface hover:text-ink"
                aria-label={tr("Fechar pré-visualização", "Close preview")}
              >
                <X size={16} />
              </button>
              <WhatsAppFlowPreview
                nodes={nodes}
                entryNodeKey={entryNodeKey}
                selectedNodeKey={selectedNodeKey}
                botName={selectedBot.name}
                triggerKind={triggerKind}
                keywords={keywords}
              />
            </div>
          )}

          {drawerMode === "runs" && (
            <div className="absolute bottom-4 right-4 top-4 z-40 w-[min(560px,calc(100%-2rem))] overflow-y-auto rounded-lg border border-line bg-surface shadow-[0_26px_90px_-42px_rgba(15,23,42,0.9)] lg:hidden">
              <button
                type="button"
                onClick={() => setDrawerMode(null)}
                className="absolute right-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-md bg-surface text-faint hover:bg-surface-2 hover:text-ink"
                aria-label={tr("Fechar execuções", "Close runs")}
              >
                <X size={16} />
              </button>
              <FlowRuntimePanel runs={runs} loading={runsLoading} />
            </div>
          )}
          </div>

          <aside className="hidden min-h-0 border-l border-white/80 bg-white/70 backdrop-blur-2xl lg:block">
            <div className="flex h-12 items-center gap-2 border-b border-line-soft bg-white/72 px-3">
              <button
                type="button"
                onClick={() => setDrawerMode("edit")}
                className={`inline-flex h-8 flex-1 items-center justify-center gap-2 rounded-lg text-xs font-semibold transition-colors ${
                  drawerMode !== "preview"
                    ? "bg-nav-active text-white"
                    : "bg-surface text-muted ring-1 ring-slate-200 hover:text-ink"
                }`}
              >
                <Settings2 size={14} />
                {tr("Configuração", "Settings")}
              </button>
              <button
                type="button"
                onClick={() => setDrawerMode("preview")}
                className={`inline-flex h-8 flex-1 items-center justify-center gap-2 rounded-lg text-xs font-semibold transition-colors ${
                  drawerMode === "preview"
                    ? "bg-nav-active text-white"
                    : "bg-surface text-muted ring-1 ring-slate-200 hover:text-ink"
                }`}
              >
                <Smartphone size={14} />
                {tr("Pré-visualização", "Preview")}
              </button>
              <button
                type="button"
                onClick={() => setDrawerMode("runs")}
                className={`inline-flex h-8 flex-1 items-center justify-center gap-2 rounded-lg text-xs font-semibold transition-colors ${
                  drawerMode === "runs"
                    ? "bg-nav-active text-white"
                    : "bg-surface text-muted ring-1 ring-slate-200 hover:text-ink"
                }`}
              >
                <History size={14} />
                {tr("Execuções", "Runs")}
              </button>
            </div>
            <div className="h-[calc(100%-48px)] min-h-0 overflow-y-auto">
              {drawerMode === "preview" ? (
                <WhatsAppFlowPreview
                  nodes={nodes}
                  entryNodeKey={entryNodeKey}
                  selectedNodeKey={selectedNodeKey}
                  botName={selectedBot.name}
                  triggerKind={triggerKind}
                  keywords={keywords}
                />
              ) : drawerMode === "runs" ? (
                <FlowRuntimePanel runs={runs} loading={runsLoading} />
              ) : (
                <FlowInspectorPanel
                  selectedNode={selectedNode}
                  nodes={nodes}
                  issues={
                    selectedNode ? (issuesByNode.get(selectedNode.key) ?? []) : []
                  }
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
                      nodes[selectedNodeIndex + 1] ??
                      nodes[selectedNodeIndex - 1];
                    setSelectedNodeKey(nextNode?.key ?? "");
                  }}
                />
              )}
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}

function WhatsAppCurveEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerStart,
  markerEnd,
  style,
  label,
  labelStyle,
  labelShowBg,
  labelBgStyle,
  labelBgPadding,
  labelBgBorderRadius,
  interactionWidth,
}: EdgeProps) {
  const direction = sourceX <= targetX ? 1 : -1;
  const distanceX = Math.max(Math.abs(targetX - sourceX), 1);
  const distanceY = targetY - sourceY;
  const control =
    distanceX < 80
      ? Math.max(4, distanceX * 0.42)
      : Math.max(72, Math.min(220, distanceX * 0.48));
  const lift = Math.max(-38, Math.min(38, distanceY * 0.12));
  const c1x = sourceX + control * direction;
  const c2x = targetX - control * direction;
  const c1y = sourceY + lift;
  const c2y = targetY - lift;
  const edgePath = `M ${sourceX},${sourceY} C ${c1x},${c1y} ${c2x},${c2y} ${targetX},${targetY}`;
  const labelX = sourceX + (targetX - sourceX) * 0.52;
  const labelY = sourceY + distanceY * 0.5 - 14;

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      markerStart={markerStart}
      markerEnd={markerEnd}
      style={{
        ...style,
        strokeLinecap: "round",
        strokeLinejoin: "round",
      }}
      label={label}
      labelX={labelX}
      labelY={labelY}
      labelStyle={labelStyle}
      labelShowBg={labelShowBg}
      labelBgStyle={labelBgStyle}
      labelBgPadding={labelBgPadding}
      labelBgBorderRadius={labelBgBorderRadius}
      interactionWidth={interactionWidth}
    />
  );
}

function FlowCanvasStepNode({ data, selected }: NodeProps<FlowCanvasNode>) {
  const { locale, tr } = useI18n();
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
      className={`relative w-[268px] overflow-hidden rounded-[18px] border bg-white/82 shadow-[0_22px_62px_-42px_rgba(15,23,42,0.86)] ring-1 ring-white/60 backdrop-blur-xl transition-[box-shadow,border-color,transform] duration-150 ${
        selected
          ? "border-[#0a152d]/70 shadow-[0_26px_78px_-40px_rgba(15,23,42,0.95)] ring-2 ring-[#0a152d]/10"
          : hasError
            ? "border-red-200/90"
            : "border-white/78"
      }`}
    >
      <span className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(255,255,255,0))]" />
      <Handle
        id="in"
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-white !bg-slate-400"
      />
      <div className="relative flex items-start gap-3 border-b border-white/70 px-3 py-2.5">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border shadow-inner ${
            isEntry
              ? "border-emerald-100/90 bg-emerald-50/92 text-emerald-700"
              : hasError
                ? "border-red-100/90 bg-red-50/92 text-red-700"
                : "border-slate-100/90 bg-white/74 text-ink"
          }`}
        >
          <Icon size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-semibold text-ink">
              {flowNode.title}
            </span>
            {isEntry && (
              <span className="rounded-full bg-emerald-100/90 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-emerald-700">
                {tr("Entrada", "Entry")}
              </span>
            )}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-muted">
            {nodeTypeLabel(flowNode.type, locale)} · {flowNode.key}
          </div>
        </div>
        {issueCount > 0 && (
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              hasError
                ? "bg-red-100 text-red-700"
                : "bg-amber-100 text-amber-700"
            }`}
          >
            {issueCount}
          </span>
        )}
      </div>
      <div className="relative px-3 py-2.5">
        {preview ? (
          <p className="line-clamp-3 text-xs leading-5 text-body">
            {preview}
          </p>
        ) : (
          <p className="text-xs text-faint">
            {tr("Ainda sem conteúdo", "No content yet")}
          </p>
        )}
        {flowNode.buttons && flowNode.buttons.length > 0 && (
          <div className="mt-3 overflow-hidden rounded-xl border border-white/70 bg-white/58 shadow-inner">
            {flowNode.buttons.slice(0, 4).map((button) => (
              <div
                key={button.replyId}
                className="flex items-center justify-between gap-2 border-b border-white/70 px-2 py-1.5 text-[11px] last:border-b-0"
              >
                <span className="min-w-0 flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                  <span className="truncate font-medium text-ink">
                    {button.label || button.replyId}
                  </span>
                </span>
                <span className="max-w-[92px] truncate text-faint">
                  {button.nextKey || tr("Sem destino", "No target")}
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
  const { locale, tr } = useI18n();
  const targetOptions = nodes
    .filter((item) => item.key !== selectedNode?.key)
    .map((item) => ({ value: item.key, label: `${item.title} · ${item.key}` }));

  return (
    <aside className="min-w-0 border-b border-line bg-surface xl:border-b-0 xl:border-r">
      <div className="h-full max-h-[780px] overflow-y-auto xl:max-h-none">
        <section className="border-b border-line-soft bg-[#fbfdff] p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-3 text-ink">
              <Settings2 size={15} />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-ink">
                {tr("Configuração do fluxo", "Flow settings")}
              </h3>
              <p className="text-xs text-muted">
                {tr("Gatilho e caminho de entrada.", "Trigger and entry path.")}
              </p>
            </div>
          </div>
          <div className="space-y-3">
            <SelectBox
              label={tr("Gatilho", "Trigger")}
              value={triggerKind}
              onChange={(value) => onTriggerKindChange(value as TriggerKind)}
              options={[
                { value: "ctwa", label: triggerLabel("ctwa", locale) },
                { value: "inbound", label: triggerLabel("inbound", locale) },
                { value: "keyword", label: triggerLabel("keyword", locale) },
                { value: "handoff", label: triggerLabel("handoff", locale) },
              ]}
              placeholder={tr("Escolha o gatilho", "Choose trigger")}
            />
            <TextInput
              label={tr("Palavras-chave", "Keywords")}
              value={keywords}
              onChange={onKeywordsChange}
              placeholder="olá, menu, ajuda"
            />
            <SelectBox
              label={tr("Passo de entrada", "Entry step")}
              value={entryNodeKey}
              onChange={onEntryNodeKeyChange}
              options={nodes.map((node) => ({
                value: node.key,
                label: `${node.title} · ${node.key}`,
              }))}
              placeholder={tr("Escolha a entrada", "Pick entry")}
            />
          </div>
        </section>

        {!selectedNode ? (
          <section className="p-8 text-center">
            <Workflow size={24} className="mx-auto text-faint" />
            <p className="mt-3 text-sm font-semibold text-ink">
              {tr("Selecione um passo", "Select a step")}
            </p>
            <p className="mt-1 text-xs leading-5 text-muted">
              {tr(
                "Clique num passo do mapa para editar conteúdo e caminhos.",
                "Click any step on the map to edit content and routing.",
              )}
            </p>
          </section>
        ) : (
          <section className="p-4">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-nav-active text-white">
                  {(() => {
                    const Icon = flowNodeIcon(selectedNode.type);
                    return <Icon size={16} />;
                  })()}
                </span>
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-ink">
                    {selectedNode.title}
                  </h3>
                  <p className="mt-0.5 truncate text-xs text-muted">
                    {nodeTypeLabel(selectedNode.type, locale)} · {selectedNode.key}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onRemove}
                disabled={selectedNode.type === "start"}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line text-faint transition-colors hover:bg-surface-2 disabled:opacity-40"
                aria-label={tr(`Remover ${selectedNode.title}`, `Remove ${selectedNode.title}`)}
              >
                <Trash2 size={14} />
              </button>
            </div>

            <div className="space-y-3">
              <TextInput
                label={tr("Chave do passo", "Step key")}
                value={selectedNode.key}
                onChange={(value) => onUpdate({ key: value })}
                placeholder="ask_time"
              />
              <TextInput
                label={tr("Título", "Title")}
                value={selectedNode.title}
                onChange={(value) => onUpdate({ title: value })}
                placeholder="Perguntar horário"
              />
              <SelectBox
                label={tr("Tipo", "Type")}
                value={selectedNode.type}
                onChange={(value) =>
                  onUpdate({
                    type: value as FlowNodeType,
                    ...defaultNodePatch(value as FlowNodeType),
                  })
                }
                options={[
                  { value: "start", label: nodeTypeLabel("start", locale) },
                  ...FLOW_NODE_TYPES.map((type) => ({
                    value: type,
                    label: nodeTypeLabel(type, locale),
                  })),
                ]}
                placeholder={tr("Escolha o tipo", "Choose type")}
              />
              {needsNextNode(selectedNode.type) && (
                <SelectBox
                  label={tr("Próximo passo", "Next step")}
                  value={selectedNode.nextKey ?? ""}
                  onChange={(value) =>
                    onUpdate({ nextKey: value || undefined })
                  }
                  options={targetOptions}
                  placeholder={tr("Terminar aqui", "Stop here")}
                />
              )}
            </div>

            {needsBody(selectedNode.type) && (
              <label className="mt-3 block">
                <span className="mb-1 block text-[11px] font-medium text-muted">
                  {tr("Mensagem / instrução", "Message / prompt")}
                </span>
                <textarea
                  value={selectedNode.body ?? ""}
                  onChange={(event) => onUpdate({ body: event.target.value })}
                  rows={
                    selectedNode.type === "send_buttons" ||
                    selectedNode.type === "send_list"
                      ? 3
                      : 4
                  }
                  className="w-full resize-none rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-faint hover:bg-surface focus:border-brand-solid/40 focus:bg-surface"
                  placeholder="Mensagem enviada ao cliente..."
                />
              </label>
            )}

            {selectedNode.type === "collect_input" && (
              <div className="mt-3">
                <TextInput
                  label={tr("Variável da resposta", "Reply variable")}
                  value={selectedNode.variableKey ?? ""}
                  onChange={(value) => onUpdate({ variableKey: value })}
                  placeholder="preferred_time"
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

            {selectedNode.type === "send_template" && (
              <SendTemplateConfig node={selectedNode} onUpdate={onUpdate} />
            )}

            {(selectedNode.type === "send_buttons" ||
              selectedNode.type === "send_list") && (
              <ChoiceRowsEditor
                node={selectedNode}
                targetOptions={targetOptions}
                onUpdate={onUpdate}
              />
            )}

            {selectedNode.type === "condition" && (
              <div className="mt-4 grid gap-3 rounded-lg border border-line bg-[#fbfdff] p-3">
                <TextInput
                  label={tr("Variável", "Variable")}
                  value={selectedNode.condition?.variableKey ?? ""}
                  onChange={(value) =>
                    onUpdate({
                      condition: {
                        ...defaultCondition(selectedNode.condition),
                        variableKey: value,
                      },
                    })
                  }
                  placeholder="preferred_time"
                />
                <SelectBox
                  label={tr("Operador", "Operator")}
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
                    { value: "present", label: tr("Existe", "Present") },
                    { value: "absent", label: tr("Não existe", "Absent") },
                    { value: "equals", label: tr("É igual a", "Equals") },
                    { value: "contains", label: tr("Contém", "Contains") },
                    { value: "starts_with", label: tr("Começa por", "Starts with") },
                    { value: "ends_with", label: tr("Termina em", "Ends with") },
                  ]}
                  placeholder={tr("Operador", "Operator")}
                />
                <TextInput
                  label={tr("Valor", "Value")}
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
                  label={tr("Se verdadeiro", "If true")}
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
                  placeholder={tr("Escolha", "Choose")}
                />
                <SelectBox
                  label={tr("Se falso", "If false")}
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
                  placeholder={tr("Escolha", "Choose")}
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

function ChoiceRowsEditor({
  node,
  targetOptions,
  onUpdate,
}: {
  node: FlowNode;
  targetOptions: Array<{ value: string; label: string }>;
  onUpdate: (patch: Partial<FlowNode>) => void;
}) {
  const { tr } = useI18n();
  const choices = node.buttons ?? [];
  const limit = node.type === "send_buttons" ? 3 : 10;

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-line bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-line-soft bg-[#fbfdff] px-3 py-2.5">
        <div>
          <div className="text-xs font-semibold text-ink">
            {node.type === "send_buttons"
              ? tr("Respostas rápidas", "Quick replies")
              : tr("Opções da lista", "List rows")}
          </div>
          <div className="mt-0.5 text-[11px] text-muted">
            {tr(
              "Cada opção pode seguir para um passo diferente.",
              "Each choice can branch to a different step.",
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() =>
            onUpdate({
              buttons: [
                ...choices,
                {
                  replyId: `choice_${choices.length + 1}`,
                  label: node.type === "send_buttons"
                    ? tr("Opção", "Option")
                    : tr("Linha", "Row"),
                  nextKey: targetOptions[0]?.value ?? "",
                },
              ],
            })
          }
          disabled={choices.length >= limit}
          className="inline-flex h-8 items-center gap-1 rounded-lg bg-nav-active px-2.5 text-xs font-semibold text-white transition-colors hover:bg-brand-solid disabled:opacity-50"
        >
          <Plus size={12} />
          {tr("Adicionar", "Add")}
        </button>
      </div>

      <div className="border-b border-line-soft px-3 py-3">
        <TextInput
          label={tr("Guardar resposta como", "Save reply as")}
          value={node.variableKey ?? ""}
          onChange={(value) => onUpdate({ variableKey: value || undefined })}
          placeholder="service_interest"
        />
      </div>

      <div className="divide-y divide-line-soft">
        {choices.length === 0 ? (
          <div className="px-3 py-5 text-center text-xs text-faint">
            {tr(
              "Adicione uma opção para criar um novo caminho.",
              "Add a reply to create a new path.",
            )}
          </div>
        ) : (
          choices.map((button, buttonIndex) => (
            <div key={`${button.replyId}-${buttonIndex}`} className="px-3 py-3">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-[11px] font-bold text-emerald-700">
                  {buttonIndex + 1}
                </span>
                <input
                  value={button.label}
                  onChange={(event) =>
                    onUpdate({
                      buttons: replaceButton(choices, buttonIndex, {
                        ...button,
                        label: event.target.value,
                      }),
                    })
                  }
                  className="min-w-0 flex-1 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm font-medium text-ink outline-none transition-colors placeholder:text-faint hover:bg-surface focus:border-brand-solid/40 focus:bg-surface"
                  placeholder={tr("Texto do botão", "Button text")}
                />
                <button
                  type="button"
                  onClick={() =>
                    onUpdate({
                      buttons: choices.filter(
                        (_, itemIndex) => itemIndex !== buttonIndex,
                      ),
                    })
                  }
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-faint transition-colors hover:bg-red-50 hover:text-red-600"
                  aria-label={tr("Remover resposta rápida", "Remove quick reply")}
                >
                  <Trash2 size={13} />
                </button>
              </div>

              <div className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(116px,0.8fr)] gap-2">
                <input
                  value={button.replyId}
                  onChange={(event) =>
                    onUpdate({
                      buttons: replaceButton(choices, buttonIndex, {
                        ...button,
                        replyId: event.target.value,
                      }),
                    })
                  }
                  className="min-w-0 rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-body outline-none transition-colors placeholder:text-faint hover:bg-surface focus:border-brand-solid/40 focus:bg-surface"
                  placeholder="reply_id"
                />
                <select
                  value={button.nextKey}
                  onChange={(event) =>
                    onUpdate({
                      buttons: replaceButton(choices, buttonIndex, {
                        ...button,
                        nextKey: event.target.value,
                      }),
                    })
                  }
                  className="min-w-0 rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs font-medium text-ink outline-none transition-colors hover:bg-surface focus:border-brand-solid/40 focus:bg-surface"
                >
                  <option value="">{tr("Sem destino", "No target")}</option>
                  {targetOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function WhatsAppFlowPreview({
  nodes,
  entryNodeKey,
  selectedNodeKey,
  botName,
  triggerKind,
  keywords,
}: {
  nodes: FlowNode[];
  entryNodeKey: string;
  selectedNodeKey: string;
  botName: string;
  triggerKind: TriggerKind;
  keywords: string;
}) {
  const { tr } = useI18n();
  const previewNodes = useMemo(
    () => walkFlowPath(nodes, selectedNodeKey || entryNodeKey, 7),
    [entryNodeKey, nodes, selectedNodeKey],
  );
  const keyword = keywords
    .split(",")
    .map((item) => item.trim())
    .find(Boolean);
  const startCopy =
    triggerKind === "keyword"
      ? `#${keyword ?? "menu"}`
      : triggerKind === "ctwa"
        ? tr("Tenho interesse", "I'm interested")
        : "Olá";

  return (
    <aside className="min-w-0 bg-[#eef3f8] p-3 2xl:p-4">
      <div className="mx-auto max-w-[300px] 2xl:max-w-[332px]">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
              <Smartphone size={15} />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-ink">
                {tr("Pré-visualização WhatsApp", "WhatsApp preview")}
              </h3>
              <p className="text-xs text-muted">
                {tr("A testar o caminho selecionado", "Testing selected path")}
              </p>
            </div>
          </div>
          <span className="rounded-full bg-surface px-2 py-1 text-[10px] font-semibold text-muted ring-1 ring-slate-200">
            Local
          </span>
        </div>

        <div className="overflow-hidden rounded-lg border border-line bg-[#111827] shadow-[0_28px_90px_-48px_rgba(15,23,42,0.9)]">
          <div className="flex items-center gap-3 border-b border-white/10 bg-[#1f2937] px-3 py-2.5 text-white 2xl:px-4 2xl:py-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold 2xl:h-9 2xl:w-9">
              {botName.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{botName}</p>
              <p className="text-xs text-emerald-200">OpenBSP</p>
            </div>
          </div>

          <div
            className="min-h-[500px] space-y-3 px-3 py-4 2xl:min-h-[540px]"
            style={{
              backgroundColor: "#10231f",
              backgroundImage:
                "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.08) 1px, transparent 0)",
              backgroundSize: "18px 18px",
            }}
          >
            <div className="ml-auto max-w-[78%] rounded-lg bg-[#0b7a5f] px-3 py-2 text-sm leading-5 text-white">
              {startCopy}
              <div className="mt-1 text-right text-[10px] text-white/70">
                9:42
              </div>
            </div>

            {previewNodes.length === 0 ? (
              <div className="rounded-lg bg-white/90 px-3 py-2 text-sm text-body">
                {tr(
                  "Adicione e selecione um passo para pré-visualizar a conversa.",
                  "Add and select a step to preview the conversation.",
                )}
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
  const { tr } = useI18n();
  if (node.type === "start") {
    return (
      <div className="mx-auto w-fit rounded-full bg-black/20 px-3 py-1 text-[11px] font-medium text-emerald-100">
        {tr("Início", "Start")}
      </div>
    );
  }
  if (node.type === "condition") {
    return (
      <div className="rounded-lg border border-violet-200/40 bg-violet-50/95 px-3 py-2 text-xs leading-5 text-violet-900">
        {tr("Condição", "Condition")}: {node.condition?.variableKey || tr("variável", "variable")}{" "}
        {node.condition?.operator ?? "present"}
      </div>
    );
  }
  if (node.type === "set_tag") {
    return (
      <div className="rounded-lg border border-amber-200/40 bg-amber-50/95 px-3 py-2 text-xs leading-5 text-amber-900">
        {tr("Etiqueta aplicada", "Tag set")}: {node.tag || "untitled_tag"}
      </div>
    );
  }
  if (node.type === "send_template") {
    return node.template ? (
      <div className="rounded-lg bg-white/95 px-3 py-2 text-sm leading-5 text-ink">
        <span className="text-xs font-medium text-[#0b7a5f]">
          {tr("Template aprovado", "Approved template")}
        </span>
        <p className="text-xs text-muted">
          {tr("Pode ser enviado fora da janela de 24h.", "Works outside the 24h window.")}
        </p>
      </div>
    ) : (
      <div className="rounded-lg border border-amber-200/40 bg-amber-50/95 px-3 py-2 text-xs leading-5 text-amber-900">
        {tr("Nenhum template selecionado", "No template selected")}
      </div>
    );
  }
  if (node.type === "handoff") {
    return (
      <div className="rounded-lg bg-white/95 px-3 py-2 text-sm leading-5 text-ink">
        {node.body || tr("A equipa continuará a partir daqui.", "The team will continue from here.")}
      </div>
    );
  }
  if (node.type === "end") {
    return (
      <div className="mx-auto w-fit rounded-full bg-black/20 px-3 py-1 text-[11px] font-medium text-emerald-100">
        {tr("Fim", "End")}
      </div>
    );
  }

  return (
    <div className="max-w-[88%] rounded-lg bg-white/95 px-3 py-2 text-sm leading-5 text-ink">
      <p>{node.body || tr("Texto da mensagem...", "Message text...")}</p>
      {(node.type === "send_buttons" || node.type === "send_list") &&
        (node.buttons ?? []).length > 0 && (
          <div className="mt-3 space-y-1.5 border-t border-line pt-2">
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
        <div className="mt-3 rounded-md bg-surface-3 px-2 py-1.5 text-xs font-medium text-muted">
          {tr("Guarda a resposta como", "Saves reply as")} {node.variableKey || "answer"}
        </div>
      )}
      <div className="mt-1 text-right text-[10px] text-faint">9:42</div>
    </div>
  );
}

function FlowIssueDock({ issues }: { issues: FlowIssue[] }) {
  const { locale, tr } = useI18n();
  if (issues.length === 0) return null;
  const first = issues[0];
  const isError = first.severity === "error";

  return (
    <div className="pointer-events-none absolute bottom-4 left-16 z-20 max-w-[520px] rounded-lg border border-line bg-white/95 px-3 py-2 shadow-[0_20px_70px_-42px_rgba(15,23,42,0.9)] backdrop-blur">
      <div className="flex items-center gap-2">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
            isError ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-600"
          }`}
        >
          <AlertTriangle size={14} />
        </span>
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-ink">
            {isError
              ? tr("Publicação bloqueada", "Activation blocked")
              : tr("Aviso do fluxo", "Flow warning")}
          </div>
          <div className="truncate text-[11px] text-muted">
            {first.nodeKey ? `${first.nodeKey}: ` : ""}
            {localizeFlowIssue(first.message, locale)}
            {issues.length > 1 ? ` (+${issues.length - 1})` : ""}
          </div>
        </div>
      </div>
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
  const { locale, tr } = useI18n();
  const clean = errors.length === 0;
  return (
    <section
      className={`rounded-lg border p-4 ${
        clean ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"
      }`}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
              clean
                ? "bg-emerald-100 text-emerald-700"
                : "bg-red-100 text-red-700"
            }`}
          >
            {clean ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}
          </span>
          <div>
            <h3 className="font-semibold text-ink">
              {clean
                ? tr("Pronto para ativar", "Ready to activate")
                : tr("Publicação bloqueada", "Activation blocked")}
            </h3>
            <p className="mt-1 text-sm leading-6 text-body">
              {clean
                ? warnings.length > 0
                  ? tr(
                      `${warnings.length} aviso(s), sem bloqueios.`,
                      `${warnings.length} warning(s), no blockers.`,
                    )
                  : tr("Nenhum problema detetado.", "No validation issues detected.")
                : tr(
                    `${errors.length} bloqueio(s), ${warnings.length} aviso(s).`,
                    `${errors.length} blocker(s), ${warnings.length} warning(s).`,
                  )}
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
                    ? "border-red-100 bg-surface text-red-800"
                    : "border-amber-100 bg-surface text-amber-800"
                }`}
              >
                <span className="font-semibold uppercase">
                  {issue.nodeKey ?? issue.scope}
                </span>
                <span className="mx-1 opacity-50">·</span>
                {localizeFlowIssue(issue.message, locale)}
              </div>
            ))}
            {issues.length > 3 && (
              <p className="text-xs font-medium text-muted">
                +{issues.length - 3} {tr("problemas adicionais", "more issues")}
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
  const { locale, tr } = useI18n();
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
    <aside className="border-b border-line-soft bg-slate-50/70 lg:border-b-0 lg:border-r">
      <div className="border-b border-line-soft bg-surface px-4 py-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="font-[var(--font-outfit)] text-base font-semibold text-ink">
              {tr("Mapa do fluxo", "Flow map")}
            </h3>
            <p className="text-xs text-muted">{tr("Selecione um bloco para editar.", "Pick a block to edit.")}</p>
          </div>
          <span className="rounded-full bg-surface-3 px-2 py-1 text-[11px] font-semibold text-muted">
            {nodes.length}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
          <select
            value={newNodeType}
            onChange={(event) =>
              setNewNodeType(event.target.value as FlowNodeType)
            }
            className="h-10 min-w-0 rounded-lg border border-line bg-surface px-2 text-xs font-medium text-ink outline-none focus:border-brand-solid/40"
          >
            {FLOW_NODE_TYPES.map((type) => (
              <option key={type} value={type}>
                {nodeTypeLabel(type, locale)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => onAddNode(newNodeType)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-nav-active text-white hover:bg-brand-solid"
            aria-label={tr("Adicionar bloco", "Add node")}
          >
            <Plus size={15} />
          </button>
        </div>
      </div>

      <div className="max-h-[720px] space-y-2 overflow-y-auto p-3">
        {nodes.map((node, index) => {
          const active = node.key === selectedNodeKey;
          const nodeIssues = issuesByNode.get(node.key) ?? [];
          const hasError = nodeIssues.some(
            (issue) => issue.severity === "error",
          );
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
                  ? "border-[#0a152d] bg-surface shadow-sm"
                  : "border-transparent bg-white/70 hover:border-line hover:bg-surface"
              }`}
            >
              <div className="flex items-center gap-3">
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                    active
                      ? "bg-nav-active text-white"
                      : "bg-surface-3 text-muted group-hover:text-ink"
                  }`}
                >
                  <NodeIcon size={15} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold text-ink">
                      {node.title}
                    </span>
                    {node.key === entryNodeKey && (
                      <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-emerald-700">
                        {tr("Entrada", "Entry")}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-muted">
                    {nodeTypeLabel(node.type, locale)} · {node.key}
                  </span>
                </span>
                {hasError ? (
                  <AlertTriangle size={15} className="shrink-0 text-red-500" />
                ) : (
                  <ArrowRight size={14} className="shrink-0 text-faint" />
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
  const { locale, tr } = useI18n();
  const NodeIcon =
    node.type === "send_list"
      ? ListTree
      : node.type === "set_tag"
        ? Tag
        : GitBranch;
  const targetOptions = nodes
    .filter((item) => item.key !== node.key)
    .map((item) => ({ value: item.key, label: `${item.title} · ${item.key}` }));

  return (
    <article className="p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-3 text-ink">
            <NodeIcon size={17} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="font-semibold text-ink">{node.title}</h4>
              <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-semibold text-body">
                {nodeTypeLabel(node.type, locale)}
              </span>
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-mono text-muted">
                {node.key}
              </span>
            </div>
            {node.body && (
              <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted">
                {node.body}
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onRemove}
          disabled={node.type === "start" && index === 0}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line text-faint hover:bg-surface-2 disabled:opacity-40"
          aria-label={`${tr("Remover", "Remove")} ${node.title}`}
        >
          <Trash2 size={15} />
        </button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <TextInput
          label={tr("Chave do bloco", "Node key")}
          value={node.key}
          onChange={(value) => onUpdate({ key: value })}
          placeholder="ask_time"
        />
        <TextInput
          label={tr("Título", "Title")}
          value={node.title}
          onChange={(value) => onUpdate({ title: value })}
          placeholder="Perguntar horário"
        />
        <SelectBox
          label={tr("Tipo", "Type")}
          value={node.type}
          onChange={(value) =>
            onUpdate({
              type: value as FlowNodeType,
              ...defaultNodePatch(value as FlowNodeType),
            })
          }
          options={[
            { value: "start", label: nodeTypeLabel("start", locale) },
            ...FLOW_NODE_TYPES.map((type) => ({
              value: type,
              label: nodeTypeLabel(type, locale),
            })),
          ]}
          placeholder={tr("Escolha o tipo", "Choose type")}
        />
        {needsNextNode(node.type) && (
          <SelectBox
            label={tr("Próximo bloco", "Next node")}
            value={node.nextKey ?? ""}
            onChange={(value) => onUpdate({ nextKey: value || undefined })}
            options={targetOptions}
            placeholder={tr("Terminar aqui", "Stop here")}
          />
        )}
      </div>

      {needsBody(node.type) && (
        <label className="mt-3 block">
          <span className="mb-1 block text-[11px] font-medium text-muted">
            {tr("Mensagem ou instrução", "Message or prompt")}
          </span>
          <textarea
            value={node.body ?? ""}
            onChange={(event) => onUpdate({ body: event.target.value })}
            rows={3}
            className="w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-faint focus:border-brand-solid/40"
            placeholder="Mensagem enviada ao cliente..."
          />
        </label>
      )}

      {node.type === "collect_input" && (
        <div className="mt-3">
          <TextInput
            label={tr("Chave da variável", "Variable key")}
            value={node.variableKey ?? ""}
            onChange={(value) => onUpdate({ variableKey: value })}
            placeholder="preferred_time"
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
        <div className="mt-4 rounded-xl border border-line-soft bg-surface-2 p-3">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-semibold text-muted">
              {node.type === "send_buttons" ? tr("Botões", "Buttons") : tr("Opções da lista", "List rows")}
            </span>
            <button
              type="button"
              onClick={() =>
                onUpdate({
                  buttons: [
                    ...(node.buttons ?? []),
                    {
                      replyId: `choice_${(node.buttons ?? []).length + 1}`,
                      label: node.type === "send_buttons" ? tr("Opção", "Option") : tr("Linha", "Row"),
                      nextKey: targetOptions[0]?.value ?? "",
                    },
                  ],
                })
              }
              disabled={
                (node.buttons ?? []).length >=
                (node.type === "send_buttons" ? 3 : 10)
              }
              className="inline-flex h-8 items-center gap-1 rounded-lg bg-surface px-2 text-xs font-semibold text-ink ring-1 ring-slate-200 disabled:opacity-50"
            >
              <Plus size={12} />
              {tr("Adicionar", "Add")}
            </button>
          </div>
          <div className="mb-3">
            <TextInput
              label={tr("Guardar resposta como", "Save reply as")}
              value={node.variableKey ?? ""}
              onChange={(value) =>
                onUpdate({ variableKey: value || undefined })
              }
              placeholder="service_interest"
            />
          </div>
          <div className="space-y-2">
            {(node.buttons ?? []).map((button, buttonIndex) => (
              <div
                key={`${button.replyId}-${buttonIndex}`}
                className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto]"
              >
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
                  className="rounded-lg border border-line bg-surface px-3 py-2 text-xs outline-none"
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
                  className="rounded-lg border border-line bg-surface px-3 py-2 text-xs outline-none"
                  placeholder={tr("Rótulo", "Label")}
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
                  className="rounded-lg border border-line bg-surface px-3 py-2 text-xs outline-none"
                >
                  <option value="">{tr("Próximo", "Next")}</option>
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
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-surface text-faint"
                  aria-label={tr("Remover botão", "Remove button")}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {node.type === "condition" && (
        <div className="mt-4 grid gap-3 rounded-lg border border-line-soft bg-surface-2 p-3 md:grid-cols-2">
          <TextInput
            label={tr("Variável", "Variable")}
            value={node.condition?.variableKey ?? ""}
            onChange={(value) =>
              onUpdate({
                condition: {
                  ...defaultCondition(node.condition),
                  variableKey: value,
                },
              })
            }
            placeholder="preferred_time"
          />
          <SelectBox
            label={tr("Operador", "Operator")}
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
              { value: "present", label: tr("Existe", "Present") },
              { value: "absent", label: tr("Não existe", "Absent") },
              { value: "equals", label: tr("É igual", "Equals") },
              { value: "contains", label: tr("Contém", "Contains") },
              { value: "starts_with", label: tr("Começa por", "Starts with") },
              { value: "ends_with", label: tr("Termina em", "Ends with") },
            ]}
            placeholder={tr("Operador", "Operator")}
          />
          <TextInput
            label={tr("Valor", "Value")}
            value={node.condition?.value ?? ""}
            onChange={(value) =>
              onUpdate({
                condition: { ...defaultCondition(node.condition), value },
              })
            }
            placeholder="premium"
          />
          <SelectBox
            label={tr("Se verdadeiro", "True next")}
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
            placeholder={tr("Escolha", "Choose")}
          />
          <SelectBox
            label={tr("Se falso", "False next")}
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
            placeholder={tr("Escolha", "Choose")}
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

function runStatusClass(status: string) {
  if (status === "active") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "completed") return "border-sky-200 bg-sky-50 text-sky-700";
  if (status === "handed_off") return "border-amber-200 bg-amber-50 text-amber-700";
  if (status === "failed" || status === "timed_out") {
    return "border-red-200 bg-red-50 text-red-700";
  }
  return "border-line bg-surface-3 text-ink";
}

function eventStatusClass(eventType: string) {
  if (eventType === "error" || eventType === "timeout") return "bg-red-100 text-red-700";
  if (eventType === "handoff") return "bg-amber-100 text-amber-700";
  if (eventType === "message_skipped" || eventType === "fallback_fired") {
    return "bg-orange-100 text-orange-700";
  }
  if (eventType === "completed") return "bg-sky-100 text-sky-700";
  if (eventType === "message_sent") return "bg-emerald-100 text-emerald-700";
  return "bg-surface-3 text-body";
}

function runtimeEventLabel(eventType: string, locale: Locale) {
  const labels: Record<string, [string, string]> = {
    started: ["Iniciada", "Started"],
    node_entered: ["Passo iniciado", "Step entered"],
    message_sent: ["Mensagem em fila", "Message queued"],
    message_skipped: ["Mensagem ignorada", "Message skipped"],
    reply_received: ["Resposta recebida", "Reply received"],
    fallback_fired: ["Fallback acionado", "Fallback fired"],
    tag_set: ["Etiqueta aplicada", "Tag applied"],
    handoff: ["Passou à equipa", "Handoff"],
    completed: ["Concluída", "Completed"],
    timeout: ["Tempo esgotado", "Timed out"],
    stopped: ["Parada", "Stopped"],
    error: ["Erro", "Error"],
  };
  return labels[eventType]
    ? pick(locale, ...labels[eventType])
    : eventType.replaceAll("_", " ");
}

function runStatusLabel(status: string, locale: Locale) {
  const labels: Record<string, [string, string]> = {
    active: ["Ativa", "Active"],
    completed: ["Concluída", "Completed"],
    handed_off: ["Com a equipa", "Handed off"],
    failed: ["Falhou", "Failed"],
    timed_out: ["Tempo esgotado", "Timed out"],
    stopped: ["Parada", "Stopped"],
  };
  return labels[status]
    ? pick(locale, ...labels[status])
    : status.replaceAll("_", " ");
}

function formatDuration(startedAt: number, endedAt?: number, lastAdvancedAt?: number) {
  const end = endedAt ?? lastAdvancedAt ?? startedAt;
  const seconds = Math.max(0, Math.round((end - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function compactRuntimePayload(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  return Object.entries(payload as Record<string, unknown>)
    .slice(0, 5)
    .map(([key, value]) => {
      const serialized =
        value && typeof value === "object" ? JSON.stringify(value) : String(value);
      return {
        key,
        value: serialized.length > 72 ? `${serialized.slice(0, 69)}...` : serialized,
      };
    });
}

function FlowRuntimePanel({ runs, loading }: { runs: FlowRunRow[]; loading: boolean }) {
  const { locale, tr } = useI18n();
  const activeRuns = runs.filter((run) => run.status === "active").length;
  const completedRuns = runs.filter((run) => run.status === "completed").length;
  const attentionRuns = runs.filter((run) =>
    ["failed", "timed_out", "handed_off"].includes(run.status),
  ).length;

  return (
    <section className="bg-surface p-4">
      <PanelTitle
        icon={History}
        title={tr("Histórico de execuções", "Runtime history")}
        body={tr(
          "Execuções, respostas, etiquetas, handoffs e timeouts reais.",
          "Real runs, replies, tags, handoffs, and timeouts.",
        )}
      />

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {[
          { label: tr("Ativas", "Active"), value: activeRuns, tone: "text-emerald-700" },
          { label: tr("Concluídas", "Completed"), value: completedRuns, tone: "text-sky-700" },
          { label: tr("Requer atenção", "Needs review"), value: attentionRuns, tone: "text-amber-700" },
        ].map((item) => (
          <div key={item.label} className="rounded-xl border border-line-soft bg-surface-2 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase text-faint">
              {item.label}
            </p>
            <p className={`mt-1 text-lg font-semibold ${item.tone}`}>{item.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 space-y-3">
        {loading ? (
          <div className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-3 text-sm text-muted">
            <Loader2 size={14} className="animate-spin" />
            {tr("A carregar execuções", "Loading runs")}
          </div>
        ) : runs.length === 0 ? (
          <p className="rounded-xl bg-surface-2 px-3 py-3 text-sm text-muted">
            {tr(
              "Ainda não há execuções. Envie uma mensagem WhatsApp que corresponda ao gatilho.",
              "No runs yet. Send a matching WhatsApp message to start this flow.",
            )}
          </p>
        ) : (
          runs.map((run) => (
            <div
              key={run._id}
              className="rounded-lg border border-line bg-surface p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate text-sm font-semibold text-ink">
                      {run.contactName ?? run.contactHandle ?? tr("Contacto desconhecido", "Unknown contact")}
                    </p>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${runStatusClass(
                        run.status,
                      )}`}
                    >
                      {runStatusLabel(run.status, locale)}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted">
                    {run.contactHandle ?? tr("Sem identificador", "No handle")} · {tr("Iniciada", "Started")} {relativeTime(run.startedAt, Date.now(), locale)}
                  </p>
                </div>
                <div className="rounded-xl bg-surface-2 px-3 py-2 text-right">
                  <p className="text-[11px] font-semibold text-muted">{tr("Duração", "Duration")}</p>
                  <p className="text-sm font-semibold text-ink">
                    {formatDuration(run.startedAt, run.endedAt, run.lastAdvancedAt)}
                  </p>
                </div>
              </div>

              <div className="mt-3 grid gap-2 text-xs sm:grid-cols-4">
                <div className="rounded-xl bg-surface-2 px-3 py-2">
                  <p className="font-semibold text-muted">{tr("Atual", "Current")}</p>
                  <p className="mt-1 truncate text-ink">
                    {run.currentNodeKey ?? run.endReason ?? tr("Terminada", "Finished")}
                  </p>
                </div>
                <div className="rounded-xl bg-surface-2 px-3 py-2">
                  <p className="font-semibold text-muted">{tr("Eventos", "Events")}</p>
                  <p className="mt-1 text-ink">
                    {run.eventCount}
                    {run.eventCount > run.events.length
                      ? tr(` no total · ${run.events.length} visíveis`, ` total · ${run.events.length} shown`)
                      : ""}
                  </p>
                </div>
                <div className="rounded-xl bg-surface-2 px-3 py-2">
                  <p className="font-semibold text-muted">{tr("Novas tentativas", "Reprompts")}</p>
                  <p className="mt-1 text-ink">{run.repromptCount}</p>
                </div>
                <div className="rounded-xl bg-surface-2 px-3 py-2">
                  <p className="font-semibold text-muted">{tr("Variáveis", "Variables")}</p>
                  <p className="mt-1 text-ink">{Object.keys(run.vars ?? {}).length}</p>
                </div>
              </div>

              {Object.keys(run.vars ?? {}).length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {Object.keys(run.vars ?? {}).map((key) => (
                    <span
                      key={key}
                      className="rounded-full border border-line bg-surface-2 px-2 py-1 text-[11px] font-medium text-body"
                    >
                      {key}: {tr("recolhida", "captured")}
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-4 space-y-2">
                {run.events.map((event) => (
                  <div key={event._id} className="rounded-xl border border-line-soft bg-surface-2 px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${eventStatusClass(
                              event.eventType,
                            )}`}
                          >
                            {runtimeEventLabel(event.eventType, locale)}
                          </span>
                          {event.nodeKey && (
                            <span className="truncate text-xs font-medium text-body">
                              {event.nodeKey}
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="shrink-0 text-xs text-faint">
                        {relativeTime(event.createdAt, Date.now(), locale)}
                      </span>
                    </div>
                    {compactRuntimePayload(event.payload).length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {compactRuntimePayload(event.payload).map((item) => (
                          <span
                            key={`${event._id}-${item.key}`}
                            className="rounded-md bg-surface px-2 py-1 text-[11px] text-muted"
                          >
                            {item.key}: {item.value}
                          </span>
                        ))}
                      </div>
                    )}
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
    <div className="rounded-lg border border-line bg-surface p-5">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-3 text-ink">
        <Icon size={18} />
      </span>
      <div className="mt-4 text-3xl font-semibold tracking-tight text-ink">
        {value}
      </div>
      <div className="mt-1 text-sm font-medium text-body">{label}</div>
      <p className="mt-1 text-xs text-muted">{note}</p>
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
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-ink">
        <Icon size={16} />
      </span>
      <div>
        <h2 className="font-[var(--font-outfit)] text-lg font-semibold text-ink">
          {title}
        </h2>
        <p className="mt-0.5 text-sm leading-6 text-muted">{body}</p>
      </div>
    </div>
  );
}

function SendTemplateConfig({
  node,
  onUpdate,
}: {
  node: FlowNode;
  onUpdate: (patch: Partial<FlowNode>) => void;
}) {
  const { tr } = useI18n();
  const templates = useQuery(api.templates.list) as
    | Array<{
        _id: Id<"templates">;
        name: string;
        language: string;
        status: string;
        parameterSchema: Array<{ index: number; name: string; example: string }>;
      }>
    | undefined;
  const approved = (templates ?? []).filter((t) => t.status === "approved");
  const selected = approved.find((t) => t._id === node.template?.templateId);

  if (templates && approved.length === 0) {
    return (
      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-800">
        {tr(
          "Ainda não há templates aprovados. Crie e submeta um em",
          "No approved templates yet. Create and submit one in",
        )}{" "}
        <Link href="/app/templates" className="font-medium underline">
          Templates
        </Link>{" "}
        {tr(
          "primeiro; templates permitem enviar fora da janela de 24h.",
          "first; templates allow sends outside the 24h window.",
        )}
      </div>
    );
  }

  return (
    <div className="mt-4 grid gap-3 rounded-lg border border-line bg-[#fbfdff] p-3">
      <SelectBox
        label={tr("Template aprovado", "Approved template")}
        value={node.template?.templateId ?? ""}
        onChange={(value) =>
          onUpdate({
            template: value
              ? { templateId: value as Id<"templates">, variables: {} }
              : undefined,
          })
        }
        options={approved.map((t) => ({
          value: t._id,
          label: `${t.name} (${t.language})`,
        }))}
        placeholder={tr("Escolha o template", "Choose template")}
      />
      {selected &&
        selected.parameterSchema.map((param) => (
          <TextInput
            key={param.index}
            label={`{{${param.index}}} ${param.name}`}
            value={node.template?.variables?.[String(param.index)] ?? ""}
            onChange={(value) =>
              onUpdate({
                template: {
                  templateId: selected._id,
                  variables: {
                    ...(node.template?.variables ?? {}),
                    [String(param.index)]: value,
                  },
                },
              })
            }
            placeholder={param.example || `e.g. {{vars.name}}`}
          />
        ))}
      {selected && (
        <p className="text-[11px] text-faint">
          {tr("Os valores aceitam", "Values support")} {"{{vars.x}}"} {tr("e", "and")} {"{{contact.name}}"}.
        </p>
      )}
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
      <span className="mb-1 block text-[11px] font-medium text-muted">
        {label}
      </span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-faint hover:bg-surface focus:border-brand-solid/40 focus:bg-surface"
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
      <span className="mb-1 block text-[11px] font-medium text-muted">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none transition-colors hover:bg-surface focus:border-brand-solid/40 focus:bg-surface"
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
      className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-nav-active px-4 py-2 text-sm font-medium text-white transition-all hover:bg-brand-solid disabled:opacity-50"
    >
      {loading ? (
        <Loader2 size={14} className="animate-spin" />
      ) : (
        <Icon size={14} />
      )}
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
    <div className="rounded-xl border border-line-soft bg-surface-2 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">
        <Icon size={12} />
        {label}
      </div>
      <div className="mt-1 truncate text-xs font-semibold text-ink">
        {value}
      </div>
    </div>
  );
}

function readError(err: unknown, locale: Locale = "pt"): string {
  return convexErrorMessage(err, locale, locale === "pt" ? "Algo correu mal." : "Something went wrong.");
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

function defaultNode(
  key: string,
  type: FlowNodeType,
  locale: Locale = "en",
): FlowNode {
  return {
    key,
    type,
    title: nodeTypeLabel(type, locale),
    ...defaultNodePatch(type),
  };
}

function defaultNodePatch(type: FlowNodeType): Partial<FlowNode> {
  if (type === "send_message") {
    return { body: "", nextKey: undefined, buttons: undefined };
  }
  if (type === "send_template") {
    return {
      template: undefined,
      nextKey: undefined,
      body: undefined,
      buttons: undefined,
    };
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
    type === "send_template" ||
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
  if (type === "send_template") return Sparkles;
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
      type: "whatsappCurve",
      label: label === "next" ? undefined : label,
      markerEnd: { type: MarkerType.ArrowClosed, color },
      interactionWidth: 24,
      style: {
        stroke: color,
        strokeWidth: 2.8,
        strokeLinecap: "round",
        strokeLinejoin: "round",
      },
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
  const entry =
    entryNodeKey && byKey.has(entryNodeKey) ? entryNodeKey : nodes[0]?.key;
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
      if (byKey.has(target))
        queue.push({ key: target, level: current.level + 1 });
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
      const branchCenterOffset =
        ((bucket.length - 1) * FLOW_LAYOUT_BRANCH_GAP) / 2;
      const sway = FLOW_LAYOUT_SWAY[level % FLOW_LAYOUT_SWAY.length];
      positions.set(node.key, {
        x: 96 + level * FLOW_LAYOUT_X_STEP,
        y:
          FLOW_LAYOUT_BASE_Y +
          sway +
          row * FLOW_LAYOUT_BRANCH_GAP -
          branchCenterOffset,
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
      x: selectedNode.position.x + FLOW_LAYOUT_X_STEP,
      y: selectedNode.position.y + 46,
    };
  }
  const layout = autoLayoutPositions(nodes, nodes[0]?.key ?? "");
  if (selectedNode) {
    const selectedPosition = layout.get(selectedNode.key);
    if (selectedPosition) {
      return {
        x: selectedPosition.x + FLOW_LAYOUT_X_STEP,
        y: selectedPosition.y + 46,
      };
    }
  }
  return {
    x: 96 + (nodes.length % 4) * FLOW_LAYOUT_X_STEP,
    y:
      FLOW_LAYOUT_BASE_Y +
      Math.floor(nodes.length / 4) * FLOW_LAYOUT_BRANCH_GAP,
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
