"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  AlertCircle,
  Copy,
  Loader2,
  MessageSquare,
  Plus,
  Save,
  Search,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { relativeTime } from "@/lib/relativeTime";
import { useI18n } from "@/lib/i18n";

type QuickReply = {
  _id: Id<"quickReplies">;
  name: string;
  content: string;
  updatedAt: number;
};

type EditorMode = "create" | "edit";

const VARIABLE_CHIPS = [
  "{{contact.name}}",
  "{{agent.name}}",
  "{{business.name}}",
  "{{appointment.date}}",
];

const PRESETS = [
  {
    name: "greeting",
    title: ["Saudação", "Greeting"],
    content:
      "Olá {{contact.name}}! Obrigado pelo contacto. Como podemos ajudar hoje?",
  },
  {
    name: "pricing",
    title: ["Condições do serviço", "Service details"],
    content:
      "As condições variam conforme o serviço. Diz-nos o que procuras e a equipa confirma o melhor próximo passo contigo.",
  },
  {
    name: "booking",
    title: ["Agendamento", "Booking"],
    content:
      "Perfeito. Envia o serviço pretendido e o melhor horário para marcarmos a tua consulta.",
  },
  {
    name: "after_hours",
    title: ["Fora do horário", "After hours"],
    content:
      "Obrigado pela mensagem. A equipa está offline agora e responde assim que voltar ao atendimento.",
  },
  {
    name: "handoff",
    title: ["Passar à equipa", "Handoff"],
    content:
      "Vou passar o teu atendimento para uma pessoa da equipa. Fica só um momento, por favor.",
  },
  {
    name: "stop_ack",
    title: ["Cancelar comunicações", "Opt-out"],
    content:
      "Pedido recebido. Não vais receber mais mensagens nossas por WhatsApp.",
  },
];

