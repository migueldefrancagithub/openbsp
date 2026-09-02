import {
  AiProviderError,
  classifyHttpFailure,
  DEFAULT_TIMEOUT_MS,
  fetchWithTimeout,
  readErrorBody,
  retryAfterFromHeaders,
  type AdapterContext,
  type AiProviderAdapter,
  type AiRequest,
  type AiResponse,
  type AiToolCall,
} from "../provider";

const GOOGLE_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

type GooglePart =
  | { text: string }
  | { functionCall: { name: string; args: unknown } }
  | { functionResponse: { name: string; response: unknown } };

function toGoogleContents(request: AiRequest) {
  const contents: Array<{ role: "user" | "model"; parts: GooglePart[] }> = [];
  for (const message of request.messages) {
    if (message.role === "user") {
      contents.push({ role: "user", parts: [{ text: message.content }] });
    } else if (message.role === "assistant") {
      const parts: GooglePart[] = [];
      if (message.content) parts.push({ text: message.content });
      for (const call of message.toolCalls ?? []) parts.push({ functionCall: { name: call.name, args: call.input ?? {} } });
      contents.push({ role: "model", parts: parts.length > 0 ? parts : [{ text: "" }] });
    } else {
      contents.push({
        role: "user",
        parts: message.results.map((result) => ({
          functionResponse: {
            name: result.name,
            response: typeof result.output === "object" && result.output !== null ? result.output : { result: result.output ?? null },
          },
        })),
      });
    }
  }
  return contents;
}

/** Gemini tool schemas use a subset of JSON Schema without `$schema`/`additionalProperties`. */
export function toGoogleSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "$schema" || key === "additionalProperties" || key === "default") continue;
    if (key === "properties" && value && typeof value === "object") {
      out.properties = Object.fromEntries(
        Object.entries(value as Record<string, Record<string, unknown>>).map(([name, prop]) => [name, toGoogleSchema(prop)]),
      );
    } else if (key === "items" && value && typeof value === "object") {
      out.items = toGoogleSchema(value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export const googleAdapter: AiProviderAdapter = {
  id: "google",
  async complete(request: AiRequest, ctx: AdapterContext): Promise<AiResponse> {
    const fetchImpl = ctx.fetchImpl ?? ((input, init) => fetch(input, init));
    const body: Record<string, unknown> = {
      system_instruction: { parts: [{ text: request.system }] },
      contents: toGoogleContents(request),
      generationConfig: {
        maxOutputTokens: request.maxTokens,
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      },
    };
    if (request.tools && request.tools.length > 0) {
      body.tools = [
        {
          function_declarations: request.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: toGoogleSchema(tool.inputSchema),
          })),
        },
      ];
      const mode =
        request.toolChoice === "required" || (request.toolChoice && typeof request.toolChoice === "object")
          ? "ANY"
          : request.toolChoice === "none"
            ? "NONE"
            : "AUTO";
      body.tool_config = {
        function_calling_config: {
          mode,
          ...(request.toolChoice && typeof request.toolChoice === "object" ? { allowed_function_names: [request.toolChoice.name] } : {}),
        },
      };
    }

    const started = Date.now();
    const url = `${ctx.baseUrl ?? GOOGLE_BASE}/${encodeURIComponent(request.model)}:generateContent`;
    const response = await fetchWithTimeout(
      "google",
      fetchImpl,
      url,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": ctx.apiKey },
        body: JSON.stringify(body),
      },
      request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    if (!response.ok) {
      throw new AiProviderError({
        provider: "google",
        kind: classifyHttpFailure(response.status),
        status: response.status,
        retryAfterMs: retryAfterFromHeaders(response.headers),
        message: `Gemini ${response.status}: ${await readErrorBody(response)}`,
      });
    }
    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: GooglePart[] }; finishReason?: string }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      modelVersion?: string;
    };
    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const text = parts
      .filter((part): part is { text: string } => "text" in part && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n")
      .trim();
    const toolCalls: AiToolCall[] = parts
      .filter((part): part is { functionCall: { name: string; args: unknown } } => "functionCall" in part)
      .map((part, index) => ({ id: `gcall_${index}_${part.functionCall.name}`, name: part.functionCall.name, input: part.functionCall.args ?? {} }));
    const finishReason =
      toolCalls.length > 0 ? "tool_calls" : candidate?.finishReason === "MAX_TOKENS" ? "length" : candidate?.finishReason === "STOP" ? "stop" : "other";
    return {
      provider: "google",
      model: data.modelVersion ?? request.model,
      text,
      toolCalls,
      finishReason,
      usage: { inputTokens: data.usageMetadata?.promptTokenCount ?? 0, outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0 },
      latencyMs: Date.now() - started,
    };
  },
};
