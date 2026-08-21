"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  CheckCircle2,
  Copy,
  KeyRound,
  Loader2,
  Power,
  PowerOff,
  Radio,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { api } from "../../../convex/_generated/api";

function errorMessage(error: unknown): string {
  const data =
    error && typeof error === "object" && "data" in error
      ? (error as { data?: unknown }).data
      : null;
  if (data && typeof data === "object" && "message" in data) {
    return String((data as { message: unknown }).message);
  }
  if (data && typeof data === "object" && "code" in data) {
    return String((data as { code: unknown }).code);
  }
  return error instanceof Error ? error.message : "Operation failed.";
}

function generateSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function IaSolutionHubSection() {
  const channels = useQuery(api.channels.list, {});
  const createPending = useMutation(api.iaSolutionHub.createPendingChannel);
  const configure = useAction(api.iaSolutionHub.configureChannel);
  const checkHealth = useAction(api.iaSolutionHub.checkHealth);
  const setPilotMode = useMutation(api.iaSolutionHub.setPilotMode);
  const updateAllowlist = useMutation(api.iaSolutionHub.updateAllowlist);
  const hubChannels = useMemo(
    () =>
      (channels ?? []).filter(
        (channel) =>
          channel.provider === "iasolution_hub" &&
          channel.operationalTerritory === "openbsp",
      ),
    [channels],
  );
  const channel = hubChannels[0];

  const [displayName, setDisplayName] = useState("OpenBSP WhatsApp");
  const [externalChannelId, setExternalChannelId] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [channelToken, setChannelToken] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [allowlist, setAllowlist] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleCreate() {
    setBusy("create");
    setNotice(null);
    try {
      await createPending({ displayName });
      setNotice("Isolated channel reserved. It is disabled until a number is connected.");
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function handleConfigure(event: FormEvent) {
    event.preventDefault();
    if (!channel) return;
    setBusy("configure");
    setNotice(null);
    try {
      await configure({
        channelId: channel._id,
        externalChannelId,
        displayName,
        phoneNumber,
        wabaId,
        channelToken,
        webhookSecret,
        outboundAllowlist: allowlist
          .split(/[\s,;]+/)
          .map((value) => value.trim())
          .filter(Boolean),
      });
      setChannelToken("");
      setWebhookSecret("");
      setNotice("Credentials encrypted. Configure the dedicated webhook, then send one inbound test.");
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function handleHealth() {
    if (!channel) return;
    setBusy("health");
    setNotice(null);
    try {
      const result = await checkHealth({ channelId: channel._id });
      setNotice(result.ok ? "Channel health verified." : "Channel health check failed.");
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function handlePilot() {
    if (!channel) return;
    setBusy("pilot");
    setNotice(null);
    try {
      const enabling = channel.sendMode === "disabled";
      await setPilotMode({ channelId: channel._id, enabled: enabling });
      setNotice(enabling ? "Allowlist-only pilot enabled." : "Outbound kill switch enabled.");
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function handleAllowlist() {
    if (!channel) return;
    setBusy("allowlist");
    setNotice(null);
    try {
      await updateAllowlist({
        channelId: channel._id,
        outboundAllowlist: allowlist
          .split(/[\s,;]+/)
          .map((value) => value.trim())
          .filter(Boolean),
      });
      setNotice("Pilot allowlist updated. Outbound returned to disabled.");
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex flex-col gap-3 border-b border-slate-100 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Radio size={15} className="text-emerald-600" />
            <h2 className="text-[15px] font-semibold text-[#0a1b33]">
              Isolated iaSolution Hub channel
            </h2>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Awaiting Sidney&apos;s third, dedicated OpenBSP channel. Alfapay and
            the Cindy OTP/recovery channel are hard-denied.
          </p>
        </div>
        <span className="w-fit rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-600">
          {channel?.connectionState ?? "not created"}
        </span>
      </div>

      <div className="space-y-5 p-6">
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">
          Do not enter Alfapay or Cindy credentials here. Configuration remains
          default-deny until the new OpenBSP channel ID, number and WABA are
          explicitly allowlisted server-side.
        </div>
        {!channel ? (
          <div className="flex flex-col gap-4 rounded-xl border border-dashed border-slate-300 p-5 sm:flex-row sm:items-end">
            <Field
              label="Channel name"
              value={displayName}
              onChange={setDisplayName}
              placeholder="OpenBSP WhatsApp"
            />
            <button
              type="button"
              onClick={handleCreate}
              disabled={busy !== null || !displayName.trim()}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#0a152d] px-4 text-xs font-medium text-white disabled:opacity-50"
            >
              {busy === "create" ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
              Reserve isolated channel
            </button>
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Status label="Connection" value={channel.connectionState ?? channel.status} />
              <Status label="Webhook" value={channel.webhookStatus ?? "disabled"} />
              <Status label="Phone" value={channel.phoneNumber ?? "Waiting"} />
              <Status label="Outbound" value={channel.sendMode} />
            </div>

            {channel.webhookUrl && channel.webhookStatus !== "disabled" && (
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <code className="min-w-0 flex-1 truncate text-[11px] text-slate-600">
                  {channel.webhookUrl}
                </code>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(channel.webhookUrl!)}
                  className="rounded-md border border-slate-200 bg-white p-2 text-slate-500"
                  aria-label="Copy webhook URL"
                >
                  <Copy size={13} />
                </button>
              </div>
            )}

            {channel.connectionState === "pending_number" && (
              <form onSubmit={handleConfigure} className="grid gap-3 rounded-xl border border-slate-200 p-4 md:grid-cols-2">
                <Field label="Hub channel ID" value={externalChannelId} onChange={setExternalChannelId} placeholder="New isolated channel ID" />
                <Field label="Display name" value={displayName} onChange={setDisplayName} placeholder="OpenBSP WhatsApp" />
                <Field label="Connected number" value={phoneNumber} onChange={setPhoneNumber} placeholder="258..." />
                <Field label="WABA ID" value={wabaId} onChange={setWabaId} placeholder="Meta WABA ID" />
                <Field label="Channel token" value={channelToken} onChange={setChannelToken} placeholder="Stored encrypted" type="password" />
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="text-[11px] font-medium text-slate-600">Webhook HMAC secret</label>
                    <button
                      type="button"
                      onClick={() => {
                        const secret = generateSecret();
                        setWebhookSecret(secret);
                        void navigator.clipboard.writeText(secret);
                        setNotice("Webhook secret generated and copied. Store it before saving.");
                      }}
                      className="text-[10px] font-medium text-emerald-700"
                    >
                      Generate & copy
                    </button>
                  </div>
                  <input value={webhookSecret} onChange={(event) => setWebhookSecret(event.target.value)} type="password" placeholder="Copy before saving" className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-slate-400" />
                </div>
                <Field label="Pilot allowlist" value={allowlist} onChange={setAllowlist} placeholder="258..." />
                <div className="flex items-end">
                  <button type="submit" disabled={busy !== null} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#0a152d] px-4 text-xs font-medium text-white disabled:opacity-50">
                    {busy === "configure" ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} />}
                    Validate and encrypt
                  </button>
                </div>
              </form>
            )}

            {channel.connectionState !== "pending_number" && (
              <div className="space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <Field
                    label="Replace pilot allowlist"
                    value={allowlist}
                    onChange={setAllowlist}
                    placeholder="One or more E.164 numbers"
                  />
                  <button
                    type="button"
                    onClick={handleAllowlist}
                    disabled={busy !== null || !allowlist.trim()}
                    className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-600 disabled:opacity-40"
                  >
                    Save allowlist
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={handleHealth} disabled={busy !== null} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 disabled:opacity-50">
                    {busy === "health" ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                    Check health
                  </button>
                  <button type="button" onClick={handlePilot} disabled={busy !== null || channel.webhookStatus !== "verified"} className="inline-flex items-center gap-2 rounded-lg bg-[#0a152d] px-3 py-2 text-xs font-medium text-white disabled:opacity-40">
                    {channel.sendMode === "disabled" ? <Power size={13} /> : <PowerOff size={13} />}
                    {channel.sendMode === "disabled" ? "Enable allowlist pilot" : "Activate kill switch"}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {notice && (
          <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-600" />
            {notice}
          </div>
        )}
      </div>
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: "text" | "password";
}) {
  return (
    <label className="block flex-1">
      <span className="mb-1 block text-[11px] font-medium text-slate-600">{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-slate-400" />
    </label>
  );
}

function Status({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-slate-400">{label}</div>
      <div className="mt-1 truncate text-xs font-semibold text-[#0a1b33]">{value}</div>
    </div>
  );
}
