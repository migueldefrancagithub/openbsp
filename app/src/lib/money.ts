export const DEFAULT_CURRENCY = "MZN";

export function normalizeCurrency(currency?: string | null): string {
  const normalized = (currency ?? DEFAULT_CURRENCY).trim().toUpperCase();
  if (!normalized || normalized === "MT") return DEFAULT_CURRENCY;
  return normalized.slice(0, 3);
}

export function formatMoney(
  valueMinor: number,
  currency: string = DEFAULT_CURRENCY,
  options: {
    minimumFractionDigits?: number;
    maximumFractionDigits?: number;
  } = {},
): string {
  const normalized = normalizeCurrency(currency);
  const value = valueMinor / 100;
  const minimumFractionDigits = options.minimumFractionDigits ?? 0;
  const maximumFractionDigits = options.maximumFractionDigits ?? 0;

  if (normalized === DEFAULT_CURRENCY) {
    const amount = new Intl.NumberFormat("en-GB", {
      minimumFractionDigits,
      maximumFractionDigits,
    }).format(value);
    return `MT ${amount}`;
  }

  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: normalized,
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(value);
}
