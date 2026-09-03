import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { writeAudit } from "./lib/audit";
import { requireCapability, tenantMutation, tenantQuery } from "./lib/customFunctions";
import { encryptSecret, isSecretEncryptionConfigured, allowPlaintextSecretStorageForTests } from "./lib/secrets";
import { DEFAULT_MODELS, SUGGESTED_MODELS } from "./lib/ai/pricing";
import { DEFAULT_AI_SETTINGS, effectiveSettings, looksLikeApiKey, maskKey, PLATFORM_KEY_ENV, platformKeyFor } from "./lib/ai/settings";

const providerValidator = v.union(v.literal("anthropic"), v.literal("openai"), v.literal("google"), v.literal("mock"));
const effortValidator = v.union(v.literal("low"), v.literal("medium"), v.literal("high"));

const statusValidator = v.object({
  provider: providerValidator,
  model: v.string(),
  ok: v.boolean(),
  checkedAt: v.number(),
  latencyMs: v.optional(v.number()),
  error: v.optional(v.string()),
  keySource: v.union(v.literal("tenant"), v.literal("platform"), v.literal("none")),
});

export const get = tenantQuery({
  args: {},
  returns: v.object({
    provider: providerValidator,
    routerModel: v.string(),
    specialistModel: v.string(),
    fallbackProvider: v.optional(providerValidator),
    fallbackModel: v.optional(v.string()),
    effort: effortValidator,
    extendedThinking: v.boolean(),
    dailyBudgetUsdCents: v.number(),
    maxTurnsPerThreadPerDay: v.number(),
    maxToolCallsPerTurn: v.number(),
    replyLanguage: v.union(v.literal("pt"), v.literal("en")),
    keys: v.array(v.object({ provider: providerValidator, masked: v.string(), encryptedAt: v.number() })),
    platformKeys: v.array(providerValidator),
    providerStatus: v.array(statusValidator),
    suggestions: v.any(),
    ready: v.boolean(),
    updatedAt: v.optional(v.number()),
  }),
  handler: async (ctx) => {
    requireCapability(ctx.role, "ai.view_runs");
    const row = await ctx.db
      .query("aiSettings")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .unique();
    const { configuredKeys: _configuredKeys, ...settings } = effectiveSettings(row);
    void _configuredKeys;
    const platformKeys = (["anthropic", "openai", "google", "mock"] as const).filter((provider) => !!platformKeyFor(provider));
    const primaryStatus = (row?.providerStatus ?? []).find((s) => s.provider === settings.provider && s.model === settings.specialistModel);
    return {
      ...settings,
      keys: (row?.keys ?? []).map((key) => ({ provider: key.provider, masked: maskKey(key.last4), encryptedAt: key.encryptedAt })),
      platformKeys,
      providerStatus: row?.providerStatus ?? [],
      suggestions: SUGGESTED_MODELS,
      ready: !!primaryStatus?.ok,
      updatedAt: row?.updatedAt,
    };
  },
});

async function loadOrCreate(ctx: { db: any; tenantId: Doc<"aiSettings">["tenantId"]; memberId: Doc<"aiSettings">["updatedBy"] }): Promise<Doc<"aiSettings">> {
  const existing = (await ctx.db
    .query("aiSettings")
    .withIndex("by_tenant", (q: any) => q.eq("tenantId", ctx.tenantId))
    .unique()) as Doc<"aiSettings"> | null;
  if (existing) return existing;
  const now = Date.now();
  const provider = DEFAULT_AI_SETTINGS.provider;
  const id = await ctx.db.insert("aiSettings", {
    tenantId: ctx.tenantId,
    provider,
    routerModel: DEFAULT_MODELS[provider].router,
    specialistModel: DEFAULT_MODELS[provider].specialist,
    effort: DEFAULT_AI_SETTINGS.effort,
    extendedThinking: false,
    dailyBudgetUsdCents: DEFAULT_AI_SETTINGS.dailyBudgetUsdCents,
    maxTurnsPerThreadPerDay: DEFAULT_AI_SETTINGS.maxTurnsPerThreadPerDay,
    maxToolCallsPerTurn: DEFAULT_AI_SETTINGS.maxToolCallsPerTurn,
    replyLanguage: DEFAULT_AI_SETTINGS.replyLanguage,
    keys: [],
    providerStatus: [],
    updatedBy: ctx.memberId,
    updatedAt: now,
  });
  return (await ctx.db.get(id)) as Doc<"aiSettings">;
}

