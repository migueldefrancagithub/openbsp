import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";

async function seedTeamWorkspace(t: ReturnType<typeof convexTest>) {
  const users = await t.run(async (ctx) => {
    return {
      ownerUserId: await ctx.db.insert("users", { name: "Owner" }),
      leadUserId: await ctx.db.insert("users", { name: "Lead" }),
      agentUserId: await ctx.db.insert("users", { name: "Agent" }),
      outsiderUserId: await ctx.db.insert("users", { name: "Outsider" }),
    };
  });
  const seeded = await t.run(async (ctx) => {
    const tenantId = await ctx.db.insert("tenants", {
      name: "COEX Clinic",
      vertical: "clinic",
      plan: "growth",
      settings: {
        defaultLocale: "pt-PT",
        timezone: "Africa/Maputo",
        retentionDays: 730,
      },
      createdAt: Date.now(),
    });
    const ownerMemberId = await ctx.db.insert("members", {
      tenantId,
      userId: users.ownerUserId,
      role: "owner",
      status: "active",
      createdAt: Date.now(),
    });
    const leadMemberId = await ctx.db.insert("members", {
      tenantId,
      userId: users.leadUserId,
      role: "agent",
      status: "active",
      createdAt: Date.now(),
    });
    const agentMemberId = await ctx.db.insert("members", {
      tenantId,
      userId: users.agentUserId,
      role: "agent",
      status: "active",
      createdAt: Date.now(),
    });
    const outsiderMemberId = await ctx.db.insert("members", {
      tenantId,
      userId: users.outsiderUserId,
      role: "agent",
      status: "active",
      createdAt: Date.now(),
    });
    for (const userId of Object.values(users)) {
      await ctx.db.insert("sessions", {
        userId,
        activeTenantId: tenantId,
        updatedAt: Date.now(),
      });
    }
    const whatsappAccountId = await ctx.db.insert("whatsappAccounts", {
      tenantId,
      metaAppId: "123",
      wabaId: "456",
      accessToken: "token",
      status: "active",
      tokenStatus: "ok",
      createdAt: Date.now(),
    });
    const phoneNumberId = await ctx.db.insert("phoneNumbers", {
      tenantId,
      whatsappAccountId,
      phoneNumberId: "1020304050",
      e164: "+258840000000",
      displayName: "Main",
      createdAt: Date.now(),
    });
    const teamContactId = await ctx.db.insert("contacts", {
      tenantId,
      e164: "+258840000001",
      name: "Team Queue",
      tags: [],
      createdAt: Date.now(),
    });
    const directContactId = await ctx.db.insert("contacts", {
      tenantId,
      e164: "+258840000002",
      name: "Direct Owner",
      tags: [],
      createdAt: Date.now(),
    });
    return {
      tenantId,
      ownerMemberId,
      leadMemberId,
      agentMemberId,
      outsiderMemberId,
      phoneNumberId,
      teamContactId,
      directContactId,
    };
  });

  return {
    ...users,
    ...seeded,
    owner: t.withIdentity({ subject: users.ownerUserId }),
    lead: t.withIdentity({ subject: users.leadUserId }),
    agent: t.withIdentity({ subject: users.agentUserId }),
    outsider: t.withIdentity({ subject: users.outsiderUserId }),
  };
}

describe("teams and inbox queues", () => {
  it("creates a team with lead/member roles and lists its members", async () => {
    const t = convexTest(schema);
    const seeded = await seedTeamWorkspace(t);

    const teamId = await seeded.owner.mutation((api as any).teams.create, {
      name: "Sales Team",
      members: [
        { memberId: seeded.leadMemberId, teamRole: "lead" },
        { memberId: seeded.agentMemberId, teamRole: "member" },
      ],
    });

    const teams = await seeded.owner.query((api as any).teams.list, {});
    expect(teams).toEqual([
      expect.objectContaining({
        _id: teamId,
        name: "Sales Team",
        members: expect.arrayContaining([
          expect.objectContaining({ memberId: seeded.leadMemberId, teamRole: "lead" }),
          expect.objectContaining({ memberId: seeded.agentMemberId, teamRole: "member" }),
        ]),
      }),
    ]);
  });

  it("filters inbox conversations by team membership and team lead access", async () => {
    const t = convexTest(schema);
    const seeded = await seedTeamWorkspace(t);
    const teamId = await seeded.owner.mutation((api as any).teams.create, {
      name: "Sales Team",
      members: [
        { memberId: seeded.leadMemberId, teamRole: "lead" },
        { memberId: seeded.agentMemberId, teamRole: "member" },
      ],
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("conversations", {
        tenantId: seeded.tenantId,
        phoneNumberId: seeded.phoneNumberId,
        contactId: seeded.teamContactId,
        assignedTeamId: teamId,
        status: "open",
        lastMessageAt: Date.now(),
        unreadCount: 1,
        tags: [],
      });
      await ctx.db.insert("conversations", {
        tenantId: seeded.tenantId,
        phoneNumberId: seeded.phoneNumberId,
        contactId: seeded.directContactId,
        assignedTeamId: teamId,
        assignedAgentId: seeded.agentMemberId,
        status: "open",
        lastMessageAt: Date.now() + 1,
        unreadCount: 0,
        tags: [],
      });
    });

    const ownerRows = await seeded.owner.query(api.conversations.listOpen, { limit: 20 });
    const leadRows = await seeded.lead.query(api.conversations.listOpen, { limit: 20 });
    const agentRows = await seeded.agent.query(api.conversations.listOpen, { limit: 20 });
    const outsiderRows = await seeded.outsider.query(api.conversations.listOpen, { limit: 20 });

    expect(ownerRows.map((row) => row.contactName).sort()).toEqual([
      "Direct Owner",
      "Team Queue",
    ]);
    expect(leadRows.map((row) => row.contactName).sort()).toEqual([
      "Direct Owner",
      "Team Queue",
    ]);
    expect(agentRows.map((row) => row.contactName).sort()).toEqual([
      "Direct Owner",
      "Team Queue",
    ]);
    expect(outsiderRows).toHaveLength(0);
  });

  it("assigns a conversation to a team queue and optionally to a member", async () => {
    const t = convexTest(schema);
    const seeded = await seedTeamWorkspace(t);
    const teamId = await seeded.owner.mutation((api as any).teams.create, {
      name: "Sales Team",
      members: [
        { memberId: seeded.leadMemberId, teamRole: "lead" },
        { memberId: seeded.agentMemberId, teamRole: "member" },
      ],
    });
    const conversationId = await t.run(async (ctx) => {
      return await ctx.db.insert("conversations", {
        tenantId: seeded.tenantId,
        phoneNumberId: seeded.phoneNumberId,
        contactId: seeded.teamContactId,
        status: "open",
        lastMessageAt: Date.now(),
        unreadCount: 1,
        tags: [],
      });
    });

    await seeded.owner.mutation((api as any).conversations.assignTeam, {
      conversationId,
      teamId,
    });
    await seeded.owner.mutation((api as any).conversations.assignAgent, {
      conversationId,
      memberId: seeded.agentMemberId,
    });

    const row = await seeded.owner.query(api.conversations.getById, {
      conversationId,
    });
    expect(row).toMatchObject({
      assignedTeamId: teamId,
      assignedTeamName: "Sales Team",
      assignedAgentId: seeded.agentMemberId,
      assignedAgentName: "Agent",
    });
  });
});
