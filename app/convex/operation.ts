import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { tenantQuery } from "./lib/customFunctions";

const MESSAGE_EVENT_KIND_START = "message.";
const MESSAGE_EVENT_KIND_END = "message/";
const THREAD_SCAN_LIMIT = 200;
const CHANNEL_SCAN_LIMIT = 50;
const CAMPAIGN_SCAN_LIMIT = 50;
const CAMPAIGN_RECIPIENT_SCAN_LIMIT = 1_000;
const RECENT_LIMIT = 6;

const leadStatusValidator = v.union(
  v.literal("new"),
  v.literal("interested"),
  v.literal("asked_price"),
  v.literal("wants_booking"),
  v.literal("awaiting_human"),
  v.literal("booked"),
  v.literal("confirmed"),
  v.literal("attended"),
  v.literal("no_show"),
  v.literal("lost"),
);

const campaignStatsValidator = v.object({
  total: v.number(),
  sent: v.number(),
  delivered: v.number(),
  read: v.number(),
  replied: v.number(),
  clicked: v.number(),
  converted: v.number(),
  failed: v.number(),
});

export const dashboard = tenantQuery({
  args: {},
  returns: v.object({
    attention: v.object({
      threads: v.number(),
      unread: v.number(),
      awaitingHuman: v.number(),
      open24h: v.number(),
      expiring24h: v.number(),
      activeBots: v.number(),
    }),
    leads: v.object({
      total: v.number(),
      sourceThreads: v.number(),
      statusCounts: v.array(
        v.object({
          status: leadStatusValidator,
          count: v.number(),
        }),
      ),
    }),
    campaigns: v.object({
      total: v.number(),
      running: v.number(),
      scheduled: v.number(),
      stats: campaignStatsValidator,
    }),
    agents: v.object({
      total: v.number(),
      active: v.number(),
      paused: v.number(),
      drafts: v.number(),
      validationErrors: v.number(),
      runningFlows: v.number(),
    }),
    channels: v.object({
      total: v.number(),
      active: v.number(),
      labReady: v.number(),
      sendEnabled: v.number(),
    }),
    actionItems: v.array(
      v.object({
        key: v.string(),
        count: v.number(),
        href: v.string(),
        tone: v.union(v.literal("good"), v.literal("warn"), v.literal("action")),
      }),
    ),
    recentThreads: v.array(
      v.object({
        threadId: v.id("channelThreads"),
        channelId: v.id("channels"),
        threadKey: v.string(),
        label: v.string(),
        preview: v.optional(v.string()),
        leadStatus: leadStatusValidator,
        nextStep: v.optional(v.string()),
        nextStepDueAt: v.optional(v.number()),
        unreadCount: v.number(),
        serviceWindowExpiresAt: v.optional(v.number()),
        automationMode: v.optional(v.string()),
        lastEventAt: v.number(),
      }),
    ),
  }),
  handler: async (ctx) => {
    const now = Date.now();
    const [channels, rawThreads, conversations, campaigns, chatbots, runs] =
      await Promise.all([
        ctx.db
          .query("channels")
          .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
          .take(CHANNEL_SCAN_LIMIT),
        ctx.db
          .query("channelThreads")
          .withIndex("by_tenant_last_event", (q) =>
            q.eq("tenantId", ctx.tenantId),
          )
          .order("desc")
          .take(THREAD_SCAN_LIMIT),
        ctx.db
          .query("conversations")
          .withIndex("by_tenant_lastmsg", (q) =>
            q.eq("tenantId", ctx.tenantId),
          )
          .order("desc")
          .take(THREAD_SCAN_LIMIT),
        ctx.db
          .query("campaigns")
          .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
          .order("desc")
          .take(CAMPAIGN_SCAN_LIMIT),
        ctx.db
          .query("chatbots")
          .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
          .take(100),
        ctx.db
          .query("channelAutomationRuns")
          .withIndex("by_tenant_last_advanced", (q) =>
            q.eq("tenantId", ctx.tenantId),
          )
          .order("desc")
          .take(200),
      ]);

    const threads: Doc<"channelThreads">[] = [];
    for (const thread of rawThreads) {
      if (await threadHasMessageEvent(ctx, thread)) threads.push(thread);
    }

    const statusCounts = new Map<LeadStatus, number>();
    for (const status of LEAD_STATUS_ORDER) statusCounts.set(status, 0);
    for (const thread of threads) {
      const status = leadStatus(thread);
      statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
    }
    for (const conversation of conversations) {
      const status = mapConversationLeadStatus(conversation.opportunityStatus);
      statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
    }

    const campaignStats = emptyCampaignStats();
    for (const campaign of campaigns) {
      const recipients = await ctx.db
        .query("campaignRecipients")
        .withIndex("by_campaign", (q) => q.eq("campaignId", campaign._id))
        .take(CAMPAIGN_RECIPIENT_SCAN_LIMIT);
      addCampaignRecipients(campaignStats, recipients);
    }

    const open24h = threads.filter(
      (thread) =>
        thread.serviceWindowExpiresAt !== undefined &&
        thread.serviceWindowExpiresAt > now,
    ).length;
    const expiring24h = threads.filter(
      (thread) =>
        thread.serviceWindowExpiresAt !== undefined &&
        thread.serviceWindowExpiresAt > now &&
        thread.serviceWindowExpiresAt <= now + 2 * 60 * 60 * 1000,
    ).length;
    const awaitingHuman = threads.filter(
      (thread) =>
        thread.automationMode === "human" ||
        thread.leadStatus === "awaiting_human",
    ).length;
    const unread = threads.filter((thread) => thread.unreadCount > 0).length;
    const activeBots = threads.filter((thread) => thread.automationMode === "bot")
      .length;
    const activeChannels = channels.filter((channel) => channel.status === "active");

    const recentThreads = [];
    for (const thread of threads.slice(0, RECENT_LIMIT)) {
      const identity = thread.identityId ? await ctx.db.get(thread.identityId) : null;
      recentThreads.push({
        threadId: thread._id,
        channelId: thread.channelId,
        threadKey: thread.threadKey,
        label:
          identity?.displayName ??
          identity?.username ??
          identity?.phone ??
          thread.threadKey,
        preview: thread.lastPreview,
        leadStatus: leadStatus(thread),
        nextStep: thread.nextStep,
        nextStepDueAt: thread.nextStepDueAt,
        unreadCount: thread.unreadCount,
        serviceWindowExpiresAt: thread.serviceWindowExpiresAt,
        automationMode: thread.automationMode,
        lastEventAt: thread.lastEventAt,
      });
    }

    return {
      attention: {
        threads: threads.length,
        unread,
        awaitingHuman,
        open24h,
        expiring24h,
        activeBots,
      },
      leads: {
        total: threads.length + conversations.length,
        sourceThreads: threads.length,
        statusCounts: LEAD_STATUS_ORDER.map((status) => ({
          status,
          count: statusCounts.get(status) ?? 0,
        })),
      },
      campaigns: {
        total: campaigns.length,
        running: campaigns.filter((campaign) => campaign.status === "running")
          .length,
        scheduled: campaigns.filter((campaign) => campaign.status === "scheduled")
          .length,
        stats: campaignStats,
      },
      agents: {
        total: chatbots.length,
        active: chatbots.filter((bot) => bot.status === "active").length,
        paused: chatbots.filter((bot) => bot.status === "paused").length,
        drafts: chatbots.filter((bot) => bot.status === "draft").length,
        validationErrors: chatbots.reduce(
          (count, bot) =>
            count +
            (bot.flowValidationIssues ?? []).filter(
              (issue) => issue.severity === "error",
            ).length,
          0,
        ),
        runningFlows: runs.filter((run) => run.status === "active").length,
      },
      channels: {
        total: channels.length,
        active: activeChannels.length,
        labReady: activeChannels.filter(
          (channel) =>
            channel.provider === "iasolution_hub" &&
            channel.operationalTerritory === "openbsp" &&
            channel.webhookStatus === "verified",
        ).length,
        sendEnabled: activeChannels.filter(
          (channel) =>
            channel.sendMode === "allowlist" || channel.sendMode === "live",
        ).length,
      },
      actionItems: buildActionItems({
        unread,
        awaitingHuman,
        expiring24h,
        activeBotCount: chatbots.filter((bot) => bot.status === "active").length,
        validationErrors: chatbots.reduce(
          (count, bot) =>
            count +
            (bot.flowValidationIssues ?? []).filter(
              (issue) => issue.severity === "error",
            ).length,
          0,
        ),
        campaignCount: campaigns.length,
        labReady: activeChannels.some(
          (channel) =>
            channel.provider === "iasolution_hub" &&
            channel.operationalTerritory === "openbsp" &&
            channel.webhookStatus === "verified",
        ),
      }),
      recentThreads,
    };
  },
});

