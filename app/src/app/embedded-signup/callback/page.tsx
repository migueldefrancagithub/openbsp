"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAction } from "convex/react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { api } from "../../../../convex/_generated/api";

export default function EmbeddedSignupCallbackPage() {
  const searchParams = useSearchParams();
  const completeCallback = useAction(api.embeddedSignup.completeCallback);
  const [status, setStatus] = useState<"loading" | "success" | "error">(
    "loading",
  );
  const [message, setMessage] = useState("Completing Meta signup...");

  const payload = useMemo(
    () => ({
      state: searchParams.get("state") ?? "",
      code: searchParams.get("code") ?? undefined,
      error:
        searchParams.get("error_description") ??
        searchParams.get("error") ??
        undefined,
      business_id: searchParams.get("business_id") ?? undefined,
      waba_id: searchParams.get("waba_id") ?? undefined,
      phone_number_id: searchParams.get("phone_number_id") ?? undefined,
      phone_e164: searchParams.get("phone_e164") ?? undefined,
      phone_display_name: searchParams.get("phone_display_name") ?? undefined,
      flowVersion: "oauth_redirect" as const,
    }),
    [searchParams],
  );

  useEffect(() => {
    let active = true;
    async function complete() {
      if (!payload.state) {
        setStatus("error");
        setMessage("Missing Meta signup state.");
        return;
      }
      try {
        const result = await completeCallback(payload);
        if (!active) return;
        setStatus(result.ok ? "success" : "error");
        setMessage(
          result.status === "connected"
            ? "WhatsApp connected. You can close this window."
            : result.ok
              ? "Meta callback received."
              : "Meta signup failed.",
        );
      } catch (err) {
        if (!active) return;
        setStatus("error");
        setMessage(err instanceof Error ? err.message : "Meta signup failed.");
      }
    }
    void complete();
    return () => {
      active = false;
    };
  }, [completeCallback, payload]);

  const Icon =
    status === "loading" ? Loader2 : status === "success" ? CheckCircle2 : XCircle;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <section className="w-full max-w-md rounded-2xl border border-line bg-surface p-8 text-center shadow-sm">
        <Icon
          size={30}
          className={`mx-auto ${
            status === "loading"
              ? "animate-spin text-faint"
              : status === "success"
                ? "text-emerald-600"
                : "text-chip-danger-fg"
          }`}
        />
        <h1 className="mt-4 font-[var(--font-outfit)] text-2xl font-medium text-ink">
          Embedded Signup
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted">{message}</p>
        <Link
          href="/app/settings"
          className="mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-nav-active px-4 text-sm font-medium text-white hover:bg-[#0e1f41]"
        >
          Back to Settings
        </Link>
      </section>
    </main>
  );
}
