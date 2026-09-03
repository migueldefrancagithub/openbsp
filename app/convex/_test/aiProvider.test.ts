import { describe, expect, it } from "vitest";
import { AiProviderError, type AiRequest, type FetchLike } from "../lib/ai/provider";
import { anthropicAdapter } from "../lib/ai/providers/anthropic";
import { googleAdapter, toGoogleSchema } from "../lib/ai/providers/google";
import { isReasoningModel, openaiAdapter } from "../lib/ai/providers/openai";
import { mockAdapter, setMockScript } from "../lib/ai/providers/mock";
import { backoffFor, completeWithResilience, isRetryable, shouldFallback } from "../lib/ai/resilience";

const tool = {
  name: "reservar_slot",
  description: "Reserva",
  inputSchema: { type: "object", properties: { serviceId: { type: "string" }, startAt: { type: "number" } }, required: ["serviceId", "startAt"], additionalProperties: false },
};

const baseRequest: AiRequest = {
  model: "m",
  system: "sys",
  messages: [
    { role: "user", content: "Olá" },
    { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "reservar_slot", input: { serviceId: "s", startAt: 1 } }] },
    { role: "tool", results: [{ callId: "c1", name: "reservar_slot", output: { appointmentId: "a1" } }] },
    { role: "user", content: "Obrigado" },
  ],
  tools: [tool],
  toolChoice: "auto",
  maxTokens: 200,
  temperature: 0.2,
};

function fetchReturning(status: number, body: unknown, headers: Record<string, string> = {}): { fetchImpl: FetchLike; calls: Array<{ url: string; body: any; headers: Record<string, string> }> } {
  const calls: Array<{ url: string; body: any; headers: Record<string, string> }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, body: JSON.parse(String(init.body)), headers: Object.fromEntries(Object.entries(init.headers as Record<string, string>)) });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  };
  return { fetchImpl, calls };
}

