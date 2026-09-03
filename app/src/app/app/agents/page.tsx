"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { AlertTriangle, Bot, CheckCircle2, ChevronRight, Loader2, Pause, Play, Plus, Rocket, Trash2, Workflow } from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { EmptyState, PageHeader } from "@/components/app/EmptyState";
import { OBJECTIVES, issueLabel, objectiveLabel, toneLabel, toolLabel } from "@/components/agents/agentLabels";
import { AgentSandbox } from "@/components/agents/AgentSandbox";
import { AgentRunsPanel } from "@/components/agents/AgentRunsPanel";
import { AgentModeToggle } from "@/components/agents/AgentModeToggle";
import { AgentFeedbackPanel } from "@/components/agents/AgentFeedbackPanel";
import { cn } from "@/lib/cn";
import { convexErrorMessage } from "@/lib/convexErrorMessage";
import { useI18n } from "@/lib/i18n";
import { relativeTime } from "@/lib/relativeTime";

type Config = {
  instructions: string;
  tone: "formal" | "friendly" | "direct";
  knowledgeItemIds: Id<"clinicKnowledgeItems">[];
  tools: string[];
  handoff: { keywords: string[]; onLowConfidence: boolean; onClinicalQuestion: boolean; message: string };
  fallbackMessage: string;
  maxRepliesPerThread: number;
  greeting?: string;
  workingHoursOnly?: boolean;
};

const inputClass = "mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-[#0a1b33] outline-none focus:border-slate-400";

