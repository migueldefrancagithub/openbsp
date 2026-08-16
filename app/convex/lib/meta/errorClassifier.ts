export type MetaErrorCategory =
  | "auth_or_permission"
  | "billing_issue"
  | "blocked_by_meta"
  | "recipient_over_marketed"
  | "invalid_recipient"
  | "experiment_or_test_number"
  | "template_rejected_or_paused"
  | "template_parameter_error"
  | "phone_registration_limit"
  | "username_transfer_required"
  | "signup_policy_error"
  | "quality_limit_or_pacing"
  | "temporary_meta_outage"
  | "network_or_unknown";

export type MetaFailureFix = {
  title: string;
  action: string;
  retrySafe: boolean;
};

const CODE_CATEGORIES: Record<string, MetaErrorCategory> = {
  "0": "auth_or_permission",
  "3": "auth_or_permission",
  "10": "auth_or_permission",
  "190": "auth_or_permission",
  "200": "auth_or_permission",
  "368": "blocked_by_meta",
  "130497": "blocked_by_meta",
  "130429": "quality_limit_or_pacing",
  "131016": "temporary_meta_outage",
  "131026": "invalid_recipient",
  "131031": "blocked_by_meta",
  "131042": "billing_issue",
  "131047": "blocked_by_meta",
  "131049": "recipient_over_marketed",
  "131048": "quality_limit_or_pacing",
  "131056": "quality_limit_or_pacing",
  "131064": "template_rejected_or_paused",
  "132000": "template_parameter_error",
  "132001": "template_parameter_error",
  "132005": "template_parameter_error",
  "132007": "template_parameter_error",
  "132012": "template_parameter_error",
  "132015": "template_rejected_or_paused",
  "132016": "template_rejected_or_paused",
  "132018": "template_rejected_or_paused",
  "133010": "phone_registration_limit",
  "133016": "phone_registration_limit",
  "147005": "username_transfer_required",
  "2494177": "signup_policy_error",
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
  if (/\b(access token|permission|oauth|authenticate|authorization|scope)\b/.test(reason)) {
    return "auth_or_permission";
  }
  if (/\b(over.?marketing|marketing limit|too many marketing)\b/.test(reason)) {
    return "recipient_over_marketed";
  }
  if (/\b(variable|parameter|param|component|language|locale|length)\b/.test(reason)) {
    return "template_parameter_error";
  }
  if (/\b(username).*(transfer|required|already in use)\b/.test(reason)) {
    return "username_transfer_required";
  }
  if (/\b(signup|tos|terms of service|url not allowed)\b/.test(reason)) {
    return "signup_policy_error";
  }
  if (/\b(registration|deregistration).*(attempt|limit|blocked)\b/.test(reason)) {
    return "phone_registration_limit";
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
  if (/\b(temporar|unavailable|downtime|overloaded|timeout|gateway|service)\b/.test(reason)) {
    return "temporary_meta_outage";
  }
  return "network_or_unknown";
}

const FAILURE_FIXES: Record<MetaErrorCategory, MetaFailureFix> = {
  auth_or_permission: {
    title: "Token or permission problem",
    action: "Refresh the WABA token and verify app permissions, asset access, and webhook subscription before retrying.",
    retrySafe: false,
  },
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
  template_parameter_error: {
    title: "Template parameter mismatch",
    action: "Fix the template language, variable count, examples, or component payload before sending again.",
    retrySafe: false,
  },
  phone_registration_limit: {
    title: "Phone registration attempt limit",
    action: "Stop registration attempts for this phone and retry only after Meta's lockout window clears.",
    retrySafe: false,
  },
  username_transfer_required: {
    title: "Username transfer required",
    action: "Set transfer_action=force_transfer only after confirming which business phone should own the username.",
    retrySafe: false,
  },
  signup_policy_error: {
    title: "Signup policy configuration error",
    action: "Fix the Meta signup policy fields, especially the approved Terms of Service URL, then retry onboarding.",
    retrySafe: false,
  },
  quality_limit_or_pacing: {
    title: "Quality, rate, or pacing limit",
    action: "Slow the send rate, inspect phone-number quality, and resume only after quality recovers.",
    retrySafe: false,
  },
  temporary_meta_outage: {
    title: "Temporary Meta outage or overload",
    action: "Retry after a short backoff and check WhatsApp Business Platform status if failures cluster.",
    retrySafe: true,
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
