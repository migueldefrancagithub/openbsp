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

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

/** Reasoning models reject `temperature` and accept `reasoning_effort`. */
export function isReasoningModel(model: string): boolean {
  return /^(o\d|gpt-5)/i.test(model);
}

function toOpenAiMessages(request: AiRequest) {
  const out: Array<Record<string, unknown>> = [{ role: "system", content: request.system }];
  for (const message of request.messages) {
    if (message.role === "user") {
      out.push({ role: "user", content: message.content });
    } else if (message.role === "assistant") {
      out.push({
        role: "assistant",
        content: message.content || null,
        ...(message.toolCalls && message.toolCalls.length > 0
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: "function",
                function: { name: call.name, arguments: JSON.stringify(call.input ?? {}) },
              })),
            }
          : {}),
      });
    } else {
      for (const result of message.results) {
        out.push({ role: "tool", tool_call_id: result.callId, content: stringifyToolOutput(result.output) });
      }
    }
  }
  return out;
}

function parseArguments(raw: unknown): unknown {
  if (typeof raw !== "string") return raw ?? {};
  try {
    return JSON.parse(raw);
  } catch {
    return { _raw: raw };
  }
}

export const openaiAdapter: AiProviderAdapter = {
  id: "openai",
  async complete(request: AiRequest, ctx: AdapterContext): Promise<AiResponse> {
    const fetchImpl = ctx.fetchImpl ?? ((input, init) => fetch(input, init));
    const reasoning = isReasoningModel(request.model);
    const body: Record<string, unknown> = {
      model: request.model,
      messages: toOpenAiMessages(request),
      max_completion_tokens: request.maxTokens,
    };
    if (!reasoning && request.temperature !== undefined) body.temperature = request.temperature;
    if (reasoning && request.effort) body.reasoning_effort = request.effort;
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((tool) => ({
        type: "function",
        function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
      }));
      if (request.toolChoice === "required") body.tool_choice = "required";
      else if (request.toolChoice === "none") body.tool_choice = "none";
      else if (request.toolChoice && typeof request.toolChoice === "object") {
        body.tool_choice = { type: "function", function: { name: request.toolChoice.name } };
      }
    }

    const started = Date.now();
    const response = await fetchWithTimeout(
      "openai",
      fetchImpl,
      ctx.baseUrl ?? OPENAI_URL,
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${ctx.apiKey}` },
        body: JSON.stringify(body),
      },
      request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    if (!response.ok) {
      throw new AiProviderError({
        provider: "openai",
        kind: classifyHttpFailure(response.status),
        status: response.status,
        retryAfterMs: retryAfterFromHeaders(response.headers),
        message: `OpenAI ${response.status}: ${await readErrorBody(response)}`,
      });
    }
    const data = (await response.json()) as {
      model?: string;
      choices?: Array<{
        message?: { content?: string | null; tool_calls?: Array<{ id: string; function?: { name: string; arguments?: string } }> };
        finish_reason?: string;
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const choice = data.choices?.[0];
    const toolCalls: AiToolCall[] = (choice?.message?.tool_calls ?? []).map((call) => ({
      id: call.id,
      name: call.function?.name ?? "",
      input: parseArguments(call.function?.arguments),
    }));
    const finishReason =
      choice?.finish_reason === "tool_calls" || toolCalls.length > 0
        ? "tool_calls"
        : choice?.finish_reason === "length"
          ? "length"
          : choice?.finish_reason === "stop"
            ? "stop"
            : "other";
    return {
      provider: "openai",
      model: data.model ?? request.model,
      text: (choice?.message?.content ?? "").trim(),
      toolCalls,
      finishReason,
      usage: { inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0 },
      latencyMs: Date.now() - started,
    };
  },
};
