import { ConvexError, v } from "convex/values";
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
    requireCapability(ctx.role, "members.invite");
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
      .collect();
    const out = [];
    for (const team of teams) {
      const memberships = await ctx.db
        .query("teamMembers")
        .withIndex("by_team", (q) => q.eq("teamId", team._id))
        .collect();
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
