import { convexTest } from "convex-test";
import { afterAll, describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";
import { setMockScript } from "../lib/ai/providers/mock";

const previous = { key: process.env.WABA_TOKEN_ENCRYPTION_KEY_V1, mock: process.env.AI_MOCK_PROVIDER_ENABLED };
process.env.WABA_TOKEN_ENCRYPTION_KEY_V1 = "f".repeat(64);
process.env.AI_MOCK_PROVIDER_ENABLED = "1";
afterAll(() => {
  setMockScript(null);
  if (previous.key === undefined) delete process.env.WABA_TOKEN_ENCRYPTION_KEY_V1; else process.env.WABA_TOKEN_ENCRYPTION_KEY_V1 = previous.key;
  if (previous.mock === undefined) delete process.env.AI_MOCK_PROVIDER_ENABLED; else process.env.AI_MOCK_PROVIDER_ENABLED = previous.mock;
});

async function seed(t: ReturnType<typeof convexTest>) {
  const base = await t.run(async (ctx) => {
    const tenantId = await ctx.db.insert("tenants", { name: "Clínica", vertical: "clinic", plan: "starter", settings: { defaultLocale: "pt-MZ", timezone: "Africa/Maputo", retentionDays: 730 }, createdAt: Date.now() });
    const make = async (role: "owner" | "marketing") => {
      const userId = await ctx.db.insert("users", { name: role });
      const memberId = await ctx.db.insert("members", { tenantId, userId, role, status: "active", createdAt: Date.now() });
      await ctx.db.insert("sessions", { userId, activeTenantId: tenantId, updatedAt: Date.now() });
      return { userId, memberId };
    };
    const owner = await make("owner");
    const marketing = await make("marketing");
    const now = Date.now();
    const channelId = await ctx.db.insert("channels", { tenantId, publicId: "hub_composerxxxxxxxxxxxxxxx".slice(0, 28), kind: "whatsapp", provider: "iasolution_hub", operationalTerritory: "openbsp", externalAccountId: "c-cmp", displayName: "Piloto", status: "active", sendMode: "allowlist", outboundAllowlist: [], connectionState: "allowlist_only", webhookStatus: "verified", createdBy: owner.memberId, createdAt: now, updatedAt: now });
    const threadId = await ctx.db.insert("channelThreads", { tenantId, channelId, threadKey: "258840000077", lastEventAt: now, lastEventKind: "message.text", unreadCount: 0, createdAt: now, updatedAt: now });
    await ctx.db.insert("channelEvents", { tenantId, channelId, eventKey: "in:1", eventKind: "message.text", direction: "incoming", threadKey: "258840000077", payload: { text: "Quanto custa a consulta?" }, rawPayload: "{}", rawBodySha256: "s", status: "processed", attempts: 1, receivedAt: now });
    return { tenantId, owner, marketing, threadId };
  });
  const asOwner = t.withIdentity({ subject: base.owner.userId });
  await asOwner.mutation(api.aiSettings.update, { provider: "mock" });
  return { ...base, asOwner };
}

describe("AI composer", () => {
  it("suggests, rewrites and translates without ever sending; flags risky drafts", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    setMockScript((request) => ({
      provider: "mock",
      model: request.model,
      text: request.system.includes("Traduz") ? "How much is the consultation?" : request.system.includes("Reescreves") ? "Resposta mais curta." : "Olá! A consulta de avaliação custa 1500 MT. Quer marcar?",
      toolCalls: [],
      finishReason: "stop",
      usage: { inputTokens: 120, outputTokens: 30 },
      latencyMs: 5,
    }));
    const suggestion = await s.asOwner.action(api.aiComposer.suggestReply, { threadId: s.threadId });
    expect(suggestion.text).toContain("1500 MT");
    expect(suggestion.flagged).toEqual([]);
    const shorter = await s.asOwner.action(api.aiComposer.rewriteTone, { text: "Olá, tudo bem? A consulta custa 1500 MT e pode marcar quando quiser.", tone: "shorter", threadId: s.threadId });
    expect(shorter.text).toBe("Resposta mais curta.");
    const translated = await s.asOwner.action(api.aiComposer.translate, { text: "Quanto custa a consulta?", to: "en" });
    expect(translated.text).toBe("How much is the consultation?");

    setMockScript((request) => ({ provider: "mock", model: request.model, text: "Pode tomar 500 mg de paracetamol e a sua consulta está marcada para amanhã.", toolCalls: [], finishReason: "stop", usage: { inputTokens: 10, outputTokens: 10 }, latencyMs: 1 }));
    const risky = await s.asOwner.action(api.aiComposer.suggestReply, { threadId: s.threadId, hint: "responder sobre dor" });
    expect(risky.flagged.map((f) => f.split(":")[0])).toEqual(["HEALTHCARE_ADVICE", "UNVERIFIED_BOOKING"]);

    const state = await t.run(async (ctx) => ({ suggestions: await ctx.db.query("aiSuggestions").collect(), outbox: await ctx.db.query("channelOutbox").collect(), dispatches: await ctx.db.query("channelAutomationDispatches").collect(), ledger: await ctx.db.query("aiCostLedger").collect(), turns: await ctx.db.query("aiTurns").collect() }));
    expect(state.suggestions).toHaveLength(4);
    expect(state.suggestions.map((row) => row.kind)).toEqual(["suggest_reply", "rewrite_tone", "translate", "suggest_reply"]);
    expect(state.outbox).toHaveLength(0);
    expect(state.dispatches).toHaveLength(0);
    expect(state.turns).toHaveLength(0);
    expect(state.ledger[0].turns).toBe(4);
    await expect(t.withIdentity({ subject: s.marketing.userId }).action(api.aiComposer.suggestReply, { threadId: s.threadId })).rejects.toThrow(/FORBIDDEN_CAPABILITY/);
  });
});
