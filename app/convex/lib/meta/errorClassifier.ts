export type MetaErrorCategory =
  | "billing_issue"
  | "blocked_by_meta"
  | "recipient_over_marketed"
  | "invalid_recipient"
  | "experiment_or_test_number"
  | "template_rejected_or_paused"
  | "quality_limit_or_pacing"
  | "network_or_unknown";

export type MetaFailureFix = {
  title: string;
  action: string;
  retrySafe: boolean;
};

const CODE_CATEGORIES: Record<string, MetaErrorCategory> = {
  "131026": "invalid_recipient",
  "131047": "blocked_by_meta",
  "131049": "recipient_over_marketed",
  "132015": "template_rejected_or_paused",
  "132016": "template_rejected_or_paused",
  "131048": "quality_limit_or_pacing",
  "131056": "quality_limit_or_pacing",
  "130472": "experiment_or_test_number",
};

export function classifyMetaFailure(args: {
  code?: string;
  reason?: string;
}): MetaErrorCategory {
  if (args.code && CODE_CATEGORIES[args.code]) {
    return CODE_CATEGORIES[args.code];
  }
  const reason = (args.reason ?? "").toLowerCase();
  if (/\b(card|payment|billing|credit|invoice|balance)\b/.test(reason)) {
    return "billing_issue";
  }
  if (/\b(over.?marketing|marketing limit|too many marketing)\b/.test(reason)) {
    return "recipient_over_marketed";
  }
  if (/\b(template).*(paused|rejected|disabled)\b/.test(reason)) {
    return "template_rejected_or_paused";
  }
  if (/\b(quality|rate limit|pacing|throughput)\b/.test(reason)) {
    return "quality_limit_or_pacing";
  }
  if (/\b(experiment|test number)\b/.test(reason)) {
    return "experiment_or_test_number";
  }
  if (/\b(undeliverable|invalid|unreachable|not a whatsapp user)\b/.test(reason)) {
    return "invalid_recipient";
  }
  if (/\b(blocked|policy|restricted|re-engagement|reengagement)\b/.test(reason)) {
    return "blocked_by_meta";
  }
  return "network_or_unknown";
}

const FAILURE_FIXES: Record<MetaErrorCategory, MetaFailureFix> = {
  billing_issue: {
    title: "Billing or credit problem",
    action: "Check the WABA payment method, balance, and account billing status before sending again.",
    retrySafe: false,
  },
  blocked_by_meta: {
    title: "Blocked by Meta policy or window",
    action: "Review policy status, re-engagement rules, and the conversation window before retrying.",
    retrySafe: false,
  },
  recipient_over_marketed: {
    title: "Recipient is over-marketed",
    action: "Suppress this recipient from near-term marketing sends and wait for Meta's marketing limit to cool down.",
    retrySafe: false,
  },
  invalid_recipient: {
    title: "Invalid or unreachable recipient",
    action: "Clean the contact identity, phone number, or BSUID before adding the recipient to another campaign.",
    retrySafe: false,
  },
  experiment_or_test_number: {
    title: "Experiment or test-number restriction",
    action: "Move this send to an eligible production recipient or disable the conflicting test setup.",
    retrySafe: false,
  },
  template_rejected_or_paused: {
    title: "Template rejected or paused",
    action: "Fix the template quality or approval status in Meta, then create a new campaign run.",
    retrySafe: false,
  },
  quality_limit_or_pacing: {
    title: "Quality, rate, or pacing limit",
    action: "Slow the send rate, inspect phone-number quality, and resume only after quality recovers.",
    retrySafe: false,
  },
  network_or_unknown: {
    title: "Network or unknown failure",
    action: "Retry after checking logs and confirming Meta did not already accept the message.",
    retrySafe: true,
  },
};

export function failureFixForCategory(
  category: MetaErrorCategory | string | undefined,
): MetaFailureFix {
  if (category && category in FAILURE_FIXES) {
    return FAILURE_FIXES[category as MetaErrorCategory];
  }
  return FAILURE_FIXES.network_or_unknown;
}

export function isSafeRetryCategory(
  category: MetaErrorCategory | string | undefined,
): boolean {
  return failureFixForCategory(category).retrySafe;
}
