import { ConvexError, v } from "convex/values";
import { tenantMutation, tenantQuery } from "./lib/customFunctions";

const sendModeValidator = v.union(
  v.literal("disabled"),
  v.literal("allowlist"),
  v.literal("live"),
);

export const list = tenantQuery({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("channels"),
      publicId: v.string(),
      webhookUrl: v.optional(v.string()),
      kind: v.string(),
      provider: v.string(),
      externalAccountId: v.string(),
      displayName: v.string(),
      status: v.string(),
      sendMode: v.string(),
      outboundAllowlist: v.array(v.string()),
      lastHealthStatus: v.optional(v.string()),
      lastHealthDetail: v.optional(v.string()),
      lastHealthCheckAt: v.optional(v.number()),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const siteUrl = process.env.CONVEX_SITE_URL?.replace(/\/+$/, "");
    const rows = await ctx.db
      .query("channels")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .order("desc")
      .collect();
    return rows.map((row) => ({
      _id: row._id,
      publicId: row.publicId,
      webhookUrl: siteUrl
        ? `${siteUrl}/provider-webhook/leo-hub/${row.publicId}`
        : undefined,
      kind: row.kind,
      provider: row.provider,
      externalAccountId: row.externalAccountId,
      displayName: row.displayName,
      status: row.status,
      sendMode: row.sendMode,
      outboundAllowlist: row.outboundAllowlist,
      lastHealthStatus: row.lastHealthStatus,
      lastHealthDetail: row.lastHealthDetail,
      lastHealthCheckAt: row.lastHealthCheckAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  },
});

export const listRecentEvents = tenantQuery({
  args: { channelId: v.id("channels"), limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      _id: v.id("channelEvents"),
      eventKey: v.string(),
      providerEventId: v.optional(v.string()),
      eventKind: v.string(),
      direction: v.string(),
      actorProviderScopedId: v.optional(v.string()),
      threadKey: v.optional(v.string()),
      payload: v.any(),
      status: v.string(),
      receivedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const channel = await ctx.db.get(args.channelId);
    if (!channel || channel.tenantId !== ctx.tenantId) {
      throw new ConvexError({ code: "CHANNEL_NOT_FOUND" });
    }
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
    const rows = await ctx.db
      .query("channelEvents")
      .withIndex("by_channel_received", (q) =>
        q.eq("channelId", args.channelId),
      )
      .order("desc")
      .take(limit);
    return rows.map((row) => ({
      _id: row._id,
      eventKey: row.eventKey,
      providerEventId: row.providerEventId,
      eventKind: row.eventKind,
      direction: row.direction,
      actorProviderScopedId: row.actorProviderScopedId,
      threadKey: row.threadKey,
      payload: row.payload,
      status: row.status,
      receivedAt: row.receivedAt,
    }));
  },
});

export const listRecentOutbox = tenantQuery({
  args: { channelId: v.id("channels"), limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      _id: v.id("channelOutbox"),
      businessKey: v.string(),
      recipient: v.string(),
      messageKind: v.string(),
      status: v.string(),
      providerMessageId: v.optional(v.string()),
      failureReason: v.optional(v.string()),
      dispatchAttempts: v.number(),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const channel = await ctx.db.get(args.channelId);
    if (!channel || channel.tenantId !== ctx.tenantId) {
      throw new ConvexError({ code: "CHANNEL_NOT_FOUND" });
    }
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
    const rows = await ctx.db
      .query("channelOutbox")
      .withIndex("by_channel_created", (q) =>
        q.eq("channelId", args.channelId),
      )
      .order("desc")
      .take(limit);
    return rows.map((row) => ({
      _id: row._id,
      businessKey: row.businessKey,
      recipient: row.recipient,
      messageKind: row.messageKind,
      status: row.status,
      providerMessageId: row.providerMessageId,
      failureReason: row.failureReason,
      dispatchAttempts: row.dispatchAttempts,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  },
});

export const listThreads = tenantQuery({
  args: { channelId: v.id("channels"), limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      _id: v.id("channelThreads"),
      threadKey: v.string(),
      displayName: v.optional(v.string()),
      username: v.optional(v.string()),
      phone: v.optional(v.string()),
      lastEventAt: v.number(),
      lastEventKind: v.string(),
      lastInboundAt: v.optional(v.number()),
      lastOutboundAt: v.optional(v.number()),
      lastPreview: v.optional(v.string()),
      unreadCount: v.number(),
      serviceWindowExpiresAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    const channel = await ctx.db.get(args.channelId);
    if (!channel || channel.tenantId !== ctx.tenantId) {
      throw new ConvexError({ code: "CHANNEL_NOT_FOUND" });
    }
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
    const rows = await ctx.db
      .query("channelThreads")
      .withIndex("by_channel_last_event", (q) =>
        q.eq("channelId", args.channelId),
      )
      .order("desc")
      .take(limit);
    return await Promise.all(
      rows.map(async (row) => {
        const identity = row.identityId
          ? await ctx.db.get(row.identityId)
          : null;
        return {
          _id: row._id,
          threadKey: row.threadKey,
          displayName: identity?.displayName,
          username: identity?.username,
          phone: identity?.phone,
          lastEventAt: row.lastEventAt,
          lastEventKind: row.lastEventKind,
          lastInboundAt: row.lastInboundAt,
          lastOutboundAt: row.lastOutboundAt,
          lastPreview: row.lastPreview,
          unreadCount: row.unreadCount,
          serviceWindowExpiresAt: row.serviceWindowExpiresAt,
        };
      }),
    );
  },
});

export const listThreadEvents = tenantQuery({
  args: {
    channelId: v.id("channels"),
    threadKey: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("channelEvents"),
      eventKey: v.string(),
      providerEventId: v.optional(v.string()),
      eventKind: v.string(),
      direction: v.string(),
      actorProviderScopedId: v.optional(v.string()),
      threadKey: v.optional(v.string()),
      payload: v.any(),
      status: v.string(),
      receivedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const channel = await ctx.db.get(args.channelId);
    if (!channel || channel.tenantId !== ctx.tenantId) {
      throw new ConvexError({ code: "CHANNEL_NOT_FOUND" });
    }
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
    const rows = await ctx.db
      .query("channelEvents")
      .withIndex("by_channel_thread", (q) =>
        q.eq("channelId", args.channelId).eq("threadKey", args.threadKey),
      )
      .order("desc")
      .take(limit);
    return rows.map((row) => ({
      _id: row._id,
      eventKey: row.eventKey,
      providerEventId: row.providerEventId,
      eventKind: row.eventKind,
      direction: row.direction,
      actorProviderScopedId: row.actorProviderScopedId,
      threadKey: row.threadKey,
      payload: row.payload,
      status: row.status,
      receivedAt: row.receivedAt,
    }));
  },
});

export const setSendMode = tenantMutation({
  args: { channelId: v.id("channels"), sendMode: sendModeValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (ctx.role !== "owner" && ctx.role !== "admin") {
      throw new ConvexError({ code: "FORBIDDEN" });
    }
    const channel = await ctx.db.get(args.channelId);
    if (!channel || channel.tenantId !== ctx.tenantId) {
      throw new ConvexError({ code: "CHANNEL_NOT_FOUND" });
    }
    if (channel.provider === "lab_bridge" && args.sendMode === "live") {
      throw new ConvexError({
        code: "LAB_LIVE_MODE_FORBIDDEN",
        message: "Laboratory bridges can only be disabled or allowlisted.",
      });
    }
    await ctx.db.patch(channel._id, {
      sendMode: args.sendMode,
      updatedAt: Date.now(),
    });
    return null;
  },
});
