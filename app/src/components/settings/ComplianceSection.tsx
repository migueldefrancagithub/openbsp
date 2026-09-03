"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { useI18n, type Locale } from "@/lib/i18n";
import { convexErrorMessage } from "@/lib/convexErrorMessage";

function errorMessage(error: unknown, locale: Locale): string {
  return convexErrorMessage(error, locale, locale === "pt" ? "Não foi possível guardar." : "Could not save.");
}

function formatDate(timestamp: number, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "pt" ? "pt-MZ" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

export function ComplianceSection() {
  const { locale, tr } = useI18n();
  const status = useQuery(api.compliance.status, {});
  const accept = useMutation(api.compliance.acceptDataProcessingTerms);

  const [controllerName, setControllerName] = useState("");
  const [controllerEmail, setControllerEmail] = useState("");
  const [acceptDpa, setAcceptDpa] = useState(false);
  const [confirmDpia, setConfirmDpia] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!status) return;
    setControllerName((current) => current || status.controllerName);
    setControllerEmail((current) => current || status.controllerEmail);
  }, [status]);

  if (status === undefined) {
    return (
      <div className="h-40 animate-pulse rounded-lg border border-line bg-surface" />
    );
  }

  if (status.ready) {
    return (
      <section className="rounded-lg border border-line bg-surface">
        <header className="flex items-center gap-2.5 border-b border-line-soft px-4 py-3">
          <ShieldCheck size={16} className="text-emerald-600" />
          <h2 className="font-[var(--font-display)] text-[14px] font-medium text-ink">
            {tr("Proteção de dados", "Data protection")}
          </h2>
        </header>
        <div className="space-y-1 px-4 py-3 text-[13px]">
          <Row label={tr("Responsável", "Controller")} value={status.controllerName} />
          <Row label={tr("Contacto", "Contact")} value={status.controllerEmail} />
          <Row
            label={tr("Acordo aceite", "Agreement accepted")}
            value={formatDate(status.dpaSignedAt!, locale)}
          />
          <Row
            label={tr("Avaliação de impacto", "Impact assessment")}
            value={formatDate(status.dpiaCompletedAt!, locale)}
          />
          <p className="pt-2 text-[12px] text-muted">
            {tr(
              "Os canais já podem ser ligados. A aceitação é registada uma única vez e não muda ao reabrir esta página.",
              "Channels can be connected. Acceptance is recorded once and is not re-dated when this page is reopened.",
            )}
          </p>
        </div>
      </section>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await accept({
        controllerName,
        controllerEmail,
        acceptDpa,
        confirmDpiaCompleted: confirmDpia,
      });
    } catch (err) {
      setError(errorMessage(err, locale));
    } finally {
      setSaving(false);
    }
  }

  const complete =
    acceptDpa &&
    confirmDpia &&
    controllerName.trim().length >= 2 &&
    /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(controllerEmail.trim());

  return (
    <section className="rounded-lg border border-chip-warn-fg/25 bg-surface">
      <header className="flex items-center gap-2.5 border-b border-line-soft px-4 py-3">
        <ShieldCheck size={16} className="text-amber-600" />
        <div>
          <h2 className="font-[var(--font-display)] text-[14px] font-medium text-ink">
            {tr("Proteção de dados", "Data protection")}
          </h2>
          <p className="text-[12px] text-muted">
            {tr("Obrigatório antes de ligar qualquer canal.", "Required before any channel can be connected.")}
          </p>
        </div>
      </header>

      <form onSubmit={submit} className="space-y-3 px-4 py-3">
        <Field
          label={tr("Responsável pelo tratamento", "Data controller")}
          value={controllerName}
          onChange={setControllerName}
          placeholder={tr("Entidade legal responsável pelos dados", "Legal entity responsible for the data")}
        />
        <Field
          label={tr("Email do responsável", "Controller contact email")}
          value={controllerEmail}
          onChange={setControllerEmail}
          type="email"
          placeholder="privacy@example.com"
        />

        <Check
          checked={acceptDpa}
          onChange={setAcceptDpa}
          label={tr(
            "Aceito o Acordo de Tratamento de Dados em nome desta entidade.",
            "I accept the Data Processing Agreement on behalf of this controller.",
          )}
        />
        <Check
          checked={confirmDpia}
          onChange={setConfirmDpia}
          label={tr(
            "Confirmo que foi concluída uma Avaliação de Impacto de Proteção de Dados para este uso de mensagens.",
            "I confirm a Data Protection Impact Assessment has been completed for this use of messaging data.",
          )}
        />

        {!status.canAccept && (
          <p className="text-[12px] text-chip-warn-fg">
            {tr("Apenas o proprietário do espaço pode aceitar estes termos.", "Only the workspace owner can accept these terms.")}
          </p>
        )}
        {error && <p className="text-[12px] text-chip-danger-fg">{error}</p>}

        <button
          type="submit"
          disabled={!complete || saving || !status.canAccept}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-nav-active px-4 text-[13px] font-medium text-white outline-none hover:bg-[#132145] disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-[#3d52d5] focus-visible:ring-offset-2"
        >
          {saving ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <CheckCircle2 size={14} />
          )}
          {tr("Registar aceitação", "Record acceptance")}
        </button>
      </form>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className="text-right font-medium text-ink">{value}</span>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-body">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-lg border border-line px-3 text-[13px] outline-none focus:border-brand-solid/40"
      />
    </label>
  );
}

function Check({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 text-[12px] leading-relaxed text-body">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[#0a152d]"
      />
      {label}
    </label>
  );
}
