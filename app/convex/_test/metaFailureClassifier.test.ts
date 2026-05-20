import { describe, expect, it } from "vitest";
import {
  classifyMetaFailure,
  failureFixForCategory,
  isSafeRetryCategory,
} from "../lib/meta/errorClassifier";

describe("Meta failure classifier", () => {
  it("groups common Meta delivery failures into actionable product categories", () => {
    expect(classifyMetaFailure({ code: "131026", reason: "Message undeliverable" })).toBe(
      "invalid_recipient",
    );
    expect(classifyMetaFailure({ code: "131049", reason: "User is over marketing limit" })).toBe(
      "recipient_over_marketed",
    );
    expect(classifyMetaFailure({ code: "131047", reason: "Re-engagement message blocked" })).toBe(
      "blocked_by_meta",
    );
    expect(classifyMetaFailure({ reason: "Payment method card failed" })).toBe(
      "billing_issue",
    );
  });

  it("maps failure categories to operator actions and retry safety", () => {
    expect(failureFixForCategory("recipient_over_marketed")).toMatchObject({
      retrySafe: false,
    });
    expect(failureFixForCategory("recipient_over_marketed").action).toContain(
      "Suppress",
    );
    expect(isSafeRetryCategory("network_or_unknown")).toBe(true);
    expect(isSafeRetryCategory("billing_issue")).toBe(false);
  });
});
