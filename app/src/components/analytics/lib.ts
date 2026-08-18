"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export const TABS = [
  { id: "overview", label: "Overview" },
  { id: "delivery", label: "Delivery" },
  { id: "costs", label: "Costs" },
  { id: "audience", label: "Audience" },
  { id: "activity", label: "Activity" },
] as const;

export type TabId = (typeof TABS)[number]["id"];
export type RangeKey = "today" | "7d" | "30d";
export type Granularity = "hour" | "day";

export const RANGE_LABELS: Record<RangeKey, string> = {
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
};

const TAB_IDS = TABS.map((t) => t.id) as readonly string[];
const RANGES: readonly string[] = ["today", "7d", "30d"];
const GRANS: readonly string[] = ["hour", "day"];

export type AnalyticsParams = {
  tab: TabId;
  range: RangeKey;
  granularity: Granularity;
  /** Only Activity exports; other tabs have nothing tabular to hand over. */
  exportable: boolean;
  setParam: (key: "tab" | "range" | "granularity", value: string) => void;
};

/**
 * Tab, range and granularity live in the URL so a refresh, a back button, or a
 * pasted link all land on the same view. Defaults are omitted from the query
 * string to keep shared links short.
 */
export function useAnalyticsParams(): AnalyticsParams {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  const raw = search.toString();

  const parsed = useMemo(() => {
    const params = new URLSearchParams(raw);
    const tabValue = params.get("tab");
    const rangeValue = params.get("range");
    const granValue = params.get("gran");
    return {
      tab: (TAB_IDS.includes(tabValue ?? "") ? tabValue : "overview") as TabId,
      range: (RANGES.includes(rangeValue ?? "")
        ? rangeValue
        : "today") as RangeKey,
      granularity: (GRANS.includes(granValue ?? "")
        ? granValue
        : "hour") as Granularity,
    };
  }, [raw]);

  const setParam = useCallback(
    (key: "tab" | "range" | "granularity", value: string) => {
      const params = new URLSearchParams(raw);
      const queryKey = key === "granularity" ? "gran" : key;
      const isDefault =
        (queryKey === "tab" && value === "overview") ||
        (queryKey === "range" && value === "today") ||
        (queryKey === "gran" && value === "hour");
      if (isDefault) params.delete(queryKey);
      else params.set(queryKey, value);
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    },
    [raw, pathname, router],
  );

  return { ...parsed, exportable: parsed.tab === "activity", setParam };
}

export function dateWindow(range: RangeKey, now: number) {
  const day = 24 * 60 * 60 * 1000;
  if (range === "7d") return { dateFrom: now - 7 * day, dateTo: now };
  if (range === "30d") return { dateFrom: now - 30 * day, dateTo: now };
  return { dateFrom: now - day, dateTo: now };
}

// ---------- formatting ----------

/** Em dash, not "0", wherever a value has no traffic behind it. */
export const NO_DATA = "—";

export function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatPercent(value: number, hasTraffic: boolean) {
  if (!hasTraffic) return NO_DATA;
  return `${(value * 100).toFixed(1)}%`;
}

export function formatMoney(
  valueMinor: number,
  currency: string,
  hasTraffic = true,
) {
  if (!hasTraffic) return NO_DATA;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
  }).format(valueMinor / 100);
}

export function formatUpdatedAt(timestamp: number) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

// ---------- CSV ----------

function escapeCsv(value: string | number) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: string[], rows: (string | number)[][]) {
  return [headers, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\n");
}

/**
 * Download a real file. The previous implementation copied to the clipboard,
 * which is not what "Export CSV" says it does.
 */
export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([`﻿${csv}`], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
