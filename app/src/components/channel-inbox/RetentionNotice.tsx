"use client";

import { AlertTriangle, Clock3, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import { retentionCopy } from "@/lib/retentionCopy";

const STYLES = {
  protection: { box: "border-chip-warn-fg/25 bg-chip-warn text-chip-warn-fg", Icon: Clock3 },
  compliance: { box: "border-[#e0533d]/30 bg-chip-danger text-chip-danger-fg", Icon: ShieldAlert },
  quality: { box: "border-line bg-surface-2 text-ink", Icon: AlertTriangle },
} as const;

/**
 * Says why the last automatic reply did not reach the patient, above the
 * composer, where the decision to re-send is taken.
 */
export function RetentionNotice({ retention }: { retention?: { code: string; at: number } | null }) {
  const { locale } = useI18n();
  const copy = retentionCopy(retention?.code, locale);
  if (!copy) return null;
  const style = STYLES[copy.family];
  return (
    <div className={cn("mb-2 flex items-start gap-2 rounded-lg border px-3 py-2 text-[12px]", style.box)} data-retention-notice>
      <style.Icon size={14} className="mt-0.5 shrink-0" />
      <span>
        <span className="font-semibold">{copy.title}.</span> {copy.description}
      </span>
    </div>
  );
}
