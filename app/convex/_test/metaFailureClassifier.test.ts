import { describe, expect, it } from "vitest";
import { graphGet } from "../lib/meta/graph";
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
    expect(
      classifyMetaFailure({
        code: "130429",
        reason: "Cloud API message throughput has been reached.",
      }),
    ).toBe("quality_limit_or_pacing");
    expect(
      classifyMetaFailure({
        code: "131031",
        reason: "Business Account locked",
      }),
    ).toBe("blocked_by_meta");
    expect(
      classifyMetaFailure({
        code: "132000",
        reason: "The number of localizable_params does not match",
      }),
    ).toBe("template_parameter_error");
    expect(classifyMetaFailure({ code: "133016" })).toBe(
      "phone_registration_limit",
    );
    expect(classifyMetaFailure({ code: "147005" })).toBe(
      "username_transfer_required",
    );
    expect(classifyMetaFailure({ code: "2494177" })).toBe(
      "signup_policy_error",
    );
    expect(classifyMetaFailure({ code: "131016" })).toBe(
      "temporary_meta_outage",
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
    expect(isSafeRetryCategory("temporary_meta_outage")).toBe(true);
    expect(isSafeRetryCategory("billing_issue")).toBe(false);
  });
});

describe("Meta Graph error parsing", () => {
  it("preserves details and fbtrace_id for operator debugging", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          error: {
            message: "(#130429) Rate limit hit",
            code: 130429,
            error_data: {
              messaging_product: "whatsapp",
              details: "Cloud API message throughput has been reached.",
            },
            fbtrace_id: "Az8or2yhqkZfEZ",
          },
        }),
        { status: 429 },
      );

    try {
      const result = await graphGet("/PHONE/messages", "token");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toContain("Rate limit hit");
        expect(result.message).toContain("throughput has been reached");
        expect(result.details).toBe("Cloud API message throughput has been reached.");
        expect(result.fbtraceId).toBe("Az8or2yhqkZfEZ");
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
