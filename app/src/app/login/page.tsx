"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuthActions } from "@convex-dev/auth/react";
import { BrandLogo } from "@/components/Brand";
import { LanguageSwitcher, useI18n } from "@/lib/i18n";
import { authErrorMessage } from "@/lib/authErrorMessage";

export default function LoginPage() {
  const { locale, tr } = useI18n();
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
      await signIn("password", { email, password, flow: "signIn" });
      router.push("/app");
    } catch (err: unknown) {
      setError(authErrorMessage(err, locale, "signIn"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-4">
      <LanguageSwitcher compact className="absolute right-4 top-4" />
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="mb-10 flex justify-center text-ink"
        >
          <BrandLogo />
        </Link>

        <div className="rounded-lg border border-line bg-surface p-8 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.15)]">
          <h1 className="font-[var(--font-outfit)] text-[26px] font-medium tracking-tight text-ink">
            {tr("Bem-vindo de volta", "Welcome back")}
          </h1>
          <p className="text-muted text-sm mt-1">
            {tr("Entre para continuar para o seu espaço de trabalho.", "Sign in to continue to your workspace.")}
          </p>

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div>
              <label
                htmlFor="email"
                className="block text-xs font-medium text-ink mb-1.5"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-line text-sm text-ink focus:outline-none focus:ring-2 focus:ring-[#0a152d]/10 focus:border-[#0a152d] transition-all"
                placeholder="you@example.pt"
              />
            </div>
            <div>
              <label
                htmlFor="password"
                className="block text-xs font-medium text-ink mb-1.5"
              >
                {tr("Palavra-passe", "Password")}
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-line text-sm text-ink focus:outline-none focus:ring-2 focus:ring-[#0a152d]/10 focus:border-[#0a152d] transition-all"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p className="text-sm text-chip-danger-fg bg-chip-danger border border-chip-danger-fg/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full bg-nav-active text-white text-sm font-medium px-4 py-2.5 rounded-lg shadow-[0_8px_24px_-8px_rgba(10,21,45,0.5)] hover:bg-brand-solid disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {busy ? tr("A entrar…", "Signing in…") : tr("Entrar", "Sign in")}
            </button>
          </form>

          <p className="text-center text-sm text-muted mt-6">
            {tr("Ainda não tem uma conta?", "Don't have an account?")}{" "}
            <Link
              href="/signup"
              className="text-ink font-medium hover:underline"
            >
              {tr("Criar conta", "Create one")}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
