import { describe, expect, test } from "vitest";
import {
  analyzeTemplateStrategy,
  estimateTemplateBilling,
  extractTemplateVariables,
  renderTemplateBody,
} from "./whatsappTemplateAdvisor";

describe("whatsappTemplateAdvisor", () => {
  test("extracts numeric WhatsApp variables in order without duplicates", () => {
    expect(
      extractTemplateVariables("Ola {{2}}, codigo {{1}}. Repito {{2}}."),
    ).toEqual([1, 2]);
  });

  test("renders an iOS preview body with examples and marks missing values", () => {
    expect(
      renderTemplateBody("Ola {{1}}, consulta as {{2}}.", {
        1: "Maria",
      }),
    ).toBe("Ola Maria, consulta as {{2}}.");
  });

  test("estimates free and paid Meta billing moments", () => {
    expect(
      estimateTemplateBilling({
        category: "utility",
        serviceWindowOpen: true,
        freeEntryWindowOpen: false,
      }).chargeState,
    ).toBe("free");

    expect(
      estimateTemplateBilling({
        category: "marketing",
        serviceWindowOpen: true,
        freeEntryWindowOpen: false,
      }).chargeState,
    ).toBe("paid");

    expect(
      estimateTemplateBilling({
        category: "marketing",
        serviceWindowOpen: false,
        freeEntryWindowOpen: true,
      }).chargeState,
    ).toBe("free");
  });

  test("warns when utility copy sounds promotional and proposes marketing", () => {
    const analysis = analyzeTemplateStrategy({
      category: "utility",
      bodyText: "Ola {{1}}, aproveite 20% desconto no nosso pacote premium.",
      examples: { 1: "Maria" },
      serviceWindowOpen: false,
      freeEntryWindowOpen: false,
      hasMarketingOptIn: true,
    });

    expect(analysis.risks.some((risk) => risk.code === "utility_promo_risk")).toBe(
      true,
    );
    expect(analysis.suggestedCategory).toBe("marketing");
  });

  test("pushes marketing campaigns toward opt-in, opt-out and gradual ramp", () => {
    const analysis = analyzeTemplateStrategy({
      category: "marketing",
      bodyText: "Ola {{1}}, temos novidades para si.",
      examples: { 1: "Maria" },
      serviceWindowOpen: false,
      freeEntryWindowOpen: false,
      hasMarketingOptIn: false,
    });

    expect(analysis.risks.map((risk) => risk.code)).toContain(
      "marketing_opt_in_required",
    );
    expect(analysis.risks.map((risk) => risk.code)).toContain(
      "marketing_opt_out_missing",
    );
    expect(analysis.recommendations.map((item) => item.code)).toContain(
      "ramp_quality_7_10_days",
    );
  });

  test("keeps authentication templates strict and OTP-focused", () => {
    const analysis = analyzeTemplateStrategy({
      category: "authentication",
      bodyText: "Use {{1}} para entrar. Ganhe desconto hoje.",
      examples: { 1: "493021" },
      serviceWindowOpen: false,
      freeEntryWindowOpen: false,
      hasMarketingOptIn: false,
    });

    expect(analysis.risks.map((risk) => risk.code)).toContain(
      "authentication_marketing_risk",
    );
    expect(analysis.recommendations.map((item) => item.code)).toContain(
      "otp_expiry_hint",
    );
  });
});
