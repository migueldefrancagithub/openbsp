import { describe, expect, it } from "vitest";
import { isRetentionCode, retentionCopy } from "./retentionCopy";

/**
 * Every code that can stop a send needs a sentence, because a conversation
 * where the AI went quiet and nothing says why is indistinguishable from a
 * broken product.
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

describe("retention copy", () => {
  it("covers every blocking code in both languages", () => {
    for (const code of CODES_THAT_STOP_A_SEND) {
      const pt = retentionCopy(code, "pt");
      const en = retentionCopy(code, "en");
      expect(pt, code).not.toBeNull();
      expect(en, code).not.toBeNull();
      expect(pt!.description.length, code).toBeGreaterThan(20);
      expect(en!.description).not.toBe(pt!.description);
      expect(isRetentionCode(code)).toBe(true);
    }
  });

  it("groups the reason by the action it implies", () => {
    // Protection means wait, the system will send it.
    expect(retentionCopy("RATE_LIMITED", "pt")!.family).toBe("protection");
    // Compliance means never send it.
    expect(retentionCopy("DND", "pt")!.family).toBe("compliance");
    // Quality means the assistant is correcting itself.
    expect(retentionCopy("HEALTHCARE_ADVICE", "pt")!.family).toBe("quality");
  });

  it("stays silent about codes it does not know, instead of guessing", () => {
    expect(retentionCopy("SOMETHING_NEW", "pt")).toBeNull();
    expect(retentionCopy(undefined, "pt")).toBeNull();
    expect(isRetentionCode("SOMETHING_NEW")).toBe(false);
  });

  it("reads codes case-insensitively, the way events store them", () => {
    expect(retentionCopy("service_window_expired", "pt")!.family).toBe("protection");
  });
});
