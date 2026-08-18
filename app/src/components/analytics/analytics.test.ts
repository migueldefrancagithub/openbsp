// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  NO_DATA,
  dateWindow,
  formatMoney,
  formatNumber,
  formatPercent,
  toCsv,
} from "./lib";

describe("no-data never reads as a verdict", () => {
  it("renders an em dash for a rate with no traffic behind it", () => {
    // The bug this replaces: deliveryHealth(0) returns "high", so a tenant
    // with zero messages was told delivery was at risk.
    expect(formatPercent(0, false)).toBe(NO_DATA);
    expect(formatPercent(0.97, false)).toBe(NO_DATA);
  });

  it("renders the real rate once there is traffic", () => {
    expect(formatPercent(0.9712, true)).toBe("97.1%");
    expect(formatPercent(0, true)).toBe("0.0%");
  });

  it("renders an em dash for money with nothing delivered", () => {
    expect(formatMoney(0, "USD", false)).toBe(NO_DATA);
    expect(formatMoney(1234, "USD", true)).toBe("$12.34");
  });

  it("defaults money to showing a value, since totals are always real", () => {
    expect(formatMoney(0, "USD")).toBe("$0.00");
  });

  it("falls back to a valid currency when the report has none", () => {
    expect(() => formatMoney(500, "")).not.toThrow();
  });
});

describe("CSV export", () => {
  it("quotes separators, quotes and newlines", () => {
    const csv = toCsv(
      ["Interval", "Country"],
      [["09:00, 10:00", 'Mo"z'], ["11:00", "line\nbreak"]],
    );
    expect(csv).toBe(
      'Interval,Country\n"09:00, 10:00","Mo""z"\n11:00,"line\nbreak"',
    );
  });

  it("keeps the header even with no rows", () => {
    expect(toCsv(["A", "B"], [])).toBe("A,B");
  });
});

describe("date window", () => {
  const now = 1_755_500_000_000;
  const day = 24 * 60 * 60 * 1000;

  it("maps each range to its span", () => {
    expect(dateWindow("today", now)).toEqual({
      dateFrom: now - day,
      dateTo: now,
    });
    expect(dateWindow("7d", now)).toEqual({
      dateFrom: now - 7 * day,
      dateTo: now,
    });
    expect(dateWindow("30d", now)).toEqual({
      dateFrom: now - 30 * day,
      dateTo: now,
    });
  });

  it("never produces an inverted window", () => {
    for (const range of ["today", "7d", "30d"] as const) {
      const window = dateWindow(range, now);
      expect(window.dateFrom).toBeLessThan(window.dateTo);
    }
  });
});

describe("number formatting", () => {
  it("groups thousands", () => {
    expect(formatNumber(1234567)).toBe("1,234,567");
  });
});
