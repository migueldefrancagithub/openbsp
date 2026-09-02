import { anthropicAdapter } from "./providers/anthropic";
import { googleAdapter } from "./providers/google";
import { mockAdapter } from "./providers/mock";
import { openaiAdapter } from "./providers/openai";
import {
  AiProviderError,
  type AdapterContext,
  type AiErrorKind,
  type AiProviderAdapter,
  type AiProviderId,
  type AiRequest,
  type AiResponse,
  type FetchLike,
} from "./provider";

export const ADAPTERS: Record<AiProviderId, AiProviderAdapter> = {
  anthropic: anthropicAdapter,
  openai: openaiAdapter,
  google: googleAdapter,
  mock: mockAdapter,
};

export type ProviderCandidate = {
  provider: AiProviderId;
  model: string;
  apiKey: string;
  keySource: "tenant" | "platform" | "none";
};

export type ProviderAttempt = {
  provider: AiProviderId;
  model: string;
  stage: string;
  attempt: number;
  ok: boolean;
  kind?: AiErrorKind;
  status?: number;
  latencyMs: number;
};

export type ResilientResult = {
  response: AiResponse;
  candidate: ProviderCandidate;
  attempts: ProviderAttempt[];
};

export const MAX_ATTEMPTS_PER_CANDIDATE = 2;
export const MAX_RETRY_WAIT_MS = 4_000;
export const BASE_BACKOFF_MS = 500;

/** Retry the same provider only for transient failures. */
export function isRetryable(kind: AiErrorKind): boolean {
  return kind === "rate_limit" || kind === "server" || kind === "timeout" || kind === "network";
}

/** Hand over to the next provider for anything but a malformed request of ours. */
export function shouldFallback(kind: AiErrorKind): boolean {
  return kind !== "invalid_request";
}

export function backoffFor(kind: AiErrorKind, attempt: number, retryAfterMs?: number): number {
  if (kind === "rate_limit" && retryAfterMs !== undefined) return Math.min(retryAfterMs, MAX_RETRY_WAIT_MS);
  return Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_RETRY_WAIT_MS);
}

export type ResilienceOptions = {
  stage: string;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  /** Total wall-clock budget across candidates (actions have their own limit). */
  deadlineMs?: number;
  baseUrls?: Partial<Record<AiProviderId, string>>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Try the primary candidate (with bounded retries on transient failures),
 * then each fallback in order. Every attempt is recorded so the turn can be
 * audited; the caller decides what to do when everything fails.
 */
export async function completeWithResilience(
  candidates: ProviderCandidate[],
  request: AiRequest,
  options: ResilienceOptions,
): Promise<ResilientResult> {
  const attempts: ProviderAttempt[] = [];
  const sleep = options.sleep ?? defaultSleep;
  const startedAt = Date.now();
  const deadline = options.deadlineMs ?? 120_000;
  let lastError: AiProviderError | null = null;

  for (const candidate of candidates) {
    if (candidate.keySource === "none" || !candidate.apiKey) {
      attempts.push({ provider: candidate.provider, model: candidate.model, stage: options.stage, attempt: 0, ok: false, kind: "not_configured", latencyMs: 0 });
      lastError = new AiProviderError({ provider: candidate.provider, kind: "not_configured", message: `No API key for ${candidate.provider}.` });
      continue;
    }
    const adapter = ADAPTERS[candidate.provider];
    const ctx: AdapterContext = { apiKey: candidate.apiKey, fetchImpl: options.fetchImpl, baseUrl: options.baseUrls?.[candidate.provider] };
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_CANDIDATE; attempt += 1) {
      if (Date.now() - startedAt > deadline) break;
      const attemptStarted = Date.now();
      try {
        const response = await adapter.complete({ ...request, model: candidate.model }, ctx);
        attempts.push({ provider: candidate.provider, model: candidate.model, stage: options.stage, attempt, ok: true, latencyMs: response.latencyMs });
        return { response, candidate, attempts };
      } catch (error) {
        const failure =
          error instanceof AiProviderError
            ? error
            : new AiProviderError({ provider: candidate.provider, kind: "server", message: error instanceof Error ? error.message : String(error) });
        lastError = failure;
        attempts.push({
          provider: candidate.provider,
          model: candidate.model,
          stage: options.stage,
          attempt,
          ok: false,
          kind: failure.kind,
          status: failure.status,
          latencyMs: Date.now() - attemptStarted,
        });
        if (!isRetryable(failure.kind) || attempt === MAX_ATTEMPTS_PER_CANDIDATE) break;
        await sleep(backoffFor(failure.kind, attempt, failure.retryAfterMs));
      }
    }
    if (lastError && !shouldFallback(lastError.kind)) break;
  }
  const summary = attempts.map((a) => `${a.provider}/${a.model}#${a.attempt}:${a.ok ? "ok" : a.kind}`).join(", ");
  throw Object.assign(
    new AiProviderError({
      provider: lastError?.provider ?? candidates[0]?.provider ?? "mock",
      kind: lastError?.kind ?? "not_configured",
      message: `All providers failed (${summary}). Last: ${lastError?.message ?? "no candidates"}`,
      status: lastError?.status,
      retryAfterMs: lastError?.retryAfterMs,
    }),
    { attempts },
  );
}