type LeadStatus =
  | "new"
  | "interested"
  | "asked_price"
  | "wants_booking"
  | "awaiting_human"
  | "booked"
  | "confirmed"
  | "attended"
  | "no_show"
  | "lost";

const LEAD_STATUS_ORDER: LeadStatus[] = [
  "new",
  "interested",
  "asked_price",
  "wants_booking",
  "awaiting_human",
  "booked",
  "confirmed",
  "attended",
  "no_show",
  "lost",
];

function leadStatus(thread: Doc<"channelThreads">): LeadStatus {
  return thread.leadStatus ?? (thread.unreadCount > 0 ? "interested" : "new");
}

function mapConversationLeadStatus(status: string | undefined): LeadStatus {
  if (status === "booked") return "booked";
  if (status === "lost") return "lost";
  if (status === "opportunity") return "wants_booking";
  if (status === "replied") return "interested";
  if (status === "contacted") return "asked_price";
  return "new";
}

async function threadHasMessageEvent(
  ctx: { db: any },
  thread: Doc<"channelThreads">,
): Promise<boolean> {
  if (thread.lastEventKind.startsWith(MESSAGE_EVENT_KIND_START)) return true;
  const messageEvent = await ctx.db
    .query("channelEvents")
    .withIndex("by_channel_thread_kind", (q: any) =>
      q
        .eq("channelId", thread.channelId)
        .eq("threadKey", thread.threadKey)
        .gte("eventKind", MESSAGE_EVENT_KIND_START)
        .lt("eventKind", MESSAGE_EVENT_KIND_END),
    )
    .first();
  return messageEvent !== null;
}

