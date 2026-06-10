"use client";

import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  Clock3,
  Info,
  ShieldCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  analyzeTemplateStrategy,
  type TemplateCategory,
} from "@/lib/whatsappTemplateAdvisor";
import { BRAND_NAME, BrandMark } from "@/components/Brand";

type Props = {
  category: TemplateCategory;
  bodyText: string;
  buttons?: TemplateButtonPreview[];
  examples: Record<number, string>;
  hasMarketingOptIn: boolean;
  serviceWindowOpen: boolean;
  freeEntryWindowOpen: boolean;
  title?: string;
  subtitle?: string;
};

export type TemplateButtonPreview =
  | { type: "quick_reply"; text: string }
  | { type: "url"; text: string; url: string }
  | { type: "phone_number"; text: string; phoneNumber: string };

const CATEGORY_LABELS: Record<TemplateCategory, string> = {
  utility: "Utility",
  marketing: "Marketing",
  authentication: "Authentication",
};

const CATEGORY_TONES: Record<TemplateCategory, string> = {
  utility: "border-emerald-200 bg-emerald-50 text-emerald-700",
  marketing: "border-amber-200 bg-amber-50 text-amber-700",
  authentication: "border-sky-200 bg-sky-50 text-sky-700",
};

export function WhatsAppIosPreview({
  category,
  bodyText,
  buttons = [],
  examples,
  hasMarketingOptIn,
  serviceWindowOpen,
  freeEntryWindowOpen,
  title = "iOS WhatsApp preview",
  subtitle = "Live rendering with Meta category and cost guardrails.",
}: Props) {
  const analysis = analyzeTemplateStrategy({
    category,
    bodyText,
    examples,
    hasMarketingOptIn,
    serviceWindowOpen,
    freeEntryWindowOpen,
  });

  const primaryRisk = analysis.risks[0];

  return (
    <aside className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-[var(--font-outfit)] text-[17px] font-medium text-[#0a1b33]">
              {title}
            </h2>
            <p className="mt-0.5 text-[12px] leading-relaxed text-slate-500">
              {subtitle}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wider ${CATEGORY_TONES[category]}`}
          >
            {CATEGORY_LABELS[category]}
          </span>
        </div>

        <div className="mx-auto w-full max-w-[320px] rounded-[38px] border border-slate-300 bg-slate-950 p-2 shadow-[0_22px_70px_-34px_rgba(15,23,42,0.8)]">
          <div className="overflow-hidden rounded-[30px] bg-[#e5ddd5]">
            <div className="flex items-center gap-2 bg-[#075e54] px-3 py-2 text-white">
              <BrandMark className="h-8 w-8 rounded-full" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold">{BRAND_NAME}</div>
                <div className="text-[10px] text-white/70">online</div>
              </div>
              <div className="text-[10px] text-white/70">iOS</div>
            </div>
            <div className="min-h-[310px] bg-[radial-gradient(circle_at_10%_10%,rgba(255,255,255,0.38),transparent_18%),linear-gradient(135deg,#e9ddd2,#d7e6dc)] p-3">
              <div className="ml-auto max-w-[86%] rounded-2xl rounded-tr-md bg-[#dcf8c6] px-3 py-2 shadow-sm">
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[#0a1b33]">
                  {analysis.previewText || "Your message preview appears here."}
                </p>
                <div className="mt-1 text-right text-[10px] text-slate-500">
                  10:24 ✓✓
                </div>
              </div>
              {buttons.length > 0 && (
                <div className="ml-auto mt-1.5 grid max-w-[86%] gap-1">
                  {buttons.slice(0, 3).map((button, index) => (
                    <div
                      key={`${button.type}-${button.text}-${index}`}
                      className="rounded-xl bg-white/95 px-3 py-2 text-center text-[12px] font-medium text-[#128c7e] shadow-sm"
                    >
                      {button.text || "Button"}
                    </div>
                  ))}
                </div>
              )}
              {category === "marketing" && (
                <div className="mt-2 ml-auto max-w-[86%] rounded-xl bg-white/85 px-3 py-2 text-[11px] text-slate-600 shadow-sm">
                  Quick replies and CTA buttons should be tracked as campaign
                  intent signals.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="grid grid-cols-2 gap-2">
          <Signal
            icon={Banknote}
            label="Billing"
            value={analysis.billing.chargeState === "free" ? "Likely free" : "Billable"}
            tone={analysis.billing.chargeState === "free" ? "good" : "warn"}
          />
          <Signal
            icon={Clock3}
            label="Best window"
            value={freeEntryWindowOpen ? "72h FEP" : serviceWindowOpen ? "24h service" : "Template send"}
            tone={freeEntryWindowOpen || serviceWindowOpen ? "good" : "neutral"}
          />
          <Signal
            icon={ShieldCheck}
            label="Risk"
            value={primaryRisk ? primaryRisk.severity : "Clear"}
            tone={primaryRisk ? "warn" : "good"}
          />
          <Signal
            icon={CheckCircle2}
            label="Suggested"
            value={CATEGORY_LABELS[analysis.suggestedCategory]}
            tone={analysis.suggestedCategory === category ? "good" : "warn"}
          />
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-slate-500">
          {analysis.billing.reason}
        </p>
      </div>

      {analysis.risks.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-amber-900">
            <AlertTriangle size={15} />
            Guardrails
          </div>
          <ul className="space-y-2">
            {analysis.risks.slice(0, 4).map((risk) => (
              <li key={`${risk.code}-${risk.title}`} className="text-[12px] leading-relaxed text-amber-800">
                <span className="font-semibold">{risk.title}:</span>{" "}
                {risk.detail}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-[#0a1b33]">
          <Info size={15} />
          Smart strategy
        </div>
        <ul className="space-y-2">
          {analysis.recommendations.slice(0, 4).map((item) => (
            <li key={item.code} className="text-[12px] leading-relaxed text-slate-600">
              <span className="font-semibold text-[#0a1b33]">{item.title}:</span>{" "}
              {item.detail}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

function Signal({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone: "good" | "warn" | "neutral";
}) {
  const toneClass =
    tone === "good"
      ? "bg-emerald-50 text-emerald-700"
      : tone === "warn"
        ? "bg-amber-50 text-amber-700"
        : "bg-slate-100 text-slate-600";
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className={`mb-2 flex h-7 w-7 items-center justify-center rounded-lg ${toneClass}`}>
        <Icon size={14} />
      </div>
      <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
        {label}
      </div>
      <div className="mt-0.5 truncate text-[12px] font-semibold text-[#0a1b33]">
        {value}
      </div>
    </div>
  );
}
