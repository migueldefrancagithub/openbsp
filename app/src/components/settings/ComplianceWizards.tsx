"use client";

import { useState, FormEvent } from "react";
import { useMutation } from "convex/react";
import { ShieldCheck, FileSignature, Loader2, AlertCircle } from "lucide-react";
import { api } from "../../../convex/_generated/api";

const DATA_CATEGORY_OPTIONS = [
  "appointment_metadata",
  "patient_name",
  "patient_phone",
  "patient_email",
  "appointment_outcome",
  "free_text_messages",
] as const;

export function DpaCard({ signedAt }: { signedAt?: number }) {
  const accept = useMutation(api.tenants.acceptDpa);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (signedAt) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 flex items-start gap-3">
        <ShieldCheck size={18} className="text-emerald-600 mt-0.5" />
        <div>
          <div className="font-medium text-emerald-900 text-sm">
            DPA signed
          </div>
          <div className="text-xs text-emerald-700 mt-0.5">
            Signed at {new Date(signedAt).toLocaleString("pt-PT")}
          </div>
        </div>
      </div>
    );
  }

  async function onAccept() {
    setError(null);
    setBusy(true);
    try {
      await accept({});
    } catch (err: unknown) {
      const m = err instanceof Error ? err.message : "Could not sign DPA";
      setError(m);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-start gap-3 mb-3">
        <FileSignature size={18} className="text-slate-500 mt-0.5" />
        <div>
          <div className="font-semibold text-[#0a1b33] text-sm">
            Data Processing Agreement
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            Required before connecting WhatsApp.
          </div>
        </div>
      </div>
      <div className="text-[12px] text-slate-600 leading-relaxed bg-slate-50 border border-slate-100 rounded-lg p-3 max-h-48 overflow-y-auto mb-4">
        <p className="font-medium mb-2">Standard DPA (resumo):</p>
        <ul className="list-disc list-inside space-y-1">
          <li>OpenBSP atua como <strong>processor</strong> de dados pessoais.</li>
          <li>Tu (workspace owner) atuas como <strong>controller</strong>.</li>
          <li>Dados pessoais armazenados: telefone, nome, conteúdo de mensagens, metadata.</li>
          <li>Sub-processors: Convex (banco), Vercel (hosting), Meta (WhatsApp Cloud API).</li>
          <li>Backups encriptados em descanso (envelope encryption AES-256).</li>
          <li>Direito a apagamento (RGPD art. 17): exportContact + eraseContact disponíveis.</li>
          <li>Notificação de breach &lt; 72h.</li>
          <li>Audit log append-only com hash chain para evidência forense.</li>
        </ul>
      </div>
      {error && (
        <div className="flex items-start gap-2 text-[12px] text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-lg mb-3">
          <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      <button
        type="button"
        onClick={onAccept}
        disabled={busy}
        className="inline-flex items-center gap-2 bg-[#0a152d] text-white text-[13px] font-medium px-4 py-2 rounded-lg disabled:opacity-50 transition-all"
      >
        {busy && <Loader2 size={14} className="animate-spin" />}
        I am the data controller — accept DPA
      </button>
    </div>
  );
}

export function DpiaCard({ completedAt }: { completedAt?: number }) {
  const complete = useMutation(api.tenants.completeDpia);
  const [legalBasis, setLegalBasis] = useState("Legitimate interest (RGPD art. 6.1.f)");
  const [dataCategories, setDataCategories] = useState<Set<string>>(
    new Set(["appointment_metadata", "patient_name", "patient_phone"]),
  );
  const [retentionMonths, setRetentionMonths] = useState(24);
  const [risks, setRisks] = useState("");
  const [mitigations, setMitigations] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (completedAt) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 flex items-start gap-3">
        <ShieldCheck size={18} className="text-emerald-600 mt-0.5" />
        <div>
          <div className="font-medium text-emerald-900 text-sm">
            DPIA completed
          </div>
          <div className="text-xs text-emerald-700 mt-0.5">
            Completed at {new Date(completedAt).toLocaleString("pt-PT")}
          </div>
        </div>
      </div>
    );
  }

  function toggleCategory(cat: string) {
    const next = new Set(dataCategories);
    if (next.has(cat)) next.delete(cat);
    else next.add(cat);
    setDataCategories(next);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await complete({
        answers: {
          legalBasis,
          dataCategories: Array.from(dataCategories),
          retentionMonths,
          risks: risks || undefined,
          mitigations: mitigations || undefined,
        },
      });
    } catch (err: unknown) {
      const data =
        err && typeof err === "object" && "data" in err
          ? (err as { data: unknown }).data
          : null;
      const msg =
        data && typeof data === "object" && "message" in data
          ? String((data as { message: unknown }).message)
          : err instanceof Error
            ? err.message
            : "Could not save DPIA";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-xl border border-slate-200 bg-white p-5 space-y-4"
    >
      <div className="flex items-start gap-3">
        <FileSignature size={18} className="text-slate-500 mt-0.5" />
        <div>
          <div className="font-semibold text-[#0a1b33] text-sm">
            Data Protection Impact Assessment
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            Required for healthcare workspaces before connecting WhatsApp.
          </div>
        </div>
      </div>

      <Field label="Legal basis (RGPD art. 6)">
        <input
          type="text"
          value={legalBasis}
          onChange={(e) => setLegalBasis(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-[#0a1b33] focus:outline-none focus:ring-2 focus:ring-[#0a152d]/10 focus:border-[#0a152d]"
        />
      </Field>

      <Field label="Personal data categories processed">
        <div className="grid grid-cols-2 gap-2">
          {DATA_CATEGORY_OPTIONS.map((cat) => (
            <label
              key={cat}
              className="flex items-center gap-2 text-xs text-[#0a1b33] cursor-pointer"
            >
              <input
                type="checkbox"
                checked={dataCategories.has(cat)}
                onChange={() => toggleCategory(cat)}
                className="rounded"
              />
              {cat.replace(/_/g, " ")}
            </label>
          ))}
        </div>
      </Field>

      <Field label="Retention months (after which data is automatically erased)">
        <input
          type="number"
          min={1}
          max={120}
          value={retentionMonths}
          onChange={(e) => setRetentionMonths(Number(e.target.value))}
          className="w-32 px-3 py-2 rounded-lg border border-slate-200 text-sm text-[#0a1b33] focus:outline-none focus:ring-2 focus:ring-[#0a152d]/10 focus:border-[#0a152d]"
        />
      </Field>

      <Field label="Risks identified (optional)">
        <textarea
          rows={2}
          value={risks}
          onChange={(e) => setRisks(e.target.value)}
          placeholder="e.g. accidental disclosure of appointment to wrong contact"
          className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-[#0a1b33] focus:outline-none focus:ring-2 focus:ring-[#0a152d]/10 focus:border-[#0a152d] resize-none"
        />
      </Field>

      <Field label="Mitigations (optional)">
        <textarea
          rows={2}
          value={mitigations}
          onChange={(e) => setMitigations(e.target.value)}
          placeholder="e.g. multi-tenant fence + audit hash chain + per-purpose consent + DLP"
          className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-[#0a1b33] focus:outline-none focus:ring-2 focus:ring-[#0a152d]/10 focus:border-[#0a152d] resize-none"
        />
      </Field>

      {error && (
        <div className="flex items-start gap-2 text-[12px] text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-lg">
          <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={busy}
        className="inline-flex items-center gap-2 bg-[#0a152d] text-white text-[13px] font-medium px-4 py-2 rounded-lg disabled:opacity-50 transition-all"
      >
        {busy && <Loader2 size={14} className="animate-spin" />}
        Save DPIA
      </button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-700 mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}
