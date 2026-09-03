import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { tenantMutation, tenantQuery } from "./lib/customFunctions";
import { threadHasMessageEvent } from "./lib/channels/threadVisibility";

// Bounded scan: skip legacy status-only projections without unbounded reads.
const THREAD_LIST_PAGE_SIZE = 100;
const THREAD_LIST_MAX_PAGES = 10;

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
      operationalTerritory: v.optional(v.string()),
      externalAccountId: v.string(),
      displayName: v.string(),
      status: v.string(),
      sendMode: v.string(),
      outboundAllowlist: v.array(v.string()),
      connectionState: v.optional(v.string()),
      phoneNumber: v.optional(v.string()),
      wabaId: v.optional(v.string()),
      webhookStatus: v.optional(v.string()),
      credentialsConfiguredAt: v.optional(v.number()),
      lastWebhookAt: v.optional(v.number()),
      lastWebhookEventKind: v.optional(v.string()),
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
        ? row.provider === "iasolution_hub"
          ? `${siteUrl}/provider-webhook/iasolution-hub/${row.publicId}`
          : row.provider === "lab_bridge"
            ? `${siteUrl}/provider-webhook/leo-hub/${row.publicId}`
            : undefined
        : undefined,
      kind: row.kind,
      provider: row.provider,
      operationalTerritory: row.operationalTerritory,
      externalAccountId: row.externalAccountId,
      displayName: row.displayName,
      status: row.status,
      sendMode: row.sendMode,
      outboundAllowlist: row.outboundAllowlist,
      connectionState: row.connectionState,
      phoneNumber: row.phoneNumber,
      wabaId: row.wabaId,
      webhookStatus: row.webhookStatus,
      credentialsConfiguredAt: row.credentialsConfiguredAt,
      lastWebhookAt: row.lastWebhookAt,
      lastWebhookEventKind: row.lastWebhookEventKind,
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
      tags: v.optional(v.array(v.string())),
      leadSource: v.optional(v.string()),
      leadStatus: v.optional(v.string()),
      nextStep: v.optional(v.string()),
      nextStepDueAt: v.optional(v.number()),
      responsibleMemberId: v.optional(v.id("members")),
      assignedTeamId: v.optional(v.id("teams")),
      inboxStatus: v.optional(v.string()),
      starredAt: v.optional(v.number()),
      snoozedUntil: v.optional(v.number()),
      dnd: v.optional(v.boolean()),
      automationMode: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const channel = await ctx.db.get(args.channelId);
    if (!channel || channel.tenantId !== ctx.tenantId) {
      throw new ConvexError({ code: "CHANNEL_NOT_FOUND" });
    }
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
    const rows: Doc<"channelThreads">[] = [];
    let cursor: string | null = null;
    let pagesRead = 0;

    while (rows.length < limit && pagesRead < THREAD_LIST_MAX_PAGES) {
      const page = await ctx.db
        .query("channelThreads")
        .withIndex("by_channel_last_event", (q) =>
          q.eq("channelId", args.channelId),
        )
        .order("desc")
        .paginate({ cursor, numItems: THREAD_LIST_PAGE_SIZE });

      pagesRead += 1;
      for (const row of page.page) {
        if (await threadHasMessageEvent(ctx, row)) {
          rows.push(row);
          if (rows.length >= limit) break;
        }
      }

      if (page.isDone) break;
      cursor = page.continueCursor;
    }

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
          tags: row.tags,
          leadSource: row.leadSource,
          leadStatus: row.leadStatus,
          nextStep: row.nextStep,
          nextStepDueAt: row.nextStepDueAt,
          responsibleMemberId: row.responsibleMemberId,
          assignedTeamId: row.assignedTeamId,
          inboxStatus: row.inboxStatus,
          starredAt: row.starredAt,
          snoozedUntil: row.snoozedUntil,
          dnd: row.dnd,
          automationMode: row.automationMode,
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
      actorDisplayName: v.optional(v.string()),
      actorPhone: v.optional(v.string()),
      actorProviderScopedId: v.optional(v.string()),
      threadKey: v.optional(v.string()),
      payload: v.any(),
      status: v.string(),
      lastError: v.optional(v.string()),
      receivedAt: v.number(),
      providerTimestamp: v.optional(v.number()),
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
      actorDisplayName: row.actorDisplayName,
      actorPhone: row.actorPhone,
      actorProviderScopedId: row.actorProviderScopedId,
      threadKey: row.threadKey,
      payload: row.payload,
      status: row.status,
      lastError: row.lastError,
      receivedAt: row.receivedAt,
      providerTimestamp: row.providerTimestamp,
    }));
  },
});

