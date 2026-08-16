"use client";

import { useState, type ReactNode } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  Ban,
  Bot,
  Building2,
  CheckCircle2,
  Circle,
  Copy,
  Download,
  FileCheck2,
  Link2,
  Loader2,
  LogIn,
  MessageSquare,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/app/EmptyState";
import { SegmentedTabs } from "@/components/app/SegmentedTabs";
import { ConnectWabaForm } from "@/components/settings/ConnectWabaForm";
import { ApiKeysSection } from "@/components/settings/ApiKeysSection";
import { MembersSection } from "@/components/settings/MembersSection";
import { TeamsSection } from "@/components/settings/TeamsSection";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

type FacebookLoginResponse = {
  authResponse?: { code?: string };
  status?: string;
};

type EmbeddedSignupSessionInfo = {
  business_id?: string;
  waba_id?: string;
  waba_ids?: string[];
  phone_number_id?: string;
};

declare global {
  interface Window {
    FB?: {
      init: (options: {
        appId: string;
        autoLogAppEvents: boolean;
        xfbml: boolean;
        version: string;
      }) => void;
      login: (
        callback: (response: FacebookLoginResponse) => void,
        options: {
          config_id: string;
          response_type: "code";
          override_default_response_type: true;
          extras: { setup: Record<string, never> };
        },
      ) => void;
    };
    fbAsyncInit?: () => void;
  }
}

type AdmissionStatus =
  | "todo"
  | "in_progress"
  | "done"
  | "blocked"
  | "waived";

type AdmissionCheck = {
  key: string;
  title: string;
  group: string;
  source: "manual" | "auto" | "hybrid";
  status: AdmissionStatus;
  blocking: boolean;
  description: string;
  action: string;
  notes?: string;
};

type EvidenceResult = {
  ok: boolean;
  generatedAt: number;
  filename: string;
  summary: {
    total: number;
    ok: number;
    failed: number;
    skipped: number;
    writesEnabled: boolean;
  };
  target: {
    metaAppId: string;
    wabaId: string;
    whatsappAccountId: Id<"whatsappAccounts">;
    phoneNumberId: string;
    phoneE164: string;
    phoneDisplayName: string;
  };
  records: Array<{
    group: string;
    label: string;
    method: "GET" | "POST";
    endpoint: string;
    status: number;
    traceId: string;
    requestId: string;
    ok: boolean;
    skipped?: boolean;
  }>;
  doc: string;
};

