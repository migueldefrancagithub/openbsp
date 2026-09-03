"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useAction, useQuery } from "convex/react";
import {
  Activity,
  AlertTriangle,
  BadgeCheck,
  Building2,
  CheckCircle2,
  Clock3,
  Copy,
  DatabaseZap,
  KeyRound,
  Link2,
  ListChecks,
  Phone,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Unplug,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/app/EmptyState";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useI18n, type Locale } from "@/lib/i18n";

type Tone = "good" | "warn" | "bad" | "neutral";

type ChannelPhone = {
  _id: Id<"phoneNumbers">;
  phoneNumberId: string;
  e164: string;
  displayName: string;
  verifiedName?: string;
  messagingTier?: string;
  throughputLevel?: string;
  lastQualityEvent?: string;
  lastQualityEventAt?: number;
  lastMetaSyncAt?: number;
  qualityRating?: string;
  qualityLastErrorAt?: number;
  qualityLastErrorCode?: string;
  circuitBreakerUntil?: number;
  circuitBreakerReason?: string;
  circuitBreakerOpenedAt?: number;
  businessUsername?: string;
  businessUsernameStatus?: string;
  businessUsernameUpdatedAt?: number;
};

type WabaAccount = {
  _id: Id<"whatsappAccounts">;
  wabaId: string;
  metaAppId: string;
  businessPortfolioId?: string;
  onboardingSource?: "manual" | "embedded_signup" | "api";
  embeddedSignupSessionId?: Id<"embeddedSignupSessions">;
  status: string;
  qualityRating?: string;
  messagingTier?: string;
  lastQualityCheckAt?: number;
  tokenStatus: string;
  tokenStorage: "encrypted" | "legacy_plaintext" | "missing";
  lastTokenHealthCheckAt?: number;
  tokenHealthDetail?: string;
  dataAccessExpiresAt?: number;
  validatedAt?: number;
  validatedScopes?: string[];
  tokenExpiresAt?: number;
  accountUpdateEvent?: string;
  banState?: string;
  accountRestrictions?: unknown;
  lastDisconnectionReason?: string;
  lastDisconnectionInitiatedBy?: string;
  lastDisconnectedAt?: number;
  lastReconnectedAt?: number;
  coexRecovery: {
    state: "connected" | "needs_reconnect" | "watch" | "manual_review";
    tone: Tone;
    blocking: boolean;
    title: string;
    summary: string;
    operatorSteps: string[];
    customerSteps: string[];
    evidence: string[];
  };
  phoneNumbers: ChannelPhone[];
};

type ChannelHealth = {
  label: string;
  tone: Tone;
  headline: string;
  body: string;
  reasons: string[];
};

export default function ChannelsPage() {
  const { locale, tr } = useI18n();
  const accounts = useQuery(api.whatsappAccounts.listForTenant) as
    | WabaAccount[]
    | undefined;
  const refreshChannelHealth = useAction(
    api.whatsappAccounts.refreshChannelHealth,
  );
  const [selectedAccountId, setSelectedAccountId] =
    useState<Id<"whatsappAccounts"> | null>(null);
  const [selectedPhoneId, setSelectedPhoneId] =
    useState<Id<"phoneNumbers"> | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(null);

  const selectedAccount = useMemo(() => {
    if (!accounts?.length) return undefined;
    return (
      accounts.find((account) => account._id === selectedAccountId) ??
      accounts[0]
    );
  }, [accounts, selectedAccountId]);

  const selectedPhone = useMemo(() => {
    if (!selectedAccount?.phoneNumbers.length) return undefined;
    return (
      selectedAccount.phoneNumbers.find((phone) => phone._id === selectedPhoneId) ??
      selectedAccount.phoneNumbers[0]
    );
  }, [selectedAccount, selectedPhoneId]);

  const channelHealth = selectedAccount
    ? evaluateChannelHealth(selectedAccount, selectedPhone, locale)
    : undefined;

  async function copyValue(value: string, label: string) {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(null), 1600);
  }

  async function handleRefreshHealth() {
    if (!selectedAccount) return;
    setRefreshing(true);
    setRefreshError(null);
    try {
      await refreshChannelHealth({
        whatsappAccountId: selectedAccount._id,
        phoneNumberId: selectedPhone?._id,
      });
      setLastRefreshAt(Date.now());
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : tr("A atualização falhou.", "Refresh failed."));
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow={tr("Ligações WhatsApp", "WhatsApp connections")}
        title={tr("Canais", "Channels")}
        description={tr("Estado dos números, ligação à Meta e segurança de envio.", "Phone health, Meta connection and send safety.")}
      />

      <div className="grid min-h-[calc(100vh-105px)] border-t border-line-soft bg-surface lg:grid-cols-[310px_330px_1fr]">
        <aside className="border-b border-line p-4 lg:border-b-0 lg:border-r">
          <SectionLabel label={`${tr("Contas empresariais", "Business accounts")} (${accounts?.length ?? 0})`} />
          {accounts === undefined ? (
            <SkeletonRows />
          ) : accounts.length === 0 ? (
            <EmptyPanel
              icon={Building2}
              title={tr("Nenhuma WABA ligada", "No WABA connected")}
              body={tr("Ligue uma conta WhatsApp Business nas Configurações para acompanhar o canal.", "Connect a WhatsApp Business Account in Settings to monitor the channel.")}
            />
          ) : (
            <div className="space-y-2">
              {accounts.map((account) => {
                const active = selectedAccount?._id === account._id;
                const accountHealth = evaluateChannelHealth(account, undefined, locale);
                return (
                  <button
                    key={account._id}
                    type="button"
                    onClick={() => {
                      setSelectedAccountId(account._id);
                      setSelectedPhoneId(account.phoneNumbers[0]?._id ?? null);
                    }}
                    className={`flex w-full items-center gap-3 rounded-lg border px-3 py-3 text-left transition-all ${
                      active
                        ? "border-line bg-surface-2"
                        : "border-transparent hover:border-line hover:bg-surface-2"
                    }`}
                  >
                    <span
                      className={`flex h-10 w-10 items-center justify-center rounded-lg ${toneIconClass(
                        accountHealth.tone,
                      )}`}
                    >
                      <Building2 size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">
                        WABA {account.wabaId}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted">
                        {accountHealth.label} · {account.phoneNumbers.length}{" "}
                        {locale === "pt"
                          ? account.phoneNumbers.length === 1 ? "canal" : "canais"
                          : account.phoneNumbers.length === 1 ? "channel" : "channels"}
                      </span>
                    </span>
                    <HealthDot tone={accountHealth.tone} />
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        <aside className="border-b border-line p-4 lg:border-b-0 lg:border-r">
          <SectionLabel
            label={`${tr("Canais", "Channels")} (${selectedAccount?.phoneNumbers.length ?? 0})`}
          />
          {!selectedAccount ? (
            <EmptyPanel
              icon={Smartphone}
              title={tr("Ainda não há canais", "No channels yet")}
              body={tr("Os canais aparecem depois de ligar uma conta empresarial.", "Channels appear after a business account is connected.")}
            />
          ) : selectedAccount.phoneNumbers.length === 0 ? (
            <EmptyPanel
              icon={Phone}
              title={tr("Nenhum número associado", "No phone numbers")}
              body={tr("Esta WABA está ligada, mas ainda não tem um número associado.", "This WABA is connected but has no phone number bound yet.")}
            />
          ) : (
            <div className="space-y-2">
              {selectedAccount.phoneNumbers.map((phone) => {
                const active = selectedPhone?._id === phone._id;
                const phoneHealth = evaluateChannelHealth(selectedAccount, phone, locale);
                return (
                  <button
                    key={phone._id}
                    type="button"
                    onClick={() => setSelectedPhoneId(phone._id)}
                    className={`flex w-full items-center gap-3 rounded-lg border px-3 py-3 text-left transition-all ${
                      active
                        ? "border-line bg-surface-2"
                        : "border-transparent hover:border-line hover:bg-surface-2"
                    }`}
                  >
                    <span
                      className={`flex h-10 w-10 items-center justify-center rounded-lg ${toneIconClass(
                        phoneHealth.tone,
                      )}`}
                    >
                      <Phone size={17} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">
                        {phone.displayName}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted">
                        {phone.e164} · {phoneHealth.label}
                      </span>
                    </span>
                    <HealthDot tone={phoneHealth.tone} />
                  </button>
                );
              })}
              <div className="rounded-lg border border-dashed border-line px-3 py-3 text-center text-sm font-medium text-muted">
                <Link2 size={15} className="mx-auto mb-1 text-faint" />
                {tr("Ligar canal", "Connect channel")}
              </div>
            </div>
          )}
        </aside>

        <section className="min-w-0 bg-surface-2">
          {selectedPhone && selectedAccount && channelHealth ? (
            <div>
              <div className="flex flex-col gap-4 border-b border-line bg-surface p-6 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center gap-4">
                  <div
                    className={`flex h-20 w-20 items-center justify-center rounded-full border text-xl font-semibold ${toneAvatarClass(
                      channelHealth.tone,
                    )}`}
                  >
                    {initials(selectedPhone.displayName)}
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-[var(--font-outfit)] text-2xl font-semibold text-ink">
                        {selectedPhone.displayName}
                      </h2>
                      <StatusBadge tone={channelHealth.tone}>
                        {statusIcon(channelHealth.tone)}
                        {channelHealth.label}
                      </StatusBadge>
                    </div>
                    <p className="mt-1 text-sm text-muted">
                      {selectedPhone.verifiedName
                        ? `${tr("Nome verificado", "Verified name")}: ${selectedPhone.verifiedName}`
                        : `${tr("Ligado como", "Connected as")} ${selectedPhone.displayName}`}
                    </p>
                  </div>
                </div>
                <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
                  {lastRefreshAt && (
                    <span className="text-xs font-medium text-muted">
                      {tr("Atualizado", "Refreshed")} {formatRelative(lastRefreshAt, locale)}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={handleRefreshHealth}
                    disabled={refreshing}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-ink transition-colors hover:border-line disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <RefreshCw
                      size={15}
                      className={refreshing ? "animate-spin" : ""}
                    />
                    {refreshing ? tr("A atualizar...", "Refreshing...") : tr("Atualizar estado", "Refresh health")}
                  </button>
                </div>
              </div>

              <div className="grid gap-4 p-6 xl:grid-cols-2">
                {refreshError && (
                  <div className="xl:col-span-2">
                    <InlineAlert tone="bad" title={tr("Atualização falhou", "Refresh failed")}>
                      {cleanError(refreshError)}
                    </InlineAlert>
                  </div>
                )}

                <ChannelCard icon={ShieldCheck} title={tr("Estado das mensagens", "Message status")}>
                  <div
                    className={`flex items-start gap-3 rounded-lg border p-4 ${tonePanelClass(
                      channelHealth.tone,
                    )}`}
                  >
                    <span className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/80">
                      {statusIcon(channelHealth.tone)}
                    </span>
                    <div>
                      <div className="text-sm font-semibold">
                        {channelHealth.headline}
                      </div>
                      <p className="mt-1 text-sm leading-6">
                        {channelHealth.body}
                      </p>
                      {channelHealth.reasons.length > 0 && (
                        <ul className="mt-3 space-y-1 text-sm">
                          {channelHealth.reasons.map((reason) => (
                            <li key={reason} className="flex gap-2">
                              <span className="mt-2 h-1 w-1 rounded-full bg-current opacity-60" />
                              <span>{reason}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </ChannelCard>

                <ChannelCard icon={Activity} title={tr("Saúde do canal", "Channel health")}>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <HealthMetric
                      label="WABA"
                      value={stateLabel(selectedAccount.status, locale)}
                      tone={selectedAccount.status === "active" ? "good" : "bad"}
                    />
                    <HealthMetric
                      label="Token"
                      value={stateLabel(selectedAccount.tokenStatus, locale)}
                      tone={tokenTone(selectedAccount.tokenStatus)}
                    />
                    <HealthMetric
                      label={tr("Qualidade", "Quality")}
                      value={
                        stateLabel(
                          selectedPhone.qualityRating ??
                            selectedAccount.qualityRating ??
                            "unknown",
                          locale,
                        )
                      }
                      tone={qualityTone(
                        selectedPhone.qualityRating ?? selectedAccount.qualityRating,
                      )}
                    />
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <HealthMetric
                      label={tr("Nível", "Tier")}
                      value={
                        selectedPhone.messagingTier ??
                        selectedAccount.messagingTier ??
                        tr("desconhecido", "unknown")
                      }
                      tone={
                        selectedPhone.messagingTier || selectedAccount.messagingTier
                          ? "good"
                          : "neutral"
                      }
                    />
                    <HealthMetric
                      label={tr("Proteção", "Circuit")}
                      value={
                        selectedPhone.circuitBreakerUntil &&
                        selectedPhone.circuitBreakerUntil > Date.now()
                          ? tr("pausado", "paused")
                          : tr("livre", "clear")
                      }
                      tone={
                        selectedPhone.circuitBreakerUntil &&
                        selectedPhone.circuitBreakerUntil > Date.now()
                          ? "bad"
                          : "good"
                      }
                    />
                  </div>
                </ChannelCard>

                <ChannelCard
                  icon={Phone}
                  title={tr("Detalhes do número", "Phone details")}
                  action={
                    copied && (
                      <span className="text-xs font-medium text-emerald-600">
                        {tr("Copiado", "Copied")} {copied}
                      </span>
                    )
                  }
                >
                  <DetailRow label={tr("Nome de exibição", "Display name")} value={selectedPhone.displayName} />
                  <DetailRow
                    label={tr("Nome verificado", "Verified name")}
                    value={selectedPhone.verifiedName ?? tr("Não sincronizado", "Not synced")}
                  />
                  <DetailRow
                    label={tr("Número de telefone", "Phone number")}
                    value={selectedPhone.e164}
                    copy={() => copyValue(selectedPhone.e164, "phone")}
                  />
                  <DetailRow
                    label="Phone Number ID"
                    value={selectedPhone.phoneNumberId}
                    mono
                    copy={() =>
                      copyValue(selectedPhone.phoneNumberId, "phone ID")
                    }
                  />
                  <DetailRow
                    label={tr("Nome de utilizador empresarial", "Business username")}
                    value={
                      selectedPhone.businessUsername
                        ? `${selectedPhone.businessUsername} (${selectedPhone.businessUsernameStatus ?? tr("estado desconhecido", "status unknown")})`
                        : tr("Não informado", "Not reported")
                    }
                  />
                </ChannelCard>

                <ChannelCard icon={KeyRound} title={tr("Token e acesso à Meta", "Token and Meta access")}>
                  <ChecklistRow
                    icon={ShieldCheck}
                    label={tr("Armazenamento do token", "Token storage")}
                    value={formatTokenStorage(selectedAccount.tokenStorage, locale)}
                    tone={
                      selectedAccount.tokenStorage === "encrypted"
                        ? "good"
                        : selectedAccount.tokenStorage === "legacy_plaintext"
                          ? "warn"
                          : "bad"
                    }
                  />
                  <ChecklistRow
                    icon={Clock3}
                    label={tr("Última verificação do token", "Last token check")}
                    value={formatDateTime(selectedAccount.lastTokenHealthCheckAt, locale)}
                    tone={selectedAccount.lastTokenHealthCheckAt ? "good" : "warn"}
                  />
                  <ChecklistRow
                    icon={DatabaseZap}
                    label={tr("Acesso aos dados", "Data access")}
                    value={formatExpiry(selectedAccount.dataAccessExpiresAt, locale)}
                    tone={expiryTone(selectedAccount.dataAccessExpiresAt)}
                  />
                  <ChecklistRow
                    icon={BadgeCheck}
                    label="Scopes"
                    value={
                      selectedAccount.validatedScopes?.length
                        ? selectedAccount.validatedScopes.join(", ")
                        : tr("Não sincronizadas", "Not synced")
                    }
                    tone={selectedAccount.validatedScopes?.length ? "good" : "warn"}
                  />
                  {selectedAccount.tokenHealthDetail && (
                    <InlineAlert tone="warn" title={tr("Detalhe do token", "Token detail")}>
                      {selectedAccount.tokenHealthDetail}
                    </InlineAlert>
                  )}
                </ChannelCard>

                <ChannelCard icon={AlertTriangle} title={tr("Eventos e segurança Meta", "Meta events and safety")}>
                  <ChecklistRow
                    icon={Building2}
                    label={tr("Ligação inicial", "Onboarding")}
                    value={formatOnboardingSource(selectedAccount.onboardingSource, locale)}
                    tone={
                      selectedAccount.onboardingSource === "embedded_signup"
                        ? "good"
                        : "warn"
                    }
                  />
                  <ChecklistRow
                    icon={Activity}
                    label={tr("Sincronização do número", "Phone sync")}
                    value={formatDateTime(selectedPhone.lastMetaSyncAt, locale)}
                    tone={selectedPhone.lastMetaSyncAt ? "good" : "warn"}
                  />
                  <ChecklistRow
                    icon={ShieldAlert}
                    label={tr("Último evento da conta", "Last account event")}
                    value={selectedAccount.accountUpdateEvent ?? tr("Nenhum registado", "None recorded")}
                    tone={
                      selectedAccount.accountUpdateEvent &&
                      selectedAccount.status !== "active"
                        ? "bad"
                        : "neutral"
                    }
                  />
                  <ChecklistRow
                    icon={Clock3}
                    label={tr("Evento de qualidade", "Quality event")}
                    value={
                      selectedPhone.lastQualityEvent
                        ? `${selectedPhone.lastQualityEvent} · ${formatDateTime(
                            selectedPhone.lastQualityEventAt,
                            locale,
                          )}`
                        : tr("Nenhum registado", "None recorded")
                    }
                    tone={qualityTone(selectedPhone.qualityRating)}
                  />
                  {selectedPhone.qualityLastErrorCode && (
                    <InlineAlert tone="warn" title={tr("Último erro de envio", "Last send error")}>
                      {tr("Código Meta", "Meta code")} {selectedPhone.qualityLastErrorCode}
                      {selectedPhone.qualityLastErrorAt
                        ? ` · ${formatDateTime(selectedPhone.qualityLastErrorAt, locale)}`
                        : ""}
                    </InlineAlert>
                  )}
                </ChannelCard>

                <div className="xl:col-span-2">
                  <ChannelCard
                    icon={Unplug}
                    title={tr("Recuperação da coexistência", "Coexistence recovery")}
                    action={
                      <StatusBadge tone={selectedAccount.coexRecovery.tone}>
                        {statusIcon(selectedAccount.coexRecovery.tone)}
                        {formatCoexState(selectedAccount.coexRecovery.state, locale)}
                      </StatusBadge>
                    }
                  >
                    <div
                      className={`flex items-start gap-3 rounded-lg border p-4 ${tonePanelClass(
                        selectedAccount.coexRecovery.tone,
                      )}`}
                    >
                      <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/80">
                        {statusIcon(selectedAccount.coexRecovery.tone)}
                      </span>
                      <div>
                        <div className="text-sm font-semibold">
                          {selectedAccount.coexRecovery.title}
                        </div>
                        <p className="mt-1 text-sm leading-6">
                          {selectedAccount.coexRecovery.summary}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-4 lg:grid-cols-2">
                      <RecoverySteps
                        title={tr("Próximos passos no OpenBSP", "OpenBSP next steps")}
                        steps={selectedAccount.coexRecovery.operatorSteps}
                      />
                      <RecoverySteps
                        title={tr("Verificação no telefone do cliente", "Client phone check")}
                        steps={selectedAccount.coexRecovery.customerSteps}
                      />
                    </div>

                    <div className="mt-4 rounded-lg border border-line-soft bg-surface-2 p-3">
                      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                        <ListChecks size={14} />
                        {tr("Sinais da Meta", "Meta signals")}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {selectedAccount.coexRecovery.evidence.map((item) => (
                          <span
                            key={item}
                            className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-medium text-body"
                          >
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>
                  </ChannelCard>
                </div>

                <ChannelCard icon={Unplug} title={tr("Identificadores da conta", "Account identifiers")}>
                  <DetailRow
                    label="WABA ID"
                    value={selectedAccount.wabaId}
                    mono
                    copy={() => copyValue(selectedAccount.wabaId, "WABA ID")}
                  />
                  <DetailRow
                    label="Meta App ID"
                    value={selectedAccount.metaAppId}
                    mono
                    copy={() => copyValue(selectedAccount.metaAppId, "app ID")}
                  />
                  <DetailRow
                    label={tr("ID do portefólio empresarial", "Business Portfolio ID")}
                    value={selectedAccount.businessPortfolioId ?? tr("Não capturado", "Not captured")}
                    mono={Boolean(selectedAccount.businessPortfolioId)}
                    copy={
                      selectedAccount.businessPortfolioId
                        ? () =>
                            copyValue(
                              selectedAccount.businessPortfolioId as string,
                              "portfolio ID",
                            )
                        : undefined
                    }
                  />
                  <DetailRow
                    label={tr("Capacidade de envio", "Throughput")}
                    value={selectedPhone.throughputLevel ?? tr("Não sincronizada", "Not synced")}
                  />
                </ChannelCard>
              </div>
            </div>
          ) : (
            <div className="p-6">
              <EmptyPanel
                icon={Smartphone}
                title={tr("Selecione um canal", "Select a channel")}
                body={tr("Escolha um número ligado para consultar a saúde e os identificadores Meta.", "Choose a connected number to inspect health and Meta identifiers.")}
              />
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function evaluateChannelHealth(
  account: WabaAccount,
  phone?: ChannelPhone,
  locale: Locale = "en",
): ChannelHealth {
  const pt = locale === "pt";
  const reasons: string[] = [];
  const now = Date.now();
  const circuitActive =
    Boolean(phone?.circuitBreakerUntil) &&
    (phone?.circuitBreakerUntil ?? 0) > now;

  if (account.status !== "active") {
    reasons.push(pt ? `O estado da WABA é ${stateLabel(account.status, locale)}.` : `WABA status is ${stateLabel(account.status, locale)}.`);
  }
  if (account.tokenStatus === "revoked") {
    reasons.push(pt ? "O token Meta foi revogado ou não tem as permissões necessárias." : "Meta token is revoked or missing required scopes.");
  } else if (account.tokenStatus === "expiring") {
    reasons.push(pt ? "O token Meta está próximo de expirar." : "Meta token is close to expiry.");
  }
  if (account.tokenStorage !== "encrypted") {
    reasons.push(pt ? `O armazenamento do token é ${formatTokenStorage(account.tokenStorage, locale)}.` : `Token storage is ${formatTokenStorage(account.tokenStorage, locale)}.`);
  }
  if (circuitActive) {
    reasons.push(
      phone?.circuitBreakerReason
        ? `${phone.circuitBreakerReason} ${pt ? "até" : "until"} ${formatDateTime(
            phone.circuitBreakerUntil,
            locale,
          )}.`
        : `${pt ? "Proteção temporária ativa até" : "Circuit breaker active until"} ${formatDateTime(
            phone?.circuitBreakerUntil,
            locale,
          )}.`,
    );
  }
  if ((phone?.qualityRating ?? account.qualityRating) === "red") {
    reasons.push(pt ? "A classificação de qualidade da Meta está vermelha." : "Meta quality rating is red.");
  } else if ((phone?.qualityRating ?? account.qualityRating) === "yellow") {
    reasons.push(pt ? "A classificação de qualidade da Meta está amarela." : "Meta quality rating is yellow.");
  }
  if (account.lastDisconnectionReason) {
    reasons.push(
      `${pt ? "Última desconexão" : "Last disconnect"}: ${account.lastDisconnectionReason}${
        account.lastDisconnectionInitiatedBy
          ? ` ${pt ? "por" : "by"} ${account.lastDisconnectionInitiatedBy}`
          : ""
      }.`,
    );
  }
  if (account.banState) {
    reasons.push(`${pt ? "Estado de bloqueio" : "Ban state"}: ${stateLabel(account.banState, locale)}.`);
  }

  if (
    account.status !== "active" ||
    account.tokenStatus === "revoked" ||
    circuitActive ||
    (phone?.qualityRating ?? account.qualityRating) === "red"
  ) {
    return {
      label: pt ? "Bloqueado" : "Blocked",
      tone: "bad",
      headline: pt ? "Os envios devem continuar pausados" : "Outbound should stay paused",
      body: pt
        ? "Este canal tem um bloqueio da Meta ou uma proteção local ativa. Não use em campanhas ou envios manuais até resolver."
        : "This channel has a Meta-side blocker or a local circuit breaker. Campaigns and manual sends should not rely on it until the issue clears.",
      reasons,
    };
  }

  if (
    account.tokenStatus === "expiring" ||
    account.tokenStorage !== "encrypted" ||
    (phone?.qualityRating ?? account.qualityRating) === "yellow" ||
    !account.lastTokenHealthCheckAt ||
    !phone?.lastMetaSyncAt
  ) {
    if (!account.lastTokenHealthCheckAt) {
      reasons.push(pt ? "A saúde do token ainda não foi verificada." : "Token health has not been checked yet.");
    }
    if (phone && !phone.lastMetaSyncAt) {
      reasons.push(pt ? "A qualidade e o nível do número ainda não foram sincronizados." : "Phone quality/tier has not been synced yet.");
    }
    return {
      label: pt ? "Precisa de revisão" : "Needs review",
      tone: "warn",
      headline: pt ? "Enviar apenas depois de rever" : "Send only after review",
      body: pt
        ? "O canal não está bloqueado, mas deve atualizar a saúde Meta antes de campanhas de maior volume."
        : "The channel is not hard-blocked, but the operator should refresh Meta health before high-volume campaigns.",
      reasons,
    };
  }

  return {
    label: pt ? "Disponível" : "Available",
    tone: "good",
    headline: pt ? "Pronto para envios controlados" : "Ready for controlled sends",
    body: pt
      ? "O estado da WABA, token, qualidade e proteção local permitem a operação normal."
      : "WABA status, token health, quality and local circuit breaker are clear for normal operation.",
    reasons,
  };
}

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
      {label}
    </div>
  );
}

function EmptyPanel({
  icon: Icon,
  title,
  body,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-surface p-6 text-center">
      <Icon size={24} className="mx-auto text-faint" />
      <div className="mt-3 text-sm font-semibold text-ink">{title}</div>
      <p className="mt-1 text-sm leading-6 text-muted">{body}</p>
    </div>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className="h-[68px] animate-pulse rounded-lg border border-line-soft bg-surface-2"
        />
      ))}
    </div>
  );
}

function HealthDot({ tone }: { tone: Tone }) {
  return <span className={`h-2.5 w-2.5 rounded-full ${dotClass(tone)}`} />;
}

function StatusBadge({
  tone,
  children,
}: {
  tone: Tone;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${badgeClass(
        tone,
      )}`}
    >
      {children}
    </span>
  );
}

function ChannelCard({
  icon: Icon,
  title,
  action,
  children,
}: {
  icon: LucideIcon;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-line bg-surface p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon size={17} className="text-muted" />
          <h3 className="font-[var(--font-outfit)] text-lg font-semibold text-ink">
            {title}
          </h3>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function DetailRow({
  label,
  value,
  mono,
  copy,
}: {
  label: string;
  value: string;
  mono?: boolean;
  copy?: () => void;
}) {
  const { tr } = useI18n();

  return (
    <div className="border-b border-line-soft py-3 last:border-b-0">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="mt-1 flex items-center gap-2">
        <div
          className={`min-w-0 flex-1 truncate text-sm font-semibold text-ink ${
            mono ? "font-[var(--font-mono)]" : ""
          }`}
        >
          {value}
        </div>
        {copy && (
          <button
            type="button"
            onClick={copy}
            className="rounded-md p-1.5 text-faint hover:bg-surface-3 hover:text-ink"
            aria-label={`${tr("Copiar", "Copy")} ${label}`}
          >
            <Copy size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

function HealthMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: Tone;
}) {
  return (
    <div className={`rounded-lg border p-3 ${metricClass(tone)}`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] opacity-75">
        {label}
      </div>
      <div className="mt-1 break-words text-sm font-semibold capitalize">
        {value}
      </div>
    </div>
  );
}

function ChecklistRow({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone: Tone;
}) {
  return (
    <div className="flex items-start gap-3 border-b border-line-soft py-3 last:border-b-0">
      <span
        className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${toneIconClass(
          tone,
        )}`}
      >
        <Icon size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-muted">{label}</div>
        <div className="mt-0.5 break-words text-sm font-semibold text-ink">
          {value}
        </div>
      </div>
    </div>
  );
}

function RecoverySteps({ title, steps }: { title: string; steps: string[] }) {
  return (
    <div className="rounded-lg border border-line-soft bg-surface p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
        <ListChecks size={15} className="text-muted" />
        {title}
      </div>
      <ol className="space-y-2">
        {steps.map((step, index) => (
          <li key={step} className="flex gap-3 text-sm leading-6 text-body">
            <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[11px] font-semibold text-muted">
              {index + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function InlineAlert({
  tone,
  title,
  children,
}: {
  tone: Exclude<Tone, "neutral">;
  title: string;
  children: ReactNode;
}) {
  const Icon = tone === "bad" ? XCircle : tone === "warn" ? AlertTriangle : CheckCircle2;
  return (
    <div className={`mt-3 flex items-start gap-3 rounded-lg border p-3 ${tonePanelClass(tone)}`}>
      <Icon size={16} className="mt-0.5 shrink-0" />
      <div>
        <div className="text-sm font-semibold">{title}</div>
        <div className="mt-0.5 text-sm leading-6">{children}</div>
      </div>
    </div>
  );
}

function tokenTone(status: string): Tone {
  if (status === "ok") return "good";
  if (status === "revoked") return "bad";
  return "warn";
}

function qualityTone(rating?: string): Tone {
  if (rating === "green") return "good";
  if (rating === "red") return "bad";
  if (rating === "yellow") return "warn";
  return "neutral";
}

function expiryTone(value?: number): Tone {
  if (!value) return "neutral";
  const daysLeft = value - Date.now();
  if (daysLeft <= 0) return "bad";
  if (daysLeft < 14 * 24 * 60 * 60 * 1000) return "warn";
  return "good";
}

function statusIcon(tone: Tone) {
  if (tone === "good") return <CheckCircle2 size={13} />;
  if (tone === "bad") return <XCircle size={13} />;
  if (tone === "warn") return <AlertTriangle size={13} />;
  return <Clock3 size={13} />;
}

function toneAvatarClass(tone: Tone) {
  if (tone === "good") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (tone === "bad") return "border-red-200 bg-red-50 text-red-700";
  if (tone === "warn") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-line bg-surface-2 text-ink";
}

function toneIconClass(tone: Tone) {
  if (tone === "good") return "bg-emerald-50 text-emerald-600";
  if (tone === "bad") return "bg-red-50 text-red-600";
  if (tone === "warn") return "bg-amber-50 text-amber-600";
  return "bg-surface-2 text-muted";
}

function badgeClass(tone: Tone) {
  if (tone === "good") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (tone === "bad") return "border-red-200 bg-red-50 text-red-700";
  if (tone === "warn") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-line bg-surface-2 text-body";
}

function dotClass(tone: Tone) {
  if (tone === "good") return "bg-emerald-500";
  if (tone === "bad") return "bg-red-500";
  if (tone === "warn") return "bg-amber-400";
  return "bg-faint/50";
}

function metricClass(tone: Tone) {
  if (tone === "good") return "border-emerald-100 bg-emerald-50 text-emerald-700";
  if (tone === "bad") return "border-red-100 bg-red-50 text-red-700";
  if (tone === "warn") return "border-amber-100 bg-amber-50 text-amber-700";
  return "border-line bg-surface-2 text-body";
}

function tonePanelClass(tone: Tone) {
  if (tone === "good") return "border-emerald-100 bg-emerald-50 text-emerald-800";
  if (tone === "bad") return "border-red-100 bg-red-50 text-red-800";
  if (tone === "warn") return "border-amber-100 bg-amber-50 text-amber-800";
  return "border-line bg-surface-2 text-ink";
}

function formatDateTime(value?: number, locale: Locale = "en") {
  if (!value) return locale === "pt" ? "Não registado" : "Not recorded";
  return new Intl.DateTimeFormat(locale === "pt" ? "pt-MZ" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatRelative(value: number, locale: Locale = "en") {
  const seconds = Math.max(1, Math.floor((Date.now() - value) / 1000));
  if (seconds < 60) return locale === "pt" ? "agora" : "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return locale === "pt" ? `há ${minutes} min` : `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return locale === "pt" ? `há ${hours} h` : `${hours}h ago`;
  return formatDateTime(value, locale);
}

function formatExpiry(value?: number, locale: Locale = "en") {
  if (!value) return locale === "pt" ? "Sem validade informada" : "No expiry reported";
  if (value <= Date.now()) {
    return locale === "pt"
      ? `Expirou em ${formatDateTime(value, locale)}`
      : `Expired ${formatDateTime(value, locale)}`;
  }
  return locale === "pt"
    ? `Expira em ${formatDateTime(value, locale)}`
    : `Expires ${formatDateTime(value, locale)}`;
}

function formatTokenStorage(
  value: WabaAccount["tokenStorage"],
  locale: Locale = "en",
) {
  if (value === "encrypted") return locale === "pt" ? "Encriptado" : "Encrypted";
  if (value === "legacy_plaintext") {
    return locale === "pt" ? "Texto simples legado" : "Legacy plaintext";
  }
  return locale === "pt" ? "Em falta" : "Missing";
}

function formatOnboardingSource(
  value?: WabaAccount["onboardingSource"],
  locale: Locale = "en",
) {
  if (value === "embedded_signup") return "Embedded Signup";
  if (value === "manual") return locale === "pt" ? "Ligação manual" : "Manual connection";
  if (value === "api") return locale === "pt" ? "Ligação por API" : "API connection";
  return locale === "pt" ? "Desconhecida" : "Unknown";
}

function formatCoexState(
  state: WabaAccount["coexRecovery"]["state"],
  locale: Locale = "en",
) {
  if (state === "connected") return locale === "pt" ? "Ligado" : "Connected";
  if (state === "needs_reconnect") {
    return locale === "pt" ? "Religação necessária" : "Reconnect required";
  }
  if (state === "watch") return locale === "pt" ? "Em observação" : "Watch";
  return locale === "pt" ? "Revisão manual" : "Manual review";
}

function stateLabel(value: string, locale: Locale = "en") {
  if (locale !== "pt") return value.replaceAll("_", " ");
  const labels: Record<string, string> = {
    active: "ativo",
    blocked: "bloqueado",
    clear: "livre",
    connected: "ligado",
    disconnected: "desligado",
    encrypted: "encriptado",
    expiring: "a expirar",
    green: "verde",
    missing: "em falta",
    ok: "válido",
    paused: "pausado",
    pending: "pendente",
    red: "vermelha",
    revoked: "revogado",
    unknown: "desconhecida",
    yellow: "amarela",
  };
  return labels[value] ?? value.replaceAll("_", " ");
}

function cleanError(value: string) {
  return value.replace(/^.*ConvexError:\s*/i, "").trim();
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}
