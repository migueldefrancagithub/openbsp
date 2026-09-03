"use client";

import { useState } from "react";
import Link from "next/link";
import { useAction } from "convex/react";
import { CheckCircle2, CircleDashed, Loader2, Stethoscope, TriangleAlert, XCircle } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { cn } from "@/lib/cn";
import { convexErrorMessage } from "@/lib/convexErrorMessage";
import { useI18n } from "@/lib/i18n";

type Check = { key: string; status: "ok" | "warn" | "fail" | "skipped"; detail: string; href?: string; latencyMs?: number };

const LABEL_PT: Record<string, string> = {
  database: "Base de dados",
  channel: "Canal de WhatsApp",
  outbox: "Fila de envio",
  ai_key: "Chave de IA",
  ai_provider: "Ligação ao provedor",
  automation: "Agentes no ar",
};

const LABEL_EN: Record<string, string> = {
  database: "Database",
  channel: "WhatsApp channel",
  outbox: "Send queue",
  ai_key: "AI key",
  ai_provider: "Provider connection",
  automation: "Live agents",
};

const ICONS = {
  ok: { Icon: CheckCircle2, tone: "text-chip-success-fg" },
  warn: { Icon: TriangleAlert, tone: "text-chip-warn-fg" },
  fail: { Icon: XCircle, tone: "text-chip-danger-fg" },
  skipped: { Icon: CircleDashed, tone: "text-faint" },
} as const;

/**
 * One click, one verdict per piece, and the next step attached.
 *
 * The parts were already checkable, each on its own screen. Someone whose
 * clinic just went quiet does not want a tour of six pages — they want to know
 * which link in the chain is broken.
 */
export function DiagnosticsCard() {
  const { locale, tr } = useI18n();
  const run = useAction(api.diagnostics.run);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [ranAt, setRanAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function diagnose() {
    setBusy(true);
    setError(null);
    try {
      const result = await run({});
      setChecks(result.checks as Check[]);
      setRanAt(result.ranAt);
    } catch (err) {
      setError(convexErrorMessage(err, locale));
    } finally {
      setBusy(false);
    }
  }

  const worst = checks?.some((check) => check.status === "fail")
    ? "fail"
    : checks?.some((check) => check.status === "warn")
      ? "warn"
      : checks
        ? "ok"
        : null;

  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Stethoscope size={16} className="text-ink" />
          <div>
            <h3 className="text-[14px] font-semibold text-ink">{tr("Diagnóstico", "Diagnostic")}</h3>
            <p className="text-[12px] text-muted">
              {tr(
                "Testa numa vez o canal, a fila de envio, a chave de IA e os agentes.",
                "Checks the channel, the send queue, the AI key and the agents in one go.",
              )}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void diagnose()}
          disabled={busy}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-solid px-4 text-[13px] font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-50"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Stethoscope size={14} />}
          {tr("Correr diagnóstico", "Run diagnostic")}
        </button>
      </div>

      {error && <p className="mt-3 rounded-lg border border-chip-danger-fg/25 bg-chip-danger px-3 py-2 text-[12px] text-chip-danger-fg">{error}</p>}

      {worst && (
        <p
          className={cn(
            "mt-3 rounded-lg px-3 py-2 text-[12px] font-semibold",
            worst === "ok" ? "bg-chip-success text-chip-success-fg" : worst === "warn" ? "bg-chip-warn text-chip-warn-fg" : "bg-chip-danger text-chip-danger-fg",
          )}
        >
          {worst === "ok"
            ? tr("Tudo a funcionar.", "Everything is working.")
            : worst === "warn"
              ? tr("A funcionar, com ressalvas.", "Working, with caveats.")
              : tr("Há uma peça partida.", "One link is broken.")}
          {ranAt ? ` · ${new Date(ranAt).toLocaleTimeString(locale === "pt" ? "pt-PT" : "en-GB")}` : ""}
        </p>
      )}

      {checks && (
        <ul className="mt-2 divide-y divide-line-soft rounded-lg border border-line">
          {checks.map((check) => {
            const meta = ICONS[check.status];
            return (
              <li key={check.key} className="flex items-start gap-2 px-3 py-2 text-[12px]">
                <meta.Icon size={14} className={cn("mt-0.5 shrink-0", meta.tone)} />
                <div className="min-w-0 flex-1">
                  <span className="font-semibold text-ink">
                    {(locale === "pt" ? LABEL_PT : LABEL_EN)[check.key] ?? check.key}
                  </span>
                  <span className="text-muted"> · {check.detail}</span>
                  {check.href && (
                    <Link href={check.href} className="ml-1 font-semibold text-chip-info-fg hover:underline">
                      {tr("resolver", "fix")}
                    </Link>
                  )}
                </div>
                {typeof check.latencyMs === "number" && (
                  <span className="shrink-0 tabular-nums text-[10px] text-faint">{check.latencyMs} ms</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
