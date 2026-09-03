import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { internalQuery } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireCapability, tenantAction, tenantQuery } from "./lib/customFunctions";
import { effectiveSettings, platformKeyFor } from "./lib/ai/settings";

/**
 * One button that answers "is this thing working right now?".
 *
 * The pieces existed, scattered: channel health in one screen, the AI provider
 * probe in another, outbox trouble in a third. Someone whose clinic just went
 * quiet does not want to go on a tour — they want one verdict and the next
 * step. Each check says what it looked at and what to do when it is not ok.
 */
const checkValidator = v.object({
  key: v.string(),
  status: v.union(v.literal("ok"), v.literal("warn"), v.literal("fail"), v.literal("skipped")),
  /** Plain sentence: what was found. Never a stack trace, never a secret. */
  detail: v.string(),
  /** Where to go to fix it. */
  href: v.optional(v.string()),
  latencyMs: v.optional(v.number()),
});

const DIAGNOSTIC_KEYS = ["database", "channel", "outbox", "ai_key", "ai_provider", "automation"] as const;

export const _snapshot = internalQuery({
  args: { tenantId: v.id("tenants") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const started = Date.now();
    const channels = (await ctx.db
      .query("channels")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .take(10)) as Doc<"channels">[];
    const productChannels = channels.filter(
      (channel) => channel.provider === "iasolution_hub" && channel.operationalTerritory === "openbsp",
    );
    const settingsRow = await ctx.db
      .query("aiSettings")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .unique();
    const agents = (await ctx.db
      .query("aiAgents")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .take(20)) as Doc<"aiAgents">[];
    const now = Date.now();
    const stuckOutbox = (await ctx.db
      .query("channelOutbox")
      .withIndex("by_status_created", (q) => q.eq("status", "queued").lt("createdAt", now - 15 * 60_000))
      .take(20)) as Doc<"channelOutbox">[];
    const unknownOutbox = (await ctx.db
      .query("channelOutbox")
      .withIndex("by_status_unknown_since", (q) => q.eq("status", "unknown"))
      .take(20)) as Doc<"channelOutbox">[];
    return {
      readLatencyMs: Date.now() - started,
      channels: productChannels.map((channel) => ({
        displayName: channel.displayName,
        status: channel.status,
        connectionState: channel.connectionState,
        webhookStatus: channel.webhookStatus,
        sendMode: channel.sendMode,
        allowlistSize: channel.outboundAllowlist.length,
      })),
      settings: settingsRow
        ? { provider: effectiveSettings(settingsRow).provider, tenantKeys: settingsRow.keys.map((key) => key.provider), status: settingsRow.providerStatus }
        : { provider: effectiveSettings(null).provider, tenantKeys: [] as string[], status: [] },
      agents: agents.map((agent) => ({ name: agent.name, status: agent.status, mode: agent.mode ?? "copilot", published: !!agent.publishedVersionId })),
      stuckOutbox: stuckOutbox.filter((row) => row.tenantId === args.tenantId).length,
      unknownOutbox: unknownOutbox.filter((row) => row.tenantId === args.tenantId).length,
    };
  },
});

