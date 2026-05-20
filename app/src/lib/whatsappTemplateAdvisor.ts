export type TemplateCategory = "utility" | "marketing" | "authentication";

export type BillingInput = {
  category: TemplateCategory;
  serviceWindowOpen: boolean;
  freeEntryWindowOpen: boolean;
};

export type BillingEstimate = {
  chargeState: "free" | "paid";
  reason: string;
};

export type StrategyRisk = {
  code:
    | "missing_variable_example"
    | "utility_promo_risk"
    | "marketing_opt_in_required"
    | "marketing_opt_out_missing"
    | "authentication_marketing_risk"
    | "authentication_code_missing"
    | "body_too_long";
  severity: "info" | "warning" | "blocker";
  title: string;
  detail: string;
};

export type StrategyRecommendation = {
  code:
    | "use_service_window"
    | "use_free_entry_window"
    | "ramp_quality_7_10_days"
    | "segment_by_intent"
    | "otp_expiry_hint"
    | "keep_utility_transactional";
  title: string;
  detail: string;
};

export type TemplateStrategyInput = BillingInput & {
  bodyText: string;
  examples: Record<number, string>;
  hasMarketingOptIn: boolean;
};

export type TemplateStrategyAnalysis = {
  previewText: string;
  variables: number[];
  suggestedCategory: TemplateCategory;
  billing: BillingEstimate;
  risks: StrategyRisk[];
  recommendations: StrategyRecommendation[];
};

const PROMO_WORDS = [
  "desconto",
  "promo",
  "oferta",
  "cupao",
  "cupom",
  "premium",
  "ganhe",
  "aproveite",
  "novidade",
  "novidades",
  "campanha",
  "pack",
  "pacote",
  "venda",
  "comprar",
  "buy",
  "discount",
  "offer",
  "sale",
];

const OPT_OUT_PATTERNS = [
  /\bparar\b/i,
  /\bstop\b/i,
  /\bcancelar\b/i,
  /\bsair\b/i,
  /nao receber/i,
  /não receber/i,
  /opt[- ]?out/i,
];

export function extractTemplateVariables(bodyText: string): number[] {
  const indices = new Set<number>();
  const regex = /\{\{(\d+)\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(bodyText)) !== null) {
    indices.add(Number(match[1]));
  }
  return Array.from(indices).sort((a, b) => a - b);
}

export function renderTemplateBody(
  bodyText: string,
  examples: Record<number, string>,
): string {
  return bodyText.replace(/\{\{(\d+)\}\}/g, (token, indexText) => {
    const index = Number(indexText);
    const value = examples[index]?.trim();
    return value ? value : token;
  });
}

export function estimateTemplateBilling(input: BillingInput): BillingEstimate {
  if (input.freeEntryWindowOpen) {
    return {
      chargeState: "free",
      reason:
        "Free Entry Point is open, so templates can ride the 72-hour ad/Page CTA window.",
    };
  }

  if (input.category === "utility" && input.serviceWindowOpen) {
    return {
      chargeState: "free",
      reason:
        "Utility template inside the 24-hour customer service window should be non-billable.",
    };
  }

  if (input.category === "marketing") {
    return {
      chargeState: "paid",
      reason:
        "Marketing templates are billable outside a Free Entry Point window, even if the service window is open.",
    };
  }

  if (input.category === "authentication") {
    return {
      chargeState: "paid",
      reason:
        "Authentication templates are billable outside a Free Entry Point window.",
    };
  }

  return {
    chargeState: "paid",
    reason:
      "Utility templates outside service and free-entry windows are billed as template messages.",
  };
}