describe("provider adapters", () => {
  it("maps requests and parses responses for Anthropic", async () => {
    const { fetchImpl, calls } = fetchReturning(200, {
      model: "claude-x",
      content: [{ type: "text", text: "Olá!" }, { type: "tool_use", id: "tu1", name: "reservar_slot", input: { serviceId: "s", startAt: 2 } }],
      stop_reason: "tool_use",
      usage: { input_tokens: 100, output_tokens: 20 },
    });
    const response = await anthropicAdapter.complete({ ...baseRequest, model: "claude-x" }, { apiKey: "sk-ant-test", fetchImpl });
    expect(calls[0].headers["x-api-key"]).toBe("sk-ant-test");
    expect(calls[0].body.system).toBe("sys");
    expect(calls[0].body.tools[0].input_schema).toEqual(tool.inputSchema);
    expect(calls[0].body.messages[2].content[0]).toMatchObject({ type: "tool_result", tool_use_id: "c1" });
    expect(response).toMatchObject({ provider: "anthropic", text: "Olá!", finishReason: "tool_calls", usage: { inputTokens: 100, outputTokens: 20 } });
    expect(response.toolCalls[0]).toEqual({ id: "tu1", name: "reservar_slot", input: { serviceId: "s", startAt: 2 } });
  });

  it("maps requests and parses responses for OpenAI (incl. reasoning models)", async () => {
    const { fetchImpl, calls } = fetchReturning(200, {
      model: "gpt-5",
      choices: [{ message: { content: null, tool_calls: [{ id: "call1", function: { name: "reservar_slot", arguments: '{"serviceId":"s","startAt":3}' } }] }, finish_reason: "tool_calls" }],
      usage: { prompt_tokens: 50, completion_tokens: 10 },
    });
    const response = await openaiAdapter.complete({ ...baseRequest, model: "gpt-5", effort: "low" }, { apiKey: "sk-test", fetchImpl });
    expect(isReasoningModel("gpt-5")).toBe(true);
    expect(calls[0].body.temperature).toBeUndefined();
    expect(calls[0].body.reasoning_effort).toBe("low");
    expect(calls[0].body.messages[0]).toEqual({ role: "system", content: "sys" });
    expect(calls[0].body.messages[3]).toMatchObject({ role: "tool", tool_call_id: "c1" });
    expect(response.toolCalls[0]).toEqual({ id: "call1", name: "reservar_slot", input: { serviceId: "s", startAt: 3 } });
    expect(response.finishReason).toBe("tool_calls");
  });

  it("maps requests and parses responses for Gemini", async () => {
    const { fetchImpl, calls } = fetchReturning(200, {
      candidates: [{ content: { parts: [{ text: "Claro." }, { functionCall: { name: "reservar_slot", args: { serviceId: "s", startAt: 4 } } }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 8 },
    });
    const response = await googleAdapter.complete({ ...baseRequest, model: "gemini-2.5-flash", toolChoice: { name: "reservar_slot" } }, { apiKey: "g-key-1234567890abcdef", fetchImpl });
    expect(calls[0].url).toContain("/models/gemini-2.5-flash:generateContent");
    expect(calls[0].headers["x-goog-api-key"]).toBeDefined();
    expect(calls[0].body.tool_config.function_calling_config).toEqual({ mode: "ANY", allowed_function_names: ["reservar_slot"] });
    expect(calls[0].body.contents[2].parts[0].functionResponse.name).toBe("reservar_slot");
    expect(toGoogleSchema({ type: "object", additionalProperties: false, properties: { a: { type: "string", default: "x" } } })).toEqual({ type: "object", properties: { a: { type: "string" } } });
    expect(response).toMatchObject({ text: "Claro.", finishReason: "tool_calls", usage: { inputTokens: 30, outputTokens: 8 } });
  });

  it("classifies HTTP failures and timeouts", async () => {
    const { fetchImpl } = fetchReturning(429, { error: "slow down" }, { "retry-after": "2" });
    await expect(anthropicAdapter.complete(baseRequest, { apiKey: "k", fetchImpl })).rejects.toMatchObject({ kind: "rate_limit", status: 429, retryAfterMs: 2000 });
    const unauthorized = fetchReturning(401, { error: "bad key" });
    await expect(openaiAdapter.complete(baseRequest, { apiKey: "k", fetchImpl: unauthorized.fetchImpl })).rejects.toMatchObject({ kind: "auth" });
    const slow: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      });
    await expect(googleAdapter.complete({ ...baseRequest, timeoutMs: 20 }, { apiKey: "k", fetchImpl: slow })).rejects.toMatchObject({ kind: "timeout" });
  });
});

describe("resilience", () => {
  it("retries transient failures with backoff and falls back to the next provider", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async (url) => {
      calls += 1;
      if (url.includes("anthropic")) return new Response("busy", { status: 503 });
      return new Response(JSON.stringify({ choices: [{ message: { content: "OK" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 });
    };
    const sleeps: number[] = [];
    const result = await completeWithResilience(
      [
        { provider: "anthropic", model: "claude-x", apiKey: "a", keySource: "platform" },
        { provider: "openai", model: "gpt-x", apiKey: "b", keySource: "tenant" },
      ],
      { model: "x", system: "s", messages: [{ role: "user", content: "hi" }], maxTokens: 5 },
      { stage: "router", fetchImpl, sleep: async (ms) => { sleeps.push(ms); } },
    );
    expect(result.candidate.provider).toBe("openai");
    expect(result.response.text).toBe("OK");
    expect(result.attempts.map((a) => `${a.provider}:${a.ok ? "ok" : a.kind}`)).toEqual(["anthropic:server", "anthropic:server", "openai:ok"]);
    expect(sleeps).toEqual([500]);
    expect(calls).toBe(3);
  });

  it("does not retry auth errors, skips unconfigured candidates, and reports every attempt on total failure", async () => {
    const fetchImpl: FetchLike = async () => new Response("no", { status: 401 });
    await expect(
      completeWithResilience(
        [
          { provider: "google", model: "g", apiKey: "", keySource: "none" },
          { provider: "anthropic", model: "c", apiKey: "k", keySource: "platform" },
        ],
        { model: "x", system: "s", messages: [{ role: "user", content: "hi" }], maxTokens: 5 },
        { stage: "specialist", fetchImpl, sleep: async () => {} },
      ),
    ).rejects.toMatchObject({ kind: "auth", attempts: [{ provider: "google", kind: "not_configured" }, { provider: "anthropic", kind: "auth", attempt: 1 }] });
    expect(isRetryable("rate_limit")).toBe(true);
    expect(isRetryable("auth")).toBe(false);
    expect(shouldFallback("invalid_request")).toBe(false);
    expect(backoffFor("rate_limit", 1, 60_000)).toBe(4_000);
    expect(backoffFor("server", 2)).toBe(1_000);
  });

  it("uses the mock provider deterministically", async () => {
    setMockScript(null);
    const forced = await mockAdapter.complete({ model: "mock-router", system: "s", messages: [{ role: "user", content: "olá" }], maxTokens: 5, toolChoice: { name: "emit_route" } }, { apiKey: "mock" });
    expect(forced.toolCalls[0].name).toBe("emit_route");
    const tooled = await mockAdapter.complete({ model: "m", system: "s", messages: [{ role: "user", content: '[[tool:reservar_slot {"serviceId":"s","startAt":9}]]' }], maxTokens: 5 }, { apiKey: "mock" });
    expect(tooled.toolCalls[0]).toMatchObject({ name: "reservar_slot", input: { startAt: 9 } });
    await expect(mockAdapter.complete({ model: "m", system: "s", messages: [{ role: "user", content: "[[fail:rate_limit]]" }], maxTokens: 5 }, { apiKey: "mock" })).rejects.toBeInstanceOf(AiProviderError);
    setMockScript(() => ({ provider: "mock", model: "m", text: "scripted", toolCalls: [], finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 0 }));
    expect((await mockAdapter.complete({ model: "m", system: "s", messages: [{ role: "user", content: "x" }], maxTokens: 5 }, { apiKey: "mock" })).text).toBe("scripted");
    setMockScript(null);
  });
});
