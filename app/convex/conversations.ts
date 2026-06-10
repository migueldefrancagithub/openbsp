import { ConvexError, v } from "convex/values";
import { internalMutation } from "./_generated/server";
import {
  tenantMutation,
  tenantQuery,
  loadByIdInTenant,
  requireCapability,
} from "./lib/customFunctions";
import {
  applyAiTransition,
  assertCanMakeAiEligible,
  recordAiAuditEvent,
  shouldPauseAiForOpportunityStatus,
  type AiState,
} from "./lib/aiControl";
import { DEFAULT_CURRENCY, normalizeCurrency } from "./lib/money";
import type { Id } from "./_generated/dataModel";

const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

const opportunityStatusValidator = v.union(
  v.literal("new"),
  v.literal("contacted"),
  v.literal("replied"),
  v.literal("opportunity"),
  v.literal("booked"),
  v.literal("lost"),
);

const aiStateValidator = v.union(
  v.literal("eligible"),
  v.literal("paused"),
  v.literal("disabled"),
);

/**
 * Find an open conversation for (tenant, phoneNumber, contact) or create.
 * Called by webhook processor on inbound; updates lastIncomingAt and the
 * 24h service window expiry.
 */
export const upsertForInbound = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    phoneNumberId: v.id("phoneNumbers"),
    contactId: v.id("contacts"),
    incomingAt: v.number(),
  },
  returns: v.id("conversations"),
  handler: async (ctx, args): Promise<Id<"conversations">> => {
    const existing = await ctx.db
      .query("conversations")
      .withIndex("by_tenant_phone_contact", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("phoneNumberId", args.phoneNumberId)
          .eq("contactId", args.contactId),
      )
      .filter((q) => q.neq(q.field("status"), "closed"))
      .first();

    const expiresAt = args.incomingAt + SERVICE_WINDOW_MS;

    if (existing) {
      await ctx.db.patch(existing._id, {
        lastMessageAt: args.incomingAt,
        lastIncomingAt: args.incomingAt,
        serviceWindowExpiresAt: expiresAt,
        unreadCount: existing.unreadCount + 1,
        status: existing.status === "snoozed" ? "open" : existing.status,
      });
      return existing._id;
    }

    return await ctx.db.insert("conversations", {
      tenantId: args.tenantId,
      phoneNumberId: args.phoneNumberId,
      contactId: args.contactId,
      status: "open",
      lastMessageAt: args.incomingAt,
      lastIncomingAt: args.incomingAt,
      serviceWindowExpiresAt: expiresAt,
      unreadCount: 1,
      tags: [],
    });
  },
});

/**
 * Reactive list of open conversations in the tenant, ordered by recency.
 */
export const listOpen = tenantQuery({
  args: { limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      _id: v.id("conversations"),
      contactId: v.id("contacts"),
      contactName: v.optional(v.string()),
      contactE164: v.string(),
      lastMessageAt: v.number(),
      lastIncomingAt: v.optional(v.number()),
      serviceWindowExpiresAt: v.optional(v.number()),
      unreadCount: v.number(),
      status: v.string(),
      assignedTeamId: v.optional(v.id("teams")),
      assignedTeamName: v.optional(v.string()),
      assignedAgentId: v.optional(v.id("members")),
      assignedAgentName: v.optional(v.string()),
      leadSource: v.optional(v.string()),
      opportunityStatus: v.optional(v.string()),
      aiState: v.optional(v.string()),
      aiPausedReason: v.optional(v.string()),
      lastCtwaClickAt: v.optional(v.number()),
      opportunityValueMinor: v.optional(v.number()),
      opportunityCurrency: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 50, 200);
    const access = await buildConversationAccess(ctx);
    const rows = await ctx.db
      .query("conversations")
      .withIndex("by_tenant_lastmsg", (q) => q.eq("tenantId", ctx.tenantId))
      .order("desc")
      .take(Math.max(limit * 3, limit));
    const out = [];
    for (const c of rows) {
      if (c.status === "closed") continue;
      if (!canReadConversation(ctx, access, c)) continue;
      const contact = await ctx.db.get(c.contactId);
      const assignment = await describeAssignment(ctx, c);
      out.push({
        _id: c._id,
        contactId: c.contactId,
        contactName: contact?.name,
        contactE164: contact?.e164 ?? "",
        lastMessageAt: c.lastMessageAt,
        lastIncomingAt: c.lastIncomingAt,
        serviceWindowExpiresAt: c.serviceWindowExpiresAt,
        unreadCount: c.unreadCount,
        status: c.status,
        assignedTeamId: c.assignedTeamId,
        assignedTeamName: assignment.teamName,
        assignedAgentId: c.assignedAgentId,
        assignedAgentName: assignment.agentName,
        leadSource: c.leadSource,
        opportunityStatus: c.opportunityStatus,
        aiState: c.aiState,
        aiPausedReason: c.aiPausedReason,
        lastCtwaClickAt: c.lastCtwaClickAt,
        opportunityValueMinor: c.opportunityValueMinor,
        opportunityCurrency: c.opportunityCurrency,
      });
      if (out.length >= limit) break;
    }
    return out;
  },
});

