"use client";

import { FormEvent, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  Bot,
  BrainCircuit,
  CheckCircle2,
  FolderPlus,
  Loader2,
  PauseCircle,
  Plus,
  Radio,
  Sparkles,
  UploadCloud,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/app/EmptyState";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { relativeTime } from "@/lib/relativeTime";

type ChatbotStatus = "draft" | "active" | "paused";
type TriggerKind = "inbound" | "keyword" | "ctwa" | "handoff";

type BotRow = {
  _id: Id<"chatbots">;
  folderId?: Id<"chatbotFolders">;
  folderName?: string;
  name: string;
  description?: string;
  status: ChatbotStatus;
  triggerKind: TriggerKind;
  model?: string;
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

export default function ChatbotsPage() {
  const studio = useQuery(api.chatbots.list);
  const createFolder = useMutation(api.chatbots.createFolder);
  const createBot = useMutation(api.chatbots.createBot);
  const updateStatus = useMutation(api.chatbots.updateStatus);
  const [folderName, setFolderName] = useState("");
  const [botName, setBotName] = useState("");
  const [botDescription, setBotDescription] = useState("");
  const [selectedFolderId, setSelectedFolderId] =
    useState<Id<"chatbotFolders"> | "">("");
  const [triggerKind, setTriggerKind] = useState<TriggerKind>("ctwa");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const folders = (studio?.folders ?? []) as FolderRow[];
  const bots = (studio?.bots ?? []) as BotRow[];
  const selectedFolder = useMemo(
    () => folders.find((folder) => folder._id === selectedFolderId),
    [folders, selectedFolderId],
  );
  const visibleBots = selectedFolderId
    ? bots.filter((bot) => bot.folderId === selectedFolderId)
    : bots;

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
      await createBot({
        name: botName,
        description: botDescription || undefined,
        folderId: selectedFolderId || undefined,
        triggerKind,
        model: "CXCast guardrail bot",
      });
      setBotName("");
      setBotDescription("");
      setNotice("Bot drafted.");
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(null);
    }
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
