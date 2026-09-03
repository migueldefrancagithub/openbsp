/**
 * Who could take a conversation over right now.
 *
 * The rule is shared with routing on purpose: eligible means active, online and
 * below the load ceiling — the same three facts `autoAssignThread` uses. If the
 * hand-off notice counted people the router would never pick, the clinic would
 * promise what the system cannot deliver.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import { presenceStatus } from "../assignment";
import { roleAtLeast, type Role } from "../roles";
import type { TeamAvailability } from "./handoffNotice";

/** Open conversations one member can hold before they stop being eligible. */
export const DEFAULT_LOAD_CEILING = 8;

const MAX_MEMBERS = 60;

export async function teamAvailability(
  ctx: { db: any },
  tenantId: Id<"tenants">,
  now: number,
  loadCeiling: number = DEFAULT_LOAD_CEILING,
): Promise<TeamAvailability> {
  const members = (await ctx.db
    .query("members")
    .withIndex("by_tenant_user", (q: any) => q.eq("tenantId", tenantId))
    .take(MAX_MEMBERS)) as Doc<"members">[];
  // Marketing reads campaigns; it is not an input to routing, so it is not an
  // input to what we promise the patient either.
  const handlers = members.filter(
    (member) => member.status === "active" && roleAtLeast(member.role as Role, "agent"),
  );
  let available = 0;
  for (const member of handlers) {
    const presence = (await ctx.db
      .query("presence")
      .withIndex("by_tenant_member", (q: any) => q.eq("tenantId", tenantId).eq("memberId", member._id))
      .unique()) as Doc<"presence"> | null;
    if (presenceStatus(presence, now) !== "online") continue;
    const open = (await ctx.db
      .query("channelThreads")
      .withIndex("by_tenant_responsible", (q: any) =>
        q.eq("tenantId", tenantId).eq("responsibleMemberId", member._id),
      )
      .take(loadCeiling + 1)) as Doc<"channelThreads">[];
    const load = open.filter((thread) => !thread.closedAt).length;
    if (load >= loadCeiling) continue;
    available += 1;
  }
  return { available, total: handlers.length };
}
