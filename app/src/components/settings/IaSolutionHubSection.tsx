"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
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
import { useI18n, type Locale } from "@/lib/i18n";
import { convexErrorMessage } from "@/lib/convexErrorMessage";

function errorMessage(error: unknown, locale: Locale): string {
  return convexErrorMessage(error, locale, locale === "pt" ? "A operação falhou." : "Operation failed.");
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
  const { locale, tr } = useI18n();
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
  const [prefillDigits, setPrefillDigits] = useState<string | null>(null);

  // The inbox pilot banner deep-links here with ?allowlistAdd=<digits>. Prefill
  // the replacement list with the current allowlist plus the new number; the
  // operator still saves and re-arms the pilot explicitly (ADR-003 §8-9).
  useEffect(() => {
    const digits = new URLSearchParams(window.location.search)
      .get("allowlistAdd")
      ?.replace(/\D/g, "");
    if (digits && digits.length >= 8) setPrefillDigits(digits);
  }, []);
  useEffect(() => {
    if (!prefillDigits || !channel) return;
    const current = channel.outboundAllowlist ?? [];
    if (current.includes(prefillDigits)) {
      setNotice(tr(
        "Este número já está na lista autorizada do piloto.",
        "This number is already on the pilot allowlist.",
      ));
      setPrefillDigits(null);
      return;
    }
    setAllowlist([...current, prefillDigits].join("\n"));
    setNotice(tr(
      "Número adicionado ao rascunho da lista. Guarde a lista e volte a ativar o piloto.",
      "Number added to the list draft. Save the list, then enable the pilot again.",
    ));
    setPrefillDigits(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillDigits, channel?._id]);

  async function handleCreate() {
    setBusy("create");
    setNotice(null);
    try {
      await createPending({ displayName });
      setNotice(tr(
        "Canal isolado reservado. Permanece desativado até ligar um número.",
        "Isolated channel reserved. It is disabled until a number is connected.",
      ));
    } catch (error) {
      setNotice(errorMessage(error, locale));
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
      setNotice(tr(
        "Credenciais encriptadas. Configure o webhook dedicado e envie um teste recebido.",
        "Credentials encrypted. Configure the dedicated webhook, then send one inbound test.",
      ));
    } catch (error) {
      setNotice(errorMessage(error, locale));
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
      setNotice(result.ok
        ? tr("Saúde do canal verificada.", "Channel health verified.")
        : tr("A verificação de saúde do canal falhou.", "Channel health check failed."));
    } catch (error) {
      setNotice(errorMessage(error, locale));
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
      setNotice(enabling
        ? tr("Piloto limitado à lista autorizada.", "Allowlist-only pilot enabled.")
        : tr("Bloqueio de envios ativado.", "Outbound kill switch enabled."));
    } catch (error) {
      setNotice(errorMessage(error, locale));
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
      setNotice(tr(
        "Lista autorizada atualizada. Os envios voltaram ao modo desativado.",
        "Pilot allowlist updated. Outbound returned to disabled.",
      ));
    } catch (error) {
      setNotice(errorMessage(error, locale));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section id="hub" className="scroll-mt-4 overflow-hidden rounded-lg border border-line bg-surface">
      <div className="flex flex-col gap-3 border-b border-line-soft px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Radio size={15} className="text-emerald-600" />
            <h2 className="text-[15px] font-semibold text-ink">
              {tr("Canal isolado do iaSolution Hub", "Isolated iaSolution Hub channel")}
            </h2>
          </div>
          <p className="mt-1 text-xs text-muted">
            {tr(
              "Ligação Alfapay autorizada para laboratório OpenBSP, isolada por organização, canal, webhook, HMAC e lista autorizada.",
              "Authorized Alfapay lab connection for OpenBSP, isolated by workspace, channel, webhook, HMAC, and allowlist.",
            )}
          </p>
        </div>
        <span className="w-fit rounded-md border border-line bg-surface-2 px-2 py-1 text-[11px] font-medium text-body">
          {statusLabel(channel?.connectionState ?? "not_created", locale)}
        </span>
      </div>

      <div className="space-y-5 p-6">
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">
          {tr(
            "A configuração bloqueia por padrão até o ID do canal, número e WABA autorizados serem validados no servidor. Os envios começam desativados e só entram em piloto após um ciclo de webhook assinado.",
            "Configuration remains default-deny until the authorized channel ID, phone number, and WABA are validated server-side. Outbound starts disabled and only enters pilot mode after a signed webhook round trip.",
          )}
        </div>
        {!channel ? (
          <div className="flex flex-col gap-4 rounded-lg border border-dashed border-line p-5 sm:flex-row sm:items-end">
            <Field
              label={tr("Nome do canal", "Channel name")}
              value={displayName}
              onChange={setDisplayName}
              placeholder="OpenBSP WhatsApp"
            />
            <button
              type="button"
              onClick={handleCreate}
              disabled={busy !== null || !displayName.trim()}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-nav-active px-4 text-xs font-medium text-white disabled:opacity-50"
            >
              {busy === "create" ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
              {tr("Reservar canal isolado", "Reserve isolated channel")}
            </button>
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Status label={tr("Ligação", "Connection")} value={statusLabel(channel.connectionState ?? channel.status, locale)} />
              <Status label="Webhook" value={statusLabel(channel.webhookStatus ?? "disabled", locale)} />
              <Status label={tr("Número", "Phone")} value={channel.phoneNumber ?? tr("A aguardar", "Waiting")} />
              <Status label={tr("Envios", "Outbound")} value={statusLabel(channel.sendMode, locale)} />
            </div>

            {channel.webhookUrl && channel.webhookStatus !== "disabled" && (
              <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2">
                <code className="min-w-0 flex-1 truncate text-[11px] text-body">
                  {channel.webhookUrl}
                </code>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(channel.webhookUrl!)}
                  className="rounded-md border border-line bg-surface p-2 text-muted"
                  aria-label={tr("Copiar URL do webhook", "Copy webhook URL")}
                >
                  <Copy size={13} />
                </button>
              </div>
            )}

            {channel.connectionState === "pending_number" && (
              <form onSubmit={handleConfigure} className="grid gap-3 rounded-lg border border-line p-4 md:grid-cols-2">
                <Field
                  label="Hub channel ID"
                  value={externalChannelId}
                  onChange={setExternalChannelId}
                  placeholder={tr("Novo ID isolado do canal", "New isolated channel ID")}
                />
                <Field label={tr("Nome de exibição", "Display name")} value={displayName} onChange={setDisplayName} placeholder="OpenBSP WhatsApp" />
                <Field label={tr("Número ligado", "Connected number")} value={phoneNumber} onChange={setPhoneNumber} placeholder="258..." />
                <Field label="WABA ID" value={wabaId} onChange={setWabaId} placeholder="Meta WABA ID" />
                <Field label={tr("Token do canal", "Channel token")} value={channelToken} onChange={setChannelToken} placeholder={tr("Guardado de forma encriptada", "Stored encrypted")} type="password" />
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="text-[11px] font-medium text-body">{tr("Segredo HMAC do webhook", "Webhook HMAC secret")}</label>
                    <button
                      type="button"
                      onClick={() => {
                        const secret = generateSecret();
                        setWebhookSecret(secret);
                        void navigator.clipboard.writeText(secret);
                        setNotice(tr(
                          "Segredo do webhook gerado e copiado. Guarde-o antes de gravar.",
                          "Webhook secret generated and copied. Store it before saving.",
                        ));
                      }}
                      className="text-[10px] font-medium text-emerald-700"
                    >
                      {tr("Gerar e copiar", "Generate & copy")}
                    </button>
                  </div>
                  <input value={webhookSecret} onChange={(event) => setWebhookSecret(event.target.value)} type="password" placeholder={tr("Copie antes de gravar", "Copy before saving")} className="h-10 w-full rounded-lg border border-line px-3 text-sm outline-none focus:border-brand-solid/40" />
                </div>
                <Field label={tr("Lista autorizada do piloto", "Pilot allowlist")} value={allowlist} onChange={setAllowlist} placeholder="258..." />
                <div className="flex items-end">
                  <button type="submit" disabled={busy !== null} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-nav-active px-4 text-xs font-medium text-white disabled:opacity-50">
                    {busy === "configure" ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} />}
                    {tr("Validar e encriptar", "Validate and encrypt")}
                  </button>
                </div>
              </form>
            )}

            {channel.connectionState !== "pending_number" && (
              <div className="space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <Field
                    label={tr("Substituir lista autorizada", "Replace pilot allowlist")}
                    value={allowlist}
                    onChange={setAllowlist}
                    placeholder={tr("Um ou mais números E.164", "One or more E.164 numbers")}
                  />
                  <button
                    type="button"
                    onClick={handleAllowlist}
                    disabled={busy !== null || !allowlist.trim()}
                    className="inline-flex h-10 items-center justify-center rounded-lg border border-line px-3 text-xs font-medium text-body disabled:opacity-40"
                  >
                    {tr("Guardar lista", "Save allowlist")}
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={handleHealth} disabled={busy !== null} className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs font-medium text-body disabled:opacity-50">
                    {busy === "health" ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                    {tr("Verificar saúde", "Check health")}
                  </button>
                  <button type="button" onClick={handlePilot} disabled={busy !== null || channel.webhookStatus !== "verified"} className="inline-flex items-center gap-2 rounded-lg bg-nav-active px-3 py-2 text-xs font-medium text-white disabled:opacity-40">
                    {channel.sendMode === "disabled" ? <Power size={13} /> : <PowerOff size={13} />}
                    {channel.sendMode === "disabled"
                      ? tr("Ativar piloto autorizado", "Enable allowlist pilot")
                      : tr("Bloquear envios", "Activate kill switch")}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {notice && (
          <div className="flex items-start gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-body">
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
      <span className="mb-1 block text-[11px] font-medium text-body">{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="h-10 w-full rounded-lg border border-line px-3 text-sm outline-none focus:border-brand-solid/40" />
    </label>
  );
}

function Status({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-faint">{label}</div>
      <div className="mt-1 truncate text-xs font-semibold text-ink">{value}</div>
    </div>
  );
}

function statusLabel(value: string, locale: Locale) {
  if (locale !== "pt") return value.replaceAll("_", " ");
  const labels: Record<string, string> = {
    active: "ativo",
    disabled: "desativado",
    not_created: "não criado",
    pending: "pendente",
    pending_number: "aguarda número",
    pilot_allowlist: "piloto autorizado",
    verified: "verificado",
  };
  return labels[value] ?? value.replaceAll("_", " ");
}
