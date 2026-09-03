import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { requireCapability, tenantAction } from "./lib/customFunctions";
import { AiProviderError, type AiProviderId } from "./lib/ai/provider";
import { completeWithResilience } from "./lib/ai/resilience";
import { effectiveSettings, resolveApiKey } from "./lib/ai/settings";

const providerValidator = v.union(v.literal("anthropic"), v.literal("openai"), v.literal("google"), v.literal("mock"));

/**
 * "Test this provider": one tiny request through the same port the runtime
 * uses. Stores the verdict (never the key) so publish gates can require a
 * green status for the chosen provider + specialist model.
 */
export const probe = tenantAction({
  args: { provider: v.optional(providerValidator), model: v.optional(v.string()) },
  returns: v.object({ ok: v.boolean(), latencyMs: v.optional(v.number()), error: v.optional(v.string()), keySource: v.string() }),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "ai.configure");
    const row = (await ctx.runQuery(internal.aiSettings._load, { tenantId: ctx.tenantId })) as Doc<"aiSettings"> | null;
    const settings = effectiveSettings(row);
    const provider: AiProviderId = args.provider ?? settings.provider;
    const model = args.model?.trim() || (provider === settings.provider ? settings.specialistModel : settings.fallbackModel ?? settings.specialistModel);
    const key = await resolveApiKey(row, provider);
    const checkedAt = Date.now();
    let status: { ok: boolean; latencyMs?: number; error?: string };
    if (key.keySource === "none") {
      status = { ok: false, error: "AI_PROVIDER_NOT_CONFIGURED" };
    } else {
      try {
        const result = await completeWithResilience(
          [{ provider, model, apiKey: key.apiKey, keySource: key.keySource }],
          {
            model,
            system: "Responde apenas com a palavra OK.",
            messages: [{ role: "user", content: "Teste de ligação." }],
            maxTokens: 8,
            temperature: 0,
            timeoutMs: 20_000,
          },
          { stage: "probe", deadlineMs: 30_000 },
        );
        status = { ok: true, latencyMs: result.response.latencyMs };
      } catch (error) {
        const failure = error instanceof AiProviderError ? error : null;
        status = { ok: false, error: failure ? `${failure.kind}${failure.status ? ` ${failure.status}` : ""}` : "unknown" };
      }
    }
    await ctx.runMutation(internal.aiSettings._storeProbe, {
      tenantId: ctx.tenantId,
      memberId: ctx.memberId,
      status: { provider, model, ok: status.ok, checkedAt, latencyMs: status.latencyMs, error: status.error, keySource: key.keySource },
    });
    if (status.error === "AI_PROVIDER_NOT_CONFIGURED") {
      throw new ConvexError({ code: "AI_PROVIDER_NOT_CONFIGURED", provider });
    }
    return { ...status, keySource: key.keySource };
  },
});
