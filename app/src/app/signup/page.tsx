"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuthActions } from "@convex-dev/auth/react";

export default function SignupPage() {
  const { signIn } = useAuthActions();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn("password", { email, password, flow: "signUp" });
      router.push("/onboarding");
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Não foi possível criar a conta.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f9fafb] px-4">
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="flex items-center gap-2 font-[var(--font-outfit)] font-semibold tracking-tight text-[#0a1b33] mb-10 justify-center"
        >
          <span className="inline-block w-7 h-7 rounded-md bg-gradient-to-br from-[#F5C344] via-[#F28482] to-[#B567C2]" />
          openbsp
        </Link>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.15)] p-8">
          <h1 className="font-[var(--font-outfit)] text-[26px] font-medium tracking-tight text-[#0a1b33]">
            Create your workspace
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            Free during MVP. No credit card required.
          </p>

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div>
              <label
                htmlFor="email"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Work email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm text-[#0a1b33] focus:outline-none focus:ring-2 focus:ring-[#0a152d]/10 focus:border-[#0a152d] transition-all"
                placeholder="you@clinic.pt"
              />
            </div>
            <div>
              <label
                htmlFor="password"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm text-[#0a1b33] focus:outline-none focus:ring-2 focus:ring-[#0a152d]/10 focus:border-[#0a152d] transition-all"
                placeholder="At least 8 characters"
              />
              <p className="text-[11px] text-slate-400 mt-1.5">
                Mínimo 8 caracteres.
              </p>
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full bg-[#0a152d] text-white text-sm font-medium px-4 py-2.5 rounded-lg shadow-[0_8px_24px_-8px_rgba(10,21,45,0.5)] hover:bg-[#0a1b33] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {busy ? "Creating…" : "Create account"}
            </button>
          </form>

          <p className="text-[11px] text-slate-400 mt-4 leading-relaxed">
            Ao criar conta concordas com os Termos e a Política de Privacidade.
            DPA assinado no onboarding (obrigatório para healthcare).
          </p>

          <p className="text-center text-sm text-slate-500 mt-6">
            Already have an account?{" "}
            <Link
              href="/login"
              className="text-[#0a1b33] font-medium hover:underline"
            >
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
