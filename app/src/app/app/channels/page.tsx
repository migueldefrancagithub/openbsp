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
    ? evaluateChannelHealth(selectedAccount, selectedPhone)
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
      setRefreshError(error instanceof Error ? error.message : "Refresh failed.");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Meta channels"
        title="Channels"
        description="Manage WhatsApp business accounts, phone health, and coexistence readiness."
      />

      <div className="grid min-h-[calc(100vh-105px)] border-t border-slate-100 bg-white lg:grid-cols-[310px_330px_1fr]">
        <aside className="border-b border-slate-200 p-4 lg:border-b-0 lg:border-r">
          <SectionLabel label={`Business accounts (${accounts?.length ?? 0})`} />
          {accounts === undefined ? (
            <SkeletonRows />
          ) : accounts.length === 0 ? (
            <EmptyPanel
              icon={Building2}
              title="No WABA connected"
              body="Connect a WhatsApp Business Account in Settings to unlock channel health."
            />
          ) : (
            <div className="space-y-2">
              {accounts.map((account) => {
                const active = selectedAccount?._id === account._id;
                const accountHealth = evaluateChannelHealth(account);
                return (
                  <button
                    key={account._id}
                    type="button"
                    onClick={() => {
                      setSelectedAccountId(account._id);
                      setSelectedPhoneId(account.phoneNumbers[0]?._id ?? null);
                    }}
                    className={`flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-all ${
                      active
                        ? "border-slate-300 bg-slate-50"
                        : "border-transparent hover:border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <span
                      className={`flex h-10 w-10 items-center justify-center rounded-xl ${toneIconClass(
                        accountHealth.tone,
                      )}`}
                    >
                      <Building2 size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-[#0a1b33]">
                        WABA {account.wabaId}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-slate-500">
                        {accountHealth.label} · {account.phoneNumbers.length} channel
                        {account.phoneNumbers.length === 1 ? "" : "s"}
                      </span>
                    </span>
                    <HealthDot tone={accountHealth.tone} />
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        <aside className="border-b border-slate-200 p-4 lg:border-b-0 lg:border-r">
          <SectionLabel
            label={`Channels (${selectedAccount?.phoneNumbers.length ?? 0})`}
          />
          {!selectedAccount ? (
            <EmptyPanel
              icon={Smartphone}
              title="No channels yet"
              body="The channel list appears after a business account is connected."
            />
          ) : selectedAccount.phoneNumbers.length === 0 ? (
            <EmptyPanel
              icon={Phone}
              title="No phone numbers"
              body="This WABA is connected but has no phone number bound yet."
            />
          ) : (
            <div className="space-y-2">
              {selectedAccount.phoneNumbers.map((phone) => {
                const active = selectedPhone?._id === phone._id;
                const phoneHealth = evaluateChannelHealth(selectedAccount, phone);
                return (
                  <button
                    key={phone._id}
                    type="button"
                    onClick={() => setSelectedPhoneId(phone._id)}
                    className={`flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-all ${
                      active
                        ? "border-slate-300 bg-slate-50"
                        : "border-transparent hover:border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <span
                      className={`flex h-10 w-10 items-center justify-center rounded-xl ${toneIconClass(
                        phoneHealth.tone,
                      )}`}
                    >
                      <Phone size={17} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-[#0a1b33]">
                        {phone.displayName}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-slate-500">
                        {phone.e164} · {phoneHealth.label}
                      </span>
                    </span>
                    <HealthDot tone={phoneHealth.tone} />
                  </button>
                );
              })}
              <div className="rounded-xl border border-dashed border-slate-200 px-3 py-3 text-center text-sm font-medium text-slate-500">
                <Link2 size={15} className="mx-auto mb-1 text-slate-400" />
                Connect channel
              </div>
            </div>
          )}
        </aside>

        <section className="min-w-0 bg-[#f8fafc]">
          {selectedPhone && selectedAccount && channelHealth ? (
            <div>
              <div className="flex flex-col gap-4 border-b border-slate-200 bg-white p-6 lg:flex-row lg:items-center lg:justify-between">
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
                      <h2 className="font-[var(--font-outfit)] text-2xl font-semibold text-[#0a1b33]">
                        {selectedPhone.displayName}
                      </h2>
                      <StatusBadge tone={channelHealth.tone}>
                        {statusIcon(channelHealth.tone)}
                        {channelHealth.label}
                      </StatusBadge>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      {selectedPhone.verifiedName
                        ? `Verified name: ${selectedPhone.verifiedName}`
                        : `Connected as ${selectedPhone.displayName}`}
                    </p>
                  </div>
                </div>
                <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
                  {lastRefreshAt && (
                    <span className="text-xs font-medium text-slate-500">
                      Refreshed {formatRelative(lastRefreshAt)}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={handleRefreshHealth}
                    disabled={refreshing}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-[#0a1b33] transition-colors hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <RefreshCw
                      size={15}
                      className={refreshing ? "animate-spin" : ""}
                    />
                    {refreshing ? "Refreshing..." : "Refresh health"}
                  </button>
                </div>
              </div>

              <div className="grid gap-4 p-6 xl:grid-cols-2">
                {refreshError && (
                  <div className="xl:col-span-2">
                    <InlineAlert tone="bad" title="Refresh failed">
                      {cleanError(refreshError)}
                    </InlineAlert>
                  </div>
                )}

                <ChannelCard icon={ShieldCheck} title="Message status">
                  <div
                    className={`flex items-start gap-3 rounded-xl border p-4 ${tonePanelClass(
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

                <ChannelCard icon={Activity} title="Channel health status">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <HealthMetric
                      label="WABA"
                      value={selectedAccount.status}
                      tone={selectedAccount.status === "active" ? "good" : "bad"}
                    />
                    <HealthMetric
                      label="Token"
                      value={selectedAccount.tokenStatus}
                      tone={tokenTone(selectedAccount.tokenStatus)}
                    />
                    <HealthMetric
                      label="Quality"
                      value={
                        selectedPhone.qualityRating ??
                        selectedAccount.qualityRating ??
                        "unknown"
                      }
                      tone={qualityTone(
                        selectedPhone.qualityRating ?? selectedAccount.qualityRating,
                      )}
                    />
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <HealthMetric
                      label="Tier"
                      value={
                        selectedPhone.messagingTier ??
                        selectedAccount.messagingTier ??
                        "unknown"
                      }
                      tone={
                        selectedPhone.messagingTier || selectedAccount.messagingTier
                          ? "good"
                          : "neutral"
                      }
                    />
                    <HealthMetric
                      label="Circuit"
                      value={
                        selectedPhone.circuitBreakerUntil &&
                        selectedPhone.circuitBreakerUntil > Date.now()
                          ? "paused"
                          : "clear"
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
                  title="Phone details"
                  action={
                    copied && (
                      <span className="text-xs font-medium text-emerald-600">
                        Copied {copied}
                      </span>
                    )
                  }
                >
                  <DetailRow label="Display name" value={selectedPhone.displayName} />
                  <DetailRow
                    label="Verified name"
                    value={selectedPhone.verifiedName ?? "Not synced"}
                  />
                  <DetailRow
                    label="Phone number"
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
                    label="Business username"
                    value={
                      selectedPhone.businessUsername
                        ? `${selectedPhone.businessUsername} (${selectedPhone.businessUsernameStatus ?? "status unknown"})`
                        : "Not reported"
                    }
                  />
                </ChannelCard>

                <ChannelCard icon={KeyRound} title="Token and Meta access">
                  <ChecklistRow
                    icon={ShieldCheck}
                    label="Token storage"
                    value={formatTokenStorage(selectedAccount.tokenStorage)}
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
                    label="Last token check"
                    value={formatDateTime(selectedAccount.lastTokenHealthCheckAt)}
                    tone={selectedAccount.lastTokenHealthCheckAt ? "good" : "warn"}
                  />
                  <ChecklistRow
                    icon={DatabaseZap}
                    label="Data access"
                    value={formatExpiry(selectedAccount.dataAccessExpiresAt)}
                    tone={expiryTone(selectedAccount.dataAccessExpiresAt)}
                  />
                  <ChecklistRow
                    icon={BadgeCheck}
                    label="Scopes"
                    value={
                      selectedAccount.validatedScopes?.length
                        ? selectedAccount.validatedScopes.join(", ")
                        : "Not synced"
                    }
                    tone={selectedAccount.validatedScopes?.length ? "good" : "warn"}
                  />
                  {selectedAccount.tokenHealthDetail && (
                    <InlineAlert tone="warn" title="Token detail">
                      {selectedAccount.tokenHealthDetail}
                    </InlineAlert>
                  )}
                </ChannelCard>

                <ChannelCard icon={AlertTriangle} title="Meta events and safety">
                  <ChecklistRow
                    icon={Building2}
                    label="Onboarding"
                    value={formatOnboardingSource(selectedAccount.onboardingSource)}
                    tone={
                      selectedAccount.onboardingSource === "embedded_signup"
                        ? "good"
                        : "warn"
                    }
                  />
                  <ChecklistRow
                    icon={Activity}
                    label="Phone sync"
                    value={formatDateTime(selectedPhone.lastMetaSyncAt)}
                    tone={selectedPhone.lastMetaSyncAt ? "good" : "warn"}
                  />
                  <ChecklistRow
                    icon={ShieldAlert}
                    label="Last account event"
                    value={selectedAccount.accountUpdateEvent ?? "None recorded"}
                    tone={
                      selectedAccount.accountUpdateEvent &&
                      selectedAccount.status !== "active"
                        ? "bad"
                        : "neutral"
                    }
                  />
                  <ChecklistRow
                    icon={Clock3}
                    label="Quality event"
                    value={
                      selectedPhone.lastQualityEvent
                        ? `${selectedPhone.lastQualityEvent} · ${formatDateTime(
                            selectedPhone.lastQualityEventAt,
                          )}`
                        : "None recorded"
                    }
                    tone={qualityTone(selectedPhone.qualityRating)}
                  />
                  {selectedPhone.qualityLastErrorCode && (
                    <InlineAlert tone="warn" title="Last send error">
                      Meta code {selectedPhone.qualityLastErrorCode}
                      {selectedPhone.qualityLastErrorAt
                        ? ` · ${formatDateTime(selectedPhone.qualityLastErrorAt)}`
                        : ""}
                    </InlineAlert>
                  )}
                </ChannelCard>

                <div className="xl:col-span-2">
                  <ChannelCard
                    icon={Unplug}
                    title="Coexistence recovery"
                    action={
                      <StatusBadge tone={selectedAccount.coexRecovery.tone}>
                        {statusIcon(selectedAccount.coexRecovery.tone)}
                        {formatCoexState(selectedAccount.coexRecovery.state)}
                      </StatusBadge>
                    }
                  >
                    <div
                      className={`flex items-start gap-3 rounded-xl border p-4 ${tonePanelClass(
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
                        title="OpenBSP next steps"
                        steps={selectedAccount.coexRecovery.operatorSteps}
                      />
                      <RecoverySteps
                        title="Client phone check"
                        steps={selectedAccount.coexRecovery.customerSteps}
                      />
                    </div>

                    <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-3">
                      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                        <ListChecks size={14} />
                        Meta signals
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {selectedAccount.coexRecovery.evidence.map((item) => (
                          <span
                            key={item}
                            className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600"
                          >
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>
                  </ChannelCard>
                </div>

                <ChannelCard icon={Unplug} title="Account identifiers">
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
                    label="Business Portfolio ID"
                    value={selectedAccount.businessPortfolioId ?? "Not captured"}
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
                    label="Throughput"
                    value={selectedPhone.throughputLevel ?? "Not synced"}
                  />
                </ChannelCard>
              </div>
            </div>
          ) : (
            <div className="p-6">
              <EmptyPanel
                icon={Smartphone}
                title="Select a channel"
                body="Pick a connected phone number to inspect its health and Meta identifiers."
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
): ChannelHealth {
  const reasons: string[] = [];
  const now = Date.now();
  const circuitActive =
    Boolean(phone?.circuitBreakerUntil) &&
    (phone?.circuitBreakerUntil ?? 0) > now;

  if (account.status !== "active") {
    reasons.push(`WABA status is ${account.status}.`);
  }
  if (account.tokenStatus === "revoked") {
    reasons.push("Meta token is revoked or missing required scopes.");
  } else if (account.tokenStatus === "expiring") {
    reasons.push("Meta token is close to expiry.");
  }
  if (account.tokenStorage !== "encrypted") {
    reasons.push(`Token storage is ${formatTokenStorage(account.tokenStorage)}.`);
  }
  if (circuitActive) {
    reasons.push(
      phone?.circuitBreakerReason
        ? `${phone.circuitBreakerReason} until ${formatDateTime(
            phone.circuitBreakerUntil,
          )}.`
        : `Circuit breaker active until ${formatDateTime(
            phone?.circuitBreakerUntil,
          )}.`,
    );
  }
  if ((phone?.qualityRating ?? account.qualityRating) === "red") {
    reasons.push("Meta quality rating is red.");
  } else if ((phone?.qualityRating ?? account.qualityRating) === "yellow") {
    reasons.push("Meta quality rating is yellow.");
  }
  if (account.lastDisconnectionReason) {
    reasons.push(
      `Last disconnect: ${account.lastDisconnectionReason}${
        account.lastDisconnectionInitiatedBy
          ? ` by ${account.lastDisconnectionInitiatedBy}`
          : ""
      }.`,
    );
  }
  if (account.banState) {
    reasons.push(`Ban state: ${account.banState}.`);
  }

  if (
    account.status !== "active" ||
    account.tokenStatus === "revoked" ||
    circuitActive ||
    (phone?.qualityRating ?? account.qualityRating) === "red"
  ) {
    return {
      label: "Blocked",
      tone: "bad",
      headline: "Outbound should stay paused",
      body:
        "This channel has a Meta-side blocker or a local circuit breaker. Campaigns and manual sends should not rely on it until the issue clears.",
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
      reasons.push("Token health has not been checked yet.");
    }
    if (phone && !phone.lastMetaSyncAt) {
      reasons.push("Phone quality/tier has not been synced yet.");
    }
    return {
      label: "Needs review",
      tone: "warn",
      headline: "Send only after review",
      body:
        "The channel is not hard-blocked, but the operator should refresh Meta health before high-volume campaigns.",
      reasons,
    };
  }

  return {
    label: "Available",
    tone: "good",
    headline: "Ready for controlled sends",
    body:
      "WABA status, token health, quality and local circuit breaker are clear for normal operation.",
    reasons,
  };
}

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
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
    <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-center">
      <Icon size={24} className="mx-auto text-slate-300" />
      <div className="mt-3 text-sm font-semibold text-[#0a1b33]">{title}</div>
      <p className="mt-1 text-sm leading-6 text-slate-500">{body}</p>
    </div>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className="h-[68px] animate-pulse rounded-xl border border-slate-100 bg-slate-50"
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
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon size={17} className="text-slate-500" />
          <h3 className="font-[var(--font-outfit)] text-lg font-semibold text-[#0a1b33]">
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
  return (
    <div className="border-b border-slate-100 py-3 last:border-b-0">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 flex items-center gap-2">
        <div
          className={`min-w-0 flex-1 truncate text-sm font-semibold text-[#0a1b33] ${
            mono ? "font-[var(--font-mono)]" : ""
          }`}
        >
          {value}
        </div>
        {copy && (
          <button
            type="button"
            onClick={copy}
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-[#0a1b33]"
            aria-label={`Copy ${label}`}
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
    <div className={`rounded-xl border p-3 ${metricClass(tone)}`}>
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
    <div className="flex items-start gap-3 border-b border-slate-100 py-3 last:border-b-0">
      <span
        className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${toneIconClass(
          tone,
        )}`}
      >
        <Icon size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-slate-500">{label}</div>
        <div className="mt-0.5 break-words text-sm font-semibold text-[#0a1b33]">
          {value}
        </div>
      </div>
    </div>
  );
}

function RecoverySteps({ title, steps }: { title: string; steps: string[] }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-white p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#0a1b33]">
        <ListChecks size={15} className="text-slate-500" />
        {title}
      </div>
      <ol className="space-y-2">
        {steps.map((step, index) => (
          <li key={step} className="flex gap-3 text-sm leading-6 text-slate-600">
            <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-500">
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
    <div className={`mt-3 flex items-start gap-3 rounded-xl border p-3 ${tonePanelClass(tone)}`}>
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
  return "border-slate-200 bg-slate-50 text-[#0a1b33]";
}

function toneIconClass(tone: Tone) {
  if (tone === "good") return "bg-emerald-50 text-emerald-600";
  if (tone === "bad") return "bg-red-50 text-red-600";
  if (tone === "warn") return "bg-amber-50 text-amber-600";
  return "bg-slate-50 text-slate-500";
}

function badgeClass(tone: Tone) {
  if (tone === "good") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (tone === "bad") return "border-red-200 bg-red-50 text-red-700";
  if (tone === "warn") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function dotClass(tone: Tone) {
  if (tone === "good") return "bg-emerald-500";
  if (tone === "bad") return "bg-red-500";
  if (tone === "warn") return "bg-amber-400";
  return "bg-slate-300";
}

function metricClass(tone: Tone) {
  if (tone === "good") return "border-emerald-100 bg-emerald-50 text-emerald-700";
  if (tone === "bad") return "border-red-100 bg-red-50 text-red-700";
  if (tone === "warn") return "border-amber-100 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function tonePanelClass(tone: Tone) {
  if (tone === "good") return "border-emerald-100 bg-emerald-50 text-emerald-800";
  if (tone === "bad") return "border-red-100 bg-red-50 text-red-800";
  if (tone === "warn") return "border-amber-100 bg-amber-50 text-amber-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function formatDateTime(value?: number) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatRelative(value: number) {
  const seconds = Math.max(1, Math.floor((Date.now() - value) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return formatDateTime(value);
}

function formatExpiry(value?: number) {
  if (!value) return "No expiry reported";
  if (value <= Date.now()) return `Expired ${formatDateTime(value)}`;
  return `Expires ${formatDateTime(value)}`;
}

function formatTokenStorage(value: WabaAccount["tokenStorage"]) {
  if (value === "encrypted") return "Encrypted";
  if (value === "legacy_plaintext") return "Legacy plaintext";
  return "Missing";
}

function formatOnboardingSource(value?: WabaAccount["onboardingSource"]) {
  if (value === "embedded_signup") return "Embedded Signup";
  if (value === "manual") return "Manual connection";
  if (value === "api") return "API connection";
  return "Unknown";
}

function formatCoexState(state: WabaAccount["coexRecovery"]["state"]) {
  if (state === "connected") return "Connected";
  if (state === "needs_reconnect") return "Reconnect required";
  if (state === "watch") return "Watch";
  return "Manual review";
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
