import { v, ConvexError } from "convex/values";
import {
  internalMutation,
  internalQuery,
  action,
  mutation,
} from "./_generated/server";
import { internal } from "./_generated/api";
import {
  tenantQuery,
  tenantMutation,
  loadByIdInTenant,
} from "./lib/customFunctions";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "./_generated/dataModel";

const TOKEN_BYTES = 32;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const inviteRoleValidator = v.union(
  v.literal("admin"),
  v.literal("agent"),
  v.literal("marketing"),
);

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function bytesToUrlBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const view = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < view.length; i++) {
    hex += view[i].toString(16).padStart(2, "0");
  }
  return hex;
}

// ---------- Public: list invites + members ----------

export const list = tenantQuery({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("memberInvites"),
      email: v.string(),
      role: v.string(),
      status: v.string(),
      createdAt: v.number(),
      expiresAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("memberInvites")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .order("desc")
      .collect();
    const now = Date.now();
    return rows.map((r) => ({
      _id: r._id,
      email: r.email,
      role: r.role,
      status:
        r.status === "active" && r.expiresAt < now ? "expired" : r.status,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
    }));
  },
});

export const listMembers = tenantQuery({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("members"),
      userId: v.id("users"),
      role: v.string(),
      status: v.string(),
      createdAt: v.number(),
      email: v.optional(v.string()),
      name: v.optional(v.string()),
    }),
  ),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("members")
      .withIndex("by_tenant_user", (q) => q.eq("tenantId", ctx.tenantId))
      .collect();
    const out = [];
    for (const m of rows) {
      const u = await ctx.db.get(m.userId);
      out.push({
        _id: m._id,
        userId: m.userId,
        role: m.role,
        status: m.status,
        createdAt: m.createdAt,
        email: u?.email,
        name: u?.name,
      });
    }
    return out;
  },
});

// ---------- Internal for invite action ----------

export const _meTenant = internalQuery({
  args: {},
  returns: v.union(
    v.object({
      tenantId: v.id("tenants"),
      memberId: v.id("members"),
      role: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const userId = (await getAuthUserId(ctx)) as Id<"users"> | null;
    if (!userId) return null;
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!session) return null;
    const member = await ctx.db
      .query("members")
      .withIndex("by_tenant_user", (q) =>
        q.eq("tenantId", session.activeTenantId).eq("userId", userId),
      )
      .unique();
    if (!member || member.status !== "active") return null;
    return {
      tenantId: session.activeTenantId,
      memberId: member._id,
      role: member.role,
    };
  },
});

export const _insertInvite = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    invitedBy: v.id("members"),
    email: v.string(),
    role: inviteRoleValidator,
    tokenHash: v.string(),
  },
  returns: v.id("memberInvites"),
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("memberInvites", {
      tenantId: args.tenantId,
      email: args.email,
      role: args.role,
      tokenHash: args.tokenHash,
      invitedBy: args.invitedBy,
      status: "active",
      createdAt: now,
      expiresAt: now + INVITE_TTL_MS,
    });
  },
});

// ---------- Public action: create invite ----------

export const invite = action({
  args: { email: v.string(), role: inviteRoleValidator },
  returns: v.object({
    inviteId: v.id("memberInvites"),
    plaintextToken: v.string(),
    expiresAt: v.number(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    inviteId: Id<"memberInvites">;
    plaintextToken: string;
    expiresAt: number;
  }> => {
    const me: {
      tenantId: Id<"tenants">;
      memberId: Id<"members">;
      role: string;
    } | null = await ctx.runQuery(internal.memberInvites._meTenant, {});
    if (!me) throw new ConvexError({ code: "UNAUTHENTICATED" });
    if (me.role !== "owner" && me.role !== "admin") {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only owner or admin can invite members.",
      });
    }
    const email = args.email.trim().toLowerCase();
    if (!EMAIL_REGEX.test(email)) {
      throw new ConvexError({
        code: "INVALID_EMAIL",
        message: "Invalid email format.",
      });
    }

    const buf = new Uint8Array(TOKEN_BYTES);
    crypto.getRandomValues(buf);
    const plaintextToken = bytesToUrlBase64(buf);
    const tokenHash = await sha256Hex(plaintextToken);

    const inviteId: Id<"memberInvites"> = await ctx.runMutation(
      internal.memberInvites._insertInvite,
      {
        tenantId: me.tenantId,
        invitedBy: me.memberId,
        email,
        role: args.role,
        tokenHash,
      },
    );

    return {
      inviteId,
      plaintextToken,
      expiresAt: Date.now() + INVITE_TTL_MS,
    };
  },
});

// ---------- Revoke ----------

export const revoke = tenantMutation({
  args: { inviteId: v.id("memberInvites") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const inv = await loadByIdInTenant(
      ctx as Parameters<typeof loadByIdInTenant>[0],
      "memberInvites",
      args.inviteId,
    );
    if (inv.status !== "active") return null;
    await ctx.db.patch(args.inviteId, { status: "revoked" });
    return null;
  },
});

// ---------- Accept (called by invitee after signup) ----------

export const accept = mutation({
  args: { token: v.string() },
  returns: v.object({
    tenantId: v.id("tenants"),
    memberId: v.id("members"),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    tenantId: Id<"tenants">;
    memberId: Id<"members">;
  }> => {
    const userId = (await getAuthUserId(ctx)) as Id<"users"> | null;
    if (!userId) throw new ConvexError({ code: "UNAUTHENTICATED" });

    const tokenHash = await sha256Hex(args.token);
    const inv = await ctx.db
      .query("memberInvites")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (!inv) throw new ConvexError({ code: "INVITE_NOT_FOUND" });
    if (inv.status !== "active") {
      throw new ConvexError({ code: "INVITE_NOT_ACTIVE", status: inv.status });
    }
    if (inv.expiresAt < Date.now()) {
      await ctx.db.patch(inv._id, { status: "expired" });
      throw new ConvexError({ code: "INVITE_EXPIRED" });
    }

    // Reject if the user is already a member of this tenant.
    const existing = await ctx.db
      .query("members")
      .withIndex("by_tenant_user", (q) =>
        q.eq("tenantId", inv.tenantId).eq("userId", userId),
      )
      .unique();
    if (existing) {
      throw new ConvexError({
        code: "ALREADY_MEMBER",
        message: "You're already a member of this workspace.",
      });
    }

    const memberId = await ctx.db.insert("members", {
      tenantId: inv.tenantId,
      userId,
      role: inv.role,
      status: "active",
      createdAt: Date.now(),
    });

    await ctx.db.patch(inv._id, {
      status: "used",
      usedAt: Date.now(),
      usedByUserId: userId,
    });

    // Set active tenant for this user if they don't already have a session.
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (session) {
      await ctx.db.patch(session._id, {
        activeTenantId: inv.tenantId,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("sessions", {
        userId,
        activeTenantId: inv.tenantId,
        updatedAt: Date.now(),
      });
    }

    return { tenantId: inv.tenantId, memberId };
  },
});