/**
 * Reactive single conversation lookup with tenant fence.
 */
export const getById = tenantQuery({
  args: { conversationId: v.id("conversations") },
  returns: v.union(
    v.object({
      _id: v.id("conversations"),
      contactId: v.id("contacts"),
      contactName: v.optional(v.string()),
      contactE164: v.string(),
      lastMessageAt: v.number(),
      serviceWindowExpiresAt: v.optional(v.number()),
      unreadCount: v.number(),
      status: v.string(),
      assignedTeamId: v.optional(v.id("teams")),
      assignedTeamName: v.optional(v.string()),
      assignedAgentId: v.optional(v.id("members")),
      assignedAgentName: v.optional(v.string()),
      leadSource: v.optional(v.string()),
      opportunityStatus: v.optional(v.string()),
      aiState: v.optional(v.string()),
      aiPausedReason: v.optional(v.string()),
      lastCtwaClickAt: v.optional(v.number()),
      opportunityValueMinor: v.optional(v.number()),
      opportunityCurrency: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const c = await loadByIdInTenant(
      ctx as Parameters<typeof loadByIdInTenant>[0],
      "conversations",
      args.conversationId,
    );
    const access = await buildConversationAccess(ctx);
    if (!canReadConversation(ctx, access, c)) return null;
    const contact = await ctx.db.get(c.contactId);
    const assignment = await describeAssignment(ctx, c);
    return {
      _id: c._id,
      contactId: c.contactId,
      contactName: contact?.name,
      contactE164: contact?.e164 ?? "",
      lastMessageAt: c.lastMessageAt,
      serviceWindowExpiresAt: c.serviceWindowExpiresAt,
      unreadCount: c.unreadCount,
      status: c.status,
      assignedTeamId: c.assignedTeamId,
      assignedTeamName: assignment.teamName,
      assignedAgentId: c.assignedAgentId,
      assignedAgentName: assignment.agentName,
      leadSource: c.leadSource,
      opportunityStatus: c.opportunityStatus,
      aiState: c.aiState,
      aiPausedReason: c.aiPausedReason,
      lastCtwaClickAt: c.lastCtwaClickAt,
      opportunityValueMinor: c.opportunityValueMinor,
      opportunityCurrency: c.opportunityCurrency,
    };
  },
});

export const setOpportunityStatus = tenantMutation({
  args: {
    conversationId: v.id("conversations"),
    status: opportunityStatusValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const conversation = await loadByIdInTenant(
      ctx as Parameters<typeof loadByIdInTenant>[0],
      "conversations",
      args.conversationId,
    );
    await ctx.db.patch(args.conversationId, { opportunityStatus: args.status });
    if (
      shouldPauseAiForOpportunityStatus(args.status) &&
      conversation.aiState !== "disabled"
    ) {
      await applyAiTransition(ctx, {
        tenantId: ctx.tenantId,
        conversation: {
          ...conversation,
          opportunityStatus: args.status,
        },
        state: "paused",
        reason: args.status,
        payload: {
          previousOpportunityStatus: conversation.opportunityStatus,
          nextOpportunityStatus: args.status,
        },
        createdBy: ctx.memberId,
      });
    }
    return null;
  },
});

export const assignTeam = tenantMutation({
  args: {
    conversationId: v.id("conversations"),
    teamId: v.id("teams"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "conversations.assign_other");
    await loadByIdInTenant(
      ctx as Parameters<typeof loadByIdInTenant>[0],
      "conversations",
      args.conversationId,
    );
    await loadByIdInTenant(
      ctx as Parameters<typeof loadByIdInTenant>[0],
      "teams",
      args.teamId,
    );
    await ctx.db.patch(args.conversationId, {
      assignedTeamId: args.teamId,
    });
    return null;
  },
});

export const assignAgent = tenantMutation({
  args: {
    conversationId: v.id("conversations"),
    memberId: v.id("members"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "conversations.assign_other");
    const conversation = await loadByIdInTenant(
      ctx as Parameters<typeof loadByIdInTenant>[0],
      "conversations",
      args.conversationId,
    );
    const member = await loadByIdInTenant(
      ctx as Parameters<typeof loadByIdInTenant>[0],
      "members",
      args.memberId,
    );
    if (member.status !== "active") {
      throw new ConvexError({ code: "MEMBER_NOT_ACTIVE" });
    }
    const assignedTeamId = conversation.assignedTeamId;
    if (assignedTeamId) {
      const teamMember = await ctx.db
        .query("teamMembers")
        .withIndex("by_team_member", (q) =>
          q.eq("teamId", assignedTeamId).eq("memberId", args.memberId),
        )
        .unique();
      if (!teamMember) {
        throw new ConvexError({ code: "MEMBER_NOT_IN_TEAM" });
      }
    }
    await ctx.db.patch(args.conversationId, {
      assignedAgentId: args.memberId,
    });
    return null;
  },
});

export const setAiState = tenantMutation({
  args: {
    conversationId: v.id("conversations"),
    state: aiStateValidator,
    reason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const conversation = await loadByIdInTenant(
      ctx as Parameters<typeof loadByIdInTenant>[0],
      "conversations",
      args.conversationId,
    );
    if (args.state === "eligible") {
      assertCanMakeAiEligible(conversation);
    }
    await ctx.db.patch(args.conversationId, {
      aiState: args.state as AiState,
      aiPausedReason:
        args.state === "paused" ? args.reason ?? "manual_pause" : undefined,
    });
    await recordAiAuditEvent(ctx, {
      tenantId: ctx.tenantId,
      conversation,
      kind:
        args.state === "eligible"
          ? "eligible"
          : args.state === "paused"
            ? "paused"
            : "blocked",
      reason:
        args.reason ??
        (args.state === "eligible"
          ? "manual_enable"
          : args.state === "paused"
            ? "manual_pause"
            : "manual_disable"),
      createdBy: ctx.memberId,
    });
    return null;
  },
});

export const setOpportunityValue = tenantMutation({
  args: {
    conversationId: v.id("conversations"),
    valueMinor: v.number(),
    currency: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await loadByIdInTenant(
      ctx as Parameters<typeof loadByIdInTenant>[0],
      "conversations",
      args.conversationId,
    );
    await ctx.db.patch(args.conversationId, {
      opportunityValueMinor: Math.max(0, Math.round(args.valueMinor)),
      opportunityCurrency: normalizeCurrency(args.currency ?? DEFAULT_CURRENCY),
    });
    return null;
  },
});

type ConversationAccess = {
  teamIds: Set<string>;
  leadTeamIds: Set<string>;
  leadMemberIds: Set<string>;
};

async function buildConversationAccess(ctx: {
  db: any;
  tenantId: Id<"tenants">;
  memberId: Id<"members">;
  role: string;
}): Promise<ConversationAccess> {
  if (ctx.role === "owner" || ctx.role === "admin") {
    return {
      teamIds: new Set(["*"]),
      leadTeamIds: new Set(["*"]),
      leadMemberIds: new Set(["*"]),
    };
  }

  const memberships = await ctx.db
    .query("teamMembers")
    .withIndex("by_member", (q: any) =>
      q.eq("tenantId", ctx.tenantId).eq("memberId", ctx.memberId),
    )
    .collect();
  const teamIds = new Set<string>();
  const leadTeamIds = new Set<string>();
  const leadMemberIds = new Set<string>();

  for (const membership of memberships) {
    teamIds.add(membership.teamId);
    if (membership.teamRole === "lead") {
      leadTeamIds.add(membership.teamId);
      const teammates = await ctx.db
        .query("teamMembers")
        .withIndex("by_team", (q: any) => q.eq("teamId", membership.teamId))
        .collect();
      for (const teammate of teammates) {
        leadMemberIds.add(teammate.memberId);
      }
    }
  }

  return { teamIds, leadTeamIds, leadMemberIds };
}

function canReadConversation(
  ctx: { memberId: Id<"members">; role: string },
  access: ConversationAccess,
  conversation: {
    assignedTeamId?: Id<"teams">;
    assignedAgentId?: Id<"members">;
  },
): boolean {
  if (ctx.role === "owner" || ctx.role === "admin") return true;
  if (conversation.assignedAgentId === ctx.memberId) return true;
  if (!conversation.assignedAgentId && !conversation.assignedTeamId) return true;
  if (
    conversation.assignedTeamId &&
    !conversation.assignedAgentId &&
    access.teamIds.has(conversation.assignedTeamId)
  ) {
    return true;
  }
  if (
    conversation.assignedTeamId &&
    access.leadTeamIds.has(conversation.assignedTeamId)
  ) {
    return true;
  }
  if (
    conversation.assignedAgentId &&
    access.leadMemberIds.has(conversation.assignedAgentId)
  ) {
    return true;
  }
  return false;
}

async function describeAssignment(
  ctx: { db: any; tenantId: Id<"tenants"> },
  conversation: {
    assignedTeamId?: Id<"teams">;
    assignedAgentId?: Id<"members">;
  },
): Promise<{ teamName?: string; agentName?: string }> {
  const team = conversation.assignedTeamId
    ? await ctx.db.get(conversation.assignedTeamId)
    : null;
  const member = conversation.assignedAgentId
    ? await ctx.db.get(conversation.assignedAgentId)
    : null;
  const user = member?.tenantId === ctx.tenantId ? await ctx.db.get(member.userId) : null;
  return {
    teamName: team?.tenantId === ctx.tenantId ? team.name : undefined,
    agentName:
      user?.name ??
      user?.email ??
      (member?.tenantId === ctx.tenantId ? member.role : undefined),
  };
}
