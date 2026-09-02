import { AiProviderError, type AdapterContext, type AiProviderAdapter, type AiRequest, type AiResponse } from "../provider";

/**
 * Deterministic provider for tests, the sandbox and the golden set. Scripted
 * via `mockScript` (per test) or by simple conventions in the last user
 * message: `[[tool:name {...}]]` returns a tool call, `[[fail:kind]]` raises.
 */
export type MockScript = (request: AiRequest) => AiResponse | AiProviderError;

let script: MockScript | null = null;

export function setMockScript(next: MockScript | null) {
  script = next;
}

function lastUserText(request: AiRequest): string {
  for (let i = request.messages.length - 1; i >= 0; i -= 1) {
    const message = request.messages[i];
    if (message.role === "user") return message.content;
  }
  return "";
}

export const mockAdapter: AiProviderAdapter = {
  id: "mock",
  async complete(request: AiRequest, _ctx: AdapterContext): Promise<AiResponse> {
    const started = Date.now();
    if (script) {
      const result = script(request);
      if (result instanceof AiProviderError) throw result;
      return { ...result, latencyMs: Date.now() - started };
    }
    const text = lastUserText(request);
    const fail = text.match(/\[\[fail:(\w+)\]\]/);
    if (fail) {
      throw new AiProviderError({ provider: "mock", kind: fail[1] as AiProviderError["kind"], message: `mock ${fail[1]}` });
    }
    const tool = text.match(/\[\[tool:([a-z_]+)\s*(\{.*\})?\]\]/);
    if (tool) {
      return {
        provider: "mock",
        model: request.model,
        text: "",
        toolCalls: [{ id: `mock_${tool[1]}`, name: tool[1], input: tool[2] ? JSON.parse(tool[2]) : {} }],
        finishReason: "tool_calls",
        usage: { inputTokens: 50, outputTokens: 20 },
        latencyMs: Date.now() - started,
      };
    }
    if (request.toolChoice && typeof request.toolChoice === "object") {
      return {
        provider: "mock",
        model: request.model,
        text: "",
        toolCalls: [{ id: "mock_forced", name: request.toolChoice.name, input: { intent: "info_request", needsHuman: false, confidence: 0.9 } }],
        finishReason: "tool_calls",
        usage: { inputTokens: 40, outputTokens: 15 },
        latencyMs: Date.now() - started,
      };
    }
    return {
      provider: "mock",
      model: request.model,
      text: `Resposta simulada: ${text.slice(0, 80)}`,
      toolCalls: [],
      finishReason: "stop",
      usage: { inputTokens: 60, outputTokens: 30 },
      latencyMs: Date.now() - started,
    };
  },
};
