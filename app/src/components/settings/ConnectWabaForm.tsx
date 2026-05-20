"use client";

import { useState, FormEvent } from "react";
import { useAction } from "convex/react";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { api } from "../../../convex/_generated/api";

type Result =
  | { kind: "idle" }
  | { kind: "validating" }
  | { kind: "success"; scopes: string[] }
  | { kind: "error"; message: string };

export function ConnectWabaForm() {
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
        (err instanceof Error ? err.message : "Connection failed");
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
          label="Phone number ID"
          value={phoneNumberId}
          onChange={setPhoneNumberId}
          placeholder="Meta phone_number_id"
        />
        <Field
          label="Phone E.164"
          value={phoneE164}
          onChange={setPhoneE164}
          placeholder="+351912000000"
        />
        <div className="md:col-span-2">
          <Field
            label="Display name"
            value={phoneDisplayName}
            onChange={setPhoneDisplayName}
            placeholder="Clínica X"
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-slate-700 mb-1.5">
            System user access token
          </label>
          <input
            type="password"
            required
            value={systemUserToken}
            onChange={(e) => setSystemUserToken(e.target.value)}
            placeholder="EAAB…"
            className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm font-mono text-[#0a1b33] focus:outline-none focus:ring-2 focus:ring-[#0a152d]/10 focus:border-[#0a152d] transition-all"
          />
          <p className="text-[11px] text-slate-400 mt-1.5">
            Validated via Graph API: requires{" "}
            <code>whatsapp_business_messaging</code>,{" "}
            <code>whatsapp_business_management</code>,{" "}
            <code>business_management</code>. Personal user tokens rejected.
          </p>
        </div>
      </div>

      {result.kind === "success" && (
        <div className="flex items-start gap-2 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5 text-sm">
          <CheckCircle2 size={16} className="flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">Connected.</div>
            <div className="text-xs text-emerald-700/80 mt-0.5">
              Scopes validated: {result.scopes.join(", ")}
            </div>
          </div>
        </div>
      )}
      {result.kind === "error" && (
        <div className="flex items-start gap-2 text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-sm">
          <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
          <div>{result.message}</div>
        </div>
      )}

      <button
        type="submit"
        disabled={busy}
        className="inline-flex items-center gap-2 bg-[#0a152d] text-white text-[13px] font-medium px-4 py-2.5 rounded-lg shadow-[0_8px_24px_-8px_rgba(10,21,45,0.5)] hover:bg-[#0a1b33] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
      >
        {busy && <Loader2 size={14} className="animate-spin" />}
        {busy ? "Validating via Graph API…" : "Validate and connect"}
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
      <label className="block text-xs font-medium text-slate-700 mb-1.5">
        {label}
      </label>
      <input
        type="text"
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm text-[#0a1b33] focus:outline-none focus:ring-2 focus:ring-[#0a152d]/10 focus:border-[#0a152d] transition-all"
      />
    </div>
  );
}
