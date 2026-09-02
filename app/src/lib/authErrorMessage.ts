import type { Locale } from "@/lib/i18n";

type AuthFlow = "signIn" | "signUp";

export function authErrorMessage(error: unknown, locale: Locale, flow: AuthFlow) {
  const source = error instanceof Error ? error.message.toLowerCase() : "";
  const pt = locale === "pt";

  if (source.includes("already") || source.includes("exists")) {
    return pt
      ? "Já existe uma conta com este email. Entre com a sua palavra-passe."
      : "An account already exists for this email. Sign in with your password.";
  }

  if (source.includes("invalid") || source.includes("credential")) {
    return pt ? "Email ou palavra-passe incorretos." : "Incorrect email or password.";
  }

  if (source.includes("rate") || source.includes("too many")) {
    return pt
      ? "Foram feitas demasiadas tentativas. Aguarde um momento e tente novamente."
      : "Too many attempts. Wait a moment and try again.";
  }

  if (flow === "signUp") {
    return pt
      ? "Não foi possível criar a conta agora. Tente novamente."
      : "Could not create the account right now. Try again.";
  }

  return pt ? "Não foi possível entrar agora. Tente novamente." : "Could not sign in right now. Try again.";
}
