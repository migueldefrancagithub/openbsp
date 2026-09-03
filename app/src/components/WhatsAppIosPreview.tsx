"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Info,
  MessageCircle,
  ShieldCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  analyzeTemplateStrategy,
  type TemplateCategory,
} from "@/lib/whatsappTemplateAdvisor";
import { BRAND_NAME, BrandMark } from "@/components/Brand";
import { useI18n, type Locale } from "@/lib/i18n";

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
  title,
  subtitle,
}: Props) {
  const { locale, tr } = useI18n();
  const analysis = analyzeTemplateStrategy({
    category,
    bodyText,
    examples,
    hasMarketingOptIn,
    serviceWindowOpen,
    freeEntryWindowOpen,
  });

  const primaryRisk = analysis.risks[0];
  const effectiveTitle = title ?? tr("Pré-visualização WhatsApp no iOS", "iOS WhatsApp preview");
  const effectiveSubtitle = subtitle ?? tr(
    "Renderização com categoria Meta, consentimento e rastreio de respostas.",
    "Rendering with Meta category, consent, and response tracking.",
  );

  return (
    <aside className="space-y-4">
      <div className="rounded-lg border border-line bg-surface p-4 shadow-sm">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-[var(--font-outfit)] text-[17px] font-medium text-ink">
              {effectiveTitle}
            </h2>
            <p className="mt-0.5 text-[12px] leading-relaxed text-muted">
              {effectiveSubtitle}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wider ${CATEGORY_TONES[category]}`}
          >
            {categoryLabel(category, locale)}
          </span>
        </div>

        <div className="mx-auto w-full max-w-[320px] rounded-[38px] border border-line bg-slate-950 p-2 shadow-[0_22px_70px_-34px_rgba(15,23,42,0.8)]">
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
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">
                  {analysis.previewText || tr("A pré-visualização aparece aqui.", "Your message preview appears here.")}
                </p>
                <div className="mt-1 text-right text-[10px] text-muted">
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
                      {button.text || tr("Botão", "Button")}
                    </div>
                  ))}
                </div>
              )}
              {category === "marketing" && (
                <div className="mt-2 ml-auto max-w-[86%] rounded-xl bg-white/85 px-3 py-2 text-[11px] text-body shadow-sm">
                  {tr(
                    "Respostas rápidas e botões são registados como sinais de intenção da campanha.",
                    "Quick replies and CTA buttons are tracked as campaign intent signals.",
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-line bg-surface p-4">
        <div className="grid grid-cols-2 gap-2">
          <Signal
            icon={MessageCircle}
            label={tr("Forma de envio", "Send path")}
            value={analysis.billing.chargeState === "free" ? tr("Janela aberta", "Open window") : "Template"}
            tone={analysis.billing.chargeState === "free" ? "good" : "warn"}
          />
          <Signal
            icon={Clock3}
            label={tr("Melhor janela", "Best window")}
            value={freeEntryWindowOpen ? "72h FEP" : serviceWindowOpen ? tr("24h de atendimento", "24h service") : tr("Envio por template", "Template send")}
            tone={freeEntryWindowOpen || serviceWindowOpen ? "good" : "neutral"}
          />
          <Signal
            icon={ShieldCheck}
            label={tr("Risco", "Risk")}
            value={primaryRisk ? severityLabel(primaryRisk.severity, locale) : tr("Livre", "Clear")}
            tone={primaryRisk ? "warn" : "good"}
          />
          <Signal
            icon={CheckCircle2}
            label={tr("Sugerida", "Suggested")}
            value={categoryLabel(analysis.suggestedCategory, locale)}
            tone={analysis.suggestedCategory === category ? "good" : "warn"}
          />
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-muted">
          {primaryRisk
            ? riskContent(primaryRisk.code, locale).detail
            : tr(
                "Pronto para registar respostas, interações e conversões operacionais após o envio.",
                "Ready to track replies, interactions, and operational conversions after send.",
              )}
        </p>
      </div>

      {analysis.risks.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-amber-900">
            <AlertTriangle size={15} />
            {tr("Proteções", "Guardrails")}
          </div>
          <ul className="space-y-2">
            {analysis.risks.slice(0, 4).map((risk) => (
              <li key={`${risk.code}-${risk.title}`} className="text-[12px] leading-relaxed text-amber-800">
                <span className="font-semibold">{riskContent(risk.code, locale).title}:</span>{" "}
                {riskContent(risk.code, locale).detail}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-lg border border-line bg-surface p-4">
        <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-ink">
          <Info size={15} />
          {tr("Estratégia recomendada", "Recommended strategy")}
        </div>
        <ul className="space-y-2">
          {analysis.recommendations.slice(0, 4).map((item) => (
            <li key={item.code} className="text-[12px] leading-relaxed text-body">
              <span className="font-semibold text-ink">{recommendationContent(item.code, locale).title}:</span>{" "}
              {recommendationContent(item.code, locale).detail}
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
        : "bg-surface-3 text-body";
  return (
    <div className="rounded-lg border border-line bg-surface-2 p-3">
      <div className={`mb-2 flex h-7 w-7 items-center justify-center rounded-lg ${toneClass}`}>
        <Icon size={14} />
      </div>
      <div className="text-[10px] font-medium uppercase tracking-wider text-faint">
        {label}
      </div>
      <div className="mt-0.5 truncate text-[12px] font-semibold text-ink">
        {value}
      </div>
    </div>
  );
}

function categoryLabel(category: TemplateCategory, locale: Locale) {
  if (category === "utility") return locale === "pt" ? "Utilidade" : "Utility";
  if (category === "authentication") return locale === "pt" ? "Autenticação" : "Authentication";
  return "Marketing";
}

function severityLabel(severity: string, locale: Locale) {
  if (locale !== "pt") return severity;
  if (severity === "blocker") return "bloqueio";
  if (severity === "warning") return "atenção";
  return "informação";
}

function riskContent(code: string, locale: Locale) {
  const en: Record<string, { title: string; detail: string }> = {
    body_too_long: { title: "Body too long", detail: "WhatsApp body copy should stay within the template body limit." },
    missing_variable_example: { title: "Missing variable example", detail: "Meta requires a concrete sample for every variable." },
    utility_promo_risk: { title: "Utility may become marketing", detail: "Promotional language can move a template from utility to marketing." },
    marketing_opt_in_required: { title: "Marketing opt-in missing", detail: "Only send campaigns to contacts with clear marketing permission." },
    marketing_opt_out_missing: { title: "Add a simple opt-out", detail: "A short opt-out line reduces complaints and protects quality." },
    authentication_marketing_risk: { title: "Authentication cannot include marketing", detail: "Authentication templates must not contain offers or persuasive copy." },
    authentication_code_missing: { title: "Verification code missing", detail: "Authentication templates must center on a one-time verification code." },
  };
  const pt: typeof en = {
    body_too_long: { title: "Mensagem demasiado longa", detail: "O texto deve respeitar o limite do corpo do template WhatsApp." },
    missing_variable_example: { title: "Exemplo de variável em falta", detail: "A Meta exige uma amostra concreta para cada variável." },
    utility_promo_risk: { title: "Utilidade pode virar marketing", detail: "Linguagem promocional pode reclassificar o template como marketing." },
    marketing_opt_in_required: { title: "Consentimento de marketing em falta", detail: "Envie campanhas apenas para contactos com autorização clara." },
    marketing_opt_out_missing: { title: "Adicione uma saída simples", detail: "Uma instrução curta de opt-out reduz reclamações e protege a qualidade." },
    authentication_marketing_risk: { title: "Autenticação não pode conter marketing", detail: "Templates de autenticação não devem conter ofertas ou texto persuasivo." },
    authentication_code_missing: { title: "Código de verificação em falta", detail: "O template de autenticação deve focar um código de uso único." },
  };
  return (locale === "pt" ? pt : en)[code] ?? { title: code, detail: "" };
}

function recommendationContent(code: string, locale: Locale) {
  const en: Record<string, { title: string; detail: string }> = {
    keep_utility_transactional: { title: "Keep utility transactional", detail: "Tie the message to an appointment, payment, delivery, account, or support action." },
    ramp_quality_7_10_days: { title: "Ramp one use case gradually", detail: "Start with a smaller cohort, inspect feedback, then increase volume." },
    segment_by_intent: { title: "Segment by intent", detail: "Prioritize recent leads and responders before broad audiences." },
    otp_expiry_hint: { title: "Show expiry and purpose", detail: "Explain why the code was sent and how long it remains valid." },
    use_service_window: { title: "Prefer the 24-hour window", detail: "Reply inside the service window before using a template." },
    use_free_entry_window: { title: "Use the ad entry window first", detail: "Prioritize ad leads before the 72-hour period expires." },
  };
  const pt: typeof en = {
    keep_utility_transactional: { title: "Mantenha utilidade transacional", detail: "Relacione a mensagem com agendamento, pagamento, entrega, conta ou suporte." },
    ramp_quality_7_10_days: { title: "Aumente o volume gradualmente", detail: "Comece com um grupo pequeno, reveja o retorno e só depois aumente." },
    segment_by_intent: { title: "Segmente por intenção", detail: "Priorize leads recentes e pessoas que já responderam." },
    otp_expiry_hint: { title: "Mostre validade e finalidade", detail: "Explique por que o código foi enviado e até quando é válido." },
    use_service_window: { title: "Prefira a janela de 24 horas", detail: "Responda dentro da janela de atendimento antes de usar template." },
    use_free_entry_window: { title: "Use primeiro a janela do anúncio", detail: "Priorize leads de anúncio antes de terminar o período de 72 horas." },
  };
  return (locale === "pt" ? pt : en)[code] ?? { title: code, detail: "" };
}
