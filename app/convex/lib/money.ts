export const DEFAULT_CURRENCY = "MZN";

export function normalizeCurrency(currency?: string): string {
  const normalized = (currency ?? DEFAULT_CURRENCY).trim().toUpperCase();
  if (!normalized || normalized === "MT") return DEFAULT_CURRENCY;
  return normalized.slice(0, 3);
}
