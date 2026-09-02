import { describe, expect, it } from "vitest";
import { formatTime, relativeTime } from "./relativeTime";

describe("relativeTime", () => {
  const now = Date.UTC(2026, 8, 1, 12, 0, 0);

  it("uses the selected language for immediate activity", () => {
    expect(relativeTime(now - 10_000, now, "pt")).toBe("agora");
    expect(relativeTime(now - 10_000, now, "en")).toBe("just now");
  });

  it("keeps compact operational units stable", () => {
    expect(relativeTime(now - 12 * 60_000, now, "pt")).toBe("12m");
    expect(relativeTime(now - 3 * 60 * 60_000, now, "en")).toBe("3h");
    expect(relativeTime(now - 2 * 24 * 60 * 60_000, now, "pt")).toBe("2d");
  });

  it("formats message time for PT and EN without throwing", () => {
    const options: Intl.DateTimeFormatOptions = {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    };

    expect(formatTime(now, "pt")).toBe(
      new Date(now).toLocaleTimeString("pt-MZ", options),
    );
    expect(formatTime(now, "en")).toBe(
      new Date(now).toLocaleTimeString("en-GB", options),
    );
  });
});
