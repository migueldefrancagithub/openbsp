import { ConvexError } from "convex/values";
import {
  customAction,
  customCtx,
  customMutation,
  customQuery,
} from "convex-helpers/server/customFunctions";
import { getAuthUserId } from "@convex-dev/auth/server";
import { action, mutation, query } from "../_generated/server";
import { internal } from "../_generated/api";
import type {
  DataModel,
  Doc,
  Id,
  TableNames,
} from "../_generated/dataModel";
import {
  hasCapability,
  roleAtLeast,
  type Capability,
  type Role,
} from "./roles";

type AnyReader = {
  db: {
    get<T extends TableNames>(id: Id<T>): Promise<Doc<T> | null>;
    query: unknown;
  };
};

export type ResolvedTenantContext = {
  userId: Id<"users">;
  memberId: Id<"members">;
  tenantId: Id<"tenants">;
  role: Role;
};

async function resolveActiveTenant(ctx: {
  auth: { getUserIdentity: () => Promise<unknown> };
  db: any;
}): Promise<ResolvedTenantContext> {
  const userId = (await getAuthUserId(ctx as never)) as Id<"users"> | null;
  if (!userId) {
    throw new ConvexError({ code: "UNAUTHENTICATED" });
  }
  const session = await ctx.db
    .query("sessions")
    .withIndex("by_user", (q: any) => q.eq("userId", userId))
    .unique();
  if (!session) {
    throw new ConvexError({ code: "NO_ACTIVE_TENANT" });
  }
  const member = await ctx.db
    .query("members")
    .withIndex("by_tenant_user", (q: any) =>
      q.eq("tenantId", session.activeTenantId).eq("userId", userId),
    )
    .unique();
  if (!member || member.status !== "active") {
    throw new ConvexError({ code: "FORBIDDEN" });
  }
  return {
    userId,
    memberId: member._id as Id<"members">,
    tenantId: session.activeTenantId as Id<"tenants">,
    role: member.role as Role,
  };
}

export const tenantQuery = customQuery(
  query,
  customCtx(async (ctx) => resolveActiveTenant(ctx as never)),
);

export const tenantMutation = customMutation(
  mutation,
  customCtx(async (ctx) => resolveActiveTenant(ctx as never)),
);

/**
 * Actions cannot touch `ctx.db`; they resolve the caller through
 * `me._tenantContext` and get the same `{ userId, memberId, tenantId, role }`
 * shape as queries/mutations. Replaces the per-file `_meTenant` copies.
 */
export const tenantAction = customAction(
  action,
  customCtx(async (ctx): Promise<ResolvedTenantContext> => {
    const me = await ctx.runQuery(internal.me._tenantContext, {});
    if (!me) throw new ConvexError({ code: "UNAUTHENTICATED" });
    return me;
  }),
);

export async function loadByIdInTenant<T extends TableNames>(
  ctx: AnyReader & { tenantId: Id<"tenants"> },
  _table: T,
  id: Id<T>,
): Promise<Doc<T>> {
  const doc = await ctx.db.get(id);
  if (!doc) {
    throw new ConvexError({ code: "NOT_FOUND" });
  }
  const tenantField = (doc as { tenantId?: Id<"tenants"> }).tenantId;
  if (!tenantField || tenantField !== ctx.tenantId) {
    throw new ConvexError({
      code: "CROSS_TENANT_ACCESS",
      table: _table,
      id,
    });
  }
  return doc;
}

export function requireRoleAtLeast(actual: Role, required: Role): void {
  if (!roleAtLeast(actual, required)) {
    throw new ConvexError({
      code: "FORBIDDEN",
      role: actual,
      required,
    });
  }
}

export function requireCapability(role: Role, capability: Capability): void {
  if (!hasCapability(role, capability)) {
    throw new ConvexError({
      code: "FORBIDDEN_CAPABILITY",
      capability,
      role,
    });
  }
}

export type { DataModel };
