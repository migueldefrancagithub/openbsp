import type { Doc, Id } from "../_generated/dataModel";
import { recordThreadSystemEvent } from "./channels/systemEvents";

/**
 * Who should own a thread. Manual choices come from the inbox; rules pick a
 * member of a team for brand-new inbound conversations (round-robin or
 * fewest open threads, optionally only members online right now).
 */
export type AssignmentStrategy = "manual" | "round_robin" | "least_open";

export type AssignmentInput = {
  requestedMemberId?: Id<"members">;
  requestedTeamId?: Id<"teams">;
  clearMember?: boolean;
  clearTeam?: boolean;
};

export type AssignmentDecision = {
  strategy: AssignmentStrategy;
  responsibleMemberId?: Id<"members"> | null;
  assignedTeamId?: Id<"teams"> | null;
};

export function resolveAssignment(input: AssignmentInput): AssignmentDecision {
  return {
    strategy: "manual",
    responsibleMemberId: input.clearMember ? null : input.requestedMemberId,
    assignedTeamId: input.clearTeam ? null : input.requestedTeamId,
  };
}

export const PRESENCE_ONLINE_MS = 90_000;
export const PRESENCE_AWAY_MS = 10 * 60_000;
const MAX_RULES = 20;
const MAX_TEAM_MEMBERS = 50;
const OPEN_THREAD_SAMPLE = 25;

export type PresenceStatus = "online" | "away" | "offline";

export function presenceStatus(
  row: { lastSeenAt: number; manualStatus?: "available" | "away" } | null | undefined,
  now: number,
): PresenceStatus {
  if (!row) return "offline";
  if (now - row.lastSeenAt > PRESENCE_AWAY_MS) return "offline";
  if (row.manualStatus === "away") return "away";
  return now - row.lastSeenAt <= PRESENCE_ONLINE_MS ? "online" : "away";
}

async function candidateMembers(
  ctx: { db: any },
  rule: Doc<"assignmentRules">,
  now: number,
): Promise<Doc<"members">[]> {
  const memberships = (await ctx.db
    .query("teamMembers")
    .withIndex("by_team", (q: any) => q.eq("teamId", rule.teamId))
    .take(MAX_TEAM_MEMBERS)) as Doc<"teamMembers">[];
  const out: Doc<"members">[] = [];
  for (const membership of memberships) {
    const member = (await ctx.db.get(membership.memberId)) as Doc<"members"> | null;
    if (!member || member.status !== "active" || member.tenantId !== rule.tenantId) continue;
    if (rule.onlyOnline) {
      const presence = (await ctx.db
        .query("presence")
        .withIndex("by_tenant_member", (q: any) => q.eq("tenantId", rule.tenantId).eq("memberId", member._id))
        .unique()) as Doc<"presence"> | null;
      if (presenceStatus(presence, now) !== "online") continue;
    }
    out.push(member);
  }
  return out.sort((a, b) => a._creationTime - b._creationTime);
}

async function openThreadCount(ctx: { db: any }, member: Doc<"members">): Promise<number> {
  const rows = (await ctx.db
    .query("channelThreads")
    .withIndex("by_tenant_responsible", (q: any) =>
      q.eq("tenantId", member.tenantId).eq("responsibleMemberId", member._id),
    )
    .order("desc")
    .take(OPEN_THREAD_SAMPLE)) as Doc<"channelThreads">[];
  return rows.filter((row) => !row.closedAt).length;
}

export function pickRoundRobin(
  candidates: Doc<"members">[],
  lastAssigned: Id<"members"> | undefined,
): Doc<"members"> | null {
  if (candidates.length === 0) return null;
  const index = lastAssigned ? candidates.findIndex((m) => m._id === lastAssigned) : -1;
  return candidates[(index + 1) % candidates.length];
}

/**
 * Apply the first matching active rule to a freshly created inbound thread.
 * Bounded reads: ≤20 rules, ≤50 memberships (+1 presence each when
 * onlyOnline, +1 open-thread sample each for least_open).
 */
export async function autoAssignThread(
  ctx: { db: any },
  args: { thread: Doc<"channelThreads">; now: number },
): Promise<Id<"members"> | null> {
  const { thread, now } = args;
  if (thread.responsibleMemberId) return null;
  const rules = (await ctx.db
    .query("assignmentRules")
    .withIndex("by_tenant_active", (q: any) => q.eq("tenantId", thread.tenantId).eq("active", true))
    .take(MAX_RULES)) as Doc<"assignmentRules">[];
  for (const rule of rules) {
    if (rule.channelId && rule.channelId !== thread.channelId) continue;
    if (rule.leadStatuses && rule.leadStatuses.length > 0 && !rule.leadStatuses.includes(thread.leadStatus ?? "new")) continue;
    const candidates = await candidateMembers(ctx, rule, now);
    if (candidates.length === 0) continue;
    let chosen: Doc<"members"> | null = null;
    if (rule.strategy === "least_open") {
      let best = Number.POSITIVE_INFINITY;
      for (const candidate of candidates) {
        const count = await openThreadCount(ctx, candidate);
        if (count < best) {
          best = count;
          chosen = candidate;
        }
      }
    } else {
      chosen = pickRoundRobin(candidates, rule.lastAssignedMemberId);
    }
    if (!chosen) continue;
    await ctx.db.patch(thread._id, {
      responsibleMemberId: chosen._id,
      assignedTeamId: thread.assignedTeamId ?? rule.teamId,
      assignedBy: "rule",
      assignmentRuleId: rule._id,
      updatedAt: now,
    });
    await ctx.db.patch(rule._id, {
      lastAssignedMemberId: chosen._id,
      assignedCount: (rule.assignedCount ?? 0) + 1,
      updatedAt: now,
    });
    await recordThreadSystemEvent(ctx, {
      thread,
      kind: "inbox.assigned",
      severity: "info",
      actorType: "system",
      payload: { memberId: chosen._id, ruleId: rule._id, ruleName: rule.name, strategy: rule.strategy },
      dedupeKey: `assign:${thread._id}:rule:${rule._id}`,
      now,
    });
    return chosen._id;
  }
  return null;
}
