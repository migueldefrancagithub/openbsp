import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const tenantId = await ctx.db.insert("tenants", {
      name: "Members",
      vertical: "clinic",
      plan: "starter",
      settings: { defaultLocale: "pt-MZ", timezone: "Africa/Maputo", retentionDays: 730 },
      createdAt: Date.now(),
    });
    const make = async (role: "owner" | "admin" | "agent") => {
      const userId = await ctx.db.insert("users", { name: role });
      const memberId = await ctx.db.insert("members", { tenantId, userId, role, status: "active", createdAt: Date.now() });
      await ctx.db.insert("sessions", { userId, activeTenantId: tenantId, updatedAt: Date.now() });
      return { userId, memberId };
    };
    return { tenantId, owner: await make("owner"), admin: await make("admin"), agent: await make("agent") };
  });
}

describe("members", () => {
  it("applies the owner rules on role changes and suspensions", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    const asOwner = t.withIdentity({ subject: s.owner.userId });
    const asAdmin = t.withIdentity({ subject: s.admin.userId });
    const asAgent = t.withIdentity({ subject: s.agent.userId });

    await expect(asAgent.mutation(api.members.changeRole, { memberId: s.admin.memberId, role: "agent" })).rejects.toThrow(/FORBIDDEN_CAPABILITY/);
    await expect(asOwner.mutation(api.members.changeRole, { memberId: s.owner.memberId, role: "admin" })).rejects.toThrow(/CANNOT_CHANGE_OWN_ROLE/);
    await expect(asAdmin.mutation(api.members.changeRole, { memberId: s.agent.memberId, role: "owner" })).rejects.toThrow(/OWNER_ROLE_RESTRICTED/);
    await expect(asAdmin.mutation(api.members.changeRole, { memberId: s.owner.memberId, role: "admin" })).rejects.toThrow(/OWNER_ROLE_RESTRICTED/);
    await expect(asOwner.mutation(api.members.setStatus, { memberId: s.owner.memberId, status: "suspended" })).rejects.toThrow(/CANNOT_CHANGE_OWN_ROLE/);

    await asAdmin.mutation(api.members.changeRole, { memberId: s.agent.memberId, role: "marketing" });
    await asOwner.mutation(api.members.changeRole, { memberId: s.admin.memberId, role: "owner" });
    // Now two owners: the original can be demoted; then the last one cannot.
    await asAdmin.mutation(api.members.changeRole, { memberId: s.owner.memberId, role: "admin" });
    await expect(asOwner.mutation(api.members.changeRole, { memberId: s.admin.memberId, role: "agent" })).rejects.toThrow(/OWNER_ROLE_RESTRICTED|LAST_OWNER/);
    await expect(asAdmin.mutation(api.members.setStatus, { memberId: s.admin.memberId, status: "suspended" })).rejects.toThrow(/CANNOT_CHANGE_OWN_ROLE/);

    await asAdmin.mutation(api.members.setStatus, { memberId: s.agent.memberId, status: "suspended" });
    await expect(asAgent.query(api.tenantsQueries.getActive, {})).rejects.toThrow(/FORBIDDEN/);
    await asAdmin.mutation(api.members.setStatus, { memberId: s.agent.memberId, status: "active" });

    const audit = await t.run(async (ctx) => await ctx.db.query("auditLog").collect());
    expect(audit.map((row) => row.action)).toEqual(
      expect.arrayContaining(["members.role_changed", "members.suspended", "members.reactivated"]),
    );
  });

  it("persists the UI language per member", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    const asAgent = t.withIdentity({ subject: s.agent.userId });
    expect((await asAgent.query(api.tenantsQueries.getActiveOptional, {}))?.locale).toBeUndefined();
    await asAgent.mutation(api.members.setLocale, { locale: "en" });
    expect((await asAgent.query(api.tenantsQueries.getActive, {})).locale).toBe("en");
    expect((await asAgent.query(api.tenantsQueries.getActiveOptional, {}))?.locale).toBe("en");
  });

  it("updates and removes teams, unassigning threads in the background", async () => {
    const t = convexTest(schema);
    const s = await seed(t);
    const asAdmin = t.withIdentity({ subject: s.admin.userId });
    const teamId = await asAdmin.mutation(api.teams.create, {
      name: "Recepção",
      members: [{ memberId: s.agent.memberId, teamRole: "member" }],
    });
    await asAdmin.mutation(api.teams.update, {
      teamId,
      name: "Recepção manhã",
      add: [s.admin.memberId],
      leadMemberId: s.admin.memberId,
    });
    const [team] = await asAdmin.query(api.teams.list, {});
    expect(team.name).toBe("Recepção manhã");
    expect(team.members.find((row) => row.memberId === s.admin.memberId)?.teamRole).toBe("lead");
    expect(team.members).toHaveLength(2);

    const channelId = await t.run(async (ctx) =>
      await ctx.db.insert("channels", {
        tenantId: s.tenantId,
        publicId: "hub_teamsxxxxxxxxxxxxxxxxxxx".slice(0, 28),
        kind: "whatsapp",
        provider: "iasolution_hub",
        operationalTerritory: "openbsp",
        externalAccountId: "c-teams",
        displayName: "c",
        status: "active",
        sendMode: "allowlist",
        outboundAllowlist: [],
        connectionState: "allowlist_only",
        webhookStatus: "verified",
        createdBy: s.owner.memberId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    const threadId = await t.run(async (ctx) =>
      await ctx.db.insert("channelThreads", {
        tenantId: s.tenantId,
        channelId,
        threadKey: "258840000010",
        lastEventAt: Date.now(),
        lastEventKind: "message.text",
        unreadCount: 0,
        assignedTeamId: teamId as Id<"teams">,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    await asAdmin.mutation(api.teams.remove, { teamId });
    await t.mutation(internal.teams._unassignTeamThreads, { tenantId: s.tenantId, teamId });
    const thread = await t.run(async (ctx) => await ctx.db.get(threadId));
    expect(thread?.assignedTeamId).toBeUndefined();
    expect(await asAdmin.query(api.teams.list, {})).toHaveLength(0);
    const memberships = await t.run(async (ctx) => await ctx.db.query("teamMembers").collect());
    expect(memberships).toHaveLength(0);
  });
});
