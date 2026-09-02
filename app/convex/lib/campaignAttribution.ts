import type { Doc, Id } from "../_generated/dataModel";
import {
  CAMPAIGN_RECIPIENT_STATUS_RANK,
  readCampaignStats,
  transitionStats,
  type CampaignRecipientStatus,
} from "./campaignStats";

const CHANNEL_CAMPAIGN_KINDS = new Set(["channel_template", "channel_text"]);
const ATTRIBUTABLE = new Set<CampaignRecipientStatus>([
  "sent",
  "delivered",
  "read",
  "replied",
  "clicked",
]);
const CONVERSION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Campaigns with transactional stats (B2+). Legacy/micro campaigns keep theirs. */
export function hasChannelStats(campaign: Doc<"campaigns"> | null): boolean {
  return !!campaign && CHANNEL_CAMPAIGN_KINDS.has(campaign.kind ?? "");
}

/**
 * Keep `campaigns.stats` in step with a recipient's status change. Called in
 * the same transaction as the recipient patch, so the counters can never drift
 * from the rows (Convex serializes conflicting writes).
 */
export async function bumpCampaignStats(
  ctx: { db: any },
  campaign: Doc<"campaigns">,
  change: {
    from: CampaignRecipientStatus | null;
    to?: CampaignRecipientStatus;
    replied?: boolean;
    clicked?: boolean;
    converted?: boolean;
    unknown?: number;
    attempts?: number;
    rateLimited?: number;
  },
  now: number,
): Promise<void> {
  if (!hasChannelStats(campaign)) return;
  let stats = readCampaignStats(campaign.stats);
  if (change.to !== undefined && change.to !== change.from) {
    stats = transitionStats(stats, change.from, change.to);
  }
  if (change.replied) stats.replied += 1;
  if (change.clicked) stats.clicked += 1;
  if (change.converted) stats.converted += 1;
  if (change.unknown) stats.unknown = Math.max(0, stats.unknown + change.unknown);
  if (change.attempts) stats.attempts += change.attempts;
  if (change.rateLimited) stats.rateLimited += change.rateLimited;
  await ctx.db.patch(campaign._id, { stats, updatedAt: now });
}

async function newestAttributableRecipient(
  ctx: { db: any },
  args: { tenantId: Id<"tenants">; channelId: Id<"channels">; threadKey: string; now: number; windowMs: number },
): Promise<{ recipient: Doc<"campaignRecipients">; campaign: Doc<"campaigns"> } | null> {
  const candidates = (await ctx.db
    .query("campaignRecipients")
    .withIndex("by_tenant_channel_thread", (q: any) =>
      q.eq("tenantId", args.tenantId).eq("channelId", args.channelId).eq("threadKey", args.threadKey),
    )
    .order("desc")
    .take(10)) as Doc<"campaignRecipients">[];
  for (const candidate of candidates) {
    if (!candidate.sentAt || args.now - candidate.sentAt > args.windowMs) continue;
    if (!ATTRIBUTABLE.has(candidate.status as CampaignRecipientStatus)) continue;
    const campaign = (await ctx.db.get(candidate.campaignId)) as Doc<"campaigns"> | null;
    if (!campaign || !hasChannelStats(campaign)) continue;
    return { recipient: candidate, campaign };
  }
  return null;
}

