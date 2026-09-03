import { convexTest } from "convex-test";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";

const previous = { key: process.env.WABA_TOKEN_ENCRYPTION_KEY_V1, anthropic: process.env.ANTHROPIC_API_KEY, mock: process.env.AI_MOCK_PROVIDER_ENABLED };
process.env.WABA_TOKEN_ENCRYPTION_KEY_V1 = "a".repeat(64);
delete process.env.ANTHROPIC_API_KEY;

afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  if (previous.key === undefined) delete process.env.WABA_TOKEN_ENCRYPTION_KEY_V1;
  else process.env.WABA_TOKEN_ENCRYPTION_KEY_V1 = previous.key;
  if (previous.anthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = previous.anthropic;
  if (previous.mock === undefined) delete process.env.AI_MOCK_PROVIDER_ENABLED;
  else process.env.AI_MOCK_PROVIDER_ENABLED = previous.mock;
});

async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const tenantId = await ctx.db.insert("tenants", {
      name: "Clinic",
      vertical: "clinic",
      plan: "starter",
      settings: { defaultLocale: "pt-MZ", timezone: "Africa/Maputo", retentionDays: 730 },
      createdAt: Date.now(),
    });
    const make = async (role: "owner" | "agent") => {
      const userId = await ctx.db.insert("users", { name: role });
      const memberId = await ctx.db.insert("members", { tenantId, userId, role, status: "active", createdAt: Date.now() });
      await ctx.db.insert("sessions", { userId, activeTenantId: tenantId, updatedAt: Date.now() });
      return { userId, memberId };
    };
    return { tenantId, owner: await make("owner"), agent: await make("agent") };
  });
}

describe("AI settings", () => {
  it("serves defaults, validates updates and masks tenant keys", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    const asOwner = t.withIdentity({ subject: s.owner.userId });
    const asAgent = t.withIdentity({ subject: s.agent.userId });

    const defaults = await asOwner.query(api.aiSettings.get, {});
    expect(defaults).toMatchObject({ provider: "anthropic", routerModel: "claude-haiku-4-5-20251001", specialistModel: "claude-sonnet-5", ready: false, keys: [] });

    await expect(asAgent.mutation(api.aiSettings.update, { provider: "openai" })).rejects.toThrow(/FORBIDDEN_CAPABILITY/);
    await expect(asOwner.mutation(api.aiSettings.update, { specialistModel: "bad model!" })).rejects.toThrow(/AI_MODEL_REQUIRED/);
    await expect(asOwner.mutation(api.aiSettings.update, { fallbackProvider: "anthropic" })).rejects.toThrow(/AI_FALLBACK_SAME_PROVIDER/);
    await expect(asOwner.mutation(api.aiSettings.update, { dailyBudgetUsdCents: -1 })).rejects.toThrow(/AI_BUDGET_INVALID/);
    await asOwner.mutation(api.aiSettings.update, { provider: "openai", fallbackProvider: "google", fallbackModel: "gemini-2.5-flash", effort: "high", dailyBudgetUsdCents: 1200 });
    const updated = await asOwner.query(api.aiSettings.get, {});
    expect(updated).toMatchObject({ provider: "openai", routerModel: "gpt-5-mini", specialistModel: "gpt-5", fallbackProvider: "google", effort: "high", dailyBudgetUsdCents: 1200 });

    await expect(asOwner.mutation(api.aiSettings.setProviderKey, { provider: "openai", apiKey: "nope" })).rejects.toThrow(/INVALID_API_KEY_FORMAT/);
    const masked = await asOwner.mutation(api.aiSettings.setProviderKey, { provider: "openai", apiKey: "sk-test-1234567890abcdefXYZ9" });
    expect(masked).toEqual({ masked: "••••XYZ9" });
    const withKey = await asOwner.query(api.aiSettings.get, {});
    expect(withKey.keys).toEqual([expect.objectContaining({ provider: "openai", masked: "••••XYZ9" })]);
    const stored = await t.run(async (ctx) => (await ctx.db.query("aiSettings").collect())[0]);
    expect(stored.keys[0].ciphertext.startsWith("aes256gcm:")).toBe(true);
    expect(JSON.stringify(stored)).not.toContain("sk-test-1234567890abcdefXYZ9");
    const audit = await t.run(async (ctx) => (await ctx.db.query("auditLog").collect()).map((row) => row.action));
    expect(audit).toEqual(expect.arrayContaining(["ai.settings.updated", "ai.key.set"]));
    await asOwner.mutation(api.aiSettings.clearProviderKey, { provider: "openai" });
    expect((await asOwner.query(api.aiSettings.get, {})).keys).toEqual([]);
  });

  it("probes a provider through the port and stores the verdict without the key", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    const asOwner = t.withIdentity({ subject: s.owner.userId });
    await asOwner.mutation(api.aiSettings.update, { provider: "anthropic", specialistModel: "claude-sonnet-5" });
    await expect(asOwner.action(api.aiProviders.probe, {})).rejects.toThrow(/AI_PROVIDER_NOT_CONFIGURED/);

    await asOwner.mutation(api.aiSettings.setProviderKey, { provider: "anthropic", apiKey: "sk-ant-test-1234567890abcdef" });
    let seenKey = "";
    vi.stubGlobal("fetch", async (_input: string | URL | Request, init?: RequestInit) => {
      seenKey = String((init?.headers as Record<string, string>)["x-api-key"]);
      return Response.json({ content: [{ type: "text", text: "OK" }], stop_reason: "end_turn", usage: { input_tokens: 5, output_tokens: 1 } });
    });
    const ok = await asOwner.action(api.aiProviders.probe, {});
    expect(ok).toMatchObject({ ok: true, keySource: "tenant" });
    expect(seenKey).toBe("sk-ant-test-1234567890abcdef");
    const after = await asOwner.query(api.aiSettings.get, {});
    expect(after.ready).toBe(true);
    expect(after.providerStatus[0]).toMatchObject({ provider: "anthropic", model: "claude-sonnet-5", ok: true, keySource: "tenant" });

    vi.stubGlobal("fetch", async () => new Response("bad key", { status: 401 }));
    const failed = await asOwner.action(api.aiProviders.probe, { provider: "anthropic", model: "claude-opus-5" });
    expect(failed).toMatchObject({ ok: false, error: "auth 401" });
    const statuses = (await asOwner.query(api.aiSettings.get, {})).providerStatus;
    expect(statuses).toHaveLength(2);
    expect((await asOwner.query(api.aiSettings.get, {})).ready).toBe(true); // specialist model still green

    // Platform key fallback when the tenant has none.
    await asOwner.mutation(api.aiSettings.clearProviderKey, { provider: "anthropic" });
    process.env.ANTHROPIC_API_KEY = "sk-ant-platform-key-000000000000";
    vi.stubGlobal("fetch", async () => Response.json({ content: [{ type: "text", text: "OK" }], stop_reason: "end_turn", usage: {} }));
    expect(await asOwner.action(api.aiProviders.probe, {})).toMatchObject({ ok: true, keySource: "platform" });
    delete process.env.ANTHROPIC_API_KEY;
  });
});
