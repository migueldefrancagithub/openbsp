"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useMutation } from "convex/react";
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  ShieldCheck,
  Smartphone,
  XCircle,
} from "lucide-react";
import { api } from "../../../../../convex/_generated/api";

type LauncherState =
  | { status: "idle"; message: string }
  | { status: "loading"; message: string }
  | { status: "ready"; message: string }
  | { status: "error"; message: string };

export default function WhatsAppConnectLauncherPage() {
  const params = useParams<{ token: string }>();
  const beginFromLaunchToken = useMutation(
    api.embeddedSignup.beginFromLaunchToken,
  );
  const [state, setState] = useState<LauncherState>({
    status: "idle",
    message: "Connect your WhatsApp Business number to OpenBSP.",
  });

  const token = params.token;

  async function handleStart() {
    if (!token) {
      setState({
        status: "error",
        message: "This signup link is missing its secure token.",
      });
      return;
    }
    setState({
      status: "loading",
      message: "Preparing a secure Meta signup session...",
    });
    try {
      const result = await beginFromLaunchToken({ token });
      if (!result.configured) {
        setState({
          status: "error",
          message:
            "OpenBSP is not configured for Meta Embedded Signup yet. Ask the workspace admin to finish Meta app settings.",
        });
        return;
      }
      if (!result.url) {
        setState({
          status: "error",
          message:
            "Meta redirect URI is missing. Ask the workspace admin to configure META_EMBEDDED_SIGNUP_REDIRECT_URI.",
        });
        return;
      }
      setState({
        status: "ready",
        message: `Redirecting to Meta for ${result.tenantName}...`,
      });
      window.location.assign(result.url);
    } catch (error) {
      setState({
        status: "error",
        message: cleanError(
          error instanceof Error ? error.message : "Could not start signup.",
        ),
      });
    }
  }

  const Icon =
    state.status === "error"
      ? XCircle
      : state.status === "ready"
        ? CheckCircle2
        : state.status === "loading"
          ? Loader2
          : ShieldCheck;

  return (
    <main className="min-h-screen bg-background px-4 py-10 text-ink">
      <section className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-lg flex-col justify-center">
        <div className="rounded-3xl border border-line bg-surface p-8 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-nav-active text-white">
              <Smartphone size={22} />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
                WhatsApp Business
              </p>
              <h1 className="font-[var(--font-outfit)] text-2xl font-semibold">
                Connect to OpenBSP
              </h1>
            </div>
          </div>

          <div className="mt-8 rounded-2xl border border-line-soft bg-surface-2 p-5">
            <Icon
              size={24}
              className={`${
                state.status === "error"
                  ? "text-chip-danger-fg"
                  : state.status === "ready"
                    ? "text-emerald-600"
                    : state.status === "loading"
                      ? "animate-spin text-muted"
                      : "text-emerald-600"
              }`}
            />
            <p className="mt-3 text-sm leading-6 text-body">
              {state.message}
            </p>
          </div>

          <div className="mt-6 space-y-3 text-sm leading-6 text-body">
            <p>
              Use the Facebook account that manages the client business and keep
              the same WhatsApp Business app number selected.
            </p>
            <p>
              OpenBSP will verify the WABA and phone number server-side before
              storing any connection.
            </p>
          </div>

          <button
            type="button"
            onClick={handleStart}
            disabled={state.status === "loading" || state.status === "ready"}
            className="mt-8 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-nav-active px-4 text-sm font-semibold text-white transition-colors hover:bg-[#0e1f41] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {state.status === "loading" || state.status === "ready" ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <ExternalLink size={16} />
            )}
            Continue with Facebook
          </button>

          <p className="mt-4 text-center text-xs leading-5 text-faint">
            This secure link can only start signup for the workspace that issued
            it.
          </p>
        </div>
      </section>
    </main>
  );
}

function cleanError(value: string) {
  return value.replace(/^.*ConvexError:\s*/i, "").trim();
}
