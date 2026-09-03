import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireCapability, tenantAction } from "./lib/customFunctions";
import { runTurnPipeline } from "./lib/ai/pipeline";
import type { AiMessage } from "./lib/ai/provider";
import { candidatesFor, effectiveSettings } from "./lib/ai/settings";
import { formatLocalDateTime } from "./lib/clinicTime";
import { internalQuery } from "./_generated/server";

const transcriptValidator = v.array(
  v.object({
    inbound: v.string(),
    outcome: v.string(),
    text: v.optional(v.string()),
    reason: v.optional(v.string()),
    routerIntent: v.optional(v.string()),
    toolCalls: v.array(v.object({ name: v.string(), status: v.string(), input: v.any(), output: v.any(), errorCode: v.optional(v.string()) })),
    violations: v.array(v.string()),
    attempts: v.array(v.object({ provider: v.string(), model: v.string(), stage: v.string(), ok: v.boolean(), kind: v.optional(v.string()), latencyMs: v.number() })),
    costUsdMicros: v.number(),
  }),
);

export const _context = internalQuery({
  args: { tenantId: v.id("tenants"), agentId: v.id("aiAgents") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const agent = (await ctx.db.get(args.agentId)) as Doc<"aiAgents"> | null;
    if (!agent || agent.tenantId !== args.tenantId) return null;
    const tenant = await ctx.db.get(args.tenantId);
    const settingsRow = await ctx.db
      .query("aiSettings")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .unique();
    const knowledge = [];
    for (const itemId of agent.config.knowledgeItemIds) {
      const item = await ctx.db.get(itemId);
      if (item && item.status === "active") knowledge.push({ kind: item.kind, title: item.title, body: item.body });
    }
    const services = (await ctx.db
      .query("clinicServices")
      .withIndex("by_tenant_status", (q) => q.eq("tenantId", args.tenantId).eq("status", "active"))
      .take(40)) as Doc<"clinicServices">[];
    const templates = agent.channelId
      ? ((await ctx.db
          .query("channelTemplates")
          .withIndex("by_channel", (q) => q.eq("channelId", agent.channelId!))
          .take(100)) as Doc<"channelTemplates">[]).filter((t) => ["approved", "active"].includes(t.status.toLowerCase()))
      : [];
    const clinicSettings = await ctx.db
      .query("clinicSettings")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .unique();
    const timeZone = clinicSettings?.timezone ?? tenant?.settings.timezone ?? "Africa/Maputo";
    return {
      agent,
      settingsRow,
      knowledge,
      services: services.map((s) => ({ id: s._id, name: s.name, durationMinutes: s.durationMinutes })),
      templates: templates.map((t) => ({ name: t.name, languageCode: t.languageCode })),
      clinicName: tenant?.name ?? "Clínica",
      timeZone,
      publisherId: agent.createdBy,
    };
  },
});

/**
 * Dry-run the draft configuration against a scripted conversation. Same
 * pipeline as production, real reads (agenda), zero writes, nothing sent.
 */
export const simulate = tenantAction({
  args: { agentId: v.id("aiAgents"), messages: v.array(v.string()), serviceWindowOpen: v.optional(v.boolean()) },
  returns: v.object({ transcript: transcriptValidator, totalCostUsdMicros: v.number() }),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "ai.configure");
    const context = (await ctx.runQuery(internal.aiSandbox._context, { tenantId: ctx.tenantId, agentId: args.agentId })) as {
      agent: Doc<"aiAgents">;
      settingsRow: Doc<"aiSettings"> | null;
      knowledge: Array<{ kind: string; title: string; body: string }>;
      services: Array<{ id: Id<"clinicServices">; name: string; durationMinutes: number }>;
      templates: Array<{ name: string; languageCode: string }>;
      clinicName: string;
      timeZone: string;
      publisherId: Id<"members">;
    } | null;
    if (!context) throw new Error("AGENT_NOT_FOUND");
    const settings = effectiveSettings(context.settingsRow);
    const candidates = {
      router: await candidatesFor(context.settingsRow, "router"),
      specialist: await candidatesFor(context.settingsRow, "specialist"),
    };
    const history: AiMessage[] = [];
    const transcript = [];
    let total = 0;
    for (const inbound of args.messages.slice(0, 8)) {
      const result = await runTurnPipeline({
        candidates,
        settings,
        agent: { name: context.agent.name, objective: context.agent.objective, config: context.agent.config, knowledge: context.knowledge },
        clinic: { clinicName: context.clinicName, services: context.services, templates: context.templates, localNow: formatLocalDateTime(Date.now(), context.timeZone), timeZone: context.timeZone, allowedHosts: [] },
        thread: { firstName: "Ana", leadStatus: "interested", serviceWindowOpen: args.serviceWindowOpen ?? true },
        history,
        inboundText: inbound,
        executeTool: async (call) =>
          await ctx.runMutation(internal.aiTools.dryRun, {
            tenantId: ctx.tenantId,
            memberId: context.publisherId,
            allowedTools: context.agent.config.tools,
            name: call.name,
            input: call.input ?? {},
          }),
      });
      total += result.costUsdMicros;
      history.push({ role: "user", content: inbound });
      if (result.text) history.push({ role: "assistant", content: result.text });
      transcript.push({
        inbound,
        outcome: result.outcome,
        text: result.text,
        reason: result.reason,
        routerIntent: result.routerDecision?.intent,
        toolCalls: result.toolCalls.map((c) => ({ name: c.name, status: c.status, input: c.input, output: c.output, errorCode: c.errorCode })),
        violations: result.violations,
        attempts: result.attempts.map((a) => ({ provider: a.provider, model: a.model, stage: a.stage, ok: a.ok, kind: a.kind, latencyMs: a.latencyMs })),
        costUsdMicros: result.costUsdMicros,
      });
      if (result.outcome === "handoff") break;
    }
    await ctx.runMutation(internal.aiSandbox._markRun, { tenantId: ctx.tenantId, agentId: args.agentId });
    return { transcript, totalCostUsdMicros: total };
  },
});

import { internalMutation } from "./_generated/server";

export const _markRun = internalMutation({
  args: { tenantId: v.id("tenants"), agentId: v.id("aiAgents") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const agent = await ctx.db.get(args.agentId);
    if (agent && agent.tenantId === args.tenantId) await ctx.db.patch(agent._id, { lastSandboxAt: Date.now() });
    return null;
  },
});
