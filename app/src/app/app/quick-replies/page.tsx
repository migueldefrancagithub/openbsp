"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Zap, Plus, Trash2, Loader2, Save, AlertCircle } from "lucide-react";
import { PageHeader } from "@/components/app/EmptyState";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { relativeTime } from "@/lib/relativeTime";

export default function QuickRepliesPage() {
  const items = useQuery(api.quickReplies.list, {});
  const create = useMutation(api.quickReplies.create);
  const update = useMutation(api.quickReplies.update);
  const remove = useMutation(api.quickReplies.remove);

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleCreate() {
    setError(null);
    setBusy(true);
    try {
      await create({ name: name.trim(), content: content.trim() });
      setName("");
      setContent("");
      setCreating(false);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Inbox tools"
        title="Quick replies"
        description="Canned messages your team can drop into any conversation with one click."
        action={
          !creating && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="inline-flex items-center gap-2 bg-[#0a152d] text-white text-[13px] font-medium px-4 py-2 rounded-lg shadow-[0_8px_24px_-8px_rgba(10,21,45,0.5)] hover:bg-[#0a1b33] transition-all"
            >
              <Plus size={14} strokeWidth={2.5} />
              New quick reply
            </button>
          )
        }
      />

      <div className="px-8 py-8 max-w-3xl space-y-4">
        {creating && (
          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
            <div className="text-[11px] uppercase tracking-wider text-slate-400 font-medium">
              New quick reply
            </div>
            <div>
              <label className="text-[11px] text-slate-500 font-medium">
                Shortcut name (lowercase, no spaces)
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="greeting"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#0a152d]/20 focus:border-[#0a152d]/40"
              />
            </div>
            <div>
              <label className="text-[11px] text-slate-500 font-medium">
                Message
              </label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={3}
                placeholder="Olá! Obrigada pelo contacto..."
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] resize-none focus:outline-none focus:ring-2 focus:ring-[#0a152d]/20 focus:border-[#0a152d]/40"
              />
            </div>
            {error && (
              <div className="text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
                <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                {error}
              </div>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  setName("");
                  setContent("");
                  setError(null);
                }}
                className="text-[13px] text-slate-500 hover:text-slate-700 px-3 py-2"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={!name.trim() || !content.trim() || busy}
                className="inline-flex items-center gap-2 bg-[#0a152d] text-white text-[13px] font-medium px-4 py-2 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#0a1b33] transition-all"
              >
                {busy && <Loader2 size={14} className="animate-spin" />}
                Save
              </button>
            </div>
          </div>
        )}

        {items === undefined ? (
          <div className="text-slate-400 text-sm">Loading…</div>
        ) : items.length === 0 ? (
          !creating && (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center">
              <Zap size={28} className="mx-auto text-amber-400 mb-3" />
              <h2 className="font-[var(--font-outfit)] text-[18px] font-medium text-[#0a1b33]">
                No quick replies yet
              </h2>
              <p className="text-slate-500 text-sm mt-1.5 max-w-md mx-auto leading-relaxed">
                Save phrases your team types over and over — greetings, FAQ
                answers, opening hours — and drop them into any inbox
                conversation with one click.
              </p>
            </div>
          )
        ) : (
          <ul className="space-y-2">
            {items.map((q) => (
              <QuickReplyRow
                key={q._id}
                item={q}
                onSave={(content) =>
                  update({ quickReplyId: q._id, content }).then(() => undefined)
                }
                onDelete={() =>
                  remove({ quickReplyId: q._id }).then(() => undefined)
                }
              />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function QuickReplyRow({
  item,
  onSave,
  onDelete,
}: {
  item: {
    _id: Id<"quickReplies">;
    name: string;
    content: string;
    updatedAt: number;
  };
  onSave: (content: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.content);
  const [busy, setBusy] = useState(false);

  async function handleSave() {
    setBusy(true);
    try {
      await onSave(draft.trim());
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete quick reply "${item.name}"?`)) return;
    setBusy(true);
    try {
      await onDelete();
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-start gap-3">
        <Zap size={14} className="text-amber-500 flex-shrink-0 mt-1" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-[#0a1b33] font-[var(--font-mono)]">
              /{item.name}
            </span>
            <span className="text-[10px] text-slate-400">
              updated {relativeTime(item.updatedAt)}
            </span>
          </div>
          {editing ? (
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] resize-none focus:outline-none focus:ring-2 focus:ring-[#0a152d]/20 focus:border-[#0a152d]/40"
            />
          ) : (
            <p className="mt-1 text-[13px] text-slate-700 whitespace-pre-wrap">
              {item.content}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {editing ? (
            <button
              type="button"
              onClick={handleSave}
              disabled={busy || draft.trim() === item.content || !draft.trim()}
              className="text-slate-500 hover:text-emerald-600 p-2 disabled:opacity-30 disabled:cursor-not-allowed"
              title="Save"
            >
              {busy ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Save size={14} />
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setDraft(item.content);
                setEditing(true);
              }}
              className="text-[11px] text-slate-500 hover:text-[#0a152d] px-2 py-1"
            >
              Edit
            </button>
          )}
          <button
            type="button"
            onClick={handleDelete}
            disabled={busy}
            className="text-slate-400 hover:text-red-600 p-2 disabled:opacity-40"
            title="Delete"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </li>
  );
}

function formatError(err: unknown): string {
  if (err && typeof err === "object" && "data" in err) {
    const data = (err as { data: unknown }).data;
    if (typeof data === "object" && data !== null) {
      const d = data as Record<string, unknown>;
      if (typeof d.message === "string") return d.message;
      if (typeof d.code === "string") return d.code;
    }
  }
  return err instanceof Error ? err.message : "Unknown error";
}