export const run = tenantAction({
  args: {},
  returns: v.object({ checks: v.array(checkValidator), ranAt: v.number() }),
  handler: async (ctx): Promise<{ checks: Array<{ key: string; status: "ok" | "warn" | "fail" | "skipped"; detail: string; href?: string; latencyMs?: number }>; ranAt: number }> => {
    requireCapability(ctx.role, "ai.configure");
    const checks: Array<{ key: string; status: "ok" | "warn" | "fail" | "skipped"; detail: string; href?: string; latencyMs?: number }> = [];
    const snapshot = (await ctx.runQuery(internal.diagnostics._snapshot, { tenantId: ctx.tenantId })) as {
      readLatencyMs: number;
      channels: Array<{ displayName: string; status: string; connectionState: string; webhookStatus: string; sendMode: string; allowlistSize: number }>;
      settings: { provider: string; tenantKeys: string[]; status: Array<{ provider: string; ok: boolean; checkedAt: number; error?: string }> };
      agents: Array<{ name: string; status: string; mode: string; published: boolean }>;
      stuckOutbox: number;
      unknownOutbox: number;
    };

    checks.push({
      key: "database",
      status: "ok",
      detail: `Leitura de dados respondeu em ${snapshot.readLatencyMs} ms.`,
      latencyMs: snapshot.readLatencyMs,
    });

    const channel = snapshot.channels[0];
    if (!channel) {
      checks.push({ key: "channel", status: "fail", detail: "Nenhum canal de WhatsApp ligado nesta clínica.", href: "/app/channels" });
    } else if (channel.webhookStatus !== "verified") {
      checks.push({ key: "channel", status: "fail", detail: `O webhook do canal "${channel.displayName}" não está verificado, por isso as mensagens recebidas não entram.`, href: "/app/channels" });
    } else if (channel.status !== "active") {
      checks.push({ key: "channel", status: "warn", detail: `O canal "${channel.displayName}" está ${channel.status}.`, href: "/app/channels" });
    } else if (channel.sendMode !== "live") {
      checks.push({
        key: "channel",
        status: "warn",
        detail: `Piloto ativo: só ${channel.allowlistSize} número(s) recebem respostas automáticas. Qualquer outro número escreve, é lido, e não recebe resposta da IA.`,
        href: "/app/channels",
      });
    } else {
      checks.push({ key: "channel", status: "ok", detail: `Canal "${channel.displayName}" ligado e a receber.` });
    }

    if (snapshot.stuckOutbox > 0) {
      checks.push({ key: "outbox", status: "fail", detail: `${snapshot.stuckOutbox} resposta(s) presa(s) há mais de 15 minutos sem chegar ao paciente.`, href: "/app/admin/logs?tab=outbox" });
    } else if (snapshot.unknownOutbox > 0) {
      checks.push({ key: "outbox", status: "warn", detail: `${snapshot.unknownOutbox} envio(s) sem confirmação do canal. Não são reenviados automaticamente, para não duplicar.`, href: "/app/admin/logs?tab=outbox" });
    } else {
      checks.push({ key: "outbox", status: "ok", detail: "Nenhum envio preso ou por confirmar." });
    }

    const provider = snapshot.settings.provider;
    const hasTenantKey = snapshot.settings.tenantKeys.includes(provider);
    const hasPlatformKey = !!platformKeyFor(provider as never);
    if (!hasTenantKey && !hasPlatformKey) {
      checks.push({
        key: "ai_key",
        status: "fail",
        detail: `Sem chave para ${provider}. Os agentes não conseguem responder nem sugerir.`,
        href: "/app/settings?tab=ai",
      });
    } else {
      checks.push({
        key: "ai_key",
        status: "ok",
        detail: hasTenantKey ? `Chave da clínica configurada para ${provider}.` : `A usar a chave da plataforma para ${provider}.`,
      });
    }

    if (!hasTenantKey && !hasPlatformKey) {
      checks.push({ key: "ai_provider", status: "skipped", detail: "Teste de ligação não corrido: falta a chave." });
    } else {
      const started = Date.now();
      try {
        const probe = (await ctx.runAction(api.aiProviders.probe, {})) as {
          ok: boolean;
          latencyMs?: number;
          error?: string;
          keySource: string;
        };
        checks.push({
          key: "ai_provider",
          status: probe.ok ? "ok" : "fail",
          detail: probe.ok
            ? `${provider} respondeu (chave ${probe.keySource === "tenant" ? "da clínica" : "da plataforma"}).`
            : `${provider} não respondeu: ${probe.error ?? "erro desconhecido"}.`,
          href: probe.ok ? undefined : "/app/settings?tab=ai",
          latencyMs: probe.latencyMs ?? Date.now() - started,
        });
      } catch (error) {
        checks.push({
          key: "ai_provider",
          status: "fail",
          detail: `O teste de ligação falhou: ${error instanceof Error ? error.message.slice(0, 160) : "erro desconhecido"}.`,
          href: "/app/settings?tab=ai",
          latencyMs: Date.now() - started,
        });
      }
    }

    const live = snapshot.agents.filter((agent) => agent.status === "active" && agent.published && agent.mode !== "sandbox");
    if (snapshot.agents.length === 0) {
      checks.push({ key: "automation", status: "warn", detail: "Nenhum agente criado. As conversas ficam todas para a equipa.", href: "/app/agents" });
    } else if (live.length === 0) {
      checks.push({ key: "automation", status: "warn", detail: "Nenhum agente publicado e no ar. As conversas ficam todas para a equipa.", href: "/app/agents" });
    } else {
      const autopilot = live.filter((agent) => agent.mode === "autopilot").length;
      checks.push({
        key: "automation",
        status: "ok",
        detail: `${live.length} agente(s) no ar · ${autopilot} em Automático, ${live.length - autopilot} em Co-Piloto.`,
      });
    }

    return { checks, ranAt: Date.now() };
  },
});

/** The keys the screen knows how to label, so a new check cannot arrive unnamed. */
export const knownChecks = tenantQuery({
  args: {},
  returns: v.array(v.string()),
  handler: async () => [...DIAGNOSTIC_KEYS],
});
