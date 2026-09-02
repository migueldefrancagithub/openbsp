import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { writeAudit } from "./lib/audit";
import { loadByIdInTenant, requireCapability, tenantMutation, tenantQuery } from "./lib/customFunctions";

const strategyValidator = v.union(v.literal("round_robin"), v.literal("least_open"));

const ruleValidator = v.object({
  _id: v.id("assignmentRules"),
  name: v.string(),
  channelId: v.optional(v.id("channels")),
  teamId: v.id("teams"),
  teamName: v.string(),
  strategy: strategyValidator,
  onlyOnline: v.boolean(),
  leadStatuses: v.optional(v.array(v.string())),
  active: v.boolean(),
  order: v.number(),
  assignedCount: v.number(),
});

export const list = tenantQuery({
  args: {},
  returns: v.array(ruleValidator),
  handler: async (ctx) => {
    const rows = [
      ...((await ctx.db
        .query("assignmentRules")
        .withIndex("by_tenant_active", (q) => q.eq("tenantId", ctx.tenantId).eq("active", true))
        .take(50)) as Doc<"assignmentRules">[]),
      ...((await ctx.db
        .query("assignmentRules")
        .withIndex("by_tenant_active", (q) => q.eq("tenantId", ctx.tenantId).eq("active", false))
        .take(50)) as Doc<"assignmentRules">[]),
    ];
    const out = [];
    for (const rule of rows) {
      const team = await ctx.db.get(rule.teamId);
      out.push({
        _id: rule._id,
        name: rule.name,
        channelId: rule.channelId,
        teamId: rule.teamId,
        teamName: team?.name ?? "",
        strategy: rule.strategy,
        onlyOnline: rule.onlyOnline,
        leadStatuses: rule.leadStatuses,
        active: rule.active,
        order: rule.order,
        assignedCount: rule.assignedCount ?? 0,
      });
    }
    return out.sort((a, b) => a.order - b.order);
  },
});

export const save = tenantMutation({
  args: {
    ruleId: v.optional(v.id("assignmentRules")),
    name: v.string(),
    channelId: v.optional(v.id("channels")),
    teamId: v.id("teams"),
    strategy: strategyValidator,
    onlyOnline: v.boolean(),
    leadStatuses: v.optional(v.array(v.string())),
    active: v.optional(v.boolean()),
  },
  returns: v.id("assignmentRules"),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "teams.manage");
    const name = args.name.trim();
    if (name.length < 2 || name.length > 80) throw new ConvexError({ code: "INVALID_TEXT_LENGTH", label: "name", min: 2, max: 80 });
    await loadByIdInTenant(ctx, "teams", args.teamId);
    if (args.channelId) await loadByIdInTenant(ctx, "channels", args.channelId);
    const now = Date.now();
    const leadStatuses = args.leadStatuses?.filter((s) => s.trim().length > 0);
    if (args.ruleId) {
      const rule = await loadByIdInTenant(ctx, "assignmentRules", args.ruleId);
      await ctx.db.patch(rule._id, {
        name,
        channelId: args.channelId,
        teamId: args.teamId,
        strategy: args.strategy,
        onlyOnline: args.onlyOnline,
        leadStatuses: leadStatuses && leadStatuses.length > 0 ? leadStatuses : undefined,
        active: args.active ?? rule.active,
        updatedAt: now,
      });
      await writeAudit(ctx, { action: "assignment_rule.updated", targetType: "assignmentRule", targetId: rule._id, payload: { name } });
      return rule._id;
    }
    const existing = await ctx.db
      .query("assignmentRules")
      .withIndex("by_tenant_active", (q) => q.eq("tenantId", ctx.tenantId).eq("active", true))
      .take(21);
    if (existing.length >= 20) throw new ConvexError({ code: "ASSIGNMENT_RULE_LIMIT" });
    const ruleId = await ctx.db.insert("assignmentRules", {
      tenantId: ctx.tenantId,
      name,
      channelId: args.channelId,
      teamId: args.teamId,
      strategy: args.strategy,
      onlyOnline: args.onlyOnline,
      leadStatuses: leadStatuses && leadStatuses.length > 0 ? leadStatuses : undefined,
      active: args.active ?? true,
      order: existing.length,
      assignedCount: 0,
      createdBy: ctx.memberId,
      createdAt: now,
      updatedAt: now,
    });
    await writeAudit(ctx, { action: "assignment_rule.created", targetType: "assignmentRule", targetId: ruleId, payload: { name } });
    return ruleId;
  },
});

export const remove = tenantMutation({
  args: { ruleId: v.id("assignmentRules") },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "teams.manage");
    const rule = await loadByIdInTenant(ctx, "assignmentRules", args.ruleId);
    await ctx.db.delete(rule._id);
    await writeAudit(ctx, { action: "assignment_rule.removed", targetType: "assignmentRule", targetId: rule._id, payload: { name: rule.name } });
    return null;
  },
});
