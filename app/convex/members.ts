import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { writeAudit } from "./lib/audit";
import {
  loadByIdInTenant,
  requireCapability,
  tenantMutation,
} from "./lib/customFunctions";
import type { Role } from "./lib/roles";

const roleValidator = v.union(
  v.literal("owner"),
  v.literal("admin"),
  v.literal("agent"),
  v.literal("marketing"),
);

async function activeOwners(ctx: { db: any; tenantId: Doc<"members">["tenantId"] }) {
  const rows = (await ctx.db
    .query("members")
    .withIndex("by_tenant_user", (q: any) => q.eq("tenantId", ctx.tenantId))
    .take(200)) as Doc<"members">[];
  return rows.filter((row) => row.role === "owner" && row.status === "active");
}

/**
 * Change a teammate's role. Owners are special: only an owner can grant or
 * revoke the owner role, nobody can change their own role, and the last
 * active owner can neither be demoted nor suspended.
 */
export const changeRole = tenantMutation({
  args: { memberId: v.id("members"), role: roleValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "members.change_role");
    if (args.memberId === ctx.memberId) {
      throw new ConvexError({ code: "CANNOT_CHANGE_OWN_ROLE" });
    }
    const member = await loadByIdInTenant(ctx, "members", args.memberId);
    if ((args.role === "owner" || member.role === "owner") && ctx.role !== "owner") {
      throw new ConvexError({ code: "OWNER_ROLE_RESTRICTED" });
    }
    if (member.role === "owner" && args.role !== "owner") {
      const owners = await activeOwners(ctx);
      if (owners.length <= 1) throw new ConvexError({ code: "LAST_OWNER" });
    }
    if (member.role === args.role) return null;
    await ctx.db.patch(member._id, { role: args.role as Role });
    await writeAudit(ctx, {
      action: "members.role_changed",
      targetType: "member",
      targetId: member._id,
      payload: { from: member.role, to: args.role },
    });
    return null;
  },
});

export const setStatus = tenantMutation({
  args: {
    memberId: v.id("members"),
    status: v.union(v.literal("active"), v.literal("suspended")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "members.remove");
    if (args.memberId === ctx.memberId) {
      throw new ConvexError({ code: "CANNOT_CHANGE_OWN_ROLE" });
    }
    const member = await loadByIdInTenant(ctx, "members", args.memberId);
    if (member.role === "owner" && ctx.role !== "owner") {
      throw new ConvexError({ code: "OWNER_ROLE_RESTRICTED" });
    }
    if (args.status === "suspended" && member.role === "owner") {
      const owners = await activeOwners(ctx);
      if (owners.length <= 1) throw new ConvexError({ code: "LAST_OWNER" });
    }
    if (member.status === args.status) return null;
    await ctx.db.patch(member._id, { status: args.status });
    await writeAudit(ctx, {
      action: args.status === "suspended" ? "members.suspended" : "members.reactivated",
      targetType: "member",
      targetId: member._id,
    });
    return null;
  },
});

/** The caller's own UI language; read back by tenantsQueries.getActive*. */
export const setLocale = tenantMutation({
  args: { locale: v.union(v.literal("pt"), v.literal("en")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(ctx.memberId, { locale: args.locale });
    return null;
  },
});
