"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  Key,
  Plus,
  Copy,
  Check,
  Trash2,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { relativeTime } from "@/lib/relativeTime";
import { BRAND_NAME } from "@/components/Brand";

type Role = "owner" | "admin" | "agent" | "marketing";

export function ApiKeysSection() {
  const keys = useQuery(api.apiKeys.list, {});
  const mint = useAction(api.apiKeys.mint);
  const revoke = useMutation(api.apiKeys.revoke);

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("agent");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justMinted, setJustMinted] = useState<{
    name: string;
    plaintext: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleMint() {
    setError(null);
    setBusy(true);
    try {
      const r = await mint({ name: name.trim(), role });
      setJustMinted({ name: name.trim(), plaintext: r.plaintextToken });
      setName("");
      setCreating(false);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  function copyToken() {
    if (!justMinted) return;
    navigator.clipboard.writeText(justMinted.plaintext);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
        <h2 className="font-semibold text-[#0a1b33] text-[15px]">API keys</h2>
        {!creating && !justMinted && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 bg-[#0a152d] text-white text-[12px] font-medium px-3 py-1.5 rounded-lg hover:bg-[#0a1b33] transition-all"
          >
            <Plus size={12} strokeWidth={2.5} />
            New key
          </button>
        )}
      </div>

      <div className="px-6 py-5 space-y-3">
        <p className="text-[12px] text-slate-500">
          Tokens for external systems to call the {BRAND_NAME} API. Each token is
          shown <strong>once</strong> — copy it now, we only store the hash.
        </p>

        {justMinted && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 space-y-2">
            <div className="flex items-center gap-2 text-[12px] font-semibold text-emerald-800">
              <Check size={14} />
              Key &quot;{justMinted.name}&quot; created
            </div>
            <div className="text-[11px] text-emerald-700">
              Copy now — you won&apos;t see it again.
            </div>
            <div className="flex items-stretch gap-2">
              <code className="flex-1 bg-white border border-emerald-200 rounded-md px-3 py-2 text-[11px] font-[var(--font-mono)] text-[#0a1b33] break-all">
                {justMinted.plaintext}
              </code>
              <button
                type="button"
                onClick={copyToken}
                className="bg-emerald-600 text-white px-3 rounded-md hover:bg-emerald-700 transition-colors flex items-center gap-1 text-[12px] font-medium"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setJustMinted(null)}
              className="text-[12px] text-emerald-800 font-medium hover:underline"
            >
              Done
            </button>
          </div>
        )}

        {creating && (
          <div className="rounded-lg border border-slate-200 p-4 space-y-3">
            <div>
              <label className="text-[11px] text-slate-500 font-medium">
                Name (for your own reference)
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="zapier integration"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#0a152d]/20"
              />
            </div>
            <div>
              <label className="text-[11px] text-slate-500 font-medium">
                Role
              </label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#0a152d]/20"
              >
                <option value="agent">agent — read + send messages</option>
                <option value="marketing">marketing — send campaigns</option>
                <option value="admin">admin — manage workspace</option>
                <option value="owner">owner — full access</option>
              </select>
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
                  setError(null);
                }}
                className="text-[12px] text-slate-500 hover:text-slate-700 px-2 py-1.5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleMint}
                disabled={!name.trim() || busy}
                className="inline-flex items-center gap-1.5 bg-[#0a152d] text-white text-[12px] font-medium px-3 py-1.5 rounded-lg disabled:opacity-40 hover:bg-[#0a1b33] transition-all"
              >
                {busy && <Loader2 size={12} className="animate-spin" />}
                Mint key
              </button>
            </div>
          </div>
        )}

        {keys === undefined ? (
          <div className="text-slate-400 text-[12px]">Loading…</div>
        ) : keys.length === 0 && !creating && !justMinted ? (
          <div className="text-center py-6 border border-dashed border-slate-200 rounded-lg">
            <Key size={20} className="mx-auto text-slate-300 mb-2" />
            <div className="text-[12px] text-slate-500">No keys yet</div>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
            {keys?.map((k) => (
              <li
                key={k._id}
                className="flex items-center gap-3 px-4 py-3 bg-white"
              >
                <Key
                  size={14}
                  className={
                    k.revokedAt ? "text-slate-300" : "text-slate-500"
                  }
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[13px] font-medium ${k.revokedAt ? "text-slate-400 line-through" : "text-[#0a1b33]"}`}
                    >
                      {k.name}
                    </span>
                    <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">
                      {k.role}
                    </span>
                    {k.revokedAt && (
                      <span className="text-[10px] uppercase tracking-wider text-red-600 font-medium">
                        revoked
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5 font-[var(--font-mono)]">
                    {k.keyPreview} · created {relativeTime(k.createdAt)}
                    {k.lastUsedAt &&
                      ` · last used ${relativeTime(k.lastUsedAt)}`}
                  </div>
                </div>
                {!k.revokedAt && (
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`Revoke key "${k.name}"?`)) {
                        revoke({ apiKeyId: k._id });
                      }
                    }}
                    className="text-slate-400 hover:text-red-600 p-1.5"
                    title="Revoke"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
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
