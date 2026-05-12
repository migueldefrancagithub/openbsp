"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../../../convex/_generated/api";

export default function AppDashboard() {
  const tenant = useQuery(api.tenantsQueries.getActiveOptional);
  const { signOut } = useAuthActions();
  const router = useRouter();

  useEffect(() => {
    if (tenant === null) {
      router.replace("/onboarding");
    }
  }, [tenant, router]);

  async function handleSignOut() {
    await signOut();
    router.push("/");
  }

  if (tenant === undefined || tenant === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-slate-400 text-sm">Loading workspace…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f9fafb] flex flex-col">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur sticky top-0 z-40">
        <div className="mx-auto max-w-6xl px-6 h-14 flex items-center justify-between">
          <Link
            href="/app"
            className="flex items-center gap-2 font-[var(--font-outfit)] font-semibold tracking-tight text-[#0a1b33]"
          >
            <span className="inline-block w-6 h-6 rounded-md bg-gradient-to-br from-[#F5C344] via-[#F28482] to-[#B567C2]" />
            openbsp
          </Link>
          <div className="flex items-center gap-3">
            <div className="text-xs text-slate-500 hidden sm:block">
              {tenant.name} · <span className="text-slate-400">{tenant.role}</span>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              className="px-3 py-1.5 rounded-lg text-xs text-slate-600 hover:text-[#0a1b33] hover:bg-slate-100 transition-all"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 mx-auto max-w-6xl w-full px-6 py-12">
        <div className="mb-10">
          <h1 className="font-[var(--font-outfit)] text-[32px] font-medium tracking-tight text-[#0a1b33]">
            Welcome to {tenant.name}
          </h1>
          <p className="text-slate-500 mt-1 text-sm">
            Your workspace is live. Next: connect your WhatsApp Business
            Account to start receiving messages.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { title: "Connect WhatsApp", note: "Sandbox or production WABA" },
            { title: "Invite team", note: "Roles: admin, agent, marketing" },
            {
              title: "Sign DPA",
              note: tenant.healthcareMode
                ? "Required (healthcare mode active)"
                : "Optional",
            },
            {
              title: "Complete DPIA",
              note: tenant.healthcareMode ? "Required for healthcare" : "—",
            },
            { title: "Import contacts", note: "CSV with consent proof per row" },
            { title: "Submit first template", note: "appointment_reminder pre-built" },
          ].map((step) => (
            <div
              key={step.title}
              className="bg-white rounded-2xl border border-slate-200 p-5 hover:border-slate-300 transition-all cursor-default"
            >
              <div className="font-semibold text-[#0a1b33] text-[15px]">
                {step.title}
              </div>
              <div className="text-slate-500 text-xs mt-1">{step.note}</div>
              <div className="text-[11px] text-slate-400 mt-3 uppercase tracking-wider">
                Coming next
              </div>
            </div>
          ))}
        </div>

        <div className="mt-16 p-6 rounded-2xl bg-[#0A0A0B] text-white">
          <div
            className="text-xs uppercase tracking-[0.18em] mb-3"
            style={{
              background: "linear-gradient(90deg, #FF3D77, #06B6D4, #4361EE)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              WebkitTextFillColor: "transparent",
              color: "transparent",
            }}
          >
            Workspace details
          </div>
          <pre className="text-[12px] text-slate-300 font-mono overflow-x-auto">
{JSON.stringify(tenant, null, 2)}
          </pre>
        </div>
      </main>
    </div>
  );
}