export const update = tenantMutation({
  args: {
    provider: v.optional(providerValidator),
    routerModel: v.optional(v.string()),
    specialistModel: v.optional(v.string()),
    fallbackProvider: v.optional(v.union(providerValidator, v.null())),
    fallbackModel: v.optional(v.union(v.string(), v.null())),
    effort: v.optional(effortValidator),
    extendedThinking: v.optional(v.boolean()),
    dailyBudgetUsdCents: v.optional(v.number()),
    maxTurnsPerThreadPerDay: v.optional(v.number()),
    maxToolCallsPerTurn: v.optional(v.number()),
    replyLanguage: v.optional(v.union(v.literal("pt"), v.literal("en"))),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "ai.configure");
    const row = await loadOrCreate(ctx);
    const patch: Partial<Doc<"aiSettings">> = { updatedBy: ctx.memberId, updatedAt: Date.now() };
    const provider = args.provider ?? row.provider;
    if (args.provider && args.provider !== row.provider) {
      patch.provider = args.provider;
      // Switching provider resets models to that provider's defaults unless given.
      patch.routerModel = args.routerModel?.trim() || DEFAULT_MODELS[args.provider].router;
      patch.specialistModel = args.specialistModel?.trim() || DEFAULT_MODELS[args.provider].specialist;
    } else {
      if (args.routerModel !== undefined) patch.routerModel = args.routerModel.trim();
      if (args.specialistModel !== undefined) patch.specialistModel = args.specialistModel.trim();
    }
    for (const model of [patch.routerModel ?? row.routerModel, patch.specialistModel ?? row.specialistModel]) {
      if (!model || model.length > 80 || !/^[a-zA-Z0-9._:-]+$/.test(model)) throw new ConvexError({ code: "AI_MODEL_REQUIRED" });
    }
    if (args.fallbackProvider !== undefined) {
      patch.fallbackProvider = args.fallbackProvider ?? undefined;
      if (args.fallbackProvider === provider) throw new ConvexError({ code: "AI_FALLBACK_SAME_PROVIDER" });
    }
    if (args.fallbackModel !== undefined) patch.fallbackModel = args.fallbackModel?.trim() || undefined;
    if (args.effort) patch.effort = args.effort;
    if (args.extendedThinking !== undefined) patch.extendedThinking = args.extendedThinking;
    if (args.dailyBudgetUsdCents !== undefined) {
      if (!Number.isFinite(args.dailyBudgetUsdCents) || args.dailyBudgetUsdCents < 0 || args.dailyBudgetUsdCents > 100_000) {
        throw new ConvexError({ code: "AI_BUDGET_INVALID" });
      }
      patch.dailyBudgetUsdCents = Math.round(args.dailyBudgetUsdCents);
    }
    if (args.maxTurnsPerThreadPerDay !== undefined) patch.maxTurnsPerThreadPerDay = Math.min(200, Math.max(1, Math.round(args.maxTurnsPerThreadPerDay)));
    if (args.maxToolCallsPerTurn !== undefined) patch.maxToolCallsPerTurn = Math.min(12, Math.max(1, Math.round(args.maxToolCallsPerTurn)));
    if (args.replyLanguage) patch.replyLanguage = args.replyLanguage;
    await ctx.db.patch(row._id, patch);
    await writeAudit(ctx, {
      action: "ai.settings.updated",
      targetType: "aiSettings",
      targetId: row._id,
      payload: { keys: Object.keys(patch).filter((k) => k !== "updatedBy" && k !== "updatedAt") },
    });
    return null;
  },
});

/** Store a tenant-owned key encrypted; only the last 4 characters are ever shown again. */
export const setProviderKey = tenantMutation({
  args: { provider: providerValidator, apiKey: v.string() },
  returns: v.object({ masked: v.string() }),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "ai.configure");
    const apiKey = args.apiKey.trim();
    if (!looksLikeApiKey(args.provider, apiKey)) throw new ConvexError({ code: "INVALID_API_KEY_FORMAT" });
    if (!isSecretEncryptionConfigured() && !allowPlaintextSecretStorageForTests()) {
      throw new ConvexError({ code: "SECRET_ENCRYPTION_NOT_CONFIGURED" });
    }
    const row = await loadOrCreate(ctx);
    const encrypted = await encryptSecret(apiKey);
    const last4 = apiKey.slice(-4);
    const keys = row.keys.filter((key) => key.provider !== args.provider);
    keys.push({ provider: args.provider, ciphertext: encrypted.ciphertext, keyVersion: encrypted.keyVersion, last4, encryptedAt: encrypted.encryptedAt });
    await ctx.db.patch(row._id, {
      keys,
      providerStatus: row.providerStatus.filter((s) => s.provider !== args.provider),
      updatedBy: ctx.memberId,
      updatedAt: Date.now(),
    });
    await writeAudit(ctx, { action: "ai.key.set", targetType: "aiSettings", targetId: row._id, payload: { provider: args.provider, last4 } });
    return { masked: maskKey(last4) };
  },
});

export const clearProviderKey = tenantMutation({
  args: { provider: providerValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "ai.configure");
    const row = await loadOrCreate(ctx);
    await ctx.db.patch(row._id, {
      keys: row.keys.filter((key) => key.provider !== args.provider),
      providerStatus: row.providerStatus.filter((s) => s.provider !== args.provider),
      updatedBy: ctx.memberId,
      updatedAt: Date.now(),
    });
    await writeAudit(ctx, { action: "ai.key.cleared", targetType: "aiSettings", targetId: row._id, payload: { provider: args.provider } });
    return null;
  },
});

/** Raw row for actions (keys stay encrypted until `resolveApiKey`). */
export const _load = internalQuery({
  args: { tenantId: v.id("tenants") },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("aiSettings")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .unique();
  },
});

export const _storeProbe = internalMutation({
  args: { tenantId: v.id("tenants"), memberId: v.id("members"), status: statusValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await loadOrCreate({ db: ctx.db, tenantId: args.tenantId, memberId: args.memberId });
    const providerStatus = row.providerStatus.filter((s) => !(s.provider === args.status.provider && s.model === args.status.model));
    providerStatus.push(args.status);
    await ctx.db.patch(row._id, { providerStatus: providerStatus.slice(-12), updatedAt: Date.now() });
    return null;
  },
});

export const platformKeyEnvNames = PLATFORM_KEY_ENV;
