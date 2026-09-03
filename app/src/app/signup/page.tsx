"use client";

import { useState, FormEvent, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { BrandLogo } from "@/components/Brand";
import { LanguageSwitcher, useI18n } from "@/lib/i18n";
import { authErrorMessage } from "@/lib/authErrorMessage";

export default function SignupPage() {
  const { locale, tr } = useI18n();
  const { signIn } = useAuthActions();
  const router = useRouter();
  const searchParams = useSearchParams();
  const acceptInvite = useMutation(api.memberInvites.accept);
  const inviteToken = searchParams.get("invite");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Persist invite token so the post-auth flow can redeem it.
  useEffect(() => {
    if (inviteToken) {
      sessionStorage.setItem("openbsp_invite_token", inviteToken);
    }
  }, [inviteToken]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn("password", { email, password, flow: "signUp" });
      const pendingToken = sessionStorage.getItem("openbsp_invite_token");
      if (pendingToken) {
        try {
          await acceptInvite({ token: pendingToken });
          sessionStorage.removeItem("openbsp_invite_token");
          router.push("/app");
          return;
        } catch {
          // Fall through to onboarding if invite redemption fails.
        }
      }
      router.push("/onboarding");
    } catch (err: unknown) {
      setError(authErrorMessage(err, locale, "signUp"));
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
            {inviteToken ? tr("Aceitar convite", "Accept invite") : tr("Criar espaço de trabalho", "Create your workspace")}
          </h1>
          <p className="text-muted text-sm mt-1">
            {inviteToken
              ? tr("Crie uma conta para entrar no espaço de trabalho para o qual recebeu convite.", "Create an account to join the workspace you were invited to.")
              : tr("Comece sem cartão de crédito.", "Start without a credit card.")}
          </p>

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div>
              <label
                htmlFor="email"
                className="block text-xs font-medium text-ink mb-1.5"
              >
                {tr("Email profissional", "Work email")}
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-line text-sm text-ink focus:outline-none focus:ring-2 focus:ring-[#0a152d]/10 focus:border-[#0a152d] transition-all"
                placeholder="you@clinic.pt"
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
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-line text-sm text-ink focus:outline-none focus:ring-2 focus:ring-[#0a152d]/10 focus:border-[#0a152d] transition-all"
                placeholder={tr("Pelo menos 8 caracteres", "At least 8 characters")}
              />
              <p className="text-[11px] text-faint mt-1.5">
                {tr("Mínimo de 8 caracteres.", "At least 8 characters.")}
              </p>
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
              {busy ? tr("A criar…", "Creating…") : tr("Criar conta", "Create account")}
            </button>
          </form>

          <p className="text-[11px] text-faint mt-4 leading-relaxed">
            {tr("Ao criar a conta, concorda com os Termos e a Política de Privacidade.", "By creating an account, you agree to the Terms and Privacy Policy.")}
          </p>

          <p className="text-center text-sm text-muted mt-6">
            {tr("Já tem uma conta?", "Already have an account?")}{" "}
            <Link
              href="/login"
              className="text-ink font-medium hover:underline"
            >
              {tr("Entrar", "Sign in")}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
