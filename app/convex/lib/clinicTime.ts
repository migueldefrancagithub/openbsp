import { ConvexError } from "convex/values";

/**
 * Tenant-timezone date helpers built on `Intl` (available in the Convex
 * runtime). Replaces the fixed Maputo offset: clinics outside +02:00 and DST
 * zones get correct local days, weekdays and slot boundaries.
 */
export const DEFAULT_TIMEZONE = "Africa/Maputo";

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        weekday: "short",
      });
    } catch {
      throw new ConvexError({ code: "INVALID_TIMEZONE", timeZone });
    }
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    partsFormatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

export function resolveTimeZone(value: string | undefined): string {
  if (value && isValidTimeZone(value)) return value;
  return DEFAULT_TIMEZONE;
}

export type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
  date: string;
  minuteOfDay: number;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function localParts(timestamp: number, timeZone: string): LocalParts {
  const parts = partsFormatter(timeZone).formatToParts(new Date(timestamp));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  const year = Number(get("year"));
  const month = Number(get("month"));
  const day = Number(get("day"));
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  const second = Number(get("second"));
  const weekday = WEEKDAYS.indexOf(get("weekday"));
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    weekday: weekday < 0 ? 0 : weekday,
    date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    minuteOfDay: hour * 60 + minute,
  };
}

export function localDateOf(timestamp: number, timeZone: string): string {
  return localParts(timestamp, timeZone).date;
}

export function minuteOfDayOf(timestamp: number, timeZone: string): number {
  return localParts(timestamp, timeZone).minuteOfDay;
}

export function parseDate(date: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new ConvexError({ code: "INVALID_DATE" });
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) throw new ConvexError({ code: "INVALID_DATE" });
  return { year, month, day };
}

export function parseTime(value: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) throw new ConvexError({ code: "INVALID_TIME", value });
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Offset (ms) of `timeZone` from UTC at the given instant. */
function offsetAt(timestamp: number, timeZone: string): number {
  const p = localParts(timestamp, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(timestamp / 1000) * 1000;
}

/**
 * Local wall-clock (date + HH:MM in the tenant zone) → epoch ms. Two-pass
 * offset resolution handles DST transitions; times inside a DST gap resolve
 * to the instant after the gap.
 */
export function localTimeToTimestamp(date: string, time: string, timeZone: string): number {
  const { year, month, day } = parseDate(date);
  const minutes = parseTime(time);
  const naive = Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60, 0);
  const firstOffset = offsetAt(naive, timeZone);
  let candidate = naive - firstOffset;
  const secondOffset = offsetAt(candidate, timeZone);
  if (secondOffset !== firstOffset) candidate = naive - secondOffset;
  return candidate;
}

export function weekdayOfDate(date: string, timeZone: string): number {
  return localParts(localTimeToTimestamp(date, "12:00", timeZone), timeZone).weekday;
}

export function startOfLocalDay(date: string, timeZone: string): number {
  return localTimeToTimestamp(date, "00:00", timeZone);
}

export function addDays(date: string, days: number): string {
  const { year, month, day } = parseDate(date);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

export function formatLocalTime(timestamp: number, timeZone: string, locale = "pt-MZ"): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(timestamp);
}

export function formatLocalDateTime(timestamp: number, timeZone: string, locale = "pt-MZ"): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(timestamp);
}
