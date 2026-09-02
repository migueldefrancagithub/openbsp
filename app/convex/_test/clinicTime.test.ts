import { describe, expect, it } from "vitest";
import {
  addDays,
  localDateOf,
  localTimeToTimestamp,
  minuteOfDayOf,
  resolveTimeZone,
  weekdayOfDate,
} from "../lib/clinicTime";

describe("clinic time (tenant timezone)", () => {
  it("round-trips local wall-clock in Maputo (+02:00, no DST)", () => {
    const ts = localTimeToTimestamp("2026-09-03", "08:30", "Africa/Maputo");
    expect(new Date(ts).toISOString()).toBe("2026-09-03T06:30:00.000Z");
    expect(localDateOf(ts, "Africa/Maputo")).toBe("2026-09-03");
    expect(minuteOfDayOf(ts, "Africa/Maputo")).toBe(8 * 60 + 30);
    expect(weekdayOfDate("2026-09-03", "Africa/Maputo")).toBe(4); // Thursday
  });

  it("handles DST zones and the day boundary", () => {
    const lisbonSummer = localTimeToTimestamp("2026-07-01", "09:00", "Europe/Lisbon");
    expect(new Date(lisbonSummer).toISOString()).toBe("2026-07-01T08:00:00.000Z");
    const lisbonWinter = localTimeToTimestamp("2026-01-15", "09:00", "Europe/Lisbon");
    expect(new Date(lisbonWinter).toISOString()).toBe("2026-01-15T09:00:00.000Z");
    // 23:30 Maputo is still the same local day even though UTC has moved on.
    const late = localTimeToTimestamp("2026-09-03", "23:30", "Africa/Maputo");
    expect(new Date(late).toISOString()).toBe("2026-09-03T21:30:00.000Z");
    expect(localDateOf(late, "Africa/Maputo")).toBe("2026-09-03");
    expect(localDateOf(late, "UTC")).toBe("2026-09-03");
    expect(localDateOf(localTimeToTimestamp("2026-09-03", "00:30", "Africa/Maputo"), "UTC")).toBe("2026-09-02");
  });

  it("falls back to Maputo for unknown zones and adds days safely", () => {
    expect(resolveTimeZone("Mars/Olympus")).toBe("Africa/Maputo");
    expect(resolveTimeZone("Europe/Lisbon")).toBe("Europe/Lisbon");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});
