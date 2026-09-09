import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { writeAudit } from "./lib/audit";
import {
  loadByIdInTenant,
  requireCapability,
  requireRoleAtLeast,
  tenantMutation,
  tenantQuery,
} from "./lib/customFunctions";
import { applyThreadUpdate } from "./lib/channels/threadUpdate";
import { assignmentFor, resolveActiveStage } from "./lib/crmStages";

const MIGRATION_BATCH = 100;

const legacyStatusValidator = v.union(
  v.literal("new"),
  v.literal("interested"),
  v.literal("asked_price"),
  v.literal("wants_booking"),
  v.literal("awaiting_human"),
  v.literal("booked"),
  v.literal("confirmed"),
  v.literal("attended"),
  v.literal("no_show"),
  v.literal("lost"),
);

const categoryValidator = v.union(v.literal("open"), v.literal("won"), v.literal("lost"));
const rulesValidator = v.object({
  category: categoryValidator,
  requireNextStep: v.boolean(),
  pauseAi: v.boolean(),
});

const stageValidator = v.object({
  _id: v.id("crmStages"),
  name: v.string(),
  color: v.string(),
  position: v.number(),
  legacyStatus: v.optional(legacyStatusValidator),
  isSystemStage: v.boolean(),
  useSystemLabel: v.boolean(),
  rules: rulesValidator,
});

const DEFAULT_STAGES = [
  { name: "Novo", color: "#2b4f8a", legacyStatus: "new", category: "open" },
  { name: "Interessado", color: "#356fc3", legacyStatus: "interested", category: "open" },
  { name: "Pediu preço", color: "#6b7280", legacyStatus: "asked_price", category: "open" },
  { name: "Quer agendar", color: "#2563a7", legacyStatus: "wants_booking", category: "open" },
  { name: "Aguarda equipa", color: "#d18a13", legacyStatus: "awaiting_human", category: "open", pauseAi: true },
  { name: "Agendado", color: "#16877b", legacyStatus: "booked", category: "open" },
  { name: "Confirmado", color: "#0d6b61", legacyStatus: "confirmed", category: "won" },
  { name: "Concluído", color: "#1d7a46", legacyStatus: "attended", category: "won" },
  { name: "Não compareceu", color: "#e0533d", legacyStatus: "no_show", category: "lost" },
  { name: "Perdido", color: "#b3261e", legacyStatus: "lost", category: "lost" },
] as const;

function cleanName(value: string): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 50) throw new ConvexError({ code: "INVALID_STAGE_NAME" });
  return name;
}

function cleanColor(value: string): string {
  const color = value.trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(color)) throw new ConvexError({ code: "INVALID_STAGE_COLOR" });
  return color;
}

function stageRow(stage: Doc<"crmStages">) {
  return {
    _id: stage._id,
    name: stage.name,
    color: stage.color,
    position: stage.position,
    legacyStatus: stage.legacyStatus,
    isSystemStage: stage.isSystemStage ?? false,
    useSystemLabel: stage.useSystemLabel ?? false,
    rules: stage.rules,
  };
}

export const ensureDefault = tenantMutation({
  args: {},
  returns: v.id("crmPipelines"),
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("crmPipelines")
      .withIndex("by_tenant_default", (q) => q.eq("tenantId", ctx.tenantId).eq("isDefault", true))
      .first();
    if (existing) return existing._id;

    requireCapability(ctx.role, "leads.update");
    const now = Date.now();
    const pipelineId = await ctx.db.insert("crmPipelines", {
      tenantId: ctx.tenantId,
      name: "Funil principal",
      isDefault: true,
      active: true,
      createdBy: ctx.memberId,
      createdAt: now,
      updatedAt: now,
    });
    for (const [position, stage] of DEFAULT_STAGES.entries()) {
      await ctx.db.insert("crmStages", {
        tenantId: ctx.tenantId,
        pipelineId,
        name: stage.name,
        color: stage.color,
        position,
        legacyStatus: stage.legacyStatus,
        isSystemStage: true,
        useSystemLabel: true,
        rules: {
          category: stage.category,
          requireNextStep: false,
          pauseAi: "pauseAi" in stage ? stage.pauseAi : false,
        },
        createdBy: ctx.memberId,
        createdAt: now,
        updatedAt: now,
      });
    }
    await writeAudit(ctx, {
      action: "crm.pipeline_created",
      targetType: "crm_pipeline",
      targetId: pipelineId,
      payload: { defaultStages: DEFAULT_STAGES.length },
      now,
    });
    return pipelineId;
  },
});

