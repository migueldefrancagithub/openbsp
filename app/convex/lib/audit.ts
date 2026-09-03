import type { Id } from "../_generated/dataModel";
import { sha256Hex } from "./idempotency";

export type AuditActorKind = "member" | "ai" | "system";

export type WriteAuditArgs = {
  action: string;
  targetType: string;
  targetId: string;
  payload?: unknown;
  /** Defaults to the acting member; automation passes the publishing member. */
  actorMemberId?: Id<"members">;
  actorKind?: AuditActorKind;
  /** Role of the actor at write time; recorded in the hash-chained log. */
  actorRole?: string;
  now?: number;
};

/** Stable JSON: sorted keys, no undefined, so hashes are reproducible. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const inner = (value as Record<string, unknown>)[key];
      if (inner !== undefined) out[key] = sortValue(inner);
    }
    return out;
  }
  return value;
}

export type ChainedAuditRow = {
  tenantId: Id<"tenants">;
  actorType: "member" | "system" | "scheduler" | "api_key";
  actorId: string;
  actorRoleSnapshot?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
  prevHash: string;
  createdAt: number;
};

export const GENESIS_HASH = "genesis";

/** The hash covers everything except `selfHash` itself. */
export async function hashAuditRow(row: ChainedAuditRow): Promise<string> {
  return await sha256Hex(canonicalJson(row));
}

/**
 * Append-only, hash-chained audit log (CLAUDE.md principle 6). Each row's
 * `selfHash` covers its content plus the previous row's `selfHash`, so any
 * edit or deletion breaks the chain (`audit.verifyChain`). Only ever inserts.
 */
export async function appendAuditInTx(
  ctx: { db: any },
  args: Omit<ChainedAuditRow, "prevHash" | "createdAt"> & { now?: number },
): Promise<Id<"auditLog">> {
  const last = await ctx.db
    .query("auditLog")
    .withIndex("by_tenant_created", (q: any) => q.eq("tenantId", args.tenantId))
    .order("desc")
    .first();
  const { now, ...rest } = args;
  const row: ChainedAuditRow = {
    ...rest,
    prevHash: last?.selfHash ?? GENESIS_HASH,
    createdAt: now ?? Date.now(),
  };
  const selfHash = await hashAuditRow(row);
  return await ctx.db.insert("auditLog", { ...row, selfHash });
}

/**
 * Single seam for operational audit writes. Two sinks: `clinicAuditEvents`
 * (queryable by target — thread history, Operação panel) and the hash-chained
 * `auditLog` (tamper-evident export). Callers never touch either directly.
 */
export async function writeAudit(
  ctx: { db: any; tenantId: Id<"tenants">; memberId: Id<"members">; role?: string },
  args: WriteAuditArgs,
): Promise<Id<"clinicAuditEvents">> {
  const now = args.now ?? Date.now();
  const actorMemberId = args.actorMemberId ?? ctx.memberId;
  const actorKind = args.actorKind ?? "member";
  const eventId = await ctx.db.insert("clinicAuditEvents", {
    tenantId: ctx.tenantId,
    actorMemberId,
    actorKind,
    action: args.action,
    targetType: args.targetType,
    targetId: args.targetId,
    payload: args.payload,
    createdAt: now,
  });
  await appendAuditInTx(ctx, {
    tenantId: ctx.tenantId,
    actorType: actorKind === "member" ? "member" : "system",
    actorId: String(actorMemberId),
    actorRoleSnapshot: args.actorRole ?? ctx.role,
    action: args.action,
    targetType: args.targetType,
    targetId: args.targetId,
    metadata: args.payload === undefined ? undefined : { payload: args.payload, eventId },
    now,
  });
  return eventId;
}
