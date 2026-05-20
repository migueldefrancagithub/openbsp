import { v } from "convex/values";
import { tenantQuery } from "./lib/customFunctions";

const opportunityStatuses = [
  "new",
  "contacted",
  "replied",
  "opportunity",
  "booked",
  "lost",
] as const;

export const dashboard = tenantQuery({
  args: { limit: v.optional(v.number()) },
  returns: v.object({
    totalReferrals: v.number(),
    openConversations: v.number(),
    booked: v.number(),
    pipelineValueMinor: v.number(),
    bookedValueMinor: v.number(),
    currency: v.string(),
    freeEntryOpen: v.number(),
    freeEntryExpiringSoon: v.number(),
    byOpportunityStatus: v.array(
      v.object({
        status: v.string(),
        count: v.number(),
      }),
    ),
    recent: v.array(
      v.object({
        _id: v.id("ctwaReferrals"),
        conversationId: v.id("conversations"),
        contactName: v.optional(v.string()),
        contactE164: v.string(),
        sourceType: v.optional(v.string()),
        sourceId: v.optional(v.string()),
        sourceUrl: v.optional(v.string()),
        headline: v.optional(v.string()),
        body: v.optional(v.string()),
        clickedAt: v.number(),
        freeEntryWindowExpiresAt: v.number(),
        opportunityStatus: v.optional(v.string()),
        opportunityValueMinor: v.optional(v.number()),
        opportunityCurrency: v.optional(v.string()),
        aiState: v.optional(v.string()),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 50, 200);
    const now = Date.now();
    const referrals = await ctx.db
      .query("ctwaReferrals")
      .withIndex("by_contact", (q) => q.eq("tenantId", ctx.tenantId))
      .collect();
    const recentReferrals = referrals
      .slice()
      .sort((a, b) => b.clickedAt - a.clickedAt)
      .slice(0, limit);
    const conversations = await ctx.db
      .query("conversations")
      .withIndex("by_tenant_lastmsg", (q) => q.eq("tenantId", ctx.tenantId))
      .collect();
    const ctwaConversations = conversations.filter(
      (conversation) => conversation.leadSource === "ctwa",
    );
    const statusCounts = new Map<string, number>(
      opportunityStatuses.map((status) => [status, 0]),
    );
    for (const conversation of ctwaConversations) {
      const status = conversation.opportunityStatus ?? "new";
      statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
    }

    const recent = [];
    for (const referral of recentReferrals) {
      const [contact, conversation] = await Promise.all([
        ctx.db.get(referral.contactId),
        ctx.db.get(referral.conversationId),
      ]);
      if (conversation?.tenantId !== ctx.tenantId) continue;
      recent.push({
        _id: referral._id,
        conversationId: referral.conversationId,
        contactName: contact?.name,
        contactE164: contact?.e164 ?? "",
        sourceType: referral.sourceType,
        sourceId: referral.sourceId,
        sourceUrl: referral.sourceUrl,
        headline: referral.headline,
        body: referral.body,
        clickedAt: referral.clickedAt,
        freeEntryWindowExpiresAt: referral.freeEntryWindowExpiresAt,
        opportunityStatus: conversation.opportunityStatus,
        opportunityValueMinor: conversation.opportunityValueMinor,
        opportunityCurrency: conversation.opportunityCurrency,
        aiState: conversation.aiState,
      });
    }
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

    return {
      totalReferrals: referrals.length,
      openConversations: ctwaConversations.filter(
        (conversation) => conversation.status !== "closed",
      ).length,
      booked: ctwaConversations.filter(
        (conversation) => conversation.opportunityStatus === "booked",
      ).length,
      pipelineValueMinor,
      bookedValueMinor,
      currency:
        ctwaConversations.find((conversation) => conversation.opportunityCurrency)
          ?.opportunityCurrency ?? "EUR",
      freeEntryOpen: referrals.filter(
        (referral) => referral.freeEntryWindowExpiresAt > now,
      ).length,
      freeEntryExpiringSoon: referrals.filter(
        (referral) =>
          referral.freeEntryWindowExpiresAt > now &&
          referral.freeEntryWindowExpiresAt <= now + 6 * 60 * 60 * 1000,
      ).length,
      byOpportunityStatus: Array.from(statusCounts.entries()).map(
        ([status, count]) => ({ status, count }),
      ),
      recent,
    };
  },
});