export default function SettingsPage() {
  const tenant = useQuery(api.tenantsQueries.getActive);
  const wabaAccounts = useQuery(api.whatsappAccounts.listForTenant);
  const admission = useQuery(api.metaAdmission.readiness);
  const signupSessions = useQuery(api.embeddedSignup.listSessions);
  const quickReplies = useQuery(api.quickReplies.list);
  const setAdmissionCheck = useMutation(api.metaAdmission.setManualCheck);
  const beginEmbeddedSignup = useMutation(api.embeddedSignup.begin);
  const createSignupLaunchLink = useMutation(
    api.embeddedSignup.createLaunchLink,
  );
  const completeEmbeddedSignup = useAction(api.embeddedSignup.completeCallback);
  const runMetaEvidence = useAction(api.metaEvidence.runWhatsAppEvidence);
  const [signupBusy, setSignupBusy] = useState(false);
  const [signupNotice, setSignupNotice] = useState<string | null>(null);
  const [launchLinkBusy, setLaunchLinkBusy] = useState(false);
  const [launchLink, setLaunchLink] = useState<string | null>(null);
  const [launchLinkNotice, setLaunchLinkNotice] = useState<string | null>(null);
  const [admissionBusy, setAdmissionBusy] = useState<string | null>(null);
  const [evidenceBusy, setEvidenceBusy] = useState<Id<"whatsappAccounts"> | null>(null);
  const [evidenceResult, setEvidenceResult] = useState<EvidenceResult | null>(null);
  const [evidenceNotice, setEvidenceNotice] = useState<string | null>(null);
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(false);
  const [botEnabled, setBotEnabled] = useState(true);
  const [ecommerceEnabled, setEcommerceEnabled] = useState(false);
  const [autoReplyPeriod, setAutoReplyPeriod] = useState(3);
  const [autoReplyCode, setAutoReplyCode] = useState("");
  const [dndOnCode, setDndOnCode] = useState("");
  const [dndOffCode, setDndOffCode] = useState("");
  const [settingsTab, setSettingsTab] = useState("meta");
  if (!tenant) return null;

  const hasConnection = (wabaAccounts?.length ?? 0) > 0;
  const settingsTabs = [
    { key: "meta", label: "Meta", value: admission ? `${admission.score}% ready` : "Checking", icon: ShieldCheck },
    { key: "whatsapp", label: "WhatsApp", value: hasConnection ? "Connected" : "Setup", icon: Smartphone },
    { key: "automation", label: "Automation", value: "Rules", icon: Bot },
    { key: "team", label: "Team", value: "Members/API", icon: Users },
    { key: "workspace", label: "Workspace", value: tenant.role, icon: Building2 },
  ];

  async function handleEmbeddedSignup() {
    setSignupBusy(true);
    setSignupNotice(null);
    let removeMessageListener: (() => void) | undefined;
    try {
      const result = await beginEmbeddedSignup({});
      if (
        !result.configured ||
        !result.appId ||
        !result.configId ||
        !result.graphVersion
      ) {
        setSignupNotice(
          "Embedded Signup session created. Add META_EMBEDDED_SIGNUP_APP_ID, META_EMBEDDED_SIGNUP_CONFIG_ID, and META_EMBEDDED_SIGNUP_APP_SECRET to enable Meta v4 signup.",
        );
        return;
      }

      const sessionInfo: { current?: EmbeddedSignupSessionInfo } = {};
      const onMessage = (event: MessageEvent) => {
        if (!event.origin.endsWith("facebook.com")) return;
        try {
          const data = JSON.parse(String(event.data)) as {
            type?: string;
            event?: string;
            data?: EmbeddedSignupSessionInfo;
          };
          if (data.type === "WA_EMBEDDED_SIGNUP") {
            sessionInfo.current = data.data;
          }
        } catch {
          // Meta may also post non-JSON diagnostic strings while testing.
        }
      };
      window.addEventListener("message", onMessage);
      removeMessageListener = () =>
        window.removeEventListener("message", onMessage);

      await loadFacebookSdk(result.appId, result.graphVersion);
      if (!window.FB) throw new Error("Facebook SDK failed to initialize.");

      const response = await new Promise<FacebookLoginResponse>((resolve) => {
        window.FB!.login(resolve, {
          config_id: result.configId!,
          response_type: "code",
          override_default_response_type: true,
          extras: { setup: {} },
        });
      });
      const code = response.authResponse?.code;
      if (!code) {
        setSignupNotice(
          response.status
            ? `Meta signup did not return a code (${response.status}).`
            : "Meta signup was closed before a code was returned.",
        );
        return;
      }

      const sessionData = sessionInfo.current;
      const completion = await completeEmbeddedSignup({
        state: result.state,
        code,
        flowVersion: "v4_sdk",
        business_id: sessionData?.business_id,
        waba_id: sessionData?.waba_id ?? sessionData?.waba_ids?.[0],
        phone_number_id: sessionData?.phone_number_id,
      });
      setSignupNotice(
        completion.status === "connected"
          ? "WhatsApp connected via Embedded Signup v4."
          : completion.ok
            ? `Meta signup captured (${completion.status}).`
            : "Meta signup failed during backend onboarding.",
      );
    } catch (err) {
      setSignupNotice(
        err instanceof Error ? err.message : "Embedded Signup failed.",
      );
    } finally {
      removeMessageListener?.();
      setSignupBusy(false);
    }
  }

  async function handleCreateLaunchLink() {
    setLaunchLinkBusy(true);
    setLaunchLinkNotice(null);
    try {
      const result = await createSignupLaunchLink({
        label: "Client WhatsApp connect link",
        expiresInHours: 72,
      });
      const url = `${window.location.origin}${result.path}`;
      setLaunchLink(url);
      await navigator.clipboard.writeText(url);
      setLaunchLinkNotice(
        `Client signup link copied. It expires ${formatDate(result.expiresAt)}.`,
      );
    } catch (error) {
      setLaunchLinkNotice(
        error instanceof Error
          ? cleanError(error.message)
          : "Could not create signup link.",
      );
    } finally {
      setLaunchLinkBusy(false);
    }
  }

  async function handleAdmissionStatus(
    key: string,
    status: AdmissionStatus,
  ) {
    setAdmissionBusy(`${key}:${status}`);
    try {
      await setAdmissionCheck({ key, status });
    } finally {
      setAdmissionBusy(null);
    }
  }

  async function handleRunEvidence(
    whatsappAccountId: Id<"whatsappAccounts">,
    phoneNumberId?: Id<"phoneNumbers">,
  ) {
    setEvidenceBusy(whatsappAccountId);
    setEvidenceNotice(null);
    try {
      const result = await runMetaEvidence({
        whatsappAccountId,
        phoneNumberId,
      });
      setEvidenceResult(result);
      setEvidenceNotice(
        result.summary.failed === 0
          ? "Read-only evidence pack generated."
          : "Evidence pack generated with failed checks.",
      );
    } catch (error) {
      setEvidenceNotice(
        error instanceof Error ? error.message : "Evidence run failed.",
      );
    } finally {
      setEvidenceBusy(null);
    }
  }

  function downloadEvidence() {
    if (!evidenceResult) return;
    const blob = new Blob([evidenceResult.doc], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = evidenceResult.filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <PageHeader
        eyebrow="Workspace"
        title="Settings"
        description="Workspace and WhatsApp connection."
      />

      <div className="px-8 py-8 max-w-6xl space-y-6">
        <SegmentedTabs
          items={settingsTabs}
          selected={settingsTab}
          onChange={setSettingsTab}
        />

        {/* Workspace card */}
        {settingsTab === "workspace" && (
        <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-[#0a1b33] text-[15px]">
              Workspace
            </h2>
          </div>
          <dl className="divide-y divide-slate-100">
            <Row label="Name" value={tenant.name} />
            <Row label="Vertical" value={tenant.vertical} />
            <Row label="Tenant ID" value={tenant.tenantId} mono />
            <Row label="Your role" value={tenant.role} />
          </dl>
        </section>
        )}

        {/* WhatsApp connection */}
        {settingsTab === "meta" && (
        <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-[#0a1b33] text-[15px]">
              Coexistence readiness
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Provider-grade Meta admission, Embedded Signup, security, webhook, and COEX checks.
            </p>
          </div>
          <div className="p-6">
            {!admission ? (
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                <Loader2 size={15} className="animate-spin" />
                Loading provider readiness...
              </div>
            ) : (
              <>
                <div className="mb-5 grid gap-3 md:grid-cols-[180px_1fr]">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center gap-2 text-[12px] font-semibold uppercase text-slate-500">
                      <ShieldCheck size={14} />
                      Meta readiness
                    </div>
                    <div className="mt-3 text-4xl font-semibold text-[#0a1b33]">
                      {admission.score}%
                    </div>
                    <div className={`mt-2 inline-flex rounded-md border px-2 py-1 text-[11px] font-semibold ${readinessTone(admission.readinessLabel)}`}>
                      {admission.readinessLabel.replace(/_/g, " ")}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-[#0a1b33]">
                        {admission.blockers.length > 0 ? (
                          <AlertTriangle size={15} />
                        ) : (
                          <CheckCircle2 size={15} />
                        )}
                      </div>
                      <div>
                        <div className="text-[13px] font-semibold text-[#0a1b33]">
                          Next move
                        </div>
                        <p className="mt-1 text-sm leading-6 text-slate-500">
                          {admission.suggestedPath}
                        </p>
                        {admission.blockers.length > 0 && (
                          <div className="mt-2 text-[11px] font-mono text-slate-400">
                            Blocking: {admission.blockers.join(", ")}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {admission.checks.map((check) => (
                    <AdmissionCheckCard
                      key={check.key}
                      check={check}
                      busy={admissionBusy}
                      onSetStatus={handleAdmissionStatus}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
          <div className="border-t border-slate-100 px-6 py-4">
            <div className="mb-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-[#0a1b33]">
                    <FileCheck2 size={16} />
                  </div>
                  <div>
                    <div className="text-[13px] font-semibold text-[#0a1b33]">
                      Meta App Review evidence
                    </div>
                    <p className="mt-1 max-w-2xl text-[12px] leading-5 text-slate-500">
                      Runs read-only Graph checks against the connected WABA and returns a token-redacted pack with HTTP status, trace IDs, request IDs, and responses.
                    </p>
                  </div>
                </div>
                {evidenceResult && (
                  <button
                    type="button"
                    onClick={downloadEvidence}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px] font-medium text-slate-600 transition-colors hover:border-slate-300 hover:text-[#0a1b33]"
                  >
                    <Download size={13} />
                    Download .txt
                  </button>
                )}
              </div>

              {evidenceNotice && (
                <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                  {evidenceNotice}
                </div>
              )}

              {(wabaAccounts ?? []).length === 0 ? (
                <div className="mt-3 rounded-lg bg-white px-3 py-2 text-xs text-slate-500">
                  Connect a WABA before generating Meta evidence.
                </div>
              ) : (
                <div className="mt-3 grid gap-2">
                  {wabaAccounts!.map((account) => {
                    const primaryPhone = account.phoneNumbers[0];
                    const busy = evidenceBusy === account._id;
                    return (
                      <div
                        key={account._id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white px-3 py-3"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-[12px] font-semibold text-[#0a1b33]">
                            WABA {account.wabaId}
                          </div>
                          <div className="mt-0.5 truncate text-[11px] text-slate-500">
                            {primaryPhone
                              ? `${primaryPhone.displayName} · ${primaryPhone.e164}`
                              : "No phone number found"}
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={busy || !primaryPhone}
                          onClick={() =>
                            handleRunEvidence(account._id, primaryPhone?._id)
                          }
                          className="inline-flex items-center gap-2 rounded-lg bg-[#0a152d] px-3 py-2 text-[12px] font-medium text-white transition-all hover:bg-[#0a1b33] disabled:opacity-50"
                        >
                          {busy ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <ShieldCheck size={13} />
                          )}
                          Run read-only evidence
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {evidenceResult && (
                <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
                  <div className="grid gap-2 text-xs sm:grid-cols-4">
                    <EvidenceMetric label="OK" value={evidenceResult.summary.ok} tone="text-emerald-700" />
                    <EvidenceMetric label="Failed" value={evidenceResult.summary.failed} tone="text-red-700" />
                    <EvidenceMetric label="Skipped" value={evidenceResult.summary.skipped} tone="text-amber-700" />
                    <EvidenceMetric label="Writes" value={evidenceResult.summary.writesEnabled ? "enabled" : "off"} tone="text-slate-700" />
                  </div>
                  <div className="mt-3 max-h-64 space-y-1.5 overflow-auto pr-1">
                    {evidenceResult.records.map((record, index) => (
                      <div
                        key={`${record.label}-${index}`}
                        className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-[11px]"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium text-[#0a1b33]">
                            {record.label}
                          </span>
                          <span className={`rounded-md border px-1.5 py-0.5 font-semibold ${evidenceRecordTone(record)}`}>
                            {record.skipped ? "skipped" : record.ok ? `HTTP ${record.status}` : `HTTP ${record.status || "fail"}`}
                          </span>
                        </div>
                        {!record.skipped && (
                          <div className="mt-1 truncate font-mono text-[10px] text-slate-400">
                            trace {record.traceId || "-"} · req {record.requestId || "-"}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {signupNotice && (
              <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {signupNotice}
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[13px] font-medium text-[#0a1b33]">
                  Embedded Signup
                </div>
                <div className="text-[11px] text-slate-500">
                  Start a state-tracked Meta onboarding session when app config is present.
                </div>
              </div>
              <button
                type="button"
                onClick={handleEmbeddedSignup}
                disabled={signupBusy}
                className="inline-flex items-center gap-2 rounded-lg bg-[#0a152d] px-3 py-2 text-[12px] font-medium text-white transition-all hover:bg-[#0a1b33] disabled:opacity-50"
              >
                {signupBusy ? <Loader2 size={13} className="animate-spin" /> : <LogIn size={13} />}
                Start signup
              </button>
            </div>
            {(signupSessions ?? []).length > 0 && (
              <div className="mt-3 space-y-1.5">
                {signupSessions!.slice(0, 3).map((session) => (
                  <div
                    key={session._id}
                    className="rounded-lg bg-slate-50 px-3 py-2 text-[11px]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-slate-400">
                        {session.state.slice(0, 8)}
                      </span>
                      <span className="font-medium text-slate-600">
                        {session.status}
                      </span>
                    </div>
                    {(session.businessId ||
                      session.wabaId ||
                      session.phoneNumberId) && (
                      <div className="mt-2 grid gap-1 text-slate-500">
                        {session.businessId && (
                          <span>BM {session.businessId}</span>
                        )}
                        {session.wabaId && (
                          <span>WABA {session.wabaId}</span>
                        )}
                        {session.phoneNumberId && (
                          <span>
                            Phone {session.phoneDisplayName ?? session.phoneE164 ?? session.phoneNumberId}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-2 text-[13px] font-medium text-[#0a1b33]">
                    <Link2 size={14} className="text-slate-500" />
                    Client connect link
                  </div>
                  <div className="mt-1 text-[11px] leading-5 text-slate-500">
                    Create a 72-hour secure launcher for a client to complete
                    Embedded Signup without accessing this dashboard.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCreateLaunchLink}
                  disabled={launchLinkBusy}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px] font-medium text-[#0a1b33] transition-colors hover:border-slate-300 disabled:opacity-50"
                >
                  {launchLinkBusy ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Copy size={13} />
                  )}
                  Copy link
                </button>
              </div>
              {launchLink && (
                <div className="mt-3 break-all rounded-lg border border-slate-200 bg-white px-3 py-2 font-[var(--font-mono)] text-[11px] text-slate-600">
                  {launchLink}
                </div>
              )}
              {launchLinkNotice && (
                <div className="mt-2 text-[11px] font-medium text-slate-600">
                  {launchLinkNotice}
                </div>
              )}
            </div>
          </div>
        </section>
        )}

        {/* WhatsApp connection */}
        {settingsTab === "whatsapp" && (
        <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-semibold text-[#0a1b33] text-[15px]">
              WhatsApp Business Account
            </h2>
            {hasConnection ? (
              <span className="inline-flex items-center gap-1.5 text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md text-xs font-medium">
                <CheckCircle2 size={12} /> Connected
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md text-xs font-medium">
                Not connected
              </span>
            )}
          </div>

          <div className="px-6 py-6">
            {hasConnection ? (
              <div className="space-y-4">
                {wabaAccounts!.map((acc) => (
                  <div
                    key={acc._id}
                    className="border border-slate-200 rounded-xl p-4"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center">
                          <Smartphone size={16} className="text-emerald-600" />
                        </div>
                        <div>
                          <div className="font-medium text-[#0a1b33] text-sm">
                            WABA {acc.wabaId}
                          </div>
                          <div className="text-xs text-slate-500">
                            Status: {acc.status} · Token: {acc.tokenStatus}
                            {` · Storage: ${acc.tokenStorage}`}
                            {acc.qualityRating && ` · Quality: ${acc.qualityRating}`}
                          </div>
                        </div>
                      </div>
                    </div>
                    {acc.phoneNumbers.length > 0 && (
                      <ul className="mt-3 space-y-1.5">
                        {acc.phoneNumbers.map((p) => (
                          <li
                            key={p._id}
                            className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2 text-xs"
                          >
                            <div>
                              <span className="font-medium text-[#0a1b33]">
                                {p.displayName}
                              </span>
                              <span className="text-slate-500 ml-2">{p.e164}</span>
                              {p.qualityRating && (
                                <span className="ml-2 rounded-md bg-white px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-500">
                                  {p.qualityRating}
                                </span>
                              )}
                              {p.circuitBreakerUntil &&
                                p.circuitBreakerUntil > Date.now() && (
                                  <span className="ml-2 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                                    Circuit breaker active
                                  </span>
                                )}
                              {p.circuitBreakerReason && (
                                <div className="mt-1 text-[11px] text-amber-700">
                                  {p.circuitBreakerReason}
                                </div>
                              )}
                            </div>
                            <span className="text-slate-400 font-mono text-[10px]">
                              {p.phoneNumberId}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
                <p className="text-xs text-slate-500">
                  Connect another number using the form below.
                </p>
                <div className="border-t border-slate-100 pt-6">
                  <ConnectWabaForm />
                </div>
              </div>
            ) : (
              <div>
                <div className="flex items-start gap-4 mb-6">
                  <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0">
                    <Smartphone size={18} className="text-slate-400" />
                  </div>
                  <div className="flex-1">
                    <p className="text-[14px] text-[#0a1b33] font-medium">
                      Connect a WABA system user token
                    </p>
                    <p className="text-sm text-slate-500 mt-1">
                      We call Graph API to validate scopes (
                      <code>whatsapp_business_messaging</code>,{" "}
                      <code>whatsapp_business_management</code>,{" "}
                      <code>business_management</code>) and bind the token to
                      your WABA.
                    </p>
                  </div>
                </div>
                <ConnectWabaForm />
              </div>
            )}
          </div>
        </section>
        )}

        {settingsTab === "automation" && (
        <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-[#0a1b33] text-[15px]">
              Communication automation
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Company-wide controls for DND, delayed auto replies, bots, and ecommerce flows.
            </p>
          </div>
          <div className="grid gap-4 p-6 xl:grid-cols-2">
            <SettingsCard
              icon={MessageSquare}
              title="Auto Reply"
              body="Use a quick reply when the customer has waited longer than the selected period. When enabled, the bot should not answer that same contact automatically."
            >
              <ToggleRow
                label="Enable"
                checked={autoReplyEnabled}
                onChange={setAutoReplyEnabled}
              />
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-slate-500">
                  Period in days
                </span>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={autoReplyPeriod}
                  onChange={(event) =>
                    setAutoReplyPeriod(Number(event.target.value))
                  }
                  className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm text-[#0a1b33] outline-none focus:border-slate-400"
                />
              </label>
              <QuickReplySelect
                label="Quick Message Code"
                value={autoReplyCode}
                onChange={setAutoReplyCode}
                options={quickReplies ?? []}
              />
            </SettingsCard>

            <SettingsCard
              icon={Ban}
              title="DND"
              body='When a customer sends "STOP", pause marketing sends. "START" removes the pause and lets the system continue safely.'
            >
              <QuickReplySelect
                label="DND enabled Message Code"
                value={dndOnCode}
                onChange={setDndOnCode}
                options={quickReplies ?? []}
              />
              <QuickReplySelect
                label="DND disabled Message Code"
                value={dndOffCode}
                onChange={setDndOffCode}
                options={quickReplies ?? []}
              />
            </SettingsCard>

            <SettingsCard
              icon={Bot}
              title="Bot"
              body="Company-wide bot switch. Channel-specific rules can override this when a connected number needs human-only handling."
            >
              <ToggleRow
                label="Enable Chat Bot"
                checked={botEnabled}
                onChange={setBotEnabled}
              />
            </SettingsCard>

            <SettingsCard
              icon={ShoppingBag}
              title="Ecommerce"
              body="Prepare catalog, cart recovery, and order-status conversations for shops that sell through WhatsApp."
            >
              <ToggleRow
                label="Enable Ecommerce"
                checked={ecommerceEnabled}
                onChange={setEcommerceEnabled}
              />
            </SettingsCard>
          </div>
        </section>
        )}

        {settingsTab === "team" && (
          <div className="space-y-6">
            <MembersSection />

            <TeamsSection />

            <ApiKeysSection />
          </div>
        )}
      </div>
    </>
  );
}

function AdmissionCheckCard({
  check,
  busy,
  onSetStatus,
}: {
  check: AdmissionCheck;
  busy: string | null;
  onSetStatus: (key: string, status: AdmissionStatus) => Promise<void>;
}) {
  const manual = check.source !== "auto";
  const isBusy = busy?.startsWith(`${check.key}:`) ?? false;
  const StatusIcon =
    check.status === "done" || check.status === "waived"
      ? CheckCircle2
      : check.status === "blocked"
        ? AlertTriangle
        : check.status === "in_progress"
          ? Loader2
          : Circle;

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex gap-3">
        <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-white ${statusIconTone(check.status)}`}>
          <StatusIcon
            size={14}
            className={check.status === "in_progress" ? "animate-spin" : ""}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-[13px] font-medium text-[#0a1b33]">
              {check.title}
            </div>
            <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${statusBadgeTone(check.status)}`}>
              {statusLabel(check.status)}
            </span>
            {check.blocking && check.status !== "done" && check.status !== "waived" && (
              <span className="rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                Required
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[11px] font-medium uppercase text-slate-400">
            {groupLabel(check.group)} · {check.source}
          </div>
          <p className="mt-2 text-[12px] leading-5 text-slate-600">
            {check.description}
          </p>
          <p className="mt-1 text-[11px] leading-5 text-slate-500">
            {check.notes ?? check.action}
          </p>
          {manual && (
            <div className="mt-3 flex flex-wrap gap-2">
              <AdmissionButton
                disabled={isBusy || check.status === "done"}
                onClick={() => onSetStatus(check.key, "done")}
              >
                Done
              </AdmissionButton>
              <AdmissionButton
                disabled={isBusy || check.status === "in_progress"}
                onClick={() => onSetStatus(check.key, "in_progress")}
              >
                In progress
              </AdmissionButton>
              <AdmissionButton
                disabled={isBusy || check.status === "blocked"}
                onClick={() => onSetStatus(check.key, "blocked")}
              >
                Blocked
              </AdmissionButton>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EvidenceMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone: string;
}) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase text-slate-400">
        {label}
      </div>
      <div className={`mt-1 text-sm font-semibold ${tone}`}>{value}</div>
    </div>
  );
}

function evidenceRecordTone(record: { ok: boolean; skipped?: boolean }): string {
  if (record.skipped) return "border-amber-200 bg-amber-50 text-amber-700";
  if (record.ok) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-red-200 bg-red-50 text-red-700";
}

function AdmissionButton({
  disabled,
  onClick,
  children,
}: {
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:border-slate-300 hover:text-[#0a1b33] disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function readinessTone(label: string): string {
  if (label === "live_ready" || label === "review_ready") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (label === "blocked") {
    return "border-red-200 bg-red-50 text-red-700";
  }
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function statusIconTone(status: AdmissionStatus): string {
  if (status === "done" || status === "waived") {
    return "border-emerald-200 text-emerald-600";
  }
  if (status === "blocked") return "border-red-200 text-red-600";
  if (status === "in_progress") return "border-sky-200 text-sky-600";
  return "border-slate-200 text-slate-400";
}

function statusBadgeTone(status: AdmissionStatus): string {
  if (status === "done" || status === "waived") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "blocked") return "border-red-200 bg-red-50 text-red-700";
  if (status === "in_progress") {
    return "border-sky-200 bg-sky-50 text-sky-700";
  }
  return "border-slate-200 bg-white text-slate-500";
}

function statusLabel(status: AdmissionStatus): string {
  return status.replace(/_/g, " ");
}

function groupLabel(group: string): string {
  return group.replace(/_/g, " ");
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="px-6 py-3.5 grid grid-cols-3 gap-4 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd
        className={
          mono
            ? "col-span-2 text-slate-500 font-mono text-xs"
            : "col-span-2 text-[#0a1b33] font-medium capitalize"
        }
      >
        {value}
      </dd>
    </div>
  );
}

function SettingsCard({
  icon: Icon,
  title,
  body,
  children,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[#0a1b33]">
          <Icon size={16} />
        </span>
        <div>
          <h3 className="font-[var(--font-outfit)] text-xl font-semibold text-[#0a1b33]">
            {title}
          </h3>
          <p className="mt-1 text-sm leading-6 text-slate-500">{body}</p>
        </div>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-[#0a1b33]">
      {label}
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-violet-600"
      />
    </label>
  );
}

function QuickReplySelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ _id: string; name: string }>;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-slate-500">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-[#0a1b33] outline-none focus:border-slate-400"
      >
        <option value="">Select Quick Message Code</option>
        {options.map((reply) => (
          <option key={reply._id} value={reply.name}>
            {reply.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function formatDate(value: number) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function cleanError(value: string) {
  return value.replace(/^.*ConvexError:\s*/i, "").trim();
}

function loadFacebookSdk(appId: string, graphVersion: string): Promise<void> {
  if (window.FB) {
    window.FB.init({
      appId,
      autoLogAppEvents: true,
      xfbml: true,
      version: graphVersion,
    });
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const existing = document.getElementById("facebook-jssdk");
    window.fbAsyncInit = () => {
      window.FB?.init({
        appId,
        autoLogAppEvents: true,
        xfbml: true,
        version: graphVersion,
      });
      resolve();
    };
    if (existing) return;

    const script = document.createElement("script");
    script.id = "facebook-jssdk";
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    script.onerror = () => reject(new Error("Failed to load Facebook SDK."));
    document.body.appendChild(script);
  });
}
