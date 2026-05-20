import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { tenantQuery } from "./lib/customFunctions";

const campaignStatsValidator = v.object({
  total: v.number(),
  pending: v.number(),
  queued: v.number(),
  dispatching: v.number(),
  sent: v.number(),
  delivered: v.number(),
  read: v.number(),
  replied: v.number(),
  clicked: v.number(),
  failed: v.number(),
  skipped: v.number(),
});

type CampaignStats = {
  total: number;
  pending: number;
  queued: number;
  dispatching: number;
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  clicked: number;
  failed: number;
  skipped: number;
};

type RecentCampaign = {
  _id: Id<"campaigns">;
  name: string;
  status: string;
  pauseReason?: string;
  createdAt: number;
  updatedAt?: number;
  stats: CampaignStats;
};

export const dashboard = tenantQuery({
  args: {},
  returns: v.object({
    connection: v.object({
      primaryPhone: v.union(
        v.object({
          e164: v.string(),
          displayName: v.string(),
          qualityRating: v.optional(v.string()),
          status: v.string(),
          circuitBreakerUntil: v.optional(v.number()),
          circuitBreakerReason: v.optional(v.string()),
        }),
        v.null(),
      ),
      qualityLabel: v.string(),
      modeLabel: v.string(),
      messagingLimitLabel: v.string(),
      activeWabas: v.number(),
      connectedPhones: v.number(),
    }),
    leads: v.object({
      totalContacts: v.number(),
      ctwaReferrals: v.number(),
      openCtwaChats: v.number(),
      booked: v.number(),
      freeEntryOpen: v.number(),
      freeEntryExpiringSoon: v.number(),
    }),
    revenue: v.object({
      pipelineValueMinor: v.number(),
      bookedValueMinor: v.number(),
      currency: v.string(),
    }),
    campaigns: v.object({
      total: v.number(),
      running: v.number(),
      paused: v.number(),
      failedRecipients: v.number(),
      readRate: v.number(),
      deliveryRate: v.number(),
      recent: v.array(
        v.object({
          _id: v.id("campaigns"),
          name: v.string(),
          status: v.string(),
          pauseReason: v.optional(v.string()),
          createdAt: v.number(),
          updatedAt: v.optional(v.number()),
          stats: campaignStatsValidator,
        }),
      ),
    }),
    nextActions: v.array(
      v.object({
        tone: v.union(v.literal("good"), v.literal("warn"), v.literal("action")),
        title: v.string(),
        body: v.string(),
        href: v.string(),
      }),
    ),
  }),
  handler: async (ctx) => {
    const now = Date.now();
    const [accounts, phones, contacts, referrals, conversations, campaigns] =
      await Promise.all([
        ctx.db
          .query("whatsappAccounts")
          .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
          .collect(),
        ctx.db
          .query("phoneNumbers")
          .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
          .collect(),
        ctx.db
          .query("contacts")
          .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
          .collect(),
        ctx.db
          .query("ctwaReferrals")
          .withIndex("by_contact", (q) => q.eq("tenantId", ctx.tenantId))
          .collect(),
        ctx.db
          .query("conversations")
          .withIndex("by_tenant_lastmsg", (q) => q.eq("tenantId", ctx.tenantId))
          .collect(),
        ctx.db
          .query("campaigns")
          .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
          .collect(),
      ]);

    const activeAccounts = accounts.filter((account) => account.status === "active");
    const primaryAccount = activeAccounts[0] ?? accounts[0];
    const primaryPhone =
      phones.find((phone) => phone.whatsappAccountId === primaryAccount?._id) ??
      phones[0] ??
      null;
    const primaryQuality =
      primaryPhone?.qualityRating ?? primaryAccount?.qualityRating ?? undefined;
    const ctwaConversations = conversations.filter(
      (conversation) => conversation.leadSource === "ctwa",
    );
    const pipelineValueMinor = ctwaConversations.reduce(
      (sum, conversation) => sum + (conversation.opportunityValueMinor ?? 0),
      0,
    );
    const bookedValueMinor = ctwaConversations
      .filter((conversation) => conversation.opportunityStatus === "booked")
      .reduce(
        (sum, conversation) => sum + (conversation.opportunityValueMinor ?? 0),
        0,
      );

    const recent: RecentCampaign[] = [];
    let aggregateRead = 0;
    let aggregateDelivered = 0;
    let aggregateSent = 0;
    let aggregateTotal = 0;
    let failedRecipients = 0;

    const sortedCampaigns = campaigns
      .slice()
      .sort(
        (a, b) =>
          (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt),
      );

    for (const campaign of sortedCampaigns) {
      const recipients = await ctx.db
        .query("campaignRecipients")
        .withIndex("by_campaign", (q) => q.eq("campaignId", campaign._id))
        .collect();
      const stats = countRecipients(recipients);
      aggregateRead += stats.read;
      aggregateDelivered +=
        stats.delivered + stats.read + stats.replied + stats.clicked;
      aggregateSent +=
        stats.sent +
        stats.delivered +
        stats.read +
        stats.replied +
        stats.clicked;
      aggregateTotal += stats.total;
      failedRecipients += stats.failed;
      if (recent.length < 5) {
        recent.push({
          _id: campaign._id,
          name: campaign.name,
          status: campaign.status ?? "draft",
          pauseReason: campaign.pauseReason,
          createdAt: campaign.createdAt,
          updatedAt: campaign.updatedAt,
          stats,
        });
      }
    }

    const freeEntryOpen = referrals.filter(
      (referral) => referral.freeEntryWindowExpiresAt > now,
    ).length;
    const freeEntryExpiringSoon = referrals.filter(
      (referral) =>
        referral.freeEntryWindowExpiresAt > now &&
        referral.freeEntryWindowExpiresAt <= now + 6 * 60 * 60 * 1000,
    ).length;

    const nextActions = buildNextActions({
      hasPhone: !!primaryPhone,
      primaryQuality,
      circuitBreakerReason: primaryPhone?.circuitBreakerReason,
      freeEntryExpiringSoon,
      failedRecipients,
      campaignCount: campaigns.length,
    });

    return {
      connection: {
        primaryPhone: primaryPhone
          ? {
              e164: primaryPhone.e164,
              displayName: primaryPhone.displayName,
              qualityRating: primaryPhone.qualityRating,
              status:
                primaryPhone.circuitBreakerUntil &&
                primaryPhone.circuitBreakerUntil > now
                  ? "paused"
                  : primaryAccount?.status ?? "active",
              circuitBreakerUntil: primaryPhone.circuitBreakerUntil,
              circuitBreakerReason: primaryPhone.circuitBreakerReason,
            }
          : null,
        qualityLabel: qualityText(primaryQuality),
        modeLabel: primaryAccount?.status === "active" ? "Production" : "Setup",
        messagingLimitLabel: primaryAccount?.messagingTier ?? "Not synced",
        activeWabas: activeAccounts.length,
        connectedPhones: phones.length,
      },
      leads: {
        totalContacts: contacts.length,
        ctwaReferrals: referrals.length,
        openCtwaChats: ctwaConversations.filter(
          (conversation) => conversation.status !== "closed",
        ).length,
        booked: ctwaConversations.filter(
          (conversation) => conversation.opportunityStatus === "booked",
        ).length,
        freeEntryOpen,
        freeEntryExpiringSoon,
      },
      revenue: {
        pipelineValueMinor,
        bookedValueMinor,
        currency:
          ctwaConversations.find(
            (conversation) => conversation.opportunityCurrency,
          )?.opportunityCurrency ?? "EUR",
      },
      campaigns: {
        total: campaigns.length,
        running: campaigns.filter((campaign) => campaign.status === "running")
          .length,
        paused: campaigns.filter((campaign) => campaign.status === "paused")
          .length,
        failedRecipients,
        readRate: aggregateSent > 0 ? aggregateRead / aggregateSent : 0,
        deliveryRate:
          aggregateTotal > 0 ? aggregateDelivered / aggregateTotal : 0,
        recent,
      },
      nextActions,
    };
  },
});

