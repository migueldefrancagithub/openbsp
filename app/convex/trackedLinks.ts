import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { markCampaignClick } from "./lib/campaignAttribution";

/** Link previews fetched by WhatsApp/Meta must not count as patient clicks. */
const PREVIEW_UA = /whatsapp|facebookexternalhit|facebookcatalog|twitterbot|slackbot|telegrambot|linkedinbot|discordbot|preview/i;

export function isPreviewUserAgent(userAgent: string | undefined): boolean {
  return !!userAgent && PREVIEW_UA.test(userAgent);
}

/** Public by design: the token is the capability. Returns only the target. */
export const resolve = query({
  args: { token: v.string() },
  returns: v.union(v.object({ targetUrl: v.string() }), v.null()),
  handler: async (ctx, args) => {
    const token = args.token.trim();
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
    const link = (await ctx.db
      .query("trackedLinks")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique()) as Doc<"trackedLinks"> | null;
    return link ? { targetUrl: link.targetUrl } : null;
  },
});

export const recordClick = mutation({
  args: { token: v.string(), userAgent: v.optional(v.string()) },
  returns: v.object({ counted: v.boolean() }),
  handler: async (ctx, args) => {
    const token = args.token.trim();
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return { counted: false };
    if (isPreviewUserAgent(args.userAgent)) return { counted: false };
    const link = (await ctx.db
      .query("trackedLinks")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique()) as Doc<"trackedLinks"> | null;
    if (!link) return { counted: false };
    const now = Date.now();
    if (link.firstClickedAt !== undefined) {
      await ctx.db.patch(link._id, { lastClickedAt: now });
      return { counted: false };
    }
    await ctx.db.patch(link._id, {
      // Campaign analytics report unique recipients, not repeat opens.
      clickCount: 1,
      firstClickedAt: now,
      lastClickedAt: now,
    });
    if (link.campaignRecipientId) {
      await markCampaignClick(ctx, { recipientId: link.campaignRecipientId, at: now, token });
    }
    return { counted: true };
  },
});
