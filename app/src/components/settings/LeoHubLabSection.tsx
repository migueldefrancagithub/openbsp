"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Copy,
  FlaskConical,
  Loader2,
  MessageSquareText,
  Power,
  PowerOff,
  RefreshCw,
} from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

type Notice =
  | { kind: "success"; message: string }
  | { kind: "error"; message: string }
  | null;

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

function generateWebhookSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function LeoHubLabSection() {
  const channels = useQuery(api.channels.list, {});
  const configure = useAction(api.leoHubLab.configure);
  const checkHealth = useAction(api.leoHubLab.checkHealth);
  const sendText = useAction(api.leoHubLab.sendText);
  const setSendMode = useMutation(api.channels.setSendMode);
  const labChannels = useMemo(
    () => (channels ?? []).filter((channel) => channel.provider === "lab_bridge"),
    [channels],
  );
  const [selectedId, setSelectedId] = useState<Id<"channels"> | null>(null);
  const selected =
    labChannels.find((channel) => channel._id === selectedId) ?? labChannels[0];
  const events = useQuery(
    api.channels.listRecentEvents,
    selected ? { channelId: selected._id, limit: 8 } : "skip",
  );
  const outbox = useQuery(
    api.channels.listRecentOutbox,
    selected ? { channelId: selected._id, limit: 8 } : "skip",
  );

  const [externalChannelId, setExternalChannelId] = useState("");
  const [displayName, setDisplayName] = useState("OpenBSP Lab");
  const [channelToken, setChannelToken] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [allowlist, setAllowlist] = useState("");
  const [testRecipient, setTestRecipient] = useState("");
  const [testText, setTestText] = useState("Ping do OpenBSP Lab");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    if (!selectedId && labChannels[0]) setSelectedId(labChannels[0]._id);
  }, [labChannels, selectedId]);

  useEffect(() => {
    if (selected?.outboundAllowlist[0] && !testRecipient) {
      setTestRecipient(selected.outboundAllowlist[0]);
    }
  }, [selected, testRecipient]);

  async function handleConfigure(event: FormEvent) {
    event.preventDefault();
    setBusy("configure");
    setNotice(null);
    try {
      const result = await configure({
        externalChannelId,
        displayName,
        channelToken,
        webhookSecret,
        outboundAllowlist: allowlist
          .split(/[,;\n]+/)
          .map((value) => value.trim())
          .filter(Boolean),
      });
      setSelectedId(result.channelId);
      setChannelToken("");
      setWebhookSecret("");
      setNotice({
        kind: "success",
        message: `Canal validado e guardado. Configure o webhook ${result.webhookPath} no Hub, depois ative a allowlist.`,
      });
    } catch (error) {
      setNotice({ kind: "error", message: errorMessage(error) });
    } finally {
      setBusy(null);
    }
  }

  async function handleMode(enabled: boolean) {
    if (!selected) return;
    setBusy("mode");
    setNotice(null);
    try {
      await setSendMode({
        channelId: selected._id,
        sendMode: enabled ? "allowlist" : "disabled",
      });
      setNotice({
        kind: "success",
        message: enabled
          ? "Envios liberados somente para a allowlist."
          : "Kill switch ativado. Nenhum envio de laboratório será aceito.",
      });
    } catch (error) {
      setNotice({ kind: "error", message: errorMessage(error) });
    } finally {
      setBusy(null);
    }
  }

  async function handleHealth() {
    if (!selected) return;
    setBusy("health");
    setNotice(null);
    try {
      const result = await checkHealth({ channelId: selected._id });
      setNotice({
        kind: result.ok ? "success" : "error",
        message: result.ok
          ? "Token, número e saúde do canal foram validados."
          : "O Hub respondeu, mas o canal está degradado. Veja os detalhes de saúde.",
      });
    } catch (error) {
      setNotice({ kind: "error", message: errorMessage(error) });
    } finally {
      setBusy(null);
    }
  }

  async function handleSend(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy("send");
    setNotice(null);
    try {
      const result = await sendText({
        channelId: selected._id,
        to: testRecipient,
        text: testText,
        clientNonce: crypto.randomUUID(),
      });
      setNotice({
        kind: result.status === "accepted" ? "success" : "error",
        message:
          result.status === "accepted"
            ? `Mensagem aceita pelo Hub: ${result.providerMessageId ?? result.outboxId}`
            : `Envio terminou em ${result.status}. Consulte o outbox abaixo.`,
      });
    } catch (error) {
      setNotice({ kind: "error", message: errorMessage(error) });
    } finally {
      setBusy(null);
    }
  }

  async function copyWebhook() {
    if (!selected?.webhookUrl) return;
    await navigator.clipboard.writeText(selected.webhookUrl);
    setNotice({ kind: "success", message: "Webhook copiado." });
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-violet-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-violet-100 bg-violet-50/50 px-6 py-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
            <FlaskConical size={17} />
          </div>
          <div>
            <h2 className="text-[15px] font-semibold text-[#0a1b33]">
              WhatsApp laboratory bridge
            </h2>
            <p className="mt-0.5 max-w-2xl text-xs leading-5 text-slate-500">
              Temporary Leo Hub adapter for a second test channel. It never
              enters the official Meta dispatcher, existing WABA, campaigns,
              or production inbox.
            </p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-md border border-violet-200 bg-white px-2 py-1 text-[11px] font-semibold text-violet-700">
          <AlertTriangle size={12} /> Lab only
        </span>
      </div>

      <div className="space-y-6 p-6">
        {notice && (
          <div
            className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm ${
              notice.kind === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-red-200 bg-red-50 text-red-800"
            }`}
          >
            {notice.kind === "success" ? (
              <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
            ) : (
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            )}
            {notice.message}
          </div>
        )}

        {labChannels.length > 0 && selected && (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <Metric label="Channel" value={selected.displayName} />
              <Metric label="Health" value={selected.lastHealthStatus ?? selected.status} />
              <Metric label="Send mode" value={selected.sendMode} />
            </div>
            {labChannels.length > 1 && (
              <select
                value={selected._id}
                onChange={(event) =>
                  setSelectedId(event.target.value as Id<"channels">)
                }
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-[#0a1b33] outline-none focus:border-violet-400 md:max-w-sm"
              >
                {labChannels.map((channel) => (
                  <option key={channel._id} value={channel._id}>
                    {channel.displayName} · {channel.externalAccountId}
                  </option>
                ))}
              </select>
            )}

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Dedicated webhook
              </div>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <code className="min-w-0 flex-1 break-all rounded-lg bg-white px-3 py-2 text-[11px] text-slate-600">
                  {selected.webhookUrl ??
                    `/provider-webhook/leo-hub/${selected.publicId}`}
                </code>
                <button
                  type="button"
                  disabled={!selected.webhookUrl}
                  onClick={copyWebhook}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:border-slate-300 disabled:opacity-40"
                >
                  <Copy size={13} /> Copy
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => handleMode(selected.sendMode === "disabled")}
                className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-white disabled:opacity-50 ${
                  selected.sendMode === "disabled"
                    ? "bg-violet-700 hover:bg-violet-800"
                    : "bg-slate-700 hover:bg-slate-800"
                }`}
              >
                {busy === "mode" ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : selected.sendMode === "disabled" ? (
                  <Power size={13} />
                ) : (
                  <PowerOff size={13} />
                )}
                {selected.sendMode === "disabled"
                  ? "Enable allowlist"
                  : "Activate kill switch"}
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={handleHealth}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:border-slate-300 disabled:opacity-50"
              >
                {busy === "health" ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <RefreshCw size={13} />
                )}
                Check health
              </button>
            </div>

            <form
              onSubmit={handleSend}
              className="grid gap-3 rounded-xl border border-slate-200 p-4 md:grid-cols-[220px_1fr_auto] md:items-end"
            >
              <Field
                label="Allowlisted recipient"
                value={testRecipient}
                onChange={setTestRecipient}
                placeholder="258840000099"
              />
              <Field
                label="Test message"
                value={testText}
                onChange={setTestText}
                placeholder="Ping do OpenBSP Lab"
              />
              <button
                type="submit"
                disabled={busy !== null || selected.sendMode === "disabled"}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#0a152d] px-4 text-xs font-medium text-white hover:bg-[#0a1b33] disabled:opacity-40"
              >
                {busy === "send" ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <MessageSquareText size={13} />
                )}
                Send test
              </button>
            </form>

            <div className="grid gap-4 lg:grid-cols-2">
              <ActivityList
                title="Inbound events"
                empty="No signed webhook received yet."
                rows={(events ?? []).map((event) => ({
                  id: event._id,
                  title: event.eventKind,
                  detail: event.actorProviderScopedId ?? event.eventKey,
                  status: event.status,
                }))}
              />
              <ActivityList
                title="Laboratory outbox"
                empty="No laboratory send attempted yet."
                rows={(outbox ?? []).map((item) => ({
                  id: item._id,
                  title: `${item.messageKind} · ${item.recipient}`,
                  detail: item.providerMessageId ?? item.businessKey,
                  status: item.status,
                }))}
              />
            </div>
          </div>
        )}

        <details open={labChannels.length === 0} className="group">
          <summary className="cursor-pointer list-none text-sm font-semibold text-[#0a1b33]">
            {labChannels.length === 0
              ? "Connect the second Hub channel"
              : "Connect or rotate a laboratory channel"}
          </summary>
          <form onSubmit={handleConfigure} className="mt-4 space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field
                label="Hub channel ID"
                value={externalChannelId}
                onChange={setExternalChannelId}
                placeholder="ID from Channel details"
              />
              <Field
                label="Display name"
                value={displayName}
                onChange={setDisplayName}
                placeholder="OpenBSP Lab"
              />
              <SecretField
                label="Channel token"
                value={channelToken}
                onChange={setChannelToken}
                placeholder="Paste only here, never in chat"
              />
              <div>
                <SecretField
                  label="Webhook HMAC secret"
                  value={webhookSecret}
                  onChange={setWebhookSecret}
                  placeholder="32+ random characters"
                />
                <div className="mt-1.5 flex gap-3">
                  <button
                    type="button"
                    onClick={() => setWebhookSecret(generateWebhookSecret())}
                    className="text-[11px] font-medium text-violet-700 hover:text-violet-900"
                  >
                    Generate secure secret
                  </button>
                  <button
                    type="button"
                    disabled={!webhookSecret}
                    onClick={async () => {
                      await navigator.clipboard.writeText(webhookSecret);
                      setNotice({
                        kind: "success",
                        message:
                          "HMAC secret copied. Configure this exact value in the Hub before submitting.",
                      });
                    }}
                    className="text-[11px] font-medium text-slate-500 hover:text-slate-800 disabled:opacity-40"
                  >
                    Copy secret
                  </button>
                </div>
              </div>
              <div className="md:col-span-2">
                <Field
                  label="Outbound allowlist"
                  value={allowlist}
                  onChange={setAllowlist}
                  placeholder="258840000099, one or more test numbers"
                />
              </div>
            </div>
            <p className="text-[11px] leading-5 text-slate-500">
              The token and HMAC secret are encrypted server-side. The channel
              starts with the kill switch active, even after successful token
              validation.
            </p>
            <button
              type="submit"
              disabled={busy !== null}
              className="inline-flex items-center gap-2 rounded-lg bg-violet-700 px-4 py-2.5 text-xs font-medium text-white hover:bg-violet-800 disabled:opacity-50"
            >
              {busy === "configure" && (
                <Loader2 size={13} className="animate-spin" />
              )}
              Validate and store laboratory channel
            </button>
          </form>
        </details>
      </div>
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-slate-600">
        {label}
      </span>
      <input
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm text-[#0a1b33] outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
      />
    </label>
  );
}

function SecretField(props: Parameters<typeof Field>[0]) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-slate-600">
        {props.label}
      </span>
      <input
        type="password"
        required
        autoComplete="off"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={props.placeholder}
        className="h-10 w-full rounded-lg border border-slate-200 px-3 font-mono text-sm text-[#0a1b33] outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
      />
    </label>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className="mt-1 truncate text-sm font-semibold text-[#0a1b33]">
        {value}
      </div>
    </div>
  );
}

function ActivityList({
  title,
  empty,
  rows,
}: {
  title: string;
  empty: string;
  rows: Array<{ id: string; title: string; detail: string; status: string }>;
}) {
  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="flex items-center gap-2 text-xs font-semibold text-[#0a1b33]">
        <Activity size={13} /> {title}
      </div>
      {rows.length === 0 ? (
        <p className="mt-3 text-xs text-slate-400">{empty}</p>
      ) : (
        <div className="mt-3 space-y-2">
          {rows.map((row) => (
            <div key={row.id} className="rounded-lg bg-slate-50 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-medium text-[#0a1b33]">
                  {row.title}
                </span>
                <span className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                  {row.status}
                </span>
              </div>
              <div className="mt-1 truncate font-mono text-[10px] text-slate-400">
                {row.detail}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
