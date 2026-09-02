import type { Doc, Id } from "../../_generated/dataModel";
import { decryptSecret } from "../secrets";
import type { AiProviderId } from "./provider";
import { DEFAULT_MODELS } from "./pricing";
import type { ProviderCandidate } from "./resilience";

export const PLATFORM_KEY_ENV: Record<AiProviderId, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
  mock: "AI_MOCK_PROVIDER_ENABLED",
};

export const DEFAULT_AI_SETTINGS = {
  provider: "anthropic" as AiProviderId,
  effort: "medium" as const,
  extendedThinking: false,
  dailyBudgetUsdCents: 500,
  maxTurnsPerThreadPerDay: 30,
  maxToolCallsPerTurn: 8,
  replyLanguage: "pt" as const,
};

export type EffectiveAiSettings = {
  provider: AiProviderId;
  routerModel: string;
  specialistModel: string;
  fallbackProvider?: AiProviderId;
  fallbackModel?: string;
  effort: "low" | "medium" | "high";
  extendedThinking: boolean;
  dailyBudgetUsdCents: number;
  maxTurnsPerThreadPerDay: number;
  maxToolCallsPerTurn: number;
  replyLanguage: "pt" | "en";
  configuredKeys: AiProviderId[];
};

export function effectiveSettings(row: Doc<"aiSettings"> | null): EffectiveAiSettings {
  const provider = row?.provider ?? DEFAULT_AI_SETTINGS.provider;
  return {
    provider,
    routerModel: row?.routerModel ?? DEFAULT_MODELS[provider].router,
    specialistModel: row?.specialistModel ?? DEFAULT_MODELS[provider].specialist,
    fallbackProvider: row?.fallbackProvider,
    fallbackModel: row?.fallbackModel,
    effort: row?.effort ?? DEFAULT_AI_SETTINGS.effort,
    extendedThinking: row?.extendedThinking ?? DEFAULT_AI_SETTINGS.extendedThinking,
    dailyBudgetUsdCents: row?.dailyBudgetUsdCents ?? DEFAULT_AI_SETTINGS.dailyBudgetUsdCents,
    maxTurnsPerThreadPerDay: row?.maxTurnsPerThreadPerDay ?? DEFAULT_AI_SETTINGS.maxTurnsPerThreadPerDay,
    maxToolCallsPerTurn: row?.maxToolCallsPerTurn ?? DEFAULT_AI_SETTINGS.maxToolCallsPerTurn,
    replyLanguage: row?.replyLanguage ?? DEFAULT_AI_SETTINGS.replyLanguage,
    configuredKeys: (row?.keys ?? []).map((key) => key.provider),
  };
}

export function platformKeyFor(provider: AiProviderId): string | undefined {
  const value = process.env[PLATFORM_KEY_ENV[provider]];
  if (provider === "mock") return value === "1" || value === "true" ? "mock" : undefined;
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Tenant key wins; otherwise the platform env key. Decryption only happens
 * here (actions), and the key never leaves the server.
 */
export async function resolveApiKey(
  row: Doc<"aiSettings"> | null,
  provider: AiProviderId,
): Promise<{ apiKey: string; keySource: "tenant" | "platform" } | { apiKey: ""; keySource: "none" }> {
  const own = row?.keys.find((key) => key.provider === provider);
  if (own) {
    try {
      const apiKey = await decryptSecret(own.ciphertext, own.keyVersion);
      return { apiKey, keySource: "tenant" };
    } catch {
      // Fall through to the platform key; the probe will surface the problem.
    }
  }
  const platform = platformKeyFor(provider);
  if (platform) return { apiKey: platform, keySource: "platform" };
  return { apiKey: "", keySource: "none" };
}

/** Candidates for a stage: primary then fallback (if configured and distinct). */
export async function candidatesFor(
  row: Doc<"aiSettings"> | null,
  stage: "router" | "specialist",
): Promise<ProviderCandidate[]> {
  const settings = effectiveSettings(row);
  const primaryModel = stage === "router" ? settings.routerModel : settings.specialistModel;
  const primary = await resolveApiKey(row, settings.provider);
  const out: ProviderCandidate[] = [{ provider: settings.provider, model: primaryModel, ...primary }];
  if (settings.fallbackProvider && settings.fallbackModel && settings.fallbackProvider !== settings.provider) {
    const fallback = await resolveApiKey(row, settings.fallbackProvider);
    out.push({ provider: settings.fallbackProvider, model: settings.fallbackModel, ...fallback });
  }
  return out;
}

export function maskKey(last4: string): string {
  return `••••${last4}`;
}

export function looksLikeApiKey(provider: AiProviderId, value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 16 || /\s/.test(trimmed)) return false;
  if (provider === "anthropic") return trimmed.startsWith("sk-ant-");
  if (provider === "openai") return trimmed.startsWith("sk-");
  if (provider === "google") return trimmed.length >= 20;
  return true;
}

export type AiSettingsId = Id<"aiSettings">;
