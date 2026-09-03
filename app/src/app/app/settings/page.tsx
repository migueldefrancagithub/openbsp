"use client";

import { type ReactNode, useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  Webhook,
  Stethoscope,
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
import { ComplianceSection } from "@/components/settings/ComplianceSection";
import { IaSolutionHubSection } from "@/components/settings/IaSolutionHubSection";
import { CustomFieldsSettingsSection } from "@/components/settings/CustomFieldsSettingsSection";
import { ClinicSettingsSection } from "@/components/settings/ClinicSettingsSection";
import { AiSettingsSection } from "@/components/settings/AiSettingsSection";
import { IntegrationsSection } from "@/components/settings/IntegrationsSection";
import { AssignmentRulesSection } from "@/components/settings/AssignmentRulesSection";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useI18n, type Locale } from "@/lib/i18n";
import {
  channelStateLabel,
  roleLabel,
  signupStateLabel,
  tokenStateLabel,
  verticalLabel,
} from "@/lib/operationalLabels";

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
  const { locale, tr } = useI18n();
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
  // Deep links (e.g. the inbox pilot banner) open a specific tab. Read the
  // query string after mount so this client page needs no Suspense boundary.
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    if (requested && ["meta", "whatsapp", "automation", "team", "workspace"].includes(requested)) {
      setSettingsTab(requested);
    }
  }, []);
  if (!tenant) return null;

  const hasConnection = (wabaAccounts?.length ?? 0) > 0;
  const settingsTabs = [
    { key: "meta", label: "Meta", value: admission ? `${admission.score}% ${tr("pronto", "ready")}` : tr("A verificar", "Checking"), icon: ShieldCheck },
    { key: "whatsapp", label: "WhatsApp", value: hasConnection ? tr("Ligado", "Connected") : tr("Configurar", "Setup"), icon: Smartphone },
    { key: "automation", label: tr("Automação", "Automation"), value: tr("Regras", "Rules"), icon: Bot },
    { key: "team", label: tr("Equipa", "Team"), value: tr("Membros/API", "Members/API"), icon: Users },
    { key: "clinic", label: tr("Clínica", "Clinic"), value: tr("Agenda/SLAs", "Calendar/SLAs"), icon: Stethoscope },
    { key: "ai", label: tr("IA", "AI"), value: tr("Provedor/chaves", "Provider/keys"), icon: Bot },
    { key: "integrations", label: tr("Integrações", "Integrations"), value: "Webhooks/API", icon: Webhook },
    { key: "workspace", label: tr("Espaço", "Workspace"), value: roleLabel(tenant.role, locale), icon: Building2 },
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
          tr(
            "Sessão de cadastro criada. Adicione META_EMBEDDED_SIGNUP_APP_ID, META_EMBEDDED_SIGNUP_CONFIG_ID e META_EMBEDDED_SIGNUP_APP_SECRET para ativar o cadastro Meta v4.",
            "Embedded Signup session created. Add META_EMBEDDED_SIGNUP_APP_ID, META_EMBEDDED_SIGNUP_CONFIG_ID, and META_EMBEDDED_SIGNUP_APP_SECRET to enable Meta v4 signup.",
          ),
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
      if (!window.FB) throw new Error(tr("Não foi possível iniciar o SDK do Facebook.", "Facebook SDK failed to initialize."));

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
            ? tr(`O cadastro Meta não devolveu um código (${response.status}).`, `Meta signup did not return a code (${response.status}).`)
            : tr("O cadastro Meta foi fechado antes de devolver um código.", "Meta signup was closed before a code was returned."),
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
          ? tr("WhatsApp ligado pelo Cadastro Incorporado v4.", "WhatsApp connected via Embedded Signup v4.")
          : completion.ok
            ? tr(`Cadastro Meta recebido (${completion.status}).`, `Meta signup captured (${completion.status}).`)
            : tr("O cadastro Meta falhou durante a configuração no servidor.", "Meta signup failed during backend onboarding."),
      );
    } catch (err) {
      setSignupNotice(
        err instanceof Error ? err.message : tr("O cadastro Meta falhou.", "Embedded Signup failed."),
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
        tr(
          `Link de ligação copiado. Expira em ${formatDate(result.expiresAt, locale)}.`,
          `Client signup link copied. It expires ${formatDate(result.expiresAt, locale)}.`,
        ),
      );
    } catch (error) {
      setLaunchLinkNotice(
        error instanceof Error
          ? cleanError(error.message)
          : tr("Não foi possível criar o link de ligação.", "Could not create signup link."),
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
          ? tr("Pacote de evidências de leitura gerado.", "Read-only evidence pack generated.")
          : tr("Pacote de evidências gerado com verificações falhadas.", "Evidence pack generated with failed checks."),
      );
    } catch (error) {
      setEvidenceNotice(
        error instanceof Error ? error.message : tr("A verificação de evidências falhou.", "Evidence run failed."),
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
        eyebrow={tr("Administração", "Administration")}
        title={tr("Configurações", "Settings")}
        description={tr("Espaço de trabalho, equipa, automações e ligações WhatsApp.", "Workspace, team, automation and WhatsApp connections.")}
      />

      <div className="max-w-6xl space-y-6 px-4 py-5 sm:px-6 sm:py-6">
        <SegmentedTabs
          items={settingsTabs}
          selected={settingsTab}
          onChange={setSettingsTab}
        />

        {/* Workspace card */}
        {settingsTab === "clinic" && <ClinicSettingsSection />}
        {settingsTab === "ai" && <AiSettingsSection />}
        {settingsTab === "integrations" && <IntegrationsSection />}
        {settingsTab === "workspace" && <CustomFieldsSettingsSection />}
        {settingsTab === "workspace" && (
        <section className="overflow-hidden rounded-lg border border-line bg-surface">
          <div className="px-6 py-4 border-b border-line-soft">
            <h2 className="font-semibold text-ink text-[15px]">
              {tr("Espaço de trabalho", "Workspace")}
            </h2>
          </div>
          <dl className="divide-y divide-line-soft">
            <Row label={tr("Nome", "Name")} value={tenant.name} />
            <Row label={tr("Área", "Vertical")} value={verticalLabel(tenant.vertical, locale)} />
            <Row label={tr("ID da organização", "Tenant ID")} value={tenant.tenantId} mono />
            <Row label={tr("A sua função", "Your role")} value={roleLabel(tenant.role, locale)} />
          </dl>
        </section>
        )}

        {/* WhatsApp connection */}
        {settingsTab === "meta" && (
        <section className="overflow-hidden rounded-lg border border-line bg-surface">
          <div className="px-6 py-4 border-b border-line-soft">
            <h2 className="font-semibold text-ink text-[15px]">
              {tr("Preparação da ligação Meta", "Meta connection readiness")}
            </h2>
            <p className="text-xs text-muted mt-0.5">
              {tr("Verificações de cadastro, segurança, webhook e coexistência exigidas pela Meta.", "Provider-grade Meta admission, Embedded Signup, security, webhook, and coexistence checks.")}
            </p>
          </div>
          <div className="p-6">
            {!admission ? (
              <div className="flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-4 py-5 text-sm text-muted">
                <Loader2 size={15} className="animate-spin" />
                {tr("A verificar requisitos da Meta...", "Loading provider readiness...")}
              </div>
            ) : (
              <>
                <div className="mb-5 grid gap-3 md:grid-cols-[180px_1fr]">
                  <div className="rounded-xl border border-line bg-surface-2 p-4">
                    <div className="flex items-center gap-2 text-[12px] font-semibold uppercase text-muted">
                      <ShieldCheck size={14} />
                      {tr("Preparação Meta", "Meta readiness")}
                    </div>
                    <div className="mt-3 text-4xl font-semibold text-ink">
                      {admission.score}%
                    </div>
                    <div className={`mt-2 inline-flex rounded-md border px-2 py-1 text-[11px] font-semibold ${readinessTone(admission.readinessLabel)}`}>
                      {admission.readinessLabel.replace(/_/g, " ")}
                    </div>
                  </div>
                  <div className="rounded-xl border border-line bg-surface p-4">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-surface-3 text-ink">
                        {admission.blockers.length > 0 ? (
                          <AlertTriangle size={15} />
                        ) : (
                          <CheckCircle2 size={15} />
                        )}
                      </div>
                      <div>
                        <div className="text-[13px] font-semibold text-ink">
                          {tr("Próximo passo", "Next move")}
                        </div>
                        <p className="mt-1 text-sm leading-6 text-muted">
                          {admission.suggestedPath}
                        </p>
                        {admission.blockers.length > 0 && (
                          <div className="mt-2 text-[11px] font-mono text-faint">
                            {tr("Bloqueios", "Blocking")}: {admission.blockers.join(", ")}
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
          <div className="border-t border-line-soft px-6 py-4">
            <div className="mb-5 rounded-xl border border-line bg-surface-2 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface text-ink">
                    <FileCheck2 size={16} />
                  </div>
                  <div>
                    <div className="text-[13px] font-semibold text-ink">
                      {tr("Evidências para revisão da Meta", "Meta App Review evidence")}
                    </div>
                    <p className="mt-1 max-w-2xl text-[12px] leading-5 text-muted">
                      {tr("Executa verificações apenas de leitura na WABA ligada e gera um relatório sem tokens, com estados HTTP e identificadores de diagnóstico.", "Runs read-only Graph checks against the connected WABA and returns a token-redacted pack with HTTP status and diagnostic IDs.")}
                    </p>
                  </div>
                </div>
                {evidenceResult && (
                  <button
                    type="button"
                    onClick={downloadEvidence}
                    className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-[12px] font-medium text-body transition-colors hover:border-line hover:text-ink"
                  >
                    <Download size={13} />
                    {tr("Descarregar .txt", "Download .txt")}
                  </button>
                )}
              </div>

              {evidenceNotice && (
                <div className="mt-3 rounded-lg border border-line bg-surface px-3 py-2 text-xs text-body">
                  {evidenceNotice}
                </div>
              )}

              {(wabaAccounts ?? []).length === 0 ? (
                <div className="mt-3 rounded-lg bg-surface px-3 py-2 text-xs text-muted">
                  {tr("Ligue uma WABA antes de gerar evidências para a Meta.", "Connect a WABA before generating Meta evidence.")}
                </div>
              ) : (
                <div className="mt-3 grid gap-2">
                  {wabaAccounts!.map((account) => {
                    const primaryPhone = account.phoneNumbers[0];
                    const busy = evidenceBusy === account._id;
                    return (
                      <div
                        key={account._id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface px-3 py-3"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-[12px] font-semibold text-ink">
                            WABA {account.wabaId}
                          </div>
                          <div className="mt-0.5 truncate text-[11px] text-muted">
                            {primaryPhone
                              ? `${primaryPhone.displayName} · ${primaryPhone.e164}`
                              : tr("Nenhum número encontrado", "No phone number found")}
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={busy || !primaryPhone}
                          onClick={() =>
                            handleRunEvidence(account._id, primaryPhone?._id)
                          }
                          className="inline-flex items-center gap-2 rounded-lg bg-nav-active px-3 py-2 text-[12px] font-medium text-white transition-all hover:bg-brand-solid disabled:opacity-50"
                        >
                          {busy ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <ShieldCheck size={13} />
                          )}
                          {tr("Executar verificação", "Run read-only evidence")}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {evidenceResult && (
                <div className="mt-4 rounded-xl border border-line bg-surface p-3">
                  <div className="grid gap-2 text-xs sm:grid-cols-4">
                    <EvidenceMetric label="OK" value={evidenceResult.summary.ok} tone="text-chip-success-fg" />
                    <EvidenceMetric label={tr("Falharam", "Failed")} value={evidenceResult.summary.failed} tone="text-chip-danger-fg" />
                    <EvidenceMetric label={tr("Ignoradas", "Skipped")} value={evidenceResult.summary.skipped} tone="text-chip-warn-fg" />
                    <EvidenceMetric label={tr("Escritas", "Writes")} value={evidenceResult.summary.writesEnabled ? tr("ativas", "enabled") : tr("desligadas", "off")} tone="text-ink" />
                  </div>
                  <div className="mt-3 max-h-64 space-y-1.5 overflow-auto pr-1">
                    {evidenceResult.records.map((record, index) => (
                      <div
                        key={`${record.label}-${index}`}
                        className="rounded-lg border border-line-soft bg-surface-2 px-3 py-2 text-[11px]"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium text-ink">
                            {record.label}
                          </span>
                          <span className={`rounded-md border px-1.5 py-0.5 font-semibold ${evidenceRecordTone(record)}`}>
                            {record.skipped ? tr("ignorado", "skipped") : record.ok ? `HTTP ${record.status}` : `HTTP ${record.status || tr("falha", "fail")}`}
                          </span>
                        </div>
                        {!record.skipped && (
                          <div className="mt-1 truncate font-mono text-[10px] text-faint">
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
              <div className="mb-3 rounded-lg border border-chip-warn-fg/25 bg-chip-warn px-3 py-2 text-xs text-chip-warn-fg">
                {signupNotice}
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[13px] font-medium text-ink">
                  {tr("Cadastro incorporado", "Embedded Signup")}
                </div>
                <div className="text-[11px] text-muted">
                  {tr("Inicie uma sessão segura de ligação à Meta quando a app estiver configurada.", "Start a state-tracked Meta onboarding session when app config is present.")}
                </div>
              </div>
              <button
                type="button"
                onClick={handleEmbeddedSignup}
                disabled={signupBusy}
                className="inline-flex items-center gap-2 rounded-lg bg-nav-active px-3 py-2 text-[12px] font-medium text-white transition-all hover:bg-brand-solid disabled:opacity-50"
              >
                {signupBusy ? <Loader2 size={13} className="animate-spin" /> : <LogIn size={13} />}
                {tr("Iniciar cadastro", "Start signup")}
              </button>
            </div>
            {(signupSessions ?? []).length > 0 && (
              <div className="mt-3 space-y-1.5">
                {signupSessions!.slice(0, 3).map((session) => (
                  <div
                    key={session._id}
                    className="rounded-lg bg-surface-2 px-3 py-2 text-[11px]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-faint">
                        {session.state.slice(0, 8)}
                      </span>
                      <span className="font-medium text-body">
                        {signupStateLabel(session.status, locale)}
                      </span>
                    </div>
                    {(session.businessId ||
                      session.wabaId ||
                      session.phoneNumberId) && (
                      <div className="mt-2 grid gap-1 text-muted">
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
            <div className="mt-4 rounded-xl border border-line bg-surface-2 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-2 text-[13px] font-medium text-ink">
                    <Link2 size={14} className="text-muted" />
                    {tr("Link de ligação do cliente", "Client connect link")}
                  </div>
                  <div className="mt-1 text-[11px] leading-5 text-muted">
                    {tr("Crie um link seguro de 72 horas para o cliente concluir a ligação sem aceder a este painel.", "Create a secure 72-hour link for a client to complete Embedded Signup without accessing this dashboard.")}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCreateLaunchLink}
                  disabled={launchLinkBusy}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-[12px] font-medium text-ink transition-colors hover:border-line disabled:opacity-50"
                >
                  {launchLinkBusy ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Copy size={13} />
                  )}
                  {tr("Copiar link", "Copy link")}
                </button>
              </div>
              {launchLink && (
                <div className="mt-3 break-all rounded-lg border border-line bg-surface px-3 py-2 font-[var(--font-mono)] text-[11px] text-body">
                  {launchLink}
                </div>
              )}
              {launchLinkNotice && (
                <div className="mt-2 text-[11px] font-medium text-body">
                  {launchLinkNotice}
                </div>
              )}
            </div>
          </div>
        </section>
        )}

        {/* WhatsApp connection */}
        {settingsTab === "whatsapp" && (
        <section className="overflow-hidden rounded-lg border border-line bg-surface">
          <div className="px-6 py-4 border-b border-line-soft flex items-center justify-between">
            <h2 className="font-semibold text-ink text-[15px]">
              WhatsApp Business Account
            </h2>
            {hasConnection ? (
              <span className="inline-flex items-center gap-1.5 text-chip-success-fg bg-chip-success border border-chip-success-fg/25 px-2 py-0.5 rounded-md text-xs font-medium">
                <CheckCircle2 size={12} /> {tr("Ligado", "Connected")}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-chip-warn-fg bg-chip-warn border border-chip-warn-fg/25 px-2 py-0.5 rounded-md text-xs font-medium">
                {tr("Não ligado", "Not connected")}
              </span>
            )}
          </div>

          <div className="px-6 py-6">
            {hasConnection ? (
              <div className="space-y-4">
                {wabaAccounts!.map((acc) => (
                  <div
                    key={acc._id}
                    className="border border-line rounded-xl p-4"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-chip-success flex items-center justify-center">
                          <Smartphone size={16} className="text-emerald-600" />
                        </div>
                        <div>
                          <div className="font-medium text-ink text-sm">
                            WABA {acc.wabaId}
                          </div>
                          <div className="text-xs text-muted">
                            {tr("Estado", "Status")}: {channelStateLabel(acc.status, locale)} · Token: {tokenStateLabel(acc.tokenStatus, locale)}
                            {` · ${tr("Armazenamento", "Storage")}: ${tokenStateLabel(acc.tokenStorage, locale)}`}
                            {acc.qualityRating && ` · ${tr("Qualidade", "Quality")}: ${acc.qualityRating}`}
                          </div>
                        </div>
                      </div>
                    </div>
                    {acc.phoneNumbers.length > 0 && (
                      <ul className="mt-3 space-y-1.5">
                        {acc.phoneNumbers.map((p) => (
                          <li
                            key={p._id}
                            className="flex items-center justify-between bg-surface-2 rounded-lg px-3 py-2 text-xs"
                          >
                            <div>
                              <span className="font-medium text-ink">
                                {p.displayName}
                              </span>
                              <span className="text-muted ml-2">{p.e164}</span>
                              {p.qualityRating && (
                                <span className="ml-2 rounded-md bg-surface px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted">
                                  {p.qualityRating}
                                </span>
                              )}
                              {p.circuitBreakerUntil &&
                                p.circuitBreakerUntil > Date.now() && (
                                  <span className="ml-2 rounded-md border border-chip-warn-fg/25 bg-chip-warn px-1.5 py-0.5 text-[10px] font-medium text-chip-warn-fg">
                                    {tr("Proteção temporária ativa", "Circuit breaker active")}
                                  </span>
                                )}
                              {p.circuitBreakerReason && (
                                <div className="mt-1 text-[11px] text-chip-warn-fg">
                                  {p.circuitBreakerReason}
                                </div>
                              )}
                            </div>
                            <span className="text-faint font-mono text-[10px]">
                              {p.phoneNumberId}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
                <p className="text-xs text-muted">
                  {tr("Ligue outro número usando o formulário abaixo.", "Connect another number using the form below.")}
                </p>
                <div className="border-t border-line-soft pt-6">
                  <ConnectWabaForm />
                </div>
              </div>
            ) : (
              <div>
                <div className="flex items-start gap-4 mb-6">
                  <div className="w-10 h-10 rounded-xl bg-surface-3 flex items-center justify-center flex-shrink-0">
                    <Smartphone size={18} className="text-faint" />
                  </div>
                  <div className="flex-1">
                    <p className="text-[14px] text-ink font-medium">
                      {tr("Ligar token de utilizador de sistema WABA", "Connect a WABA system user token")}
                    </p>
                    <p className="text-sm text-muted mt-1">
                      {tr("Usamos a Graph API para validar as permissões", "We use Graph API to validate scopes")} (
                      <code>whatsapp_business_messaging</code>,{" "}
                      <code>whatsapp_business_management</code>,{" "}
                      <code>business_management</code>) {tr("e associar o token à sua WABA.", "and bind the token to your WABA.")}
                    </p>
                  </div>
                </div>
                <ConnectWabaForm />
              </div>
            )}
          </div>
        </section>
        )}

        {settingsTab === "whatsapp" && (
          <div className="space-y-4">
            {/* Connecting any channel is gated on this, so it comes first. */}
            <ComplianceSection />
            <IaSolutionHubSection />
          </div>
        )}

        {settingsTab === "automation" && (
        <section className="overflow-hidden rounded-lg border border-line bg-surface">
          <div className="px-6 py-4 border-b border-line-soft">
            <h2 className="font-semibold text-ink text-[15px]">
              {tr("Automação de atendimento", "Communication automation")}
            </h2>
            <p className="text-xs text-muted mt-0.5">
              {tr("Regras gerais para opt-out, respostas automáticas, agentes e fluxos de atendimento.", "Workspace-wide rules for opt-out, delayed replies, agents and service flows.")}
            </p>
          </div>
          <div className="grid gap-4 p-6 xl:grid-cols-2">
            <SettingsCard
              icon={MessageSquare}
              title={tr("Resposta automática", "Auto Reply")}
              body={tr("Use uma resposta rápida quando o paciente esperar mais do que o período definido. O agente não deve responder ao mesmo contacto em duplicado.", "Use a quick reply when the patient has waited longer than the selected period. The agent must not reply to the same contact twice.")}
            >
              <ToggleRow
                label={tr("Ativar", "Enable")}
                checked={autoReplyEnabled}
                onChange={setAutoReplyEnabled}
              />
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-muted">
                  {tr("Período em dias", "Period in days")}
                </span>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={autoReplyPeriod}
                  onChange={(event) =>
                    setAutoReplyPeriod(Number(event.target.value))
                  }
                  className="h-10 w-full rounded-lg border border-line px-3 text-sm text-ink outline-none focus:border-brand-solid/40"
                />
              </label>
              <QuickReplySelect
                label={tr("Resposta rápida", "Quick reply")}
                value={autoReplyCode}
                onChange={setAutoReplyCode}
                options={quickReplies ?? []}
              />
            </SettingsCard>

            <SettingsCard
              icon={Ban}
              title="DND"
              body={tr('Quando o paciente envia "STOP", as mensagens de marketing são pausadas. "START" remove a pausa.', 'When a patient sends "STOP", marketing messages are paused. "START" removes the pause.')}
            >
              <QuickReplySelect
                label={tr("Resposta ao ativar STOP", "STOP acknowledgement")}
                value={dndOnCode}
                onChange={setDndOnCode}
                options={quickReplies ?? []}
              />
              <QuickReplySelect
                label={tr("Resposta ao reativar START", "START acknowledgement")}
                value={dndOffCode}
                onChange={setDndOffCode}
                options={quickReplies ?? []}
              />
            </SettingsCard>

            <SettingsCard
              icon={Bot}
              title={tr("Agente", "Agent")}
              body={tr("Controlo geral do agente. Regras por canal podem exigir atendimento exclusivamente humano.", "Workspace-wide agent control. Channel rules can require human-only handling.")}
            >
              <ToggleRow
                label={tr("Ativar agente", "Enable agent")}
                checked={botEnabled}
                onChange={setBotEnabled}
              />
            </SettingsCard>

            <SettingsCard
              icon={ShoppingBag}
              title={tr("Comércio", "Commerce")}
              body={tr("Ative apenas quando a organização usa catálogo, recuperação de carrinho e estados de encomenda no WhatsApp.", "Enable only when the organization uses catalog, cart recovery and order-status conversations on WhatsApp.")}
            >
              <ToggleRow
                label={tr("Ativar comércio", "Enable commerce")}
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

            <AssignmentRulesSection />

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
  const { locale, tr } = useI18n();
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
    <div className="rounded-lg border border-line bg-surface-2 p-3">
      <div className="flex gap-3">
        <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-surface ${statusIconTone(check.status)}`}>
          <StatusIcon
            size={14}
            className={check.status === "in_progress" ? "animate-spin" : ""}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-[13px] font-medium text-ink">
              {check.title}
            </div>
            <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${statusBadgeTone(check.status)}`}>
              {statusLabel(check.status, locale)}
            </span>
            {check.blocking && check.status !== "done" && check.status !== "waived" && (
              <span className="rounded-md border border-chip-warn-fg/25 bg-chip-warn px-1.5 py-0.5 text-[10px] font-semibold text-chip-warn-fg">
                {tr("Obrigatório", "Required")}
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[11px] font-medium uppercase text-faint">
            {groupLabel(check.group, locale)} · {check.source === "auto" ? tr("automático", "automatic") : check.source === "manual" ? tr("manual", "manual") : tr("híbrido", "hybrid")}
          </div>
          <p className="mt-2 text-[12px] leading-5 text-body">
            {check.description}
          </p>
          <p className="mt-1 text-[11px] leading-5 text-muted">
            {check.notes ?? check.action}
          </p>
          {manual && (
            <div className="mt-3 flex flex-wrap gap-2">
              <AdmissionButton
                disabled={isBusy || check.status === "done"}
                onClick={() => onSetStatus(check.key, "done")}
              >
                {tr("Concluído", "Done")}
              </AdmissionButton>
              <AdmissionButton
                disabled={isBusy || check.status === "in_progress"}
                onClick={() => onSetStatus(check.key, "in_progress")}
              >
                {tr("Em curso", "In progress")}
              </AdmissionButton>
              <AdmissionButton
                disabled={isBusy || check.status === "blocked"}
                onClick={() => onSetStatus(check.key, "blocked")}
              >
                {tr("Bloqueado", "Blocked")}
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
    <div className="rounded-lg bg-surface-2 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase text-faint">
        {label}
      </div>
      <div className={`mt-1 text-sm font-semibold ${tone}`}>{value}</div>
    </div>
  );
}

function evidenceRecordTone(record: { ok: boolean; skipped?: boolean }): string {
  if (record.skipped) return "border-chip-warn-fg/25 bg-chip-warn text-chip-warn-fg";
  if (record.ok) return "border-chip-success-fg/25 bg-chip-success text-chip-success-fg";
  return "border-chip-danger-fg/25 bg-chip-danger text-chip-danger-fg";
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
      className="rounded-md border border-line bg-surface px-2 py-1 text-[11px] font-medium text-body transition-colors hover:border-line hover:text-ink disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function readinessTone(label: string): string {
  if (label === "live_ready" || label === "review_ready") {
    return "border-chip-success-fg/25 bg-chip-success text-chip-success-fg";
  }
  if (label === "blocked") {
    return "border-chip-danger-fg/25 bg-chip-danger text-chip-danger-fg";
  }
  return "border-chip-warn-fg/25 bg-chip-warn text-chip-warn-fg";
}

function statusIconTone(status: AdmissionStatus): string {
  if (status === "done" || status === "waived") {
    return "border-chip-success-fg/25 text-emerald-600";
  }
  if (status === "blocked") return "border-chip-danger-fg/25 text-chip-danger-fg";
  if (status === "in_progress") return "border-sky-200 text-sky-600";
  return "border-line text-faint";
}

function statusBadgeTone(status: AdmissionStatus): string {
  if (status === "done" || status === "waived") {
    return "border-chip-success-fg/25 bg-chip-success text-chip-success-fg";
  }
  if (status === "blocked") return "border-chip-danger-fg/25 bg-chip-danger text-chip-danger-fg";
  if (status === "in_progress") {
    return "border-sky-200 bg-chip-info text-chip-info-fg";
  }
  return "border-line bg-surface text-muted";
}

function statusLabel(status: AdmissionStatus, locale: Locale): string {
  const labels: Record<AdmissionStatus, [string, string]> = {
    todo: ["por fazer", "to do"],
    in_progress: ["em curso", "in progress"],
    done: ["concluído", "done"],
    blocked: ["bloqueado", "blocked"],
    waived: ["dispensado", "waived"],
  };
  return labels[status][locale === "pt" ? 0 : 1];
}

function groupLabel(group: string, locale: Locale): string {
  if (locale !== "pt") return group.replace(/_/g, " ");
  const labels: Record<string, string> = {
    business: "negócio",
    security: "segurança",
    technical: "técnico",
    webhook: "webhook",
    coexistence: "coexistência",
    app_review: "revisão da app",
  };
  return labels[group] ?? group.replace(/_/g, " ");
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
      <dt className="text-muted">{label}</dt>
      <dd
        className={
          mono
            ? "col-span-2 text-muted font-mono text-xs"
            : "col-span-2 text-ink font-medium capitalize"
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
    <section className="rounded-lg border border-line bg-surface p-5">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-ink">
          <Icon size={16} />
        </span>
        <div>
          <h3 className="font-[var(--font-outfit)] text-xl font-semibold text-ink">
            {title}
          </h3>
          <p className="mt-1 text-sm leading-6 text-muted">{body}</p>
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
    <label className="flex min-h-12 items-center justify-between gap-3 rounded-lg border border-line bg-surface-2 px-4 py-2 text-sm font-semibold text-ink">
      {label}
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-emerald-600"
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
  const { tr } = useI18n();
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-muted">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-brand-solid/40"
      >
        <option value="">{tr("Selecionar resposta rápida", "Select quick reply")}</option>
        {options.map((reply) => (
          <option key={reply._id} value={reply.name}>
            {reply.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function formatDate(value: number, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "pt" ? "pt-MZ" : "en-GB", {
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
