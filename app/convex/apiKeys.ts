import { v, ConvexError } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  action,
} from "./_generated/server";
import { internal } from "./_generated/api";
import {
  tenantQuery,
  tenantMutation,
  loadByIdInTenant,
} from "./lib/customFunctions";
import type { Id } from "./_generated/dataModel";

const TOKEN_PREFIX = "obsp_";
const TOKEN_BYTES = 32;

const roleValidator = v.union(
  v.literal("owner"),
  v.literal("admin"),
  v.literal("agent"),
  v.literal("marketing"),
);

/**
 * Encode bytes as URL-safe base64 without padding.
 */
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

// ---------- Queries ----------

export const list = tenantQuery({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("apiKeys"),
      name: v.string(),
      keyPreview: v.string(),
      role: v.string(),
      createdAt: v.number(),
      revokedAt: v.optional(v.number()),
      lastUsedAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("apiKeys")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .order("desc")
      .collect();
    return rows.map((r) => ({
      _id: r._id,
      name: r.name,
      keyPreview: r.keyPreview,
      role: r.role,
      createdAt: r.createdAt,
      revokedAt: r.revokedAt,
      lastUsedAt: r.lastUsedAt,
    }));
  },
});

// ---------- Internal helpers for create action ----------

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
    const { getAuthUserId } = await import("@convex-dev/auth/server");
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

export const _insertKey = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    memberId: v.id("members"),
    name: v.string(),
    role: roleValidator,
    keyHash: v.string(),
    keyPreview: v.string(),
  },
  returns: v.id("apiKeys"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("apiKeys", {
      tenantId: args.tenantId,
      name: args.name,
      keyHash: args.keyHash,
      keyPreview: args.keyPreview,
      role: args.role,
      createdBy: args.memberId,
      createdAt: Date.now(),
    });
  },
});

// ---------- Public action: mint (returns plaintext once) ----------

/**
 * Mint a new API key. Returns the plaintext token ONCE — store it on the
 * client; we only persist its SHA-256 hash. Per wakit-api parity.
 */
export const mint = action({
  args: { name: v.string(), role: roleValidator },
  returns: v.object({
    apiKeyId: v.id("apiKeys"),
    plaintextToken: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    apiKeyId: Id<"apiKeys">;
    plaintextToken: string;
  }> => {
    const me: {
      tenantId: Id<"tenants">;
      memberId: Id<"members">;
      role: string;
    } | null = await ctx.runQuery(internal.apiKeys._meTenant, {});
    if (!me) throw new ConvexError({ code: "UNAUTHENTICATED" });
    if (me.role !== "owner" && me.role !== "admin") {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only owner or admin can mint API keys.",
      });
    }
    const name = args.name.trim();
    if (name.length === 0 || name.length > 60) {
      throw new ConvexError({
        code: "INVALID_NAME",
        message: "Name must be 1-60 chars.",
      });
    }

    const buf = new Uint8Array(TOKEN_BYTES);
    crypto.getRandomValues(buf);
    const tokenBody = bytesToUrlBase64(buf);
    const plaintextToken = `${TOKEN_PREFIX}${tokenBody}`;
    const keyHash = await sha256Hex(plaintextToken);
    const keyPreview = `${TOKEN_PREFIX}…${tokenBody.slice(-6)}`;

    const apiKeyId: Id<"apiKeys"> = await ctx.runMutation(
      internal.apiKeys._insertKey,
      {
        tenantId: me.tenantId,
        memberId: me.memberId,
        name,
        role: args.role,
        keyHash,
        keyPreview,
      },
    );

    return { apiKeyId, plaintextToken };
  },
});

// ---------- Revoke ----------

export const revoke = tenantMutation({
  args: { apiKeyId: v.id("apiKeys") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const k = await loadByIdInTenant(
      ctx as Parameters<typeof loadByIdInTenant>[0],
      "apiKeys",
      args.apiKeyId,
    );
    if (k.revokedAt) return null;
    await ctx.db.patch(args.apiKeyId, { revokedAt: Date.now() });
    return null;
  },
});

// ---------- Internal: resolve token (used by future HTTP API) ----------

export const resolveToken = internalAction({
  args: { plaintextToken: v.string() },
  returns: v.union(
    v.object({
      apiKeyId: v.id("apiKeys"),
      tenantId: v.id("tenants"),
      role: v.string(),
    }),
    v.null(),
  ),
  handler: async (
    ctx,
    args,
  ): Promise<{
    apiKeyId: Id<"apiKeys">;
    tenantId: Id<"tenants">;
    role: string;
  } | null> => {
    if (!args.plaintextToken.startsWith(TOKEN_PREFIX)) return null;
    const hash = await sha256Hex(args.plaintextToken);
    return await ctx.runQuery(internal.apiKeys._lookupByHash, { hash });
  },
});

export const _touchLastUsed = internalMutation({
  args: { apiKeyId: v.id("apiKeys") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const k = await ctx.db.get(args.apiKeyId);
    if (!k || k.revokedAt) return null;
    await ctx.db.patch(args.apiKeyId, { lastUsedAt: Date.now() });
    return null;
  },
});

export const _lookupByHash = internalQuery({
  args: { hash: v.string() },
  returns: v.union(
    v.object({
      apiKeyId: v.id("apiKeys"),
      tenantId: v.id("tenants"),
      role: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const k = await ctx.db
      .query("apiKeys")
      .withIndex("by_hash", (q) => q.eq("keyHash", args.hash))
      .unique();
    if (!k || k.revokedAt) return null;
    return {
      apiKeyId: k._id,
      tenantId: k.tenantId,
      role: k.role,
    };
  },
});