function countRecipients(
  recipients: Array<{ status: string }>,
): CampaignStats {
  const stats = {
    total: recipients.length,
    pending: 0,
    queued: 0,
    dispatching: 0,
    sent: 0,
    delivered: 0,
    read: 0,
    replied: 0,
    clicked: 0,
    failed: 0,
    skipped: 0,
  };
  for (const recipient of recipients) {
    if (recipient.status in stats) {
      stats[recipient.status as keyof typeof stats]++;
    }
  }
  return stats;
}

function qualityText(quality?: string): string {
  if (quality === "green") return "High";
  if (quality === "yellow") return "Medium";
  if (quality === "red") return "Low";
  return "Unknown";
}

function buildNextActions(args: {
  hasPhone: boolean;
  primaryQuality?: string;
  circuitBreakerReason?: string;
  freeEntryExpiringSoon: number;
  failedRecipients: number;
  campaignCount: number;
}): Array<{ tone: "good" | "warn" | "action"; title: string; body: string; href: string }> {
  const actions = [];
  if (!args.hasPhone) {
    actions.push({
      tone: "action" as const,
      title: "Connect the WhatsApp number",
      body: "Start with Embedded Signup or manual WABA setup before campaigns.",
      href: "/app/settings",
    });
  }
  if (args.primaryQuality === "yellow" || args.primaryQuality === "red") {
    actions.push({
      tone: "warn" as const,
      title: "Quality needs attention",
      body: args.circuitBreakerReason ?? "Pause broad sends and inspect failure categories.",
      href: "/app/support",
    });
  }
  if (args.freeEntryExpiringSoon > 0) {
    actions.push({
      tone: "action" as const,
      title: "CTWA windows expiring",
      body: `${args.freeEntryExpiringSoon} lead(s) should be handled before the 72h window closes.`,
      href: "/app/leads",
    });
  }
  if (args.failedRecipients > 0) {
    actions.push({
      tone: "warn" as const,
      title: "Review campaign failures",
      body: "Export failed contacts, fix unsafe causes, and retry only safe failures.",
      href: "/app/campaigns",
    });
  }
  if (args.campaignCount === 0) {
    actions.push({
      tone: "action" as const,
      title: "Build the first broadcast",
      body: "Create a client list, attach an approved template, then launch a small cohort.",
      href: "/app/campaigns",
    });
  }
  if (actions.length === 0) {
    actions.push({
      tone: "good" as const,
      title: "System looks stable",
      body: "Keep monitoring quality, read rate, and CTWA follow-up windows before scaling.",
      href: "/app/support",
    });
  }
  return actions.slice(0, 4);
}
