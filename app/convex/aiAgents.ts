import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { writeAudit } from "./lib/audit";
import { loadByIdInTenant, requireCapability, tenantMutation, tenantQuery } from "./lib/customFunctions";
import { sha256Hex } from "./lib/idempotency";
import { DEFAULT_CONFIG_BY_OBJECTIVE, hasBlockers, runChecklist, type ChecklistIssue } from "./lib/ai/checklist";
import { effectiveSettings } from "./lib/ai/settings";
import { AI_TOOL_NAMES, isAiToolName, type AiObjective } from "./lib/ai/toolRegistry";

const objectiveValidator = v.union(v.literal("reception"), v.literal("sales"), v.literal("confirmation"), v.literal("support"), v.literal("audit"));
const toneValidator = v.union(v.literal("formal"), v.literal("friendly"), v.literal("direct"));
const statusValidator = v.union(v.literal("draft"), v.literal("active"), v.literal("paused"));
const modeValidator = v.union(v.literal("sandbox"), v.literal("copilot"), v.literal("autopilot"));

const configValidator = v.object({
  instructions: v.string(),
  tone: toneValidator,
  knowledgeItemIds: v.array(v.id("clinicKnowledgeItems")),
  tools: v.array(v.string()),
  handoff: v.object({
    keywords: v.array(v.string()),
    onLowConfidence: v.boolean(),
    onClinicalQuestion: v.boolean(),
    message: v.string(),
  }),
  fallbackMessage: v.string(),
  maxRepliesPerThread: v.number(),
  greeting: v.optional(v.string()),
  workingHoursOnly: v.optional(v.boolean()),
});

const issueValidator = v.object({ code: v.string(), severity: v.union(v.literal("blocker"), v.literal("warning")), detail: v.optional(v.string()) });

const agentRowValidator = v.object({
  _id: v.id("aiAgents"),
  name: v.string(),
  objective: objectiveValidator,
  channelId: v.optional(v.id("channels")),
  channelName: v.optional(v.string()),
  status: statusValidator,
  mode: modeValidator,
  currentVersion: v.number(),
  publishedVersionId: v.optional(v.id("aiAgentVersions")),
  config: configValidator,
  blockers: v.number(),
  warnings: v.number(),
  lastSandboxAt: v.optional(v.number()),
  updatedAt: v.number(),
});

function sanitizeConfig(input: Doc<"aiAgents">["config"]): Doc<"aiAgents">["config"] {
  const instructions = input.instructions.trim().slice(0, 6_000);
  const tools = Array.from(new Set(input.tools.filter(isAiToolName)));
  return {
    instructions,
    tone: input.tone,
    knowledgeItemIds: Array.from(new Set(input.knowledgeItemIds)).slice(0, 40),
    tools,
    handoff: {
      keywords: Array.from(new Set(input.handoff.keywords.map((k) => k.trim().toLowerCase()).filter((k) => k.length > 1))).slice(0, 30),
      onLowConfidence: input.handoff.onLowConfidence,
      onClinicalQuestion: input.handoff.onClinicalQuestion,
      message: input.handoff.message.trim().slice(0, 500),
    },
    fallbackMessage: input.fallbackMessage.trim().slice(0, 500),
    maxRepliesPerThread: Math.min(50, Math.max(1, Math.round(input.maxRepliesPerThread || 8))),
    greeting: input.greeting?.trim().slice(0, 300) || undefined,
    workingHoursOnly: input.workingHoursOnly,
  };
}

