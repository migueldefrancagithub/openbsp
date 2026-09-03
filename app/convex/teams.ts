import { ConvexError, v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { writeAudit } from "./lib/audit";
import {
  loadByIdInTenant,
  requireCapability,
  tenantMutation,
  tenantQuery,
} from "./lib/customFunctions";

const teamRoleValidator = v.union(v.literal("lead"), v.literal("member"));

function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

function assertTeamName(name: string): string {
  const cleaned = cleanName(name);
  if (cleaned.length < 2 || cleaned.length > 80) {
    throw new ConvexError({
      code: "INVALID_TEAM_NAME",
      message: "Team name must be 2-80 characters.",
    });
  }
  return cleaned;
}

export const create = tenantMutation({
  args: {
    name: v.string(),
    members: v.array(
      v.object({
        memberId: v.id("members"),
        teamRole: teamRoleValidator,
      }),
    ),
  },
  returns: v.id("teams"),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "teams.manage");
    const name = assertTeamName(args.name);
    const existing = await ctx.db
      .query("teams")
      .withIndex("by_tenant_name", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("name", name),
      )
      .unique();
    if (existing) throw new ConvexError({ code: "TEAM_NAME_EXISTS" });

    const now = Date.now();
    const teamId = await ctx.db.insert("teams", {
      tenantId: ctx.tenantId,
      name,
      createdBy: ctx.memberId,
      createdAt: now,
      updatedAt: now,
    });

    const seen = new Set<string>();
    for (const requested of args.members) {
      if (seen.has(requested.memberId)) continue;
      seen.add(requested.memberId);
      const member = await loadByIdInTenant(
        ctx as Parameters<typeof loadByIdInTenant>[0],
        "members",
        requested.memberId,
      );
      if (member.status !== "active") continue;
      await ctx.db.insert("teamMembers", {
        tenantId: ctx.tenantId,
        teamId,
        memberId: requested.memberId,
        teamRole: requested.teamRole,
        createdAt: now,
      });
    }

    return teamId;
  },
});

export const list = tenantQuery({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("teams"),
      name: v.string(),
      createdAt: v.number(),
      updatedAt: v.number(),
      members: v.array(
        v.object({
          memberId: v.id("members"),
          userId: v.id("users"),
          role: v.string(),
          teamRole: v.string(),
          email: v.optional(v.string()),
          name: v.optional(v.string()),
        }),
      ),
    }),
  ),
  handler: async (ctx) => {
    const teams = await ctx.db
      .query("teams")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .order("desc")
      .take(100);
    const out = [];
    for (const team of teams) {
      const memberships = await ctx.db
        .query("teamMembers")
        .withIndex("by_team", (q) => q.eq("teamId", team._id))
        .take(200);
      const members = [];
      for (const membership of memberships) {
        const member = await ctx.db.get(membership.memberId);
        if (!member || member.tenantId !== ctx.tenantId) continue;
        const user = await ctx.db.get(member.userId);
        members.push({
          memberId: member._id,
          userId: member.userId,
          role: member.role,
          teamRole: membership.teamRole,
          email: user?.email,
          name: user?.name,
        });
      }
      out.push({
        _id: team._id,
        name: team.name,
        createdAt: team.createdAt,
        updatedAt: team.updatedAt,
        members,
      });
    }
    return out;
  },
});

/**
 * Rename a team and adjust its members/lead in one audited change.
 */
export const update = tenantMutation({
  args: {
    teamId: v.id("teams"),
    name: v.optional(v.string()),
    add: v.optional(v.array(v.id("members"))),
    remove: v.optional(v.array(v.id("members"))),
    leadMemberId: v.optional(v.id("members")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "teams.manage");
    const team = await loadByIdInTenant(ctx, "teams", args.teamId);
    const now = Date.now();
    const patch: Record<string, unknown> = { updatedAt: now };
    if (args.name !== undefined) {
      const name = assertTeamName(args.name);
      if (name !== team.name) {
        const clash = await ctx.db
          .query("teams")
          .withIndex("by_tenant_name", (q) => q.eq("tenantId", ctx.tenantId).eq("name", name))
          .unique();
        if (clash && clash._id !== team._id) throw new ConvexError({ code: "TEAM_NAME_EXISTS" });
        patch.name = name;
      }
    }
    const memberships = (await ctx.db
      .query("teamMembers")
      .withIndex("by_team", (q) => q.eq("teamId", team._id))
      .take(200)) as Doc<"teamMembers">[];
    const byMember = new Map(memberships.map((row) => [row.memberId, row]));
    for (const memberId of args.remove ?? []) {
      const row = byMember.get(memberId);
      if (row) {
        await ctx.db.delete(row._id);
        byMember.delete(memberId);
      }
    }
    for (const memberId of args.add ?? []) {
      if (byMember.has(memberId)) continue;
      const member = await loadByIdInTenant(ctx, "members", memberId);
      if (member.status !== "active") continue;
      const rowId = await ctx.db.insert("teamMembers", {
        tenantId: ctx.tenantId,
        teamId: team._id,
        memberId,
        teamRole: "member",
        createdAt: now,
      });
      byMember.set(memberId, (await ctx.db.get(rowId)) as Doc<"teamMembers">);
    }
    if (args.leadMemberId !== undefined) {
      for (const row of byMember.values()) {
        const wanted = row.memberId === args.leadMemberId ? "lead" : "member";
        if (row.teamRole !== wanted) await ctx.db.patch(row._id, { teamRole: wanted });
      }
    }
    await ctx.db.patch(team._id, patch);
    await writeAudit(ctx, {
      action: "teams.updated",
      targetType: "team",
      targetId: team._id,
      payload: { name: patch.name, added: args.add?.length ?? 0, removed: args.remove?.length ?? 0 },
    });
    return null;
  },
});

/**
 * Delete a team. Memberships go immediately; threads assigned to the team
 * are unassigned in the background (paginated), never left dangling.
 */
export const remove = tenantMutation({
  args: { teamId: v.id("teams") },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "teams.manage");
    const team = await loadByIdInTenant(ctx, "teams", args.teamId);
    const memberships = (await ctx.db
      .query("teamMembers")
      .withIndex("by_team", (q) => q.eq("teamId", team._id))
      .take(200)) as Doc<"teamMembers">[];
    for (const row of memberships) await ctx.db.delete(row._id);
    await ctx.db.delete(team._id);
    await writeAudit(ctx, {
      action: "teams.removed",
      targetType: "team",
      targetId: team._id,
      payload: { name: team.name },
    });
    await ctx.scheduler.runAfter(0, internal.teams._unassignTeamThreads, {
      tenantId: ctx.tenantId,
      teamId: team._id,
    });
    return null;
  },
});

export const _unassignTeamThreads = internalMutation({
  args: { tenantId: v.id("tenants"), teamId: v.id("teams") },
  returns: v.object({ patched: v.number(), isDone: v.boolean() }),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("channelThreads")
      .withIndex("by_tenant_team", (q) =>
        q.eq("tenantId", args.tenantId).eq("assignedTeamId", args.teamId as Id<"teams">),
      )
      .take(100);
    const now = Date.now();
    for (const thread of rows) {
      await ctx.db.patch(thread._id, { assignedTeamId: undefined, updatedAt: now });
    }
    const isDone = rows.length < 100;
    if (!isDone) {
      await ctx.scheduler.runAfter(0, internal.teams._unassignTeamThreads, args);
    }
    return { patched: rows.length, isDone };
  },
});
