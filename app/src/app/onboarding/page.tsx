"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";

const VERTICALS = [
  { value: "clinic", label: "Clínica / Saúde", note: "Healthcare-mode obrigatório" },
  { value: "services", label: "Serviços B2C" },
  { value: "ecommerce", label: "E-commerce" },
  { value: "other", label: "Outro" },
] as const;

type Vertical = (typeof VERTICALS)[number]["value"];

export default function OnboardingPage() {
  const router = useRouter();
  const createTenant = useMutation(api.tenants.createForCurrentUser);

  const [name, setName] = useState("");
  const [vertical, setVertical] = useState<Vertical>("clinic");
  const [controllerName, setControllerName] = useState("");
  const [controllerEmail, setControllerEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await createTenant({
        name,
        vertical,
        controllerName,
        controllerEmail,
      });
      router.push("/app");
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Não foi possível criar o workspace.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f9fafb] px-4 py-12">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2 font-[var(--font-outfit)] font-semibold tracking-tight text-[#0a1b33] mb-10 justify-center">
          <span className="inline-block w-7 h-7 rounded-md bg-gradient-to-br from-[#F5C344] via-[#F28482] to-[#B567C2]" />
          openbsp
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.15)] p-8">
          <h1 className="font-[var(--font-outfit)] text-[26px] font-medium tracking-tight text-[#0a1b33]">
            Set up your workspace
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            One last step before you can connect WhatsApp.
          </p>

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div>
              <label
                htmlFor="name"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Workspace name
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
                Vertical
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
                    <div>{v.label}</div>
                    {"note" in v && (
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {v.note}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label
                htmlFor="controllerName"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Data controller (RGPD)
              </label>
              <input
                id="controllerName"
                type="text"
                required
                value={controllerName}
                onChange={(e) => setControllerName(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm text-[#0a1b33] focus:outline-none focus:ring-2 focus:ring-[#0a152d]/10 focus:border-[#0a152d] transition-all"
                placeholder="Nome legal da entidade"
              />
            </div>

            <div>
              <label
                htmlFor="controllerEmail"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Controller email
              </label>
              <input
                id="controllerEmail"
                type="email"
                required
                value={controllerEmail}
                onChange={(e) => setControllerEmail(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm text-[#0a1b33] focus:outline-none focus:ring-2 focus:ring-[#0a152d]/10 focus:border-[#0a152d] transition-all"
                placeholder="dpo@clinic.pt"
              />
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
              {busy ? "Creating…" : "Create workspace →"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