export const getDefault = tenantQuery({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      pipeline: v.object({ _id: v.id("crmPipelines"), name: v.string() }),
      stages: v.array(stageValidator),
    }),
  ),
  handler: async (ctx) => {
    const pipeline = await ctx.db
      .query("crmPipelines")
      .withIndex("by_tenant_default", (q) => q.eq("tenantId", ctx.tenantId).eq("isDefault", true))
      .first();
    if (!pipeline || !pipeline.active) return null;
    const stages = await ctx.db
      .query("crmStages")
      .withIndex("by_pipeline_active_position", (q) => q.eq("pipelineId", pipeline._id).eq("archivedAt", undefined))
      .take(100);
    return {
      pipeline: { _id: pipeline._id, name: pipeline.name },
      stages: stages.filter((stage) => !stage.archivedAt).map(stageRow),
    };
  },
});

export const createStage = tenantMutation({
  args: { pipelineId: v.id("crmPipelines"), name: v.string(), color: v.string(), rules: rulesValidator },
  returns: v.id("crmStages"),
  handler: async (ctx, args) => {
    requireRoleAtLeast(ctx.role, "admin");
    const pipeline = await loadByIdInTenant(ctx, "crmPipelines", args.pipelineId);
    if (!pipeline.active) throw new ConvexError({ code: "PIPELINE_ARCHIVED" });
    const stages = await ctx.db
      .query("crmStages")
      .withIndex("by_pipeline_active_position", (q) => q.eq("pipelineId", pipeline._id).eq("archivedAt", undefined))
      .take(100);
    if (stages.filter((stage) => !stage.archivedAt).length >= 30) {
      throw new ConvexError({ code: "STAGE_LIMIT_REACHED" });
    }
    const now = Date.now();
    const stageId = await ctx.db.insert("crmStages", {
      tenantId: ctx.tenantId,
      pipelineId: pipeline._id,
      name: cleanName(args.name),
      color: cleanColor(args.color),
      position: Math.max(-1, ...stages.map((stage) => stage.position)) + 1,
      useSystemLabel: false,
      isSystemStage: false,
      rules: args.rules,
      createdBy: ctx.memberId,
      createdAt: now,
      updatedAt: now,
    });
    await writeAudit(ctx, { action: "crm.stage_created", targetType: "crm_stage", targetId: stageId, payload: { pipelineId: args.pipelineId }, now });
    return stageId;
  },
});

export const updateStage = tenantMutation({
  args: { stageId: v.id("crmStages"), name: v.string(), color: v.string(), rules: rulesValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireRoleAtLeast(ctx.role, "admin");
    const stage = await loadByIdInTenant(ctx, "crmStages", args.stageId);
    if (stage.archivedAt) throw new ConvexError({ code: "STAGE_ARCHIVED" });
    const now = Date.now();
    const after = { name: cleanName(args.name), color: cleanColor(args.color), rules: args.rules };
    await ctx.db.patch(stage._id, { ...after, useSystemLabel: false, updatedAt: now });
    await writeAudit(ctx, {
      action: "crm.stage_updated",
      targetType: "crm_stage",
      targetId: stage._id,
      payload: { before: { name: stage.name, color: stage.color, rules: stage.rules }, after },
      now,
    });
    return null;
  },
});

