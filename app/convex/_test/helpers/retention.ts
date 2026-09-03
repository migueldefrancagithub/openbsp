import { readFileSync } from "node:fs";

/**
 * The retention copy lives on the client (`src/lib/retentionCopy.ts`) because
 * it is a screen concern, and the convex test runner cannot import through the
 * `@/` alias. Reading the source keeps the coverage check honest without
 * duplicating the table.
 */
const CODES_THAT_STOP_A_SEND = [
  "RECIPIENT_NOT_ALLOWLISTED",
  "SERVICE_WINDOW_EXPIRED",
  "TEMPLATE_NOT_APPROVED",
  "RATE_LIMITED",
  "BUDGET_EXCEEDED",
  "DND",
  "AI_OPT_OUT",
  "HEALTHCARE_ADVICE",
  "UNVERIFIED_BOOKING",
  "DISCLOSURE_REQUIRED",
  "INTERNAL_VOCABULARY",
  "TOO_LONG",
  "UNTRUSTED_LINK",
  "PROVIDER_UNAVAILABLE",
];

export function retentionFamilies(): {
  families: Record<string, string[]>;
  missing: string[];
} {
  const source = readFileSync(new URL("../../../src/lib/retentionCopy.ts", import.meta.url), "utf8");
  const families: Record<string, string[]> = { protection: [], compliance: [], quality: [] };
  const entryPattern = /(\w+):\s*\{\s*\n\s*family: "(protection|compliance|quality)"/g;
  let match: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((match = entryPattern.exec(source)) !== null) {
    if (seen.has(match[1])) throw new Error(`duplicate retention code: ${match[1]}`);
    seen.add(match[1]);
    families[match[2]].push(match[1]);
  }
  return { families, missing: CODES_THAT_STOP_A_SEND.filter((code) => !seen.has(code)) };
}