export function analyzeTemplateStrategy(
  input: TemplateStrategyInput,
): TemplateStrategyAnalysis {
  const variables = extractTemplateVariables(input.bodyText);
  const previewText = renderTemplateBody(input.bodyText, input.examples);
  const lowerText = normalize(input.bodyText);
  const hasPromoLanguage = PROMO_WORDS.some((word) =>
    lowerText.includes(normalize(word)),
  );
  const hasOptOut = OPT_OUT_PATTERNS.some((pattern) =>
    pattern.test(input.bodyText),
  );

  const risks: StrategyRisk[] = [];
  const recommendations: StrategyRecommendation[] = [];
  let suggestedCategory = input.category;

  if (input.bodyText.length > 1024) {
    risks.push({
      code: "body_too_long",
      severity: "blocker",
      title: "Body too long",
      detail: "WhatsApp body copy should stay within the template body limit.",
    });
  }

  for (const index of variables) {
    if (!input.examples[index]?.trim()) {
      risks.push({
        code: "missing_variable_example",
        severity: "blocker",
        title: `Missing example for {{${index}}}`,
        detail: "Meta requires a concrete sample for every variable.",
      });
    }
  }

  if (input.category === "utility") {
    recommendations.push({
      code: "keep_utility_transactional",
      title: "Keep utility strictly transactional",
      detail:
        "Tie the message to an appointment, purchase, payment, delivery, account, or support action.",
    });

    if (hasPromoLanguage) {
      risks.push({
        code: "utility_promo_risk",
        severity: "warning",
        title: "Utility may be reclassified as marketing",
        detail:
          "Promotional or persuasive language can move a template out of utility and into marketing.",
      });
      suggestedCategory = "marketing";
    }
  }

  if (input.category === "marketing") {
    if (!input.hasMarketingOptIn) {
      risks.push({
        code: "marketing_opt_in_required",
        severity: "blocker",
        title: "Marketing opt-in missing",
        detail:
          "Only send campaigns to contacts with clear marketing permission evidence; keep promotional permission separate from transactional updates.",
      });
    }
    if (!hasOptOut) {
      risks.push({
        code: "marketing_opt_out_missing",
        severity: "warning",
        title: "Add a simple opt-out",
        detail:
          "A short line like 'Reply STOP to opt out' reduces complaints and protects quality.",
      });
    }
    recommendations.push({
      code: "ramp_quality_7_10_days",
      title: "Ramp one use case over 7-10 days",
      detail:
        "Send a smaller first cohort, inspect read/block feedback, then increase volume.",
    });
    recommendations.push({
      code: "segment_by_intent",
      title: "Segment by intent, not just demographics",
      detail:
        "Prioritize CTWA leads, recent buyers, abandoned carts, or prior responders before cold blasts.",
    });
  }

  if (input.category === "authentication") {
    if (!variables.length && !/\b(otp|codigo|código|code)\b/i.test(lowerText)) {
      risks.push({
        code: "authentication_code_missing",
        severity: "blocker",
        title: "OTP variable missing",
        detail:
          "Authentication templates should be centered on a one-time code or login verification.",
      });
    }
    if (hasPromoLanguage) {
      risks.push({
        code: "authentication_marketing_risk",
        severity: "blocker",
        title: "Authentication cannot carry marketing",
        detail:
          "OTP templates should not include offers, discounts, or persuasive commercial copy.",
      });
    }
    recommendations.push({
      code: "otp_expiry_hint",
      title: "Show expiry and purpose",
      detail:
        "Mention why the code was sent and how long it remains valid; keep it short.",
    });
  }

  if (input.serviceWindowOpen) {
    recommendations.push({
      code: "use_service_window",
      title: "Prefer the 24-hour service window",
      detail:
        "When the customer has messaged recently, reply inside that window before sending paid templates.",
    });
  }

  if (input.freeEntryWindowOpen) {
    recommendations.push({
      code: "use_free_entry_window",
      title: "Use the CTWA free-entry window first",
      detail:
        "Ad/Page CTA conversations can unlock a 72-hour window; prioritize these leads before expiry.",
    });
  }

  return {
    previewText,
    variables,
    suggestedCategory,
    billing: estimateTemplateBilling(input),
    risks,
    recommendations: dedupeRecommendations(recommendations),
  };
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function dedupeRecommendations(
  recommendations: StrategyRecommendation[],
): StrategyRecommendation[] {
  const seen = new Set<string>();
  return recommendations.filter((item) => {
    if (seen.has(item.code)) return false;
    seen.add(item.code);
    return true;
  });
}
