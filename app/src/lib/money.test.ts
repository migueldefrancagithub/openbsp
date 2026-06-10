import { describe, expect, test } from "vitest";
import { formatMoney, normalizeCurrency } from "./money";

describe("money formatting", () => {
  test("uses MT for Mozambique metical values", () => {
    const formatted = formatMoney(400300, "MZN");

    expect(formatted).toBe("MT 4,003");
    expect(formatted).not.toContain("€");
    expect(formatted).not.toContain("$");
  });

  test("normalizes MT shorthand to the MZN currency code", () => {
    expect(normalizeCurrency("MT")).toBe("MZN");
    expect(formatMoney(842, "MT", { maximumFractionDigits: 2 })).toBe("MT 8.42");
  });
});