function emptyCampaignStats() {
  return {
    total: 0,
    sent: 0,
    delivered: 0,
    read: 0,
    replied: 0,
    clicked: 0,
    converted: 0,
    failed: 0,
  };
}

function addCampaignRecipients(
  stats: ReturnType<typeof emptyCampaignStats>,
  recipients: Array<Doc<"campaignRecipients">>,
) {
  for (const recipient of recipients) {
    stats.total += 1;
    if (recipient.status === "failed") stats.failed += 1;
    if (recipient.convertedAt) stats.converted += 1;
    if (
      recipient.status === "sent" ||
      recipient.status === "delivered" ||
      recipient.status === "read" ||
      recipient.status === "replied" ||
      recipient.status === "clicked"
    ) {
      stats.sent += 1;
    }
    if (
      recipient.status === "delivered" ||
      recipient.status === "read" ||
      recipient.status === "replied" ||
      recipient.status === "clicked"
    ) {
      stats.delivered += 1;
    }
    if (
      recipient.status === "read" ||
      recipient.status === "replied" ||
      recipient.status === "clicked"
    ) {
      stats.read += 1;
    }
    if (recipient.status === "replied") stats.replied += 1;
    if (recipient.status === "clicked") stats.clicked += 1;
  }
}

function buildActionItems(args: {
  unread: number;
  awaitingHuman: number;
  expiring24h: number;
  activeBotCount: number;
  validationErrors: number;
  campaignCount: number;
  labReady: boolean;
}) {
  const items: Array<{
    key: string;
    count: number;
    href: string;
    tone: "good" | "warn" | "action";
  }> = [];
  if (!args.labReady) {
    items.push({
      key: "connect_channel",
      count: 1,
      href: "/app/settings",
      tone: "action",
    });
  }
  if (args.awaitingHuman > 0) {
    items.push({
      key: "human_queue",
      count: args.awaitingHuman,
      href: "/app/channel-inbox",
      tone: "action",
    });
  }
  if (args.unread > 0) {
    items.push({
      key: "unread_threads",
      count: args.unread,
      href: "/app/channel-inbox",
      tone: "action",
    });
  }
  if (args.expiring24h > 0) {
    items.push({
      key: "window_expiring",
      count: args.expiring24h,
      href: "/app/channel-inbox",
      tone: "warn",
    });
  }
  if (args.activeBotCount === 0) {
    items.push({
      key: "publish_agent",
      count: 1,
      href: "/app/chatbots",
      tone: "action",
    });
  }
  if (args.validationErrors > 0) {
    items.push({
      key: "agent_validation",
      count: args.validationErrors,
      href: "/app/chatbots",
      tone: "warn",
    });
  }
  if (args.campaignCount === 0) {
    items.push({
      key: "first_campaign",
      count: 1,
      href: "/app/campaigns",
      tone: "action",
    });
  }
  if (items.length === 0) {
    items.push({
      key: "stable",
      count: 0,
      href: "/app/channel-inbox",
      tone: "good",
    });
  }
  return items.slice(0, 5);
}