async function loadChecklistContext(ctx: { db: any; tenantId: Id<"tenants"> }, agent: Doc<"aiAgents">) {
  const channel = agent.channelId ? ((await ctx.db.get(agent.channelId)) as Doc<"channels"> | null) : null;
  const knowledge = (await ctx.db
    .query("clinicKnowledgeItems")
    .withIndex("by_tenant", (q: any) => q.eq("tenantId", ctx.tenantId))
    .order("desc")
    .take(100)) as Doc<"clinicKnowledgeItems">[];
  const settingsRow = (await ctx.db
    .query("aiSettings")
    .withIndex("by_tenant", (q: any) => q.eq("tenantId", ctx.tenantId))
    .unique()) as Doc<"aiSettings"> | null;
  const settings = effectiveSettings(settingsRow);
  const providerConfigured =
    settings.configuredKeys.includes(settings.provider) || !!process.env[`${settings.provider === "google" ? "GOOGLE_GENERATIVE_AI" : settings.provider.toUpperCase()}_API_KEY`] || settings.provider === "mock";
  const providerReady = (settingsRow?.providerStatus ?? []).some((s) => s.provider === settings.provider && s.model === settings.specialistModel && s.ok);
  let conflictingAgentName: string | undefined;
  if (agent.channelId) {
    const actives = (await ctx.db
      .query("aiAgents")
      .withIndex("by_tenant_channel_status", (q: any) => q.eq("tenantId", ctx.tenantId).eq("channelId", agent.channelId).eq("status", "active"))
      .take(20)) as Doc<"aiAgents">[];
    conflictingAgentName = actives.find((other) => other._id !== agent._id && other.objective === agent.objective)?.name;
  }
  return { channel, knowledge, settings, providerConfigured, providerReady, conflictingAgentName };
}

async function checklistFor(ctx: { db: any; tenantId: Id<"tenants"> }, agent: Doc<"aiAgents">): Promise<ChecklistIssue[]> {
  const context = await loadChecklistContext(ctx, agent);
  return runChecklist({
    agent,
    channel: context.channel,
    knowledge: context.knowledge,
    providerReady: context.providerReady,
    providerConfigured: context.providerConfigured,
    dailyBudgetUsdCents: context.settings.dailyBudgetUsdCents,
    conflictingAgentName: context.conflictingAgentName,
    lastSandboxAt: agent.lastSandboxAt,
    now: Date.now(),
  });
}

async function rowOf(ctx: { db: any; tenantId: Id<"tenants"> }, agent: Doc<"aiAgents">) {
  const channel = agent.channelId ? ((await ctx.db.get(agent.channelId)) as Doc<"channels"> | null) : null;
  const issues = (agent.lastValidation as ChecklistIssue[] | undefined) ?? [];
  return {
    _id: agent._id,
    name: agent.name,
    objective: agent.objective,
    channelId: agent.channelId,
    channelName: channel?.displayName,
    status: agent.status,
    mode: agent.mode ?? "copilot",
    currentVersion: agent.currentVersion,
    publishedVersionId: agent.publishedVersionId,
    config: agent.config,
    blockers: issues.filter((i) => i.severity === "blocker").length,
    warnings: issues.filter((i) => i.severity === "warning").length,
    lastSandboxAt: agent.lastSandboxAt,
    updatedAt: agent.updatedAt,
  };
}

export const list = tenantQuery({
  args: {},
  returns: v.array(agentRowValidator),
  handler: async (ctx) => {
    requireCapability(ctx.role, "ai.view_runs");
    const rows = (await ctx.db
      .query("aiAgents")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .order("desc")
      .take(50)) as Doc<"aiAgents">[];
    const out = [];
    for (const row of rows) out.push(await rowOf(ctx, row));
    return out;
  },
});

export const get = tenantQuery({
  args: { agentId: v.id("aiAgents") },
  returns: v.object({
    agent: agentRowValidator,
    issues: v.array(issueValidator),
    tools: v.array(v.string()),
    versions: v.array(v.object({ _id: v.id("aiAgentVersions"), version: v.number(), publishedAt: v.number(), knowledgeCount: v.number(), checksum: v.string() })),
  }),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "ai.view_runs");
    const agent = await loadByIdInTenant(ctx, "aiAgents", args.agentId);
    const issues = await checklistFor(ctx, agent);
    const versions = (await ctx.db
      .query("aiAgentVersions")
      .withIndex("by_agent_version", (q) => q.eq("agentId", agent._id))
      .order("desc")
      .take(20)) as Doc<"aiAgentVersions">[];
    return {
      agent: await rowOf(ctx, agent),
      issues,
      tools: [...AI_TOOL_NAMES],
      versions: versions.map((row) => ({ _id: row._id, version: row.version, publishedAt: row.publishedAt, knowledgeCount: row.knowledgeSnapshot.length, checksum: row.checksum.slice(0, 12) })),
    };
  },
});