export const getThread = tenantQuery({
  args: { channelId: v.id("channels"), threadKey: v.string() },
  returns: v.union(
    v.object({
      _id: v.id("channelThreads"),
      threadKey: v.string(),
      displayName: v.optional(v.string()),
      phone: v.optional(v.string()),
      lastEventAt: v.number(),
      lastInboundAt: v.optional(v.number()),
      lastOutboundAt: v.optional(v.number()),
      lastPreview: v.optional(v.string()),
      lastEventKind: v.string(),
      unreadCount: v.number(),
      serviceWindowExpiresAt: v.optional(v.number()),
      tags: v.optional(v.array(v.string())),
      leadSource: v.optional(v.string()),
      leadStatus: v.optional(v.string()),
      nextStep: v.optional(v.string()),
      nextStepDueAt: v.optional(v.number()),
      responsibleMemberId: v.optional(v.id("members")),
      assignedTeamId: v.optional(v.id("teams")),
      inboxStatus: v.optional(v.string()),
      starredAt: v.optional(v.number()),
      snoozedUntil: v.optional(v.number()),
      closedAt: v.optional(v.number()),
      dnd: v.optional(v.boolean()),
      automationMode: v.optional(v.string()),
      automationChangeReason: v.optional(v.string()),
      pilotBlockedAt: v.optional(v.number()),
      intent: v.optional(v.string()),
      intentSource: v.optional(v.string()),
      originCampaignId: v.optional(v.id("campaigns")),
      originCampaignName: v.optional(v.string()),
      customFields: v.optional(
        v.record(v.string(), v.union(v.string(), v.number(), v.boolean())),
      ),
      channelSendMode: v.string(),
      channelProvider: v.string(),
      channelDisplayName: v.string(),
      channelConnectionState: v.optional(v.string()),
      channelWebhookStatus: v.optional(v.string()),
      channelHealthStatus: v.optional(v.string()),
      recipientAllowlisted: v.boolean(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const channel = await ctx.db.get(args.channelId);
    if (!channel || channel.tenantId !== ctx.tenantId) {
      throw new ConvexError({ code: "CHANNEL_NOT_FOUND" });
    }
    const thread = await ctx.db
      .query("channelThreads")
      .withIndex("by_channel_thread", (q) =>
        q.eq("channelId", args.channelId).eq("threadKey", args.threadKey),
      )
      .unique();
    if (!thread) return null;
    if (!(await threadHasMessageEvent(ctx, thread))) return null;
    const identity = thread.identityId
      ? await ctx.db.get(thread.identityId)
      : null;
    const originCampaign = thread.originCampaignId
      ? await ctx.db.get(thread.originCampaignId)
      : null;
    // The allowlist itself stays server-side; the UI only needs the verdict.
    const recipient = identity?.phone ?? thread.threadKey;
    return {
      _id: thread._id,
      threadKey: thread.threadKey,
      displayName: identity?.displayName,
      phone: identity?.phone,
      lastEventAt: thread.lastEventAt,
      lastInboundAt: thread.lastInboundAt,
      lastOutboundAt: thread.lastOutboundAt,
      lastPreview: thread.lastPreview,
      lastEventKind: thread.lastEventKind,
      unreadCount: thread.unreadCount,
      serviceWindowExpiresAt: thread.serviceWindowExpiresAt,
      tags: thread.tags,
      leadSource: thread.leadSource,
      leadStatus: thread.leadStatus,
      nextStep: thread.nextStep,
      nextStepDueAt: thread.nextStepDueAt,
      responsibleMemberId: thread.responsibleMemberId,
      assignedTeamId: thread.assignedTeamId,
      inboxStatus: thread.inboxStatus,
      starredAt: thread.starredAt,
      snoozedUntil: thread.snoozedUntil,
      closedAt: thread.closedAt,
      dnd: thread.dnd,
      automationMode: thread.automationMode,
      automationChangeReason: thread.automationChangeReason,
      pilotBlockedAt: thread.pilotBlockedAt,
      intent: thread.intent,
      intentSource: thread.intentSource,
      originCampaignId: thread.originCampaignId,
      originCampaignName: originCampaign?.name,
      customFields: thread.customFields,
      channelSendMode: channel.sendMode,
      channelProvider: channel.provider,
      channelDisplayName: channel.displayName,
      channelConnectionState: channel.connectionState,
      channelWebhookStatus: channel.webhookStatus,
      channelHealthStatus: channel.lastHealthStatus,
      recipientAllowlisted: channel.outboundAllowlist.includes(recipient),
    };
  },
});

export const listTemplates = tenantQuery({
  args: { channelId: v.id("channels") },
  returns: v.array(
    v.object({
      _id: v.id("channelTemplates"),
      name: v.string(),
      languageCode: v.string(),
      category: v.optional(v.string()),
      status: v.string(),
      components: v.optional(v.any()),
    }),
  ),
  handler: async (ctx, args) => {
    const channel = await ctx.db.get(args.channelId);
    if (!channel || channel.tenantId !== ctx.tenantId) {
      throw new ConvexError({ code: "CHANNEL_NOT_FOUND" });
    }
    const rows = await ctx.db
      .query("channelTemplates")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .order("desc")
      .take(200);
    return rows
      .filter((row) => ["approved", "active"].includes(row.status.toLowerCase()))
      .map((row) => ({
        _id: row._id,
        name: row.name,
        languageCode: row.languageCode,
        category: row.category,
        status: row.status,
        components: row.components,
      }));
  },
});

export const markThreadRead = tenantMutation({
  args: { threadId: v.id("channelThreads") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread || thread.tenantId !== ctx.tenantId) {
      throw new ConvexError({ code: "THREAD_NOT_FOUND" });
    }
    if (thread.unreadCount === 0) return null;
    await ctx.db.patch(thread._id, { unreadCount: 0, updatedAt: Date.now() });
    return null;
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
    if (channel.provider === "iasolution_hub") {
      throw new ConvexError({
        code: "USE_PROVIDER_PILOT_GATE",
        message:
          "iaSolution Hub channels must use the provider pilot gate so health, webhook verification, and allowlist checks cannot be bypassed.",
      });
    }
    await ctx.db.patch(channel._id, {
      sendMode: args.sendMode,
      updatedAt: Date.now(),
    });
    return null;
  },
});
