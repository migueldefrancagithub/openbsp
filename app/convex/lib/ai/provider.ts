/**
 * Provider port. Every LLM call in OpenBSP goes through `AiProviderAdapter`
 * so the runtime, the sandbox and the composer never depend on a vendor
 * shape. Adapters are thin HTTP clients (no SDK), which keeps the Convex
 * runtime requirements minimal and makes them testable with a fetch stub.
 */
export type AiProviderId = "anthropic" | "openai" | "google" | "mock";

export type JsonSchema = Record<string, unknown>;

export type AiToolSpec = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
};

export type AiToolCall = { id: string; name: string; input: unknown };

export type AiToolResult = {
  callId: string;
  name: string;
  output: unknown;
  isError?: boolean;
};

export type AiMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: AiToolCall[] }
  | { role: "tool"; results: AiToolResult[] };

export type AiEffort = "low" | "medium" | "high";

export type AiRequest = {
  model: string;
  system: string;
  messages: AiMessage[];
  tools?: AiToolSpec[];
  /** `required` forces a call; `{ name }` forces one specific tool (structured output). */
  toolChoice?: "auto" | "none" | "required" | { name: string };
  maxTokens: number;
  temperature?: number;
  effort?: AiEffort;
  extendedThinking?: boolean;
  timeoutMs?: number;
};

export type AiFinishReason = "stop" | "tool_calls" | "length" | "other";

export type AiUsage = { inputTokens: number; outputTokens: number };

export type AiResponse = {
  text: string;
  toolCalls: AiToolCall[];
  finishReason: AiFinishReason;
  usage: AiUsage;
  latencyMs: number;
  model: string;
  provider: AiProviderId;
};

export type AiErrorKind =
  | "auth"
  | "rate_limit"
  | "timeout"
  | "server"
  | "network"
  | "invalid_request"
  | "content"
  | "not_configured";

export class AiProviderError extends Error {
  readonly kind: AiErrorKind;
  readonly provider: AiProviderId;
  readonly status?: number;
  readonly retryAfterMs?: number;

  constructor(args: {
    kind: AiErrorKind;
    provider: AiProviderId;
    message: string;
    status?: number;
    retryAfterMs?: number;
  }) {
    super(args.message);
    this.name = "AiProviderError";
    this.kind = args.kind;
    this.provider = args.provider;
    this.status = args.status;
    this.retryAfterMs = args.retryAfterMs;
  }
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type AdapterContext = {
  apiKey: string;
  fetchImpl?: FetchLike;
  baseUrl?: string;
};

export interface AiProviderAdapter {
  readonly id: AiProviderId;
  complete(request: AiRequest, ctx: AdapterContext): Promise<AiResponse>;
}

export const DEFAULT_TIMEOUT_MS = 45_000;

/** Map HTTP failures to a kind the resilience layer can act on. */
export function classifyHttpFailure(status: number): AiErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status === 408) return "timeout";
  if (status >= 500) return "server";
  if (status === 400 || status === 404 || status === 413 || status === 422) return "invalid_request";
  return "server";
}

export function retryAfterFromHeaders(headers: Headers | undefined): number | undefined {
  const raw = headers?.get("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

/** fetch with a hard timeout; timeouts and network errors become AiProviderError. */
export async function fetchWithTimeout(
  provider: AiProviderId,
  fetchImpl: FetchLike,
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    throw new AiProviderError({
      provider,
      kind: aborted ? "timeout" : "network",
      message: aborted ? `Provider timed out after ${timeoutMs} ms.` : `Network error: ${error instanceof Error ? error.message : String(error)}`,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function readErrorBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 500);
  } catch {
    return "";
  }
}

export function stringifyToolInput(input: unknown): string {
  return typeof input === "string" ? input : JSON.stringify(input ?? {});
}

export function stringifyToolOutput(output: unknown): string {
  if (typeof output === "string") return output.slice(0, 8_000);
  try {
    return JSON.stringify(output ?? null).slice(0, 8_000);
  } catch {
    return String(output).slice(0, 8_000);
  }
}
