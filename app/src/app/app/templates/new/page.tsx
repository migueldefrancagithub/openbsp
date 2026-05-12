"use client";

import { useState, useMemo, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { ChevronLeft, Loader2, AlertCircle } from "lucide-react";
import { PageHeader } from "@/components/app/EmptyState";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

export default function NewTemplatePage() {
  const router = useRouter();
  const accounts = useQuery(api.whatsappAccounts.listForTenant);
  const create = useMutation(api.templates.createDraft);

  const [whatsappAccountId, setWhatsappAccountId] = useState<string>("");
  const [name, setName] = useState("appointment_reminder");
  const [language, setLanguage] = useState("pt_PT");
  const [category, setCategory] = useState<"marketing" | "utility" | "authentication">("utility");
  const [bodyText, setBodyText] = useState(
    "Olá {{1}}, lembrete da sua consulta amanhã às {{2}} com a {{3}}.",
  );
  const [examples, setExamples] = useState<Record<number, string>>({
    1: "Maria",
    2: "10h00",
    3: "Dra. Sofia",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detectedIndices = useMemo(() => {
    const set = new Set<number>();
    const re = /\{\{(\d+)\}\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(bodyText)) !== null) set.add(Number(m[1]));
    return Array.from(set).sort((a, b) => a - b);
  }, [bodyText]);

  // Default account
  if (whatsappAccountId === "" && accounts && accounts.length > 0) {
    setWhatsappAccountId(accounts[0]._id);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const id = await create({
        whatsappAccountId: whatsappAccountId as Id<"whatsappAccounts">,
        name: name.trim(),
        language: language.trim(),
        category,
        bodyText,
        parameterSchema: detectedIndices.map((i) => ({
          index: i,
          name: `var_${i}`,
          example: examples[i] ?? "",
        })),
      });
      router.push(`/app/templates/${id}`);
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
            : "Could not create template";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  if (accounts && accounts.length === 0) {
    return (
      <>
        <PageHeader eyebrow="Templates" title="New template" description="" />
        <div className="px-8 py-8 max-w-2xl">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Connect a WhatsApp Business Account in{" "}
            <Link href="/app/settings" className="underline font-medium">
              Settings
            </Link>{" "}
            before creating templates.
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Templates"
        title="New template"
        description="Submit a template to Meta for approval. BODY-only with text variables."
        action={
          <Link
            href="/app/templates"
            className="inline-flex items-center gap-1 text-[13px] text-slate-600 hover:text-[#0a1b33] transition-colors"
          >
            <ChevronLeft size={14} />
            Back
          </Link>
        }
      />
      <form onSubmit={onSubmit} className="px-8 py-8 max-w-2xl space-y-5">
        <Field label="Name (3–40 chars, lowercase, _)">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-[var(--font-mono)] text-[#0a1b33] focus:outline-none focus:ring-2 focus:ring-[#0a152d]/10 focus:border-[#0a152d]"
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Language">
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-[#0a1b33] focus:outline-none focus:ring-2 focus:ring-[#0a152d]/10 focus:border-[#0a152d]"
            >
              <option value="pt_PT">pt_PT — Portuguese (Portugal)</option>
              <option value="pt_BR">pt_BR — Portuguese (Brazil)</option>
              <option value="en_US">en_US — English</option>
              <option value="es_ES">es_ES — Spanish</option>
            </select>
          </Field>
          <Field label="Category">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as typeof category)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-[#0a1b33] focus:outline-none focus:ring-2 focus:ring-[#0a152d]/10 focus:border-[#0a152d]"
            >
              <option value="utility">Utility (transactional)</option>
              <option value="marketing">Marketing (requires opt-in)</option>
              <option value="authentication">Authentication (OTP)</option>
            </select>
          </Field>
        </div>

        <Field label="WhatsApp Business Account">
          <select
            value={whatsappAccountId}
            onChange={(e) => setWhatsappAccountId(e.target.value)}
            required
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-[#0a1b33] focus:outline-none focus:ring-2 focus:ring-[#0a152d]/10 focus:border-[#0a152d]"
          >
            {accounts?.map((a) => (
              <option key={a._id} value={a._id}>
                WABA {a.wabaId}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Body text (use {{1}}, {{2}}, … for variables)">
          <textarea
            rows={4}
            value={bodyText}
            onChange={(e) => setBodyText(e.target.value)}
            required
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-[#0a1b33] focus:outline-none focus:ring-2 focus:ring-[#0a152d]/10 focus:border-[#0a152d] resize-none font-mono"
          />
          <p className="text-[11px] text-slate-400 mt-1.5">
            {bodyText.length} / 1024 chars · {detectedIndices.length} variable
            {detectedIndices.length === 1 ? "" : "s"} detected
          </p>
        </Field>

        {detectedIndices.length > 0 && (
          <Field label="Example values (Meta requires one example per variable)">
            <div className="space-y-2">
              {detectedIndices.map((i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[12px] font-[var(--font-mono)] text-slate-500 w-12">
                    {`{{${i}}}`}
                  </span>
                  <input
                    type="text"
                    value={examples[i] ?? ""}
                    onChange={(e) =>
                      setExamples((prev) => ({ ...prev, [i]: e.target.value }))
                    }
                    required
                    placeholder="Example value"
                    className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm text-[#0a1b33] focus:outline-none focus:ring-2 focus:ring-[#0a152d]/10 focus:border-[#0a152d]"
                  />
                </div>
              ))}
            </div>
          </Field>
        )}

        {error && (
          <div className="flex items-start gap-2 text-[12px] text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-lg">
            <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center gap-2 bg-[#0a152d] text-white text-[13px] font-medium px-4 py-2.5 rounded-lg disabled:opacity-50 transition-all"
        >
          {busy && <Loader2 size={14} className="animate-spin" />}
          Save draft
        </button>
      </form>
    </>
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