export default function AgentsPage() {
  const { locale, tr } = useI18n();
  const agents = useQuery(api.aiAgents.list, {});
  const channels = useQuery(api.channels.list);
  const settings = useQuery(api.aiSettings.get, {});
  const workspace = useQuery(api.clinic.listWorkspace, {});
  const create = useMutation(api.aiAgents.create);
  const [selectedId, setSelectedId] = useState<Id<"aiAgents"> | null>(null);
  const [creating, setCreating] = useState<{ name: string; objective: (typeof OBJECTIVES)[number]; channelId: Id<"channels"> | "" } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const productChannels = useMemo(() => (channels ?? []).filter((c) => c.provider === "iasolution_hub" && c.operationalTerritory === "openbsp"), [channels]);

  useEffect(() => {
    if (!selectedId && agents && agents.length > 0) setSelectedId(agents[0]._id);
  }, [agents, selectedId]);

  async function submitCreate() {
    if (!creating) return;
    setError(null);
    try {
      const id = await create({ name: creating.name, objective: creating.objective, channelId: creating.channelId || undefined });
      setCreating(null);
      setSelectedId(id);
    } catch (err) {
      setError(convexErrorMessage(err, locale));
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        eyebrow={tr("Automação", "Automation")}
        title={tr("Agentes", "Agents")}
        description={tr("Assistentes de IA com objetivo, tom, conhecimento e ferramentas verificáveis. Publicar só passa com a lista de verificação limpa.", "AI assistants with an objective, tone, knowledge and verifiable tools. Publishing only passes with a clean checklist.")}
        action={
          <div className="flex gap-2">
            <Link href="/app/chatbots" className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-semibold text-slate-600"><Workflow size={14} /> {tr("Fluxos por palavra-chave", "Keyword flows")}</Link>
            <button type="button" onClick={() => setCreating({ name: "", objective: "reception", channelId: productChannels[0]?._id ?? "" })} className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#0a1b33] px-4 text-[13px] font-semibold text-white"><Plus size={14} /> {tr("Novo agente", "New agent")}</button>
          </div>
        }
      />
      <div className="mx-auto w-full max-w-7xl space-y-4 px-4 py-5 sm:px-6 xl:px-8">
        {settings && !settings.ready && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
            <AlertTriangle size={14} /> {tr("A IA ainda não está pronta: configure e teste o provedor em", "AI is not ready yet: configure and test the provider in")} <Link href="/app/settings?tab=ai" className="font-semibold underline">{tr("Definições › IA", "Settings › AI")}</Link>.
          </div>
        )}
        {error && <div className="rounded-lg border border-[#e0533d]/30 bg-[#fdf1ef] px-4 py-3 text-[13px] text-[#b3261e]">{error}</div>}

        {creating && (
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block text-[11px] font-medium text-slate-500">{tr("Nome", "Name")}<input value={creating.name} onChange={(e) => setCreating({ ...creating, name: e.target.value })} placeholder={tr("Recepção da clínica", "Clinic reception")} className={inputClass} /></label>
              <label className="block text-[11px] font-medium text-slate-500">{tr("Objetivo", "Objective")}
                <select value={creating.objective} onChange={(e) => setCreating({ ...creating, objective: e.target.value as (typeof OBJECTIVES)[number] })} className={inputClass}>
                  {OBJECTIVES.map((o) => <option key={o} value={o}>{objectiveLabel(o, locale)}</option>)}
                </select>
              </label>
              <label className="block text-[11px] font-medium text-slate-500">{tr("Canal", "Channel")}
                <select value={creating.channelId} onChange={(e) => setCreating({ ...creating, channelId: e.target.value as Id<"channels"> | "" })} className={inputClass}>
                  <option value="">{tr("Escolher…", "Choose…")}</option>
                  {productChannels.map((c) => <option key={c._id} value={c._id}>{c.displayName}</option>)}
                </select>
              </label>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => setCreating(null)} className="h-9 rounded-lg border border-slate-200 px-3 text-[12px] font-semibold text-slate-600">{tr("Cancelar", "Cancel")}</button>
              <button type="button" disabled={creating.name.trim().length < 2} onClick={() => void submitCreate()} className="h-9 rounded-lg bg-[#0a1b33] px-3 text-[12px] font-semibold text-white disabled:opacity-50">{tr("Criar rascunho", "Create draft")}</button>
            </div>
          </section>
        )}

        {agents === undefined ? (
          <div className="flex items-center gap-2 px-2 py-8 text-sm text-slate-400"><Loader2 size={15} className="animate-spin" /> {tr("A carregar…", "Loading…")}</div>
        ) : agents.length === 0 && !creating ? (
          <EmptyState icon={Bot} title={tr("Ainda sem agentes", "No agents yet")} description={tr("Crie um agente de recepção: ele acolhe, responde com o conhecimento da clínica e marca consultas reais.", "Create a reception agent: it welcomes patients, answers from the clinic's knowledge and books real appointments.")} action={<button type="button" onClick={() => setCreating({ name: "", objective: "reception", channelId: productChannels[0]?._id ?? "" })} className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#0a1b33] px-4 text-[13px] font-semibold text-white"><Plus size={14} /> {tr("Novo agente", "New agent")}</button>} />
        ) : (
          <div className="grid gap-4 xl:grid-cols-[280px_1fr]">
            <ul className="space-y-1 rounded-lg border border-slate-200 bg-white p-2">
              {agents.map((agent) => (
                <li key={agent._id}>
                  <button type="button" onClick={() => setSelectedId(agent._id)} className={cn("flex w-full items-center gap-2 rounded-md px-3 py-2 text-left", selectedId === agent._id ? "bg-[#0a1b33] text-white" : "hover:bg-slate-50")}>
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", agent.status === "active" ? "bg-[#0d6b61]" : agent.status === "paused" ? "bg-amber-400" : "bg-slate-300")} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold">{agent.name}</span>
                      <span className={cn("block truncate text-[11px]", selectedId === agent._id ? "text-white/70" : "text-slate-500")}>{objectiveLabel(agent.objective, locale)} · v{agent.currentVersion} · {agent.mode === "sandbox" ? "Sandbox" : agent.mode === "copilot" ? tr("Co-Piloto", "Copilot") : tr("Automático", "Autopilot")}{agent.blockers > 0 ? ` · ${agent.blockers} ${tr("bloqueios", "blockers")}` : ""}</span>
                    </span>
                    <ChevronRight size={14} className="shrink-0 opacity-50" />
                  </button>
                </li>
              ))}
            </ul>
            {selectedId ? <AgentEditor agentId={selectedId} channels={productChannels} knowledge={(workspace?.knowledge ?? []).filter((k) => k.status === "active")} onDeleted={() => setSelectedId(null)} /> : null}
          </div>
        )}
      </div>
    </div>
  );
}

function AgentEditor({ agentId, channels, knowledge, onDeleted }: { agentId: Id<"aiAgents">; channels: Array<{ _id: Id<"channels">; displayName: string }>; knowledge: Array<{ _id: Id<"clinicKnowledgeItems">; title: string; kind: string; updatedAt: number }>; onDeleted: () => void }) {
  const { locale, tr } = useI18n();
  const detail = useQuery(api.aiAgents.get, { agentId });
  const updateDraft = useMutation(api.aiAgents.updateDraft);
  const publish = useMutation(api.aiAgents.publish);
  const setStatus = useMutation(api.aiAgents.setStatus);
  const remove = useMutation(api.aiAgents.remove);
  const [config, setConfig] = useState<Config | null>(null);
  const [name, setName] = useState("");
  const [channelId, setChannelId] = useState<Id<"channels"> | "">("");
  const [keywords, setKeywords] = useState("");
  const [tab, setTab] = useState<"config" | "sandbox" | "runs" | "evolution">("config");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  useEffect(() => {
    if (!detail || loadedFor === `${agentId}:${detail.agent.updatedAt}`) return;
    if (loadedFor?.startsWith(`${agentId}:`) && config) return; // keep local edits
    setConfig(detail.agent.config as Config);
    setName(detail.agent.name);
    setChannelId(detail.agent.channelId ?? "");
    setKeywords(detail.agent.config.handoff.keywords.join(", "));
    setLoadedFor(`${agentId}:${detail.agent.updatedAt}`);
  }, [detail, agentId, loadedFor, config]);

  useEffect(() => {
    setLoadedFor(null);
    setConfig(null);
    setTab("config");
  }, [agentId]);

  async function run(key: string, action: () => Promise<unknown>, success?: string) {
    setBusy(key);
    setNotice(null);
    try {
      await action();
      if (success) setNotice({ tone: "ok", text: success });
    } catch (err) {
      setNotice({ tone: "error", text: convexErrorMessage(err, locale) });
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!config) return;
    await run(
      "save",
      async () => {
        await updateDraft({
          agentId,
          name,
          channelId: channelId || null,
          config: { ...config, handoff: { ...config.handoff, keywords: keywords.split(/[,;\n]+/).map((k) => k.trim()).filter(Boolean) } },
        });
        setLoadedFor(null);
      },
      tr("Rascunho guardado.", "Draft saved."),
    );
  }

  if (!detail || !config) return <div className="rounded-lg border border-slate-200 bg-white p-6"><Loader2 size={15} className="animate-spin text-slate-300" /></div>;
  const { agent, issues } = detail;
  const blockers = issues.filter((i) => i.severity === "blocker");
  const warnings = issues.filter((i) => i.severity === "warning");
  const required = new Set(detail.tools.filter(() => false));

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={cn("rounded-md border px-2 py-0.5 text-[11px] font-semibold", agent.status === "active" ? "border-[#0d6b61]/30 bg-[#edf8f6] text-[#0d6b61]" : agent.status === "paused" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-slate-200 bg-slate-50 text-slate-600")}>
            {agent.status === "active" ? tr("Ativo", "Active") : agent.status === "paused" ? tr("Pausado", "Paused") : tr("Rascunho", "Draft")}
          </span>
          <span className="text-[12px] text-slate-500">v{agent.currentVersion}{agent.publishedVersionId ? ` · ${tr("publicado", "published")}` : ""}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {agent.status === "active" && <button type="button" disabled={busy !== null} onClick={() => void run("pause", () => setStatus({ agentId, status: "paused" }), tr("Agente pausado.", "Agent paused."))} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-[12px] font-semibold text-slate-700"><Pause size={13} /> {tr("Pausar", "Pause")}</button>}
          {agent.status === "paused" && <button type="button" disabled={busy !== null} onClick={() => void run("resume", () => setStatus({ agentId, status: "active" }), tr("Agente ativo.", "Agent active."))} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#0d6b61] px-3 text-[12px] font-semibold text-white"><Play size={13} /> {tr("Retomar", "Resume")}</button>}
          <button type="button" disabled={busy !== null || blockers.length > 0} onClick={() => void run("publish", () => publish({ agentId }), tr("Nova versão publicada.", "New version published."))} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#0a1b33] px-3 text-[12px] font-semibold text-white disabled:opacity-50"><Rocket size={13} /> {agent.publishedVersionId ? tr("Publicar nova versão", "Publish new version") : tr("Publicar", "Publish")}</button>
          {agent.status === "draft" && !agent.publishedVersionId && <button type="button" disabled={busy !== null} onClick={() => { if (window.confirm(tr("Apagar este rascunho?", "Delete this draft?"))) void run("remove", async () => { await remove({ agentId }); onDeleted(); }); }} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-[12px] font-semibold text-slate-500 hover:text-[#b3261e]"><Trash2 size={13} /></button>}
        </div>
      </div>
      {notice && <div className={cn("rounded-lg border px-3 py-2 text-[12px]", notice.tone === "error" ? "border-[#e0533d]/30 bg-[#fdf1ef] text-[#b3261e]" : "border-[#0d6b61]/30 bg-[#edf8f6] text-[#0d6b61]")}>{notice.text}</div>}

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">{tr("Modo de maturação", "Maturity mode")}</div>
        <AgentModeToggle agentId={agentId} mode={agent.mode} published={!!agent.publishedVersionId} onNotice={setNotice} />
      </div>

      <div className="inline-flex flex-wrap rounded-lg border border-slate-200 bg-slate-50 p-1 text-[12px] font-semibold">
        {(["config", "sandbox", "runs", "evolution"] as const).map((key) => (
          <button key={key} type="button" onClick={() => setTab(key)} className={cn("rounded-md px-3 py-1.5", tab === key ? "bg-white text-[#0a1b33] shadow-sm" : "text-slate-500")}>{key === "config" ? tr("Configuração", "Configuration") : key === "sandbox" ? "Sandbox" : key === "runs" ? tr("Execuções", "Runs") : tr("Evolução", "Evolution")}</button>
        ))}
      </div>

      {tab === "sandbox" && <AgentSandbox agentId={agentId} />}
      {tab === "runs" && <AgentRunsPanel agentId={agentId} />}
      {tab === "evolution" && <AgentFeedbackPanel agentId={agentId} />}
      {tab === "config" && (
        <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-[11px] font-medium text-slate-500">{tr("Nome", "Name")}<input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} maxLength={80} /></label>
              <label className="block text-[11px] font-medium text-slate-500">{tr("Canal", "Channel")}
                <select value={channelId} onChange={(e) => setChannelId(e.target.value as Id<"channels"> | "")} className={inputClass}>
                  <option value="">{tr("Escolher…", "Choose…")}</option>
                  {channels.map((c) => <option key={c._id} value={c._id}>{c.displayName}</option>)}
                </select>
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="text-[11px] font-medium text-slate-500">{tr("Objetivo", "Objective")}<div className="mt-1 h-10 rounded-lg border border-slate-100 bg-slate-50 px-3 text-sm leading-10 text-[#0a1b33]">{objectiveLabel(agent.objective, locale)}</div></div>
              <label className="block text-[11px] font-medium text-slate-500">{tr("Tom", "Tone")}
                <select value={config.tone} onChange={(e) => setConfig({ ...config, tone: e.target.value as Config["tone"] })} className={inputClass}>
                  {(["friendly", "formal", "direct"] as const).map((t) => <option key={t} value={t}>{toneLabel(t, locale)}</option>)}
                </select>
              </label>
              <label className="block text-[11px] font-medium text-slate-500">{tr("Máx. respostas por conversa", "Max replies per conversation")}<input type="number" min={1} max={50} value={config.maxRepliesPerThread} onChange={(e) => setConfig({ ...config, maxRepliesPerThread: Number(e.target.value) })} className={inputClass} /></label>
            </div>
            <label className="block text-[11px] font-medium text-slate-500">{tr("Instruções (o que faz e o que nunca faz)", "Instructions (what it does and never does)")}
              <textarea value={config.instructions} onChange={(e) => setConfig({ ...config, instructions: e.target.value })} rows={5} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-[#0a1b33] outline-none focus:border-slate-400" maxLength={6000} />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-[11px] font-medium text-slate-500">{tr("Saudação (opcional)", "Greeting (optional)")}<input value={config.greeting ?? ""} onChange={(e) => setConfig({ ...config, greeting: e.target.value })} className={inputClass} maxLength={300} /></label>
              <label className="block text-[11px] font-medium text-slate-500">{tr("Mensagem de recurso (quando não sabe)", "Fallback message (when unsure)")}<input value={config.fallbackMessage} onChange={(e) => setConfig({ ...config, fallbackMessage: e.target.value })} className={inputClass} maxLength={500} /></label>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">{tr("Conhecimento usado", "Knowledge used")}</div>
              {knowledge.length === 0 ? (
                <p className="text-[12px] text-slate-500">{tr("Sem conhecimento ativo. Crie em Operação › Clínica › Ensinar agente.", "No active knowledge. Create it in Operations › Clinic › Teach agent.")}</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {knowledge.map((item) => {
                    const on = config.knowledgeItemIds.includes(item._id);
                    return <button key={item._id} type="button" onClick={() => setConfig({ ...config, knowledgeItemIds: on ? config.knowledgeItemIds.filter((id) => id !== item._id) : [...config.knowledgeItemIds, item._id] })} className={cn("rounded-full border px-2.5 py-1 text-[11px] font-semibold", on ? "border-[#0a1b33] bg-[#0a1b33] text-white" : "border-slate-200 bg-white text-slate-600")}>{item.title} <span className="opacity-60">· {item.kind}</span></button>;
                  })}
                </div>
              )}
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">{tr("Ferramentas", "Tools")}</div>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {detail.tools.map((tool) => {
                  const on = config.tools.includes(tool);
                  return (
                    <label key={tool} className="flex items-center gap-2 text-[12px] text-[#0a1b33]">
                      <input type="checkbox" checked={on} onChange={(e) => setConfig({ ...config, tools: e.target.checked ? [...config.tools, tool] : config.tools.filter((t) => t !== tool) })} className="h-4 w-4 accent-[#0a1b33]" />
                      {toolLabel(tool, locale)}{required.has(tool) ? " *" : ""}
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">{tr("Passagem à equipa", "Handoff to the team")}</div>
              <label className="block text-[11px] font-medium text-slate-500">{tr("Palavras que obrigam a passar (separadas por vírgula)", "Words that force a handoff (comma separated)")}<input value={keywords} onChange={(e) => setKeywords(e.target.value)} className={inputClass} /></label>
              <label className="mt-2 block text-[11px] font-medium text-slate-500">{tr("Mensagem ao paciente na passagem", "Message to the patient on handoff")}<input value={config.handoff.message} onChange={(e) => setConfig({ ...config, handoff: { ...config.handoff, message: e.target.value } })} className={inputClass} maxLength={500} /></label>
              <div className="mt-2 flex flex-wrap gap-4 text-[12px] text-[#0a1b33]">
                <label className="flex items-center gap-2"><input type="checkbox" checked={config.handoff.onLowConfidence} onChange={(e) => setConfig({ ...config, handoff: { ...config.handoff, onLowConfidence: e.target.checked } })} className="h-4 w-4 accent-[#0a1b33]" />{tr("Passar quando tiver dúvidas", "Hand off when unsure")}</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={config.handoff.onClinicalQuestion} onChange={(e) => setConfig({ ...config, handoff: { ...config.handoff, onClinicalQuestion: e.target.checked } })} className="h-4 w-4 accent-[#0a1b33]" />{tr("Passar perguntas clínicas", "Hand off clinical questions")}</label>
              </div>
            </div>
            <div className="flex justify-end">
              <button type="button" disabled={busy !== null} onClick={() => void save()} className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#0a1b33] px-4 text-[13px] font-semibold text-[#0a1b33] disabled:opacity-50">{busy === "save" && <Loader2 size={14} className="animate-spin" />} {tr("Guardar rascunho", "Save draft")}</button>
            </div>
          </div>

          <aside className="space-y-3">
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="mb-2 flex items-center justify-between text-[13px] font-semibold text-[#0a1b33]">
                {tr("Lista de verificação", "Checklist")}
                <span className={cn("rounded-md px-2 py-0.5 text-[11px]", blockers.length === 0 ? "bg-[#edf8f6] text-[#0d6b61]" : "bg-[#fdf1ef] text-[#b3261e]")}>{blockers.length === 0 ? tr("pronto a publicar", "ready to publish") : `${blockers.length} ${tr("bloqueios", "blockers")}`}</span>
              </div>
              <ul className="space-y-1.5 text-[12px]">
                {blockers.map((issue) => <li key={issue.code + (issue.detail ?? "")} className="flex items-start gap-1.5 text-[#b3261e]"><AlertTriangle size={12} className="mt-0.5 shrink-0" /> {issueLabel(issue.code, issue.detail, locale)}</li>)}
                {warnings.map((issue) => <li key={issue.code + (issue.detail ?? "")} className="flex items-start gap-1.5 text-amber-700"><AlertTriangle size={12} className="mt-0.5 shrink-0" /> {issueLabel(issue.code, issue.detail, locale)}</li>)}
                {issues.length === 0 && <li className="flex items-center gap-1.5 text-[#0d6b61]"><CheckCircle2 size={12} /> {tr("Tudo verificado.", "All checks passed.")}</li>}
              </ul>
              <p className="mt-2 text-[10px] text-slate-400">{tr("A lista recalcula ao guardar. Publicar congela configuração e conhecimento numa versão imutável.", "The list recomputes on save. Publishing freezes configuration and knowledge into an immutable version.")}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="mb-2 text-[13px] font-semibold text-[#0a1b33]">{tr("Versões", "Versions")}</div>
              {detail.versions.length === 0 ? <p className="text-[12px] text-slate-500">{tr("Ainda não publicado.", "Not published yet.")}</p> : (
                <ul className="space-y-1 text-[12px] text-slate-600">
                  {detail.versions.map((v) => <li key={v._id} className="flex justify-between"><span>v{v.version} · {v.knowledgeCount} {tr("itens", "items")} · <code className="text-[10px] text-slate-400">{v.checksum}</code></span><span className="text-slate-400">{relativeTime(v.publishedAt, Date.now(), locale)}</span></li>)}
                </ul>
              )}
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}