export const create = tenantMutation({
  args: { name: v.string(), objective: objectiveValidator, channelId: v.optional(v.id("channels")) },
  returns: v.id("aiAgents"),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "ai.configure");
    const name = args.name.trim();
    if (name.length < 2 || name.length > 80) throw new ConvexError({ code: "INVALID_TEXT_LENGTH", label: "name", min: 2, max: 80 });
    if (args.channelId) await loadByIdInTenant(ctx, "channels", args.channelId);
    const existing = await ctx.db
      .query("aiAgents")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .take(51);
    if (existing.length >= 50) throw new ConvexError({ code: "AI_AGENT_LIMIT" });
    const defaults = DEFAULT_CONFIG_BY_OBJECTIVE[args.objective as AiObjective];
    const now = Date.now();
    const agentId = await ctx.db.insert("aiAgents", {
      tenantId: ctx.tenantId,
      name,
      objective: args.objective,
      channelId: args.channelId,
      status: "draft",
      config: {
        instructions: defaults.instructions,
        tone: "friendly",
        knowledgeItemIds: [],
        tools: defaults.tools,
        handoff: { keywords: ["advogado", "reclamação", "processo"], onLowConfidence: true, onClinicalQuestion: true, message: defaults.handoffMessage },
        fallbackMessage: defaults.fallbackMessage,
        maxRepliesPerThread: 8,
        greeting: defaults.greeting || undefined,
      },
      currentVersion: 0,
      createdBy: ctx.memberId,
      createdAt: now,
      updatedAt: now,
    });
    const agent = (await ctx.db.get(agentId)) as Doc<"aiAgents">;
    await ctx.db.patch(agentId, { lastValidation: await checklistFor(ctx, agent) });
    await writeAudit(ctx, { action: "ai.agent.created", targetType: "aiAgent", targetId: agentId, payload: { name, objective: args.objective } });
    return agentId;
  },
});

export const updateDraft = tenantMutation({
  args: {
    agentId: v.id("aiAgents"),
    name: v.optional(v.string()),
    channelId: v.optional(v.union(v.id("channels"), v.null())),
    config: v.optional(configValidator),
  },
  returns: v.array(issueValidator),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "ai.configure");
    const agent = await loadByIdInTenant(ctx, "aiAgents", args.agentId);
    const patch: Partial<Doc<"aiAgents">> = { updatedAt: Date.now() };
    if (args.name !== undefined) {
      const name = args.name.trim();
      if (name.length < 2 || name.length > 80) throw new ConvexError({ code: "INVALID_TEXT_LENGTH", label: "name", min: 2, max: 80 });
      patch.name = name;
    }
    if (args.channelId !== undefined) {
      if (args.channelId) await loadByIdInTenant(ctx, "channels", args.channelId);
      patch.channelId = args.channelId ?? undefined;
    }
    if (args.config) {
      for (const itemId of args.config.knowledgeItemIds) await loadByIdInTenant(ctx, "clinicKnowledgeItems", itemId);
      patch.config = sanitizeConfig(args.config);
    }
    await ctx.db.patch(agent._id, patch);
    const updated = (await ctx.db.get(agent._id)) as Doc<"aiAgents">;
    const issues = await checklistFor(ctx, updated);
    await ctx.db.patch(agent._id, { lastValidation: issues });
    await writeAudit(ctx, { action: "ai.agent.updated", targetType: "aiAgent", targetId: agent._id, payload: { fields: Object.keys(patch) } });
    return issues;
  },
});

export const validate = tenantQuery({
  args: { agentId: v.id("aiAgents") },
  returns: v.array(issueValidator),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "ai.view_runs");
    const agent = await loadByIdInTenant(ctx, "aiAgents", args.agentId);
    return await checklistFor(ctx, agent);
  },
});

/**
 * Freeze config + knowledge into an immutable version and activate it. A
 * published version never changes: the runtime always reads the snapshot.
 */