/** An inbound message after a campaign send counts once as a reply. */
export async function markCampaignReply(
  ctx: { db: any },
  args: { recipientId: Id<"campaignRecipients">; at: number },
): Promise<boolean> {
  const recipient = (await ctx.db.get(args.recipientId)) as Doc<"campaignRecipients"> | null;
  if (!recipient || recipient.repliedAt) return false;
  const campaign = (await ctx.db.get(recipient.campaignId)) as Doc<"campaigns"> | null;
  if (!campaign || !hasChannelStats(campaign)) return false;
  const from = recipient.status as CampaignRecipientStatus;
  const advances =
    CAMPAIGN_RECIPIENT_STATUS_RANK.replied > CAMPAIGN_RECIPIENT_STATUS_RANK[from] &&
    from !== "failed" &&
    from !== "skipped";
  await ctx.db.patch(recipient._id, {
    repliedAt: args.at,
    ...(advances ? { status: "replied" } : {}),
    updatedAt: args.at,
  });
  await ctx.db.insert("campaignEvents", {
    tenantId: recipient.tenantId,
    campaignId: campaign._id,
    campaignRecipientId: recipient._id,
    type: "campaign.recipient.replied",
    payload: { threadKey: recipient.threadKey, previousStatus: from },
    createdAt: args.at,
  });
  await bumpCampaignStats(
    ctx,
    campaign,
    { from, to: advances ? "replied" : undefined, replied: true },
    args.at,
  );
  return true;
}

/** A tracked-link hit counts once per recipient as a click. */
export async function markCampaignClick(
  ctx: { db: any },
  args: { recipientId: Id<"campaignRecipients">; at: number; token: string },
): Promise<boolean> {
  const recipient = (await ctx.db.get(args.recipientId)) as Doc<"campaignRecipients"> | null;
  if (!recipient) return false;
  const campaign = (await ctx.db.get(recipient.campaignId)) as Doc<"campaigns"> | null;
  if (!campaign || !hasChannelStats(campaign)) return false;
  if (recipient.clickedAt) return false;
  const from = recipient.status as CampaignRecipientStatus;
  const advances =
    CAMPAIGN_RECIPIENT_STATUS_RANK.clicked > CAMPAIGN_RECIPIENT_STATUS_RANK[from] &&
    from !== "failed" &&
    from !== "skipped";
  await ctx.db.patch(recipient._id, {
    clickedAt: args.at,
    clickedButtonPayload: `link:${args.token}`,
    ...(advances ? { status: "clicked" } : {}),
    updatedAt: args.at,
  });
  await ctx.db.insert("campaignEvents", {
    tenantId: recipient.tenantId,
    campaignId: campaign._id,
    campaignRecipientId: recipient._id,
    type: "campaign.recipient.clicked",
    payload: { threadKey: recipient.threadKey, previousStatus: from },
    createdAt: args.at,
  });
  await bumpCampaignStats(
    ctx,
    campaign,
    { from, to: advances ? "clicked" : undefined, clicked: true },
    args.at,
  );
  return true;
}

/**
 * A business outcome on a thread (booking reserved, attendance confirmed,
 * manual mark) is attributed to the newest campaign send within 30 days.
 * Idempotent per recipient: the first conversion wins.
 */
export async function markCampaignConversion(
  ctx: { db: any },
  args: {
    tenantId: Id<"tenants">;
    channelId: Id<"channels">;
    threadKey: string;
    label: string;
    now: number;
    valueMinor?: number;
    currency?: string;
  },
): Promise<Id<"campaignRecipients"> | null> {
  const hit = await newestAttributableRecipient(ctx, {
    tenantId: args.tenantId,
    channelId: args.channelId,
    threadKey: args.threadKey,
    now: args.now,
    windowMs: CONVERSION_WINDOW_MS,
  });
  if (!hit) return null;
  const { recipient, campaign } = hit;
  if (recipient.convertedAt) return recipient._id;
  await ctx.db.patch(recipient._id, {
    convertedAt: args.now,
    conversionLabel: args.label.slice(0, 80),
    conversionValueMinor: args.valueMinor,
    conversionCurrency: args.currency,
    updatedAt: args.now,
  });
  await ctx.db.insert("campaignEvents", {
    tenantId: recipient.tenantId,
    campaignId: campaign._id,
    campaignRecipientId: recipient._id,
    type: "campaign.recipient.converted",
    payload: { threadKey: recipient.threadKey, label: args.label.slice(0, 80) },
    createdAt: args.now,
  });
  await bumpCampaignStats(ctx, campaign, { from: null, converted: true }, args.now);
  return recipient._id;
}