export const reorderStages = tenantMutation({
  args: { pipelineId: v.id("crmPipelines"), stageIds: v.array(v.id("crmStages")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireRoleAtLeast(ctx.role, "admin");
    await loadByIdInTenant(ctx, "crmPipelines", args.pipelineId);
    const active = (await ctx.db
      .query("crmStages")
      .withIndex("by_pipeline_active_position", (q) => q.eq("pipelineId", args.pipelineId).eq("archivedAt", undefined))
      .take(100))
      .filter((stage) => !stage.archivedAt);
    if (args.stageIds.length !== active.length || new Set(args.stageIds).size !== active.length) {
      throw new ConvexError({ code: "INVALID_STAGE_ORDER" });
    }
    const activeIds = new Set(active.map((stage) => String(stage._id)));
    if (args.stageIds.some((id) => !activeIds.has(String(id)))) {
      throw new ConvexError({ code: "INVALID_STAGE_ORDER" });
    }
    const now = Date.now();
    for (const [position, stageId] of args.stageIds.entries()) {
      await ctx.db.patch(stageId, { position, updatedAt: now });
    }
    await writeAudit(ctx, { action: "crm.stages_reordered", targetType: "crm_pipeline", targetId: args.pipelineId, payload: { stageIds: args.stageIds }, now });
    return null;
  },
});

export const moveLead = tenantMutation({
  args: { threadId: v.id("channelThreads"), stageId: v.id("crmStages") },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "leads.update");
    const thread = await loadByIdInTenant(ctx, "channelThreads", args.threadId);
    const stage = await loadByIdInTenant(ctx, "crmStages", args.stageId);
    if (stage.archivedAt) throw new ConvexError({ code: "STAGE_ARCHIVED" });
    if (stage.rules.requireNextStep && !thread.nextStep?.trim()) {
      throw new ConvexError({ code: "NEXT_STEP_REQUIRED" });
    }
    const assignment = assignmentFor(stage);
    const update = {
      leadStatus: assignment.leadStatus,
      ...(stage.rules.pauseAi && thread.automationMode !== "human" ? { automationMode: "human" as const } : {}),
    };
    await applyThreadUpdate(ctx, thread, update, { auditAction: "crm.lead_stage_status_updated", crmStage: stage });
    const now = Date.now();
    await ctx.db.patch(thread._id, {
      crmPipelineId: assignment.crmPipelineId,
      crmStageId: assignment.crmStageId,
      updatedAt: now,
    });
    await writeAudit(ctx, {
      action: "crm.lead_moved",
      targetType: "channel_thread",
      targetId: thread._id,
      payload: { fromStageId: thread.crmStageId, toStageId: stage._id, pipelineId: stage.pipelineId },
      now,
    });
    return null;
  },
});

async function migrateStageBatch(
  ctx: { db: any; scheduler: any },
  args: { tenantId: Id<"tenants">; sourceStageId: Id<"crmStages">; targetStageId: Id<"crmStages"> },
) {
  const source = (await ctx.db.get(args.sourceStageId)) as Doc<"crmStages"> | null;
  const target = (await ctx.db.get(args.targetStageId)) as Doc<"crmStages"> | null;
  if (!source || !target || source.tenantId !== args.tenantId || target.tenantId !== args.tenantId) return 0;
  const rows = source.isSystemStage && source.legacyStatus
    ? await ctx.db
        .query("channelThreads")
        .withIndex("by_tenant_lead_status", (q: any) => q.eq("tenantId", args.tenantId).eq("leadStatus", source.legacyStatus))
        .filter((q: any) => q.eq(q.field("crmStageId"), undefined))
        .take(MIGRATION_BATCH)
    : await ctx.db
        .query("channelThreads")
        .withIndex("by_tenant_crm_stage", (q: any) => q.eq("tenantId", args.tenantId).eq("crmStageId", source._id))
        .take(MIGRATION_BATCH);
  const assignment = assignmentFor(await resolveActiveStage(ctx, target));
  const now = Date.now();
  for (const thread of rows) {
    await ctx.db.patch(thread._id, { ...assignment, updatedAt: now });
  }
  if (rows.length === MIGRATION_BATCH) {
    await ctx.scheduler.runAfter(0, internal.crmPipelines._migrateArchivedStage, args);
  }
  return rows.length;
}

export const archiveStage = tenantMutation({
  args: { stageId: v.id("crmStages"), targetStageId: v.id("crmStages") },
  returns: v.object({ migrated: v.number() }),
  handler: async (ctx, args) => {
    requireRoleAtLeast(ctx.role, "admin");
    if (args.stageId === args.targetStageId) throw new ConvexError({ code: "INVALID_STAGE_REDIRECT" });
    const source = await loadByIdInTenant(ctx, "crmStages", args.stageId);
    const target = await loadByIdInTenant(ctx, "crmStages", args.targetStageId);
    if (source.pipelineId !== target.pipelineId || source.archivedAt || target.archivedAt) {
      throw new ConvexError({ code: "INVALID_STAGE_REDIRECT" });
    }
    const now = Date.now();
    await ctx.db.patch(source._id, { archivedAt: now, redirectStageId: target._id, updatedAt: now });
    const migrated = await migrateStageBatch(ctx, { tenantId: ctx.tenantId, sourceStageId: source._id, targetStageId: target._id });
    await writeAudit(ctx, {
      action: "crm.stage_archived",
      targetType: "crm_stage",
      targetId: source._id,
      payload: { targetStageId: target._id, migratedInFirstBatch: migrated },
      now,
    });
    return { migrated };
  },
});

export const _migrateArchivedStage = internalMutation({
  args: { tenantId: v.id("tenants"), sourceStageId: v.id("crmStages"), targetStageId: v.id("crmStages") },
  returns: v.number(),
  handler: async (ctx, args) => await migrateStageBatch(ctx, args),
});
