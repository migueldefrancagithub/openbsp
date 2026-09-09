import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { DatabaseReader } from "../_generated/server";

export function assignmentFor(stage: Doc<"crmStages">) {
  const systemStage = !!stage.isSystemStage && !!stage.legacyStatus;
  const categoryStatus = stage.rules.category === "won" ? "attended" as const
    : stage.rules.category === "lost" ? "lost" as const : "interested" as const;
  return {
    crmPipelineId: stage.pipelineId,
    crmStageId: systemStage ? undefined : stage._id,
    leadStatus: stage.legacyStatus ?? categoryStatus,
  };
}

/** Bounded redirects preserve archived stages without losing future leads. */
export async function resolveActiveStage(ctx: { db: DatabaseReader }, source: Doc<"crmStages">) {
  let stage = source;
  const seen = new Set<string>();
  for (let hop = 0; hop < 100; hop += 1) {
    if (seen.has(stage._id)) break;
    seen.add(stage._id);
    if (!stage.archivedAt) return stage;
    if (!stage.redirectStageId) break;
    const target = await ctx.db.get(stage.redirectStageId);
    if (!target || target.tenantId !== source.tenantId || target.pipelineId !== source.pipelineId) break;
    stage = target;
  }
  throw new ConvexError({ code: "INVALID_STAGE_REDIRECT" });
}

export async function stageAssignmentForStatus(
  ctx: { db: DatabaseReader },
  tenantId: Id<"tenants">,
  legacyStatus: Doc<"channelThreads">["leadStatus"],
) {
  if (!legacyStatus) return undefined;
  const candidates = await ctx.db.query("crmStages")
    .withIndex("by_tenant_legacy", (q) => q.eq("tenantId", tenantId).eq("legacyStatus", legacyStatus))
    .take(20);
  const system = candidates.find((stage) => stage.isSystemStage && !stage.archivedAt)
    ?? candidates.find((stage) => stage.isSystemStage);
  return system ? assignmentFor(await resolveActiveStage(ctx, system)) : undefined;
}
