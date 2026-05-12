/**
 * Healthcare content data-loss-prevention rules. Applied to free-text
 * outbound when tenant.healthcareMode === true. Per PLAN section 7.1
 * (Codex round 2 #5).
 *
 * Two tiers:
 *  - HARD_DENY: cannot be overridden (controlled medication names,
 *    diagnosis claims). Mutation rejects unconditionally.
 *  - SOFT_DENY: blockable but admin/owner can override with written
 *    justification (audit-logged).
 *
 * Returns the list of categories matched. Empty array = passed.
 */

const DIAGNOSIS_PATTERNS: RegExp[] = [
  /\bdiagn[oóô]stic[oa]?\b/i,
  /\bdiagnosis\b/i,
  /\bcura\b(?!do|dor)/i,
  /\bcure\b/i,
  /\bguaranteed\s+result/i,
  /\btratamento\s+garantido\b/i,
  /\bresult[ao]d?[oa]\s+garantido/i,
];

// Sample of controlled / Rx-only substances regulated by INFARMED PT.
// Not exhaustive — production should pull from a maintained list and
// allow per-tenant additions.
const CONTROLLED_MEDICATION_PATTERNS: RegExp[] = [
  /\bmorfin[ao]\b/i,
  /\bfentanil\w*\b/i,
  /\btramadol\b/i,
  /\balprazolam\b/i,
  /\bdiazepam\b/i,
  /\bclonazepam\b/i,
  /\blorazepam\b/i,
  /\bzolpidem\b/i,
  /\bmetilfenidat[oa]\b/i,
  /\britalin[ao]\b/i,
  /\boxicodon[ao]\b/i,
  /\bcodein[ao]\b/i,
  /\bketamin[ao]\b/i,
];

// Dose-pattern shortcut (e.g. "500mg", "2x ao dia"). Soft.
const DOSE_PATTERN = /\b(\d{1,4})\s?(mg|mcg|µg|ug|ml|ui|UI|comprimid)\b/i;
const FREQUENCY_PATTERN = /\b\d+\s?x\s?(ao|por|by)?\s?(dia|day|hora|hour)/i;

export type DlpCategory =
  | "diagnosis_claim"
  | "controlled_medication"
  | "dose_mention"
  | "frequency_mention";

export type DlpResult = {
  passed: boolean;
  hardBlocked: boolean;
  matched: DlpCategory[];
};

export function validateHealthcareContent(text: string): DlpResult {
  const matched: DlpCategory[] = [];
  let hardBlocked = false;

  if (DIAGNOSIS_PATTERNS.some((re) => re.test(text))) {
    matched.push("diagnosis_claim");
    hardBlocked = true;
  }
  if (CONTROLLED_MEDICATION_PATTERNS.some((re) => re.test(text))) {
    matched.push("controlled_medication");
    hardBlocked = true;
  }
  if (DOSE_PATTERN.test(text)) {
    matched.push("dose_mention");
  }
  if (FREQUENCY_PATTERN.test(text)) {
    matched.push("frequency_mention");
  }

  return {
    passed: matched.length === 0,
    hardBlocked,
    matched,
  };
}
