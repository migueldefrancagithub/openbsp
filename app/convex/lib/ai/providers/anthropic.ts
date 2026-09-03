import {
  AiProviderError,
  classifyHttpFailure,
  DEFAULT_TIMEOUT_MS,
  fetchWithTimeout,
  readErrorBody,
  retryAfterFromHeaders,
  stringifyToolOutput,
  type AdapterContext,
  type AiProviderAdapter,
  type AiRequest,
  type AiResponse,
  type AiToolCall,
} from "../provider";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

type AnthropicContent =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

function toAnthropicMessages(request: AiRequest): Array<{ role: "user" | "assistant"; content: string | AnthropicContent[] }> {
  const out: Array<{ role: "user" | "assistant"; content: string | AnthropicContent[] }> = [];
  for (const message of request.messages) {
    if (message.role === "user") {
      out.push({ role: "user", content: message.content });
    } else if (message.role === "assistant") {
      const content: AnthropicContent[] = [];
      if (message.content) content.push({ type: "text", text: message.content });
      for (const call of message.toolCalls ?? []) {
        content.push({ type: "tool_use", id: call.id, name: call.name, input: call.input ?? {} });
      }
      out.push({ role: "assistant", content: content.length > 0 ? content : "" });
    } else {
      out.push({
        role: "user",
        content: message.results.map((result) => ({
          type: "tool_result" as const,
          tool_use_id: result.callId,
          content: stringifyToolOutput(result.output),
          ...(result.isError ? { is_error: true } : {}),
        })),
      });
    }
  }
  // Anthropic requires alternating roles and a user turn first.
  return out;
}

export const anthropicAdapter: AiProviderAdapter = {
  id: "anthropic",
  async complete(request: AiRequest, ctx: AdapterContext): Promise<AiResponse> {
    const fetchImpl = ctx.fetchImpl ?? ((input, init) => fetch(input, init));
    const body: Record<string, unknown> = {
      model: request.model,
      max_tokens: request.maxTokens,
      system: request.system,
      messages: toAnthropicMessages(request),
    };
    if (request.temperature !== undefined && !request.extendedThinking) body.temperature = request.temperature;
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
      }));
      if (request.toolChoice === "required") body.tool_choice = { type: "any" };
      else if (request.toolChoice === "none") body.tool_choice = { type: "none" };
      else if (request.toolChoice && typeof request.toolChoice === "object") {
        body.tool_choice = { type: "tool", name: request.toolChoice.name };
      }
    }
    if (request.extendedThinking) body.thinking = { type: "adaptive" };

    const started = Date.now();
    const response = await fetchWithTimeout(
      "anthropic",
      fetchImpl,
      ctx.baseUrl ?? ANTHROPIC_URL,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": ctx.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
      },
      request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    if (!response.ok) {
      throw new AiProviderError({
        provider: "anthropic",
        kind: classifyHttpFailure(response.status),
        status: response.status,
        retryAfterMs: retryAfterFromHeaders(response.headers),
        message: `Anthropic ${response.status}: ${await readErrorBody(response)}`,
      });
    }
    const data = (await response.json()) as {
      content?: AnthropicContent[];
      stop_reason?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
      model?: string;
    };
    const text = (data.content ?? [])
      .filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim();
    const toolCalls: AiToolCall[] = (data.content ?? [])
      .filter((part): part is { type: "tool_use"; id: string; name: string; input: unknown } => part.type === "tool_use")
      .map((part) => ({ id: part.id, name: part.name, input: part.input }));
    const finishReason =
      data.stop_reason === "tool_use" ? "tool_calls" : data.stop_reason === "max_tokens" ? "length" : data.stop_reason === "end_turn" || data.stop_reason === "stop_sequence" ? "stop" : "other";
    return {
      provider: "anthropic",
      model: data.model ?? request.model,
      text,
      toolCalls,
      finishReason,
      usage: { inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 },
      latencyMs: Date.now() - started,
    };
  },
};
