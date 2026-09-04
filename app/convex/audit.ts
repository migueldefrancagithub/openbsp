import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import type { Doc } from "./_generated/dataModel";
import { hashAuditRow, GENESIS_HASH } from "./lib/audit";
import { requireCapability, tenantQuery } from "./lib/customFunctions";

const auditRowValidator = v.object({
  _id: v.id("auditLog"),
  actorType: v.string(),
  actorId: v.string(),
  actorRoleSnapshot: v.optional(v.string()),
  action: v.string(),
  targetType: v.optional(v.string()),
  targetId: v.optional(v.string()),
  metadata: v.optional(v.any()),
  prevHash: v.string(),
  selfHash: v.string(),
  createdAt: v.number(),
});

const auditActorTypeValidator = v.union(
  v.literal("member"),
  v.literal("system"),
  v.literal("scheduler"),
  v.literal("api_key"),
);

export const listPaginated = tenantQuery({
  args: {
    paginationOpts: paginationOptsValidator,
    /** Narrow by who did it, or by what was done. */
    actorId: v.optional(v.id("members")),
    actorType: v.optional(auditActorTypeValidator),
    actionPrefix: v.optional(v.string()),
  },
  returns: v.object({
    page: v.array(auditRowValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "audit.export");
    const paginationOpts = {
      cursor: args.paginationOpts.cursor,
      numItems: Math.min(Math.max(args.paginationOpts.numItems, 1), 100),
    };
    const prefixEnd = args.actionPrefix ? `${args.actionPrefix}\uffff` : undefined;
    const result = args.actorId
      ? args.actionPrefix
        ? await ctx.db
            .query("auditLog")
            .withIndex("by_tenant_actor_id_created", (q) =>
              q.eq("tenantId", ctx.tenantId).eq("actorId", args.actorId!),
            )
            .filter((q) =>
              q.and(
                q.gte(q.field("action"), args.actionPrefix!),
                q.lt(q.field("action"), prefixEnd!),
              ),
            )
            .order("desc")
            .paginate(paginationOpts)
        : await ctx.db
            .query("auditLog")
            .withIndex("by_tenant_actor_id_created", (q) =>
              q.eq("tenantId", ctx.tenantId).eq("actorId", args.actorId!),
            )
            .order("desc")
            .paginate(paginationOpts)
      : args.actorType
        ? args.actionPrefix
          ? await ctx.db
              .query("auditLog")
              .withIndex("by_tenant_actor_type_created", (q) =>
                q.eq("tenantId", ctx.tenantId).eq("actorType", args.actorType!),
              )
              .filter((q) =>
                q.and(
                  q.gte(q.field("action"), args.actionPrefix!),
                  q.lt(q.field("action"), prefixEnd!),
                ),
              )
              .order("desc")
              .paginate(paginationOpts)
          : await ctx.db
              .query("auditLog")
              .withIndex("by_tenant_actor_type_created", (q) =>
                q.eq("tenantId", ctx.tenantId).eq("actorType", args.actorType!),
              )
              .order("desc")
              .paginate(paginationOpts)
        : args.actionPrefix
          ? await ctx.db
              .query("auditLog")
              .withIndex("by_tenant_created", (q) => q.eq("tenantId", ctx.tenantId))
              .filter((q) =>
                q.and(
                  q.gte(q.field("action"), args.actionPrefix!),
                  q.lt(q.field("action"), prefixEnd!),
                ),
              )
              .order("desc")
              .paginate(paginationOpts)
          : await ctx.db
              .query("auditLog")
              .withIndex("by_tenant_created", (q) => q.eq("tenantId", ctx.tenantId))
              .order("desc")
              .paginate(paginationOpts);
    return {
      page: result.page.map((row) => ({
        _id: row._id,
        actorType: row.actorType,
        actorId: row.actorId,
        actorRoleSnapshot: row.actorRoleSnapshot,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        metadata: row.metadata,
        prevHash: row.prevHash,
        selfHash: row.selfHash,
        createdAt: row.createdAt,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/**
 * Recompute the chain over the newest `limit` rows (oldest → newest). A
 * modified or deleted row shows up as the first broken link.
 */
export const verifyChain = tenantQuery({
  args: { limit: v.optional(v.number()) },
  returns: v.object({
    checked: v.number(),
    ok: v.boolean(),
    firstBrokenId: v.optional(v.id("auditLog")),
    newestHash: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "audit.export");
    const limit = Math.min(Math.max(args.limit ?? 200, 1), 1000);
    const newest = (await ctx.db
      .query("auditLog")
      .withIndex("by_tenant_created", (q) => q.eq("tenantId", ctx.tenantId))
      .order("desc")
      .take(limit)) as Doc<"auditLog">[];
    const rows = [...newest].reverse();
    let expectedPrev: string | null = rows.length === limit ? null : GENESIS_HASH;
    for (const row of rows) {
      if (expectedPrev !== null && row.prevHash !== expectedPrev) {
        return { checked: rows.length, ok: false, firstBrokenId: row._id, newestHash: newest[0]?.selfHash };
      }
      const { _id, _creationTime, selfHash, ...content } = row;
      void _id;
      void _creationTime;
      const recomputed = await hashAuditRow(content as Parameters<typeof hashAuditRow>[0]);
      if (recomputed !== selfHash) {
        return { checked: rows.length, ok: false, firstBrokenId: row._id, newestHash: newest[0]?.selfHash };
      }
      expectedPrev = selfHash;
    }
    return { checked: rows.length, ok: true, newestHash: newest[0]?.selfHash };
  },
});
