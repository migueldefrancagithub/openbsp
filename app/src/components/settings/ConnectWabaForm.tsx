"use client";

import { useState, FormEvent } from "react";
import { useAction } from "convex/react";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { useI18n } from "@/lib/i18n";

type Result =
  | { kind: "idle" }
  | { kind: "validating" }
  | { kind: "success"; scopes: string[] }
  | { kind: "error"; message: string };

export function ConnectWabaForm() {
  const { tr } = useI18n();
  const connect = useAction(api.whatsappAccounts.connectManual);
  const [metaAppId, setMetaAppId] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [phoneE164, setPhoneE164] = useState("");
  const [phoneDisplayName, setPhoneDisplayName] = useState("");
  const [systemUserToken, setSystemUserToken] = useState("");
  const [result, setResult] = useState<Result>({ kind: "idle" });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setResult({ kind: "validating" });
    try {
      const r = await connect({
        metaAppId,
        wabaId,
        phoneNumberId,
        phoneE164,
        phoneDisplayName,
        systemUserToken,
      });
      setResult({ kind: "success", scopes: r.validatedScopes });
      setSystemUserToken("");
    } catch (err: unknown) {
      const data = err && typeof err === "object" && "data" in err
        ? (err as { data: unknown }).data
        : null;
      const message =
        (data && typeof data === "object" && "reason" in data
          ? String((data as { reason: unknown }).reason)
          : null) ??
        (data && typeof data === "object" && "message" in data
          ? String((data as { message: unknown }).message)
          : null) ??
        (err instanceof Error ? err.message : tr("A ligação falhou", "Connection failed"));
      setResult({ kind: "error", message });
    }
  }

  const busy = result.kind === "validating";

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field
          label="Meta App ID"
          value={metaAppId}
          onChange={setMetaAppId}
          placeholder="123456789012345"
        />
        <Field
          label="WABA ID"
          value={wabaId}
          onChange={setWabaId}
          placeholder="WhatsApp Business Account ID"
        />
        <Field
          label={tr("ID do número de telefone", "Phone number ID")}
          value={phoneNumberId}
          onChange={setPhoneNumberId}
          placeholder="Meta phone_number_id"
        />
        <Field
          label={tr("Número E.164", "Phone E.164")}
          value={phoneE164}
          onChange={setPhoneE164}
          placeholder="+351912000000"
        />
        <div className="md:col-span-2">
          <Field
            label={tr("Nome de exibição", "Display name")}
            value={phoneDisplayName}
            onChange={setPhoneDisplayName}
            placeholder="Clínica X"
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-ink mb-1.5">
            {tr("Token de acesso do utilizador do sistema", "System user access token")}
          </label>
          <input
            type="password"
            required
            value={systemUserToken}
            onChange={(e) => setSystemUserToken(e.target.value)}
            placeholder="EAAB…"
            className="w-full px-3 py-2.5 rounded-lg border border-line text-sm font-mono text-ink focus:outline-none focus:ring-2 focus:ring-[#0a152d]/10 focus:border-[#0a152d] transition-all"
          />
          <p className="text-[11px] text-faint mt-1.5">
            {tr("Validado pela Graph API. Requer", "Validated via Graph API. Requires")} {" "}
            <code>whatsapp_business_messaging</code>,{" "}
            <code>whatsapp_business_management</code>,{" "}
            <code>business_management</code>. {tr(
              "Tokens de utilizadores pessoais são rejeitados. Os tokens ficam encriptados em repouso quando WABA_TOKEN_ENCRYPTION_KEY_V1 está definida.",
              "Personal user tokens are rejected. Tokens are encrypted at rest when WABA_TOKEN_ENCRYPTION_KEY_V1 is set.",
            )}
          </p>
        </div>
      </div>

      {result.kind === "success" && (
        <div className="flex items-start gap-2 text-chip-success-fg bg-chip-success border border-chip-success-fg/25 rounded-lg px-3 py-2.5 text-sm">
          <CheckCircle2 size={16} className="flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">{tr("Ligado.", "Connected.")}</div>
            <div className="text-xs text-emerald-700/80 mt-0.5">
              {tr("Permissões validadas", "Scopes validated")}: {result.scopes.join(", ")}
            </div>
          </div>
        </div>
      )}
      {result.kind === "error" && (
        <div className="flex items-start gap-2 text-chip-danger-fg bg-chip-danger border border-chip-danger-fg/25 rounded-lg px-3 py-2.5 text-sm">
          <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
          <div>{result.message}</div>
        </div>
      )}

      <button
        type="submit"
        disabled={busy}
        className="inline-flex items-center gap-2 bg-nav-active text-white text-[13px] font-medium px-4 py-2.5 rounded-lg shadow-[0_8px_24px_-8px_rgba(10,21,45,0.5)] hover:bg-brand-solid disabled:opacity-50 disabled:cursor-not-allowed transition-all"
      >
        {busy && <Loader2 size={14} className="animate-spin" />}
        {busy
          ? tr("A validar pela Graph API…", "Validating via Graph API…")
          : tr("Validar e ligar", "Validate and connect")}
      </button>
    </form>
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
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-ink mb-1.5">
        {label}
      </label>
      <input
        type="text"
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2.5 rounded-lg border border-line text-sm text-ink focus:outline-none focus:ring-2 focus:ring-[#0a152d]/10 focus:border-[#0a152d] transition-all"
      />
    </div>
  );
}