export const publish = tenantMutation({
  args: { agentId: v.id("aiAgents") },
  returns: v.object({ versionId: v.id("aiAgentVersions"), version: v.number() }),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "ai.publish");
    const agent = await loadByIdInTenant(ctx, "aiAgents", args.agentId);
    const issues = await checklistFor(ctx, agent);
    await ctx.db.patch(agent._id, { lastValidation: issues });
    if (hasBlockers(issues)) {
      throw new ConvexError({ code: "AI_AGENT_NOT_PUBLISHABLE", blockers: issues.filter((i) => i.severity === "blocker").map((i) => i.code) });
    }
    const snapshot = [];
    for (const itemId of agent.config.knowledgeItemIds) {
      const item = (await ctx.db.get(itemId)) as Doc<"clinicKnowledgeItems"> | null;
      if (!item || item.tenantId !== ctx.tenantId || item.status !== "active") continue;
      snapshot.push({ itemId: item._id, version: item.currentVersion, kind: item.kind, title: item.title, body: item.body });
    }
    const version = agent.currentVersion + 1;
    const now = Date.now();
    const checksum = await sha256Hex(JSON.stringify({ config: agent.config, snapshot: snapshot.map((s) => [s.itemId, s.version]) }));
    const versionId = await ctx.db.insert("aiAgentVersions", {
      tenantId: ctx.tenantId,
      agentId: agent._id,
      version,
      config: agent.config,
      knowledgeSnapshot: snapshot,
      checksum,
      publishedBy: ctx.memberId,
      publishedAt: now,
    });
    await ctx.db.patch(agent._id, { status: "active", currentVersion: version, publishedVersionId: versionId, updatedAt: now });
    await writeAudit(ctx, { action: "ai.agent.published", targetType: "aiAgent", targetId: agent._id, payload: { version, checksum: checksum.slice(0, 12), knowledge: snapshot.length } });
    return { versionId, version };
  },
});

export const setStatus = tenantMutation({
  args: { agentId: v.id("aiAgents"), status: v.union(v.literal("active"), v.literal("paused")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "ai.publish");
    const agent = await loadByIdInTenant(ctx, "aiAgents", args.agentId);
    if (!agent.publishedVersionId) throw new ConvexError({ code: "AI_AGENT_NOT_PUBLISHED" });
    if (agent.status === args.status) return null;
    if (args.status === "active") {
      const issues = await checklistFor(ctx, agent);
      if (issues.some((i) => i.severity === "blocker" && (i.code === "CHANNEL_NOT_READY" || i.code === "PROVIDER_NOT_CONFIGURED" || i.code === "AGENT_CONFLICT" || i.code === "BUDGET_REQUIRED"))) {
        throw new ConvexError({ code: "AI_AGENT_NOT_PUBLISHABLE", blockers: issues.filter((i) => i.severity === "blocker").map((i) => i.code) });
      }
    }
    await ctx.db.patch(agent._id, { status: args.status, updatedAt: Date.now() });
    await writeAudit(ctx, { action: args.status === "active" ? "ai.agent.resumed" : "ai.agent.paused", targetType: "aiAgent", targetId: agent._id });
    return null;
  },
});

export const remove = tenantMutation({
  args: { agentId: v.id("aiAgents") },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "ai.publish");
    const agent = await loadByIdInTenant(ctx, "aiAgents", args.agentId);
    if (agent.status !== "draft" || agent.publishedVersionId) throw new ConvexError({ code: "AI_AGENT_INVALID_STATE" });
    await ctx.db.delete(agent._id);
    await writeAudit(ctx, { action: "ai.agent.deleted", targetType: "aiAgent", targetId: agent._id, payload: { name: agent.name } });
    return null;
  },
});

export const markSandboxRun = tenantMutation({
  args: { agentId: v.id("aiAgents") },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "ai.configure");
    const agent = await loadByIdInTenant(ctx, "aiAgents", args.agentId);
    await ctx.db.patch(agent._id, { lastSandboxAt: Date.now() });
    return null;
  },
});

/**
 * Maturity mode. Sandbox never touches WhatsApp; copilot suggests and the
 * team approves; autopilot answers and books on its own. Copilot/autopilot
 * need a published version.
 */
export const setMode = tenantMutation({
  args: { agentId: v.id("aiAgents"), mode: modeValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "ai.publish");
    const agent = await loadByIdInTenant(ctx, "aiAgents", args.agentId);
    if (args.mode !== "sandbox" && !agent.publishedVersionId) throw new ConvexError({ code: "AI_MODE_REQUIRES_PUBLISH" });
    if ((agent.mode ?? "copilot") === args.mode) return null;
    await ctx.db.patch(agent._id, { mode: args.mode, updatedAt: Date.now() });
    await writeAudit(ctx, { action: "ai.agent.mode_changed", targetType: "aiAgent", targetId: agent._id, payload: { from: agent.mode ?? "copilot", to: args.mode } });
    return null;
  },
});
