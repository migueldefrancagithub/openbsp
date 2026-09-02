"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { BrandLogo } from "@/components/Brand";
import { LanguageSwitcher, useI18n } from "@/lib/i18n";

const VERTICALS = [
  { value: "clinic", pt: "Clínica / Saúde", en: "Clinic / Healthcare" },
  { value: "services", pt: "Serviços B2C", en: "B2C services" },
  { value: "ecommerce", pt: "Comércio eletrónico", en: "E-commerce" },
  { value: "other", pt: "Outro", en: "Other" },
] as const;

type Vertical = (typeof VERTICALS)[number]["value"];

export default function OnboardingPage() {
  const { tr } = useI18n();
  const router = useRouter();
  const createTenant = useMutation(api.tenants.createForCurrentUser);

  const [name, setName] = useState("");
  const [vertical, setVertical] = useState<Vertical>("services");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await createTenant({ name, vertical });
      router.push("/app");
    } catch {
      setError(tr("Não foi possível criar o espaço de trabalho. Tente novamente.", "Could not create the workspace. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-[#f9fafb] px-4 py-12">
      <LanguageSwitcher compact className="absolute right-4 top-4" />
      <div className="w-full max-w-md">
        <div className="mb-10 flex justify-center text-[#0a1b33]">
          <BrandLogo />
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-8 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.15)]">
          <h1 className="font-[var(--font-outfit)] text-[26px] font-medium tracking-tight text-[#0a1b33]">
            {tr("Configure o seu espaço de trabalho", "Set up your workspace")}
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            {tr("Só falta este passo para ligar o WhatsApp.", "One last step before you can connect WhatsApp.")}
          </p>

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div>
              <label
                htmlFor="name"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                {tr("Nome do espaço de trabalho", "Workspace name")}
              </label>
              <input
                id="name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm text-[#0a1b33] focus:outline-none focus:ring-2 focus:ring-[#0a152d]/10 focus:border-[#0a152d] transition-all"
                placeholder="Clínica Marisa Vaz"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                {tr("Área de atividade", "Business area")}
              </label>
              <div className="grid grid-cols-2 gap-2">
                {VERTICALS.map((v) => (
                  <button
                    key={v.value}
                    type="button"
                    onClick={() => setVertical(v.value)}
                    className={`text-left px-3 py-2.5 rounded-lg border text-sm transition-all ${
                      vertical === v.value
                        ? "border-[#0a152d] bg-[#0a152d]/5 text-[#0a1b33] font-medium"
                        : "border-slate-200 text-slate-600 hover:border-slate-300"
                    }`}
                  >
                    <div>{tr(v.pt, v.en)}</div>
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full bg-[#0a152d] text-white text-sm font-medium px-4 py-2.5 rounded-lg shadow-[0_8px_24px_-8px_rgba(10,21,45,0.5)] hover:bg-[#0a1b33] disabled:opacity-50 transition-all"
            >
              {busy ? tr("A criar…", "Creating…") : tr("Criar espaço de trabalho", "Create workspace")}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
