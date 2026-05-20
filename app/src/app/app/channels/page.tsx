"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Copy,
  Link2,
  Phone,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Unplug,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/app/EmptyState";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

type ChannelPhone = {
  _id: Id<"phoneNumbers">;
  phoneNumberId: string;
  e164: string;
  displayName: string;
  qualityRating?: string;
  circuitBreakerUntil?: number;
  circuitBreakerReason?: string;
};

type WabaAccount = {
  _id: Id<"whatsappAccounts">;
  wabaId: string;
  status: string;
  qualityRating?: string;
  tokenStatus: string;
  validatedAt?: number;
  tokenExpiresAt?: number;
  phoneNumbers: ChannelPhone[];
};

export default function ChannelsPage() {
  const accounts = useQuery(api.whatsappAccounts.listForTenant) as
    | WabaAccount[]
    | undefined;
  const [selectedAccountId, setSelectedAccountId] =
    useState<Id<"whatsappAccounts"> | null>(null);
  const [selectedPhoneId, setSelectedPhoneId] =
    useState<Id<"phoneNumbers"> | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

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

  async function copyValue(value: string, label: string) {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(null), 1600);
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
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                      <Building2 size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-[#0a1b33]">
                        WABA {account.wabaId}
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        WhatsApp · {account.phoneNumbers.length} channel
                        {account.phoneNumbers.length === 1 ? "" : "s"}
                      </span>
                    </span>
                    <HealthDot status={account.status} />
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
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                      <Phone size={17} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-[#0a1b33]">
                        {phone.displayName}
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        {phone.e164}
                      </span>
                    </span>
                    <CheckCircle2 size={15} className="text-emerald-500" />
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
          {selectedPhone && selectedAccount ? (
            <div>
              <div className="flex flex-col gap-4 border-b border-slate-200 bg-white p-6 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex h-20 w-20 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-xl font-semibold text-[#0a1b33]">
                    {initials(selectedPhone.displayName)}
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-[var(--font-outfit)] text-2xl font-semibold text-[#0a1b33]">
                        {selectedPhone.displayName}
                      </h2>
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                        <CheckCircle2 size={13} />
                        Active
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      Connected as {selectedPhone.displayName}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-[#0a1b33] transition-colors hover:border-slate-300"
                >
                  <RefreshCw size={15} />
                  Refresh health
                </button>
              </div>

              <div className="grid gap-4 p-6 xl:grid-cols-2">
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
                </ChannelCard>

                <ChannelCard icon={ShieldCheck} title="Message status">
                  <div className="flex items-start gap-3 rounded-xl border border-emerald-100 bg-emerald-50 p-4">
                    <span className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white text-emerald-600">
                      <CheckCircle2 size={16} />
                    </span>
                    <div>
                      <div className="text-sm font-semibold text-emerald-800">
                        Available
                      </div>
                      <p className="mt-1 text-sm leading-6 text-emerald-700">
                        This channel can send approved templates and respond
                        inside customer service windows.
                      </p>
                    </div>
                  </div>
                </ChannelCard>

                <ChannelCard icon={AlertTriangle} title="Channel health status">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <HealthMetric
                      label="WABA"
                      value={selectedAccount.status}
                      tone={selectedAccount.status === "active" ? "good" : "warn"}
                    />
                    <HealthMetric
                      label="Token"
                      value={selectedAccount.tokenStatus}
                      tone={selectedAccount.tokenStatus === "ok" ? "good" : "warn"}
                    />
                    <HealthMetric
                      label="Quality"
                      value={
                        selectedPhone.qualityRating ??
                        selectedAccount.qualityRating ??
                        "unknown"
                      }
                      tone={
                        (selectedPhone.qualityRating ?? selectedAccount.qualityRating) ===
                        "red"
                          ? "bad"
                          : "good"
                      }
                    />
                  </div>
                  {selectedPhone.circuitBreakerReason && (
                    <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                      {selectedPhone.circuitBreakerReason}
                    </div>
                  )}
                </ChannelCard>

                <ChannelCard icon={Unplug} title="Safe actions">
                  <div className="flex flex-wrap gap-2">
                    <ActionButton label="Update profile" />
                    <ActionButton label="Sync channel" />
                    <ActionButton label="Refetch" />
                    <ActionButton label="Disconnect" danger />
                  </div>
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

function HealthDot({ status }: { status: string }) {
  return (
    <span
      className={`h-2.5 w-2.5 rounded-full ${
        status === "active" ? "bg-emerald-500" : "bg-amber-400"
      }`}
    />
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
  tone: "good" | "warn" | "bad";
}) {
  const toneClass =
    tone === "good"
      ? "border-emerald-100 bg-emerald-50 text-emerald-700"
      : tone === "bad"
        ? "border-red-100 bg-red-50 text-red-700"
        : "border-amber-100 bg-amber-50 text-amber-700";
  return (
    <div className={`rounded-xl border p-3 ${toneClass}`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] opacity-75">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold capitalize">{value}</div>
    </div>
  );
}

function ActionButton({
  label,
  danger,
}: {
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={`inline-flex h-10 items-center justify-center rounded-lg border px-3 text-sm font-medium transition-colors ${
        danger
          ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
          : "border-slate-200 bg-white text-[#0a1b33] hover:border-slate-300"
      }`}
    >
      {label}
    </button>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}
