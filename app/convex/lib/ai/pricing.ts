import type { AiProviderId } from "./provider";

/**
 * USD per million tokens (input, output). Estimates for budget enforcement
 * and reports — vendors change prices; unknown models fall back to a
 * conservative default so budgets still bite.
 */
export type ModelPrice = { inputPerMillion: number; outputPerMillion: number };

const PRICES: Record<string, ModelPrice> = {
  // Anthropic
  "claude-fable-5-1": { inputPerMillion: 15, outputPerMillion: 75 },
  "claude-opus-5": { inputPerMillion: 15, outputPerMillion: 75 },
  "claude-sonnet-5": { inputPerMillion: 3, outputPerMillion: 15 },
  "claude-haiku-4-5-20251001": { inputPerMillion: 1, outputPerMillion: 5 },
  "claude-haiku-4-5": { inputPerMillion: 1, outputPerMillion: 5 },
  // OpenAI
  "gpt-5": { inputPerMillion: 1.25, outputPerMillion: 10 },
  "gpt-5-mini": { inputPerMillion: 0.25, outputPerMillion: 2 },
  "gpt-5-nano": { inputPerMillion: 0.05, outputPerMillion: 0.4 },
  "gpt-4.1": { inputPerMillion: 2, outputPerMillion: 8 },
  "gpt-4.1-mini": { inputPerMillion: 0.4, outputPerMillion: 1.6 },
  // Google
  "gemini-2.5-pro": { inputPerMillion: 1.25, outputPerMillion: 10 },
  "gemini-2.5-flash": { inputPerMillion: 0.3, outputPerMillion: 2.5 },
  "gemini-2.5-flash-lite": { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  // Tests
  "mock-router": { inputPerMillion: 0, outputPerMillion: 0 },
  "mock-specialist": { inputPerMillion: 0, outputPerMillion: 0 },
};

export const DEFAULT_PRICE: ModelPrice = { inputPerMillion: 5, outputPerMillion: 20 };

export function priceFor(model: string): ModelPrice {
  return PRICES[model] ?? PRICES[model.replace(/-\d{8}$/, "")] ?? DEFAULT_PRICE;
}

/** Cost in micro-dollars (1e-6 USD) so ledgers stay integers. */
export function costUsdMicros(model: string, usage: { inputTokens: number; outputTokens: number }): number {
  const price = priceFor(model);
  const micros = (usage.inputTokens * price.inputPerMillion + usage.outputTokens * price.outputPerMillion);
  return Math.round(micros);
}

export function usdCentsToMicros(cents: number): number {
  return Math.round(cents * 10_000);
}

export function microsToUsd(micros: number): number {
  return micros / 1_000_000;
}

/** Curated suggestions per provider; the platform accepts free-text ids too. */
export const SUGGESTED_MODELS: Record<AiProviderId, { router: string[]; specialist: string[] }> = {
  anthropic: {
    router: ["claude-haiku-4-5-20251001", "claude-sonnet-5"],
    specialist: ["claude-sonnet-5", "claude-opus-5", "claude-fable-5-1"],
  },
  openai: {
    router: ["gpt-5-mini", "gpt-5-nano", "gpt-4.1-mini"],
    specialist: ["gpt-5", "gpt-5-mini", "gpt-4.1"],
  },
  google: {
    router: ["gemini-2.5-flash-lite", "gemini-2.5-flash"],
    specialist: ["gemini-2.5-pro", "gemini-2.5-flash"],
  },
  mock: { router: ["mock-router"], specialist: ["mock-specialist"] },
};

export const DEFAULT_MODELS: Record<AiProviderId, { router: string; specialist: string }> = {
  anthropic: { router: "claude-haiku-4-5-20251001", specialist: "claude-sonnet-5" },
  openai: { router: "gpt-5-mini", specialist: "gpt-5" },
  google: { router: "gemini-2.5-flash", specialist: "gemini-2.5-pro" },
  mock: { router: "mock-router", specialist: "mock-specialist" },
};