export default function QuickRepliesPage() {
  const { locale, tr } = useI18n();
  const items = useQuery(api.quickReplies.list, {}) as QuickReply[] | undefined;
  const create = useMutation(api.quickReplies.create);
  const update = useMutation(api.quickReplies.update);
  const remove = useMutation(api.quickReplies.remove);

  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<EditorMode>("create");
  const [selectedId, setSelectedId] = useState<Id<"quickReplies"> | null>(null);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selected = useMemo(
    () => items?.find((item) => item._id === selectedId),
    [items, selectedId],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items ?? [];
    return (items ?? []).filter(
      (item) =>
        item.name.toLowerCase().includes(needle) ||
        item.content.toLowerCase().includes(needle),
    );
  }, [items, query]);

  useEffect(() => {
    if (mode === "create" || !items || items.length === 0 || selectedId) return;
    const first = items[0];
    setSelectedId(first._id);
    setMode("edit");
    setName(first.name);
    setContent(first.content);
  }, [items, mode, selectedId]);

  useEffect(() => {
    if (!selected || mode !== "edit") return;
    setName(selected.name);
    setContent(selected.content);
  }, [mode, selected]);

  function startCreate(preset?: (typeof PRESETS)[number]) {
    setMode("create");
    setSelectedId(null);
    setName(preset?.name ?? "");
    setContent(preset?.content ?? "");
    setError(null);
  }

  function selectItem(item: QuickReply) {
    setSelectedId(item._id);
    setMode("edit");
    setName(item.name);
    setContent(item.content);
    setError(null);
  }

  async function handleSave() {
    setError(null);
    setBusy(true);
    try {
      if (mode === "create") {
        const id = await create({
          name: cleanShortcut(name),
          content: content.trim(),
        });
        setSelectedId(id);
        setMode("edit");
      } else if (selectedId) {
        await update({ quickReplyId: selectedId, content: content.trim() });
      }
    } catch (err) {
      setError(formatError(err, tr("Erro desconhecido", "Unknown error")));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!selectedId || !selected) return;
    if (!confirm(tr(`Eliminar /${selected.name}?`, `Delete /${selected.name}?`))) return;
    setBusy(true);
    try {
      await remove({ quickReplyId: selectedId });
      const next = filtered.find((item) => item._id !== selectedId);
      if (next) selectItem(next);
      else startCreate();
    } catch (err) {
      setError(formatError(err, tr("Erro desconhecido", "Unknown error")));
    } finally {
      setBusy(false);
    }
  }

  function insertVariable(value: string) {
    setContent((prev) => (prev.trim() ? `${prev} ${value}` : value));
  }

  const canSave =
    content.trim().length > 0 &&
    (mode === "edit" || cleanShortcut(name).length > 0) &&
    !busy;

  return (
    <div className="min-h-[calc(100vh-64px)] bg-[#f4f7fb] p-4 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-4">
        <header className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#0a152d] text-white">
              <Zap size={18} />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                {tr("Ferramentas da Inbox", "Inbox tools")}
              </p>
              <h1 className="truncate font-[var(--font-outfit)] text-2xl font-semibold text-[#0a1b33]">
                {tr("Respostas rápidas", "Quick replies")}
              </h1>
            </div>
          </div>
          <button
            type="button"
            onClick={() => startCreate()}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#0a152d] px-4 text-sm font-semibold text-white hover:bg-[#0a1b33]"
          >
            <Plus size={15} />
            {tr("Nova resposta", "New reply")}
          </button>
        </header>

        <section className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)_360px]">
          <aside className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-100 p-3">
              <label className="relative block">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={tr("Pesquisar respostas...", "Search replies...")}
                  className="h-10 w-full rounded-md border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-[#0a1b33] outline-none focus:border-slate-400 focus:bg-white"
                />
              </label>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <Metric label={tr("Total", "Total")} value={items?.length ?? 0} />
                <Metric label={tr("Visíveis", "Shown")} value={filtered.length} />
                <Metric
                  label={tr("Caracteres", "Characters")}
                  value={(items ?? []).reduce(
                    (sum, item) => sum + item.content.length,
                    0,
                  )}
                />
              </div>
            </div>

            <div className="max-h-[calc(100vh-330px)] min-h-[360px] overflow-y-auto p-2">
              {items === undefined ? (
                <div className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-3 text-sm text-slate-500">
                  <Loader2 size={14} className="animate-spin" />
                  {tr("A carregar", "Loading")}
                </div>
              ) : filtered.length === 0 ? (
                <div className="p-8 text-center">
                  <MessageSquare size={24} className="mx-auto text-slate-300" />
                  <p className="mt-3 text-sm font-semibold text-[#0a1b33]">
                    {tr("Nenhuma resposta encontrada", "No replies found")}
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  {filtered.map((item) => (
                    <button
                      key={item._id}
                      type="button"
                      onClick={() => selectItem(item)}
                      className={`w-full rounded-md px-3 py-3 text-left transition-colors ${
                        selectedId === item._id
                          ? "bg-[#0a152d] text-white"
                          : "hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-[var(--font-mono)] text-sm font-semibold">
                          /{item.name}
                        </span>
                        <span
                          className={`shrink-0 text-[10px] ${
                            selectedId === item._id
                              ? "text-white/60"
                              : "text-slate-400"
                          }`}
                        >
                          {relativeTime(item.updatedAt, Date.now(), locale)}
                        </span>
                      </div>
                      <p
                        className={`mt-1 line-clamp-2 text-xs leading-5 ${
                          selectedId === item._id
                            ? "text-white/70"
                            : "text-slate-500"
                        }`}
                      >
                        {item.content}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </aside>

          <main className="rounded-lg border border-slate-200 bg-white">
            <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                  {mode === "create"
                    ? tr("Nova resposta", "New reply")
                    : tr("Editar resposta", "Edit reply")}
                </p>
                <h2 className="mt-1 text-lg font-semibold text-[#0a1b33]">
                  {mode === "create" ? tr("Rascunho", "Draft quick reply") : `/${name}`}
                </h2>
              </div>
              <div className="flex flex-wrap gap-2">
                {mode === "edit" && (
                  <button
                    type="button"
                    onClick={() =>
                      startCreate({
                        name: `${name}_copy`,
                        title: ["Cópia", "Copy"],
                        content,
                      })
                    }
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-semibold text-[#0a1b33] hover:bg-slate-50"
                  >
                    <Copy size={14} />
                    {tr("Duplicar", "Duplicate")}
                  </button>
                )}
                {mode === "edit" && (
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={busy}
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-red-100 bg-red-50 px-3 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                  >
                    <Trash2 size={14} />
                    {tr("Eliminar", "Delete")}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={!canSave}
                  className="inline-flex h-9 items-center gap-2 rounded-md bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {busy ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Save size={14} />
                  )}
                  {tr("Guardar", "Save")}
                </button>
              </div>
            </div>

            <div className="grid gap-4 p-4">
              <section className="space-y-4">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-slate-500">
                    {tr("Atalho", "Shortcut")}
                  </span>
                  <div className="flex h-11 items-center rounded-md border border-slate-200 bg-white px-3 focus-within:border-slate-400">
                    <span className="font-[var(--font-mono)] text-sm text-slate-400">
                      /
                    </span>
                    <input
                      value={name}
                      onChange={(event) => setName(cleanShortcut(event.target.value))}
                      disabled={mode === "edit"}
                      placeholder="greeting"
                      className="min-w-0 flex-1 bg-transparent px-1 text-sm font-semibold text-[#0a1b33] outline-none disabled:text-slate-500"
                    />
                  </div>
                </label>

                <div>
                  <p className="mb-2 text-[11px] font-medium text-slate-500">
                    {tr("Modelos prontos", "Presets")}
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {PRESETS.map((preset) => (
                      <button
                        key={preset.name}
                        type="button"
                        onClick={() => startCreate(preset)}
                        className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-left text-sm font-semibold text-[#0a1b33] hover:bg-white"
                      >
                        {preset.title[locale === "pt" ? 0 : 1]}
                        <Sparkles size={13} className="text-emerald-600" />
                      </button>
                    ))}
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-slate-500">
                    {tr("Mensagem", "Message")}
                  </span>
                  <textarea
                    value={content}
                    onChange={(event) => setContent(event.target.value)}
                    rows={11}
                    placeholder="Olá! Obrigado pelo contacto..."
                    className="w-full resize-none rounded-md border border-slate-200 bg-white px-3 py-3 text-sm leading-6 text-[#0a1b33] outline-none focus:border-slate-400"
                  />
                </label>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-2">
                    {VARIABLE_CHIPS.map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => insertVariable(chip)}
                        className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-white"
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                  <span className="text-xs font-medium text-slate-400">
                    {content.length}/4096
                  </span>
                </div>
                {error && (
                  <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    <AlertCircle size={14} className="mt-0.5 shrink-0" />
                    {error}
                  </div>
                )}
              </section>
            </div>
          </main>

          <QuickReplyPreview name={name || "shortcut"} content={content} />
        </section>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-slate-100 bg-slate-50 px-2 py-2">
      <div className="text-base font-semibold text-[#0a1b33]">{value}</div>
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
        {label}
      </div>
    </div>
  );
}

function QuickReplyPreview({
  name,
  content,
}: {
  name: string;
  content: string;
}) {
  const { tr } = useI18n();
  return (
    <aside className="rounded-lg border border-slate-200 bg-[#eef3f8] p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
          <MessageSquare size={15} />
        </span>
        <div>
          <h3 className="text-sm font-semibold text-[#0a1b33]">
            {tr("Pré-visualização", "Preview")}
          </h3>
          <p className="font-[var(--font-mono)] text-xs text-slate-500">
            /{cleanShortcut(name) || "shortcut"}
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-300 bg-[#111827]">
        <div className="bg-[#1f2937] px-4 py-3 text-sm font-semibold text-white">
          OpenBSP Inbox
        </div>
        <div
          className="min-h-[420px] px-3 py-4"
          style={{
            backgroundColor: "#10231f",
            backgroundImage:
              "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.08) 1px, transparent 0)",
            backgroundSize: "18px 18px",
          }}
        >
          <div className="ml-auto max-w-[88%] rounded-lg bg-[#0b7a5f] px-3 py-2 text-sm leading-5 text-white">
            {content.trim() || tr("Pré-visualização da mensagem...", "Message preview...")}
            <div className="mt-1 text-right text-[10px] text-white/70">9:42</div>
          </div>
        </div>
      </div>
    </aside>
  );
}

function cleanShortcut(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^\/+/, "")
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function formatError(err: unknown, fallback = "Unknown error"): string {
  if (err && typeof err === "object" && "data" in err) {
    const data = (err as { data: unknown }).data;
    if (typeof data === "object" && data !== null) {
      const d = data as Record<string, unknown>;
      if (typeof d.message === "string") return d.message;
      if (typeof d.code === "string") return d.code;
    }
  }
  return err instanceof Error ? err.message : fallback;
}
