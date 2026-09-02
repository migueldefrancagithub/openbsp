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
import { useI18n, type Locale } from "@/lib/i18n";
import { convexErrorMessage } from "@/lib/convexErrorMessage";

type Role = "owner" | "admin" | "agent" | "marketing";

export function ApiKeysSection() {
  const { locale, tr } = useI18n();
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
      setError(formatError(err, locale));
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
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-[#0a1b33]">{tr("Chaves de API", "API keys")}</h2>
        {!creating && !justMinted && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 bg-[#0a152d] text-white text-[12px] font-medium px-3 py-1.5 rounded-lg hover:bg-[#0a1b33] transition-all"
          >
            <Plus size={12} strokeWidth={2.5} />
            {tr("Nova chave", "New key")}
          </button>
        )}
      </div>

      <div className="px-6 py-5 space-y-3">
        <p className="text-[12px] text-slate-500">
          {tr(
            `Tokens para sistemas externos acederem à API ${BRAND_NAME}. Cada token é mostrado uma única vez; apenas guardamos o hash.`,
            `Tokens for external systems to call the ${BRAND_NAME} API. Each token is shown once; only the hash is stored.`,
          )}
        </p>

        {justMinted && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 space-y-2">
            <div className="flex items-center gap-2 text-[12px] font-semibold text-emerald-800">
              <Check size={14} />
              {tr("Chave", "Key")} &quot;{justMinted.name}&quot; {tr("criada", "created")}
            </div>
            <div className="text-[11px] text-emerald-700">
              {tr("Copie agora; não voltará a ser mostrada.", "Copy now; it will not be shown again.")}
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
                {copied ? tr("Copiado", "Copied") : tr("Copiar", "Copy")}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setJustMinted(null)}
              className="text-[12px] text-emerald-800 font-medium hover:underline"
            >
              {tr("Concluído", "Done")}
            </button>
          </div>
        )}

        {creating && (
          <div className="rounded-lg border border-slate-200 p-4 space-y-3">
            <div>
              <label className="text-[11px] text-slate-500 font-medium">
                {tr("Nome de referência", "Reference name")}
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
                {tr("Papel", "Role")}
              </label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#0a152d]/20"
              >
                <option value="agent">{tr("atendimento — ler e enviar mensagens", "agent — read and send messages")}</option>
                <option value="marketing">{tr("marketing — enviar campanhas", "marketing — send campaigns")}</option>
                <option value="admin">{tr("admin — gerir espaço", "admin — manage workspace")}</option>
                <option value="owner">{tr("proprietário — acesso total", "owner — full access")}</option>
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
                {tr("Cancelar", "Cancel")}
              </button>
              <button
                type="button"
                onClick={handleMint}
                disabled={!name.trim() || busy}
                className="inline-flex items-center gap-1.5 bg-[#0a152d] text-white text-[12px] font-medium px-3 py-1.5 rounded-lg disabled:opacity-40 hover:bg-[#0a1b33] transition-all"
              >
                {busy && <Loader2 size={12} className="animate-spin" />}
                {tr("Criar chave", "Create key")}
              </button>
            </div>
          </div>
        )}

        {keys === undefined ? (
          <div className="text-slate-400 text-[12px]">{tr("A carregar…", "Loading…")}</div>
        ) : keys.length === 0 && !creating && !justMinted ? (
          <div className="text-center py-6 border border-dashed border-slate-200 rounded-lg">
            <Key size={20} className="mx-auto text-slate-300 mb-2" />
            <div className="text-[12px] text-slate-500">{tr("Ainda não existem chaves", "No keys yet")}</div>
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
                      {roleLabel(k.role, locale)}
                    </span>
                    {k.revokedAt && (
                      <span className="text-[10px] uppercase tracking-wider text-red-600 font-medium">
                        {tr("revogada", "revoked")}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5 font-[var(--font-mono)]">
                    {k.keyPreview} · {tr("criada", "created")} {relativeTime(k.createdAt, Date.now(), locale)}
                    {k.lastUsedAt &&
                      ` · ${tr("último uso", "last used")} ${relativeTime(k.lastUsedAt, Date.now(), locale)}`}
                  </div>
                </div>
                {!k.revokedAt && (
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(tr(`Revogar a chave "${k.name}"?`, `Revoke key "${k.name}"?`))) {
                        revoke({ apiKeyId: k._id });
                      }
                    }}
                    className="text-slate-400 hover:text-red-600 p-1.5"
                    title={tr("Revogar", "Revoke")}
                    aria-label={tr(`Revogar chave ${k.name}`, `Revoke key ${k.name}`)}
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

function formatError(err: unknown, locale: Locale): string {
  return convexErrorMessage(err, locale, locale === "pt" ? "Erro desconhecido" : "Unknown error");
}

function roleLabel(role: string, locale: Locale) {
  if (locale !== "pt") return role;
  if (role === "agent") return "atendimento";
  if (role === "admin") return "administrador";
  if (role === "owner") return "proprietário";
  return role;
}
