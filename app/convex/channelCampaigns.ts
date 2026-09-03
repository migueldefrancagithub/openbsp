import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { writeAudit } from "./lib/audit";
import { emitWebhookEvent } from "./lib/webhooks";
import { markCampaignConversion } from "./lib/campaignAttribution";
import {
  campaignStatsValidator,
  deriveCampaignRates,
  emptyCampaignStats,
  readCampaignStats,
} from "./lib/campaignStats";
import {
  accumulateRecipient,
  BATCH_INTERVAL_MS,
  BATCH_SIZE,
  blockReasonFor,
  CHANNEL_LEAD_STATUSES,
  emptyAudienceSummary,
  materializePage,
  matchesAudience,
  normalizeAudience,
  queueNextBatch,
  readAudienceSummary,
  SEND_SPACING_MS,
  UNKNOWN_SETTLE_GRACE_MS,
  type BlockReason,
} from "./lib/channelCampaignEngine";
import { threadHasMessageEvent } from "./lib/channels/threadVisibility";
import {
  loadByIdInTenant,
  requireCapability,
  tenantMutation,
  tenantQuery,
} from "./lib/customFunctions";

const NAME_MIN = 2;
const NAME_MAX = 80;
const PREVIEW_SCAN = 500;
const EXPORT_LIMIT = 2_000;
const SCHEDULE_MIN_MS = 60_000;
const SCHEDULE_MAX_MS = 30 * 24 * 60 * 60 * 1000;

const kindValidator = v.union(v.literal("channel_template"), v.literal("channel_text"));

const leadStatusValidator = v.union(
  ...CHANNEL_LEAD_STATUSES.map((status) => v.literal(status)),
);

export const audienceValidator = v.object({
  leadStatuses: v.optional(v.array(leadStatusValidator)),
  tags: v.optional(v.array(v.string())),
  inboundWithinDays: v.optional(v.number()),
  excludeDnd: v.optional(v.boolean()),
  excludeLost: v.optional(v.boolean()),
  excludeRecentCampaignDays: v.optional(v.number()),
  threadKeys: v.optional(v.array(v.string())),
});

const bindingValidator = v.object({
  index: v.number(),
  source: v.union(v.literal("static"), v.literal("first_name"), v.literal("tracked_link")),
  value: v.optional(v.string()),
});

const blockedValidator = v.object({
  RECIPIENT_NOT_ALLOWLISTED: v.number(),
  DND: v.number(),
  LOST: v.number(),
  OPT_OUT: v.number(),
  RECENT_CAMPAIGN: v.number(),
  SERVICE_WINDOW_EXPIRED: v.number(),
  INVALID_RECIPIENT: v.number(),
});

const audienceSummaryValidator = v.object({
  scanned: v.number(),
  matched: v.number(),
  eligible: v.number(),
  missing: v.number(),
  capped: v.boolean(),
  blocked: blockedValidator,
});

const ratesValidator = v.object({
  attempted: v.number(),
  sent: v.number(),
  delivered: v.number(),
  read: v.number(),
  replied: v.number(),
  clicked: v.number(),
  converted: v.number(),
  failed: v.number(),
  skipped: v.number(),
  unknown: v.number(),
  pending: v.number(),
  deliveryRate: v.number(),
  readRate: v.number(),
  replyRate: v.number(),
  clickRate: v.number(),
  conversionRate: v.number(),
  failureRate: v.number(),
});

const campaignRowValidator = v.object({
  _id: v.id("campaigns"),
  name: v.string(),
  kind: v.string(),
  status: v.string(),
  channelId: v.optional(v.id("channels")),
  contentPreview: v.optional(v.string()),
  audienceStatus: v.optional(v.string()),
  scheduledAt: v.optional(v.number()),
  startedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  pausedAt: v.optional(v.number()),
  pauseReason: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.optional(v.number()),
  rates: ratesValidator,
});

function assertName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length < NAME_MIN || trimmed.length > NAME_MAX) {
    throw new ConvexError({ code: "INVALID_CAMPAIGN_NAME", min: NAME_MIN, max: NAME_MAX });
  }
  return trimmed;
}

function isHubChannel(channel: Doc<"channels"> | null): channel is Doc<"channels"> {
  return (
    !!channel &&
    channel.provider === "iasolution_hub" &&
    channel.operationalTerritory === "openbsp"
  );
}

function isPilotReady(channel: Doc<"channels">): boolean {
  return (
    channel.status === "active" &&
    channel.webhookStatus === "verified" &&
    channel.sendMode === "allowlist" &&
    channel.connectionState === "allowlist_only"
  );
}

/** Body variables a Hub template expects: `{{1}}..{{n}}` in its BODY component. */
export function templateBodyVariableCount(components: unknown): number {
  if (!Array.isArray(components)) return 0;
  let max = 0;
  for (const component of components) {
    if (!component || typeof component !== "object") continue;
    const type = String((component as { type?: unknown }).type ?? "").toUpperCase();
    if (type !== "BODY") continue;
    const text = String((component as { text?: unknown }).text ?? "");
    for (const match of text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
      max = Math.max(max, Number(match[1]));
    }
  }
  return max;
}

function validateBindings(
  bindings: Array<{ index: number; source: "static" | "first_name" | "tracked_link"; value?: string }>,
  expected: number,
) {
  const sorted = [...bindings].sort((a, b) => a.index - b.index);
  if (sorted.length !== expected) throw new ConvexError({ code: "INVALID_VARIABLE_BINDINGS" });
  sorted.forEach((binding, position) => {
    if (binding.index !== position + 1) throw new ConvexError({ code: "INVALID_VARIABLE_BINDINGS" });
    if (binding.source === "static" && !(binding.value ?? "").trim()) {
      throw new ConvexError({ code: "INVALID_VARIABLE_BINDINGS" });
    }
    if (binding.source === "tracked_link") {
      const value = (binding.value ?? "").trim();
      if (!/^https:\/\/[^\s]+$/.test(value) || value.length > 500) {
        throw new ConvexError({ code: "INVALID_TRACKED_LINK" });
      }
    }
  });
  const links = sorted.filter((b) => b.source === "tracked_link");
  if (links.length > 1) throw new ConvexError({ code: "INVALID_VARIABLE_BINDINGS" });
  return sorted.map((b) => ({ index: b.index, source: b.source, value: b.value?.trim() }));
}

function assertText(text: string | undefined): string {
  const trimmed = (text ?? "").trim();
  if (!trimmed || trimmed.length > 4_096) throw new ConvexError({ code: "INVALID_TEXT" });
  return trimmed;
}

function previewOf(campaign: {
  kind?: string;
  messageText?: string;
  templateName?: string;
}): string {
  if (campaign.kind === "channel_text") return (campaign.messageText ?? "").slice(0, 180);
  return `Template: ${campaign.templateName ?? ""}`.slice(0, 180);
}

function rowOf(campaign: Doc<"campaigns">) {
  return {
    _id: campaign._id,
    name: campaign.name,
    kind: campaign.kind ?? "template_broadcast",
    status: campaign.status ?? "draft",
    channelId: campaign.channelId,
    contentPreview: campaign.contentPreview,
    audienceStatus: campaign.audienceStatus,
    scheduledAt: campaign.scheduledAt,
    startedAt: campaign.startedAt,
    completedAt: campaign.completedAt,
    pausedAt: campaign.pausedAt,
    pauseReason: campaign.pauseReason,
    createdAt: campaign.createdAt,
    updatedAt: campaign.updatedAt,
    rates: deriveCampaignRates(readCampaignStats(campaign.stats)),
  };
}

async function loadChannelCampaign(
  ctx: Parameters<typeof loadByIdInTenant>[0],
  campaignId: Id<"campaigns">,
): Promise<Doc<"campaigns">> {
  const campaign = await loadByIdInTenant(ctx, "campaigns", campaignId);
  if (campaign.kind !== "channel_template" && campaign.kind !== "channel_text") {
    throw new ConvexError({ code: "CAMPAIGN_KIND_UNSUPPORTED" });
  }
  return campaign;
}

async function resolveTemplate(
  ctx: Parameters<typeof loadByIdInTenant>[0],
  channel: Doc<"channels">,
  channelTemplateId: Id<"channelTemplates">,
) {
  const template = await loadByIdInTenant(ctx, "channelTemplates", channelTemplateId);
  if (template.channelId !== channel._id) throw new ConvexError({ code: "CHANNEL_TEMPLATE_NOT_FOUND" });
  if (!["approved", "active"].includes(template.status.toLowerCase())) {
    throw new ConvexError({ code: "CHANNEL_TEMPLATE_NOT_APPROVED" });
  }
  return template;
}

// ---------------------------------------------------------------------------
// Public: create / edit
// ---------------------------------------------------------------------------

export const create = tenantMutation({
  args: {
    channelId: v.id("channels"),
    name: v.string(),
    kind: kindValidator,
    channelTemplateId: v.optional(v.id("channelTemplates")),
    variableBindings: v.optional(v.array(bindingValidator)),
    messageText: v.optional(v.string()),
    audience: audienceValidator,
    clientNonce: v.optional(v.string()),
  },
  returns: v.id("campaigns"),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "campaigns.create");
    const name = assertName(args.name);
    const channel = await loadByIdInTenant(ctx, "channels", args.channelId);
    if (!isHubChannel(channel)) throw new ConvexError({ code: "HUB_CHANNEL_NOT_FOUND" });
    const now = Date.now();
    const businessKey = args.clientNonce?.trim()
      ? `channel:${args.channelId}:${args.clientNonce.trim().slice(0, 80)}`
      : undefined;
    if (businessKey) {
      const existing = await ctx.db
        .query("campaigns")
        .withIndex("by_tenant_business_key", (q) =>
          q.eq("tenantId", ctx.tenantId).eq("businessKey", businessKey),
        )
        .unique();
      if (existing) return existing._id;
    }

    let templateFields: Partial<Doc<"campaigns">> = {};
    if (args.kind === "channel_template") {
      if (!args.channelTemplateId) throw new ConvexError({ code: "CHANNEL_TEMPLATE_NOT_FOUND" });
      const template = await resolveTemplate(ctx, channel, args.channelTemplateId);
      const expected = templateBodyVariableCount(template.components);
      const bindings = validateBindings(args.variableBindings ?? [], expected);
      templateFields = {
        channelTemplateId: template._id,
        templateName: template.name,
        templateLanguage: template.languageCode,
        variableBindings: bindings,
      };
    } else {
      templateFields = { messageText: assertText(args.messageText) };
    }
    const audience = normalizeAudience(args.audience);
    const campaignId = await ctx.db.insert("campaigns", {
      tenantId: ctx.tenantId,
      name,
      kind: args.kind,
      businessKey,
      channelId: channel._id,
      ...templateFields,
      contentPreview: previewOf({ kind: args.kind, ...templateFields }),
      audience,
      audienceStatus: "pending",
      audienceSummary: emptyAudienceSummary(),
      stats: emptyCampaignStats(),
      status: "draft",
      createdBy: ctx.memberId,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("campaignEvents", {
      tenantId: ctx.tenantId,
      campaignId,
      type: "campaign.created",
      payload: { kind: args.kind, channelId: channel._id },
      createdAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.channelCampaigns._materializePage, { campaignId });
    await writeAudit(ctx, {
      action: "campaign.created",
      targetType: "campaign",
      targetId: campaignId,
      payload: { kind: args.kind, name },
    });
    return campaignId;
  },
});

export const updateDraft = tenantMutation({
  args: {
    campaignId: v.id("campaigns"),
    name: v.optional(v.string()),
    messageText: v.optional(v.string()),
    channelTemplateId: v.optional(v.id("channelTemplates")),
    variableBindings: v.optional(v.array(bindingValidator)),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "campaigns.create");
    const campaign = await loadChannelCampaign(ctx, args.campaignId);
    if ((campaign.status ?? "draft") !== "draft") throw new ConvexError({ code: "CAMPAIGN_INVALID_STATE" });
    const patch: Partial<Doc<"campaigns">> = { updatedAt: Date.now() };
    if (args.name !== undefined) patch.name = assertName(args.name);
    if (campaign.kind === "channel_text" && args.messageText !== undefined) {
      patch.messageText = assertText(args.messageText);
    }
    if (campaign.kind === "channel_template" && (args.channelTemplateId || args.variableBindings)) {
      const channel = await loadByIdInTenant(ctx, "channels", campaign.channelId!);
      const template = await resolveTemplate(
        ctx,
        channel,
        args.channelTemplateId ?? campaign.channelTemplateId!,
      );
      const expected = templateBodyVariableCount(template.components);
      patch.channelTemplateId = template._id;
      patch.templateName = template.name;
      patch.templateLanguage = template.languageCode;
      patch.variableBindings = validateBindings(
        args.variableBindings ?? campaign.variableBindings ?? [],
        expected,
      );
    }
    patch.contentPreview = previewOf({ ...campaign, ...patch });
    await ctx.db.patch(campaign._id, patch);
    return null;
  },
});

/** Replace the audience of a draft and rebuild its recipient rows. */
export const setAudience = tenantMutation({
  args: { campaignId: v.id("campaigns"), audience: audienceValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "campaigns.create");
    const campaign = await loadChannelCampaign(ctx, args.campaignId);
    if ((campaign.status ?? "draft") !== "draft") throw new ConvexError({ code: "CAMPAIGN_INVALID_STATE" });
    const now = Date.now();
    await ctx.db.patch(campaign._id, {
      audience: normalizeAudience(args.audience),
      audienceStatus: "pending",
      audienceCursor: undefined,
      audienceSummary: emptyAudienceSummary(),
      stats: emptyCampaignStats(),
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.channelCampaigns._clearDraftRecipients, {
      campaignId: campaign._id,
    });
    return null;
  },
});

// ---------------------------------------------------------------------------
// Public: preview
// ---------------------------------------------------------------------------

export const previewAudience = tenantQuery({
  args: { channelId: v.id("channels"), audience: audienceValidator, kind: v.optional(kindValidator) },
  returns: v.object({
    scanned: v.number(),
    matched: v.number(),
    eligible: v.number(),
    capped: v.boolean(),
    pilotReady: v.boolean(),
    blocked: blockedValidator,
    sample: v.array(
      v.object({
        threadId: v.id("channelThreads"),
        threadKey: v.string(),
        label: v.string(),
        leadStatus: v.optional(v.string()),
        blocked: v.optional(v.string()),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const channel = await loadByIdInTenant(ctx, "channels", args.channelId);
    if (!isHubChannel(channel)) throw new ConvexError({ code: "HUB_CHANNEL_NOT_FOUND" });
    const audience = normalizeAudience(args.audience);
    const kind = args.kind ?? "channel_template";
    const now = Date.now();
    const summary = emptyAudienceSummary();
    const sample: Array<{
      threadId: Id<"channelThreads">;
      threadKey: string;
      label: string;
      leadStatus?: string;
      blocked?: string;
    }> = [];

    const consider = async (thread: Doc<"channelThreads">) => {
      if (!(await threadHasMessageEvent(ctx, thread))) return;
      summary.matched += 1;
      const identity = thread.identityId ? await ctx.db.get(thread.identityId) : null;
      const blocked = await blockReasonFor(ctx, {
        channel,
        thread,
        identity,
        kind,
        audience,
        now,
      });
      if (blocked) summary.blocked[blocked] += 1;
      else summary.eligible += 1;
      if (sample.length < 12) {
        sample.push({
          threadId: thread._id,
          threadKey: thread.threadKey,
          label: identity?.displayName ?? identity?.phone ?? thread.threadKey,
          leadStatus: thread.leadStatus,
          blocked: blocked ?? undefined,
        });
      }
    };

    if (audience.threadKeys) {
      for (const threadKey of audience.threadKeys) {
        summary.scanned += 1;
        const thread = await ctx.db
          .query("channelThreads")
          .withIndex("by_channel_thread", (q) => q.eq("channelId", channel._id).eq("threadKey", threadKey))
          .unique();
        if (!thread || thread.tenantId !== ctx.tenantId) {
          summary.missing += 1;
          continue;
        }
        await consider(thread);
      }
    } else {
      const threads = await ctx.db
        .query("channelThreads")
        .withIndex("by_channel_last_event", (q) => q.eq("channelId", channel._id))
        .order("desc")
        .take(PREVIEW_SCAN + 1);
      summary.capped = threads.length > PREVIEW_SCAN;
      for (const thread of threads.slice(0, PREVIEW_SCAN)) {
        summary.scanned += 1;
        if (
          audience.inboundWithinDays !== undefined &&
          thread.lastEventAt < now - audience.inboundWithinDays * 24 * 60 * 60 * 1000
        ) {
          summary.capped = false;
          break;
        }
        if (!matchesAudience(thread, audience, now)) continue;
        await consider(thread);
      }
    }
    return {
      scanned: summary.scanned,
      matched: summary.matched,
      eligible: summary.eligible,
      capped: summary.capped,
      pilotReady: isPilotReady(channel),
      blocked: summary.blocked,
      sample,
    };
  },
});

// ---------------------------------------------------------------------------
// Public: lifecycle
// ---------------------------------------------------------------------------

export const launch = tenantMutation({
  args: {
    campaignId: v.id("campaigns"),
    attestConsent: v.boolean(),
    scheduledAt: v.optional(v.number()),
  },
  returns: v.object({ status: v.string(), eligible: v.number() }),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "campaigns.start");
    const campaign = await loadChannelCampaign(ctx, args.campaignId);
    if ((campaign.status ?? "draft") !== "draft") throw new ConvexError({ code: "CAMPAIGN_INVALID_STATE" });
    if (campaign.audienceStatus === "empty") throw new ConvexError({ code: "CAMPAIGN_NO_ELIGIBLE_RECIPIENTS" });
    if (campaign.audienceStatus !== "ready") throw new ConvexError({ code: "CAMPAIGN_AUDIENCE_NOT_READY" });
    if (!args.attestConsent) throw new ConvexError({ code: "CAMPAIGN_CONSENT_ATTESTATION_REQUIRED" });
    const channel = await loadByIdInTenant(ctx, "channels", campaign.channelId!);
    if (!isHubChannel(channel) || !isPilotReady(channel)) {
      throw new ConvexError({ code: "HUB_PILOT_KILL_SWITCH_ACTIVE" });
    }
    const now = Date.now();
    const summary = readAudienceSummary(campaign.audienceSummary);
    if (args.scheduledAt !== undefined) {
      if (args.scheduledAt < now + SCHEDULE_MIN_MS || args.scheduledAt > now + SCHEDULE_MAX_MS) {
        throw new ConvexError({ code: "INVALID_SCHEDULE" });
      }
      await ctx.db.patch(campaign._id, {
        status: "scheduled",
        scheduledAt: args.scheduledAt,
        consentAttestedBy: ctx.memberId,
        consentAttestedAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("campaignEvents", {
        tenantId: ctx.tenantId,
        campaignId: campaign._id,
        type: "campaign.scheduled",
        payload: { scheduledAt: args.scheduledAt, eligible: summary.eligible },
        createdAt: now,
      });
      await ctx.scheduler.runAt(args.scheduledAt, internal.channelCampaigns._startScheduled, {
        campaignId: campaign._id,
      });
      await writeAudit(ctx, {
        action: "campaign.scheduled",
        targetType: "campaign",
        targetId: campaign._id,
        payload: { scheduledAt: args.scheduledAt, eligible: summary.eligible },
      });
      return { status: "scheduled", eligible: summary.eligible };
    }
    await ctx.db.patch(campaign._id, {
      status: "running",
      startedAt: now,
      consentAttestedBy: ctx.memberId,
      consentAttestedAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("campaignEvents", {
      tenantId: ctx.tenantId,
      campaignId: campaign._id,
      type: "campaign.launched",
      payload: { eligible: summary.eligible, batchSize: BATCH_SIZE },
      createdAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.channelCampaigns._continue, { campaignId: campaign._id });
    await writeAudit(ctx, {
      action: "campaign.launched",
      targetType: "campaign",
      targetId: campaign._id,
      payload: { eligible: summary.eligible },
    });
    return { status: "running", eligible: summary.eligible };
  },
});

export const pause = tenantMutation({
  args: { campaignId: v.id("campaigns") },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "campaigns.cancel");
    const campaign = await loadChannelCampaign(ctx, args.campaignId);
    if (campaign.status !== "running") throw new ConvexError({ code: "CAMPAIGN_INVALID_STATE" });
    const now = Date.now();
    await ctx.db.patch(campaign._id, { status: "paused", pausedAt: now, pauseReason: "manual", updatedAt: now });
    await ctx.db.insert("campaignEvents", {
      tenantId: ctx.tenantId,
      campaignId: campaign._id,
      type: "campaign.paused",
      createdAt: now,
    });
    await writeAudit(ctx, { action: "campaign.paused", targetType: "campaign", targetId: campaign._id });
    return null;
  },
});

export const resume = tenantMutation({
  args: { campaignId: v.id("campaigns") },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "campaigns.start");
    const campaign = await loadChannelCampaign(ctx, args.campaignId);
    if (campaign.status !== "paused") throw new ConvexError({ code: "CAMPAIGN_INVALID_STATE" });
    const channel = await loadByIdInTenant(ctx, "channels", campaign.channelId!);
    if (!isHubChannel(channel) || !isPilotReady(channel)) {
      throw new ConvexError({ code: "HUB_PILOT_KILL_SWITCH_ACTIVE" });
    }
    const now = Date.now();
    await ctx.db.patch(campaign._id, {
      status: "running",
      pausedAt: undefined,
      pauseReason: undefined,
      updatedAt: now,
    });
    await ctx.db.insert("campaignEvents", {
      tenantId: ctx.tenantId,
      campaignId: campaign._id,
      type: "campaign.resumed",
      createdAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.channelCampaigns._continue, { campaignId: campaign._id });
    await writeAudit(ctx, { action: "campaign.resumed", targetType: "campaign", targetId: campaign._id });
    return null;
  },
});

export const cancel = tenantMutation({
  args: { campaignId: v.id("campaigns") },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "campaigns.cancel");
    const campaign = await loadChannelCampaign(ctx, args.campaignId);
    const status = campaign.status ?? "draft";
    if (!["draft", "scheduled", "running", "paused"].includes(status)) {
      throw new ConvexError({ code: "CAMPAIGN_INVALID_STATE" });
    }
    const now = Date.now();
    await ctx.db.patch(campaign._id, {
      status: "cancelled",
      completedAt: now,
      pauseReason: undefined,
      updatedAt: now,
    });
    await ctx.db.insert("campaignEvents", {
      tenantId: ctx.tenantId,
      campaignId: campaign._id,
      type: "campaign.cancelled",
      payload: { previousStatus: status },
      createdAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.channelCampaigns._cancelPending, { campaignId: campaign._id });
    await writeAudit(ctx, { action: "campaign.cancelled", targetType: "campaign", targetId: campaign._id });
    return null;
  },
});

/** New draft with the same message and audience (recipients are recomputed). */
export const duplicate = tenantMutation({
  args: { campaignId: v.id("campaigns"), name: v.optional(v.string()) },
  returns: v.id("campaigns"),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "campaigns.create");
    const source = await loadChannelCampaign(ctx, args.campaignId);
    const now = Date.now();
    const name = assertName(args.name ?? `${source.name} (cópia)`);
    const campaignId = await ctx.db.insert("campaigns", {
      tenantId: ctx.tenantId,
      name,
      kind: source.kind,
      channelId: source.channelId,
      channelTemplateId: source.channelTemplateId,
      templateName: source.templateName,
      templateLanguage: source.templateLanguage,
      messageText: source.messageText,
      variableBindings: source.variableBindings,
      contentPreview: source.contentPreview,
      audience: source.audience,
      audienceStatus: "pending",
      audienceSummary: emptyAudienceSummary(),
      stats: emptyCampaignStats(),
      status: "draft",
      createdBy: ctx.memberId,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("campaignEvents", {
      tenantId: ctx.tenantId,
      campaignId,
      type: "campaign.created",
      payload: { duplicatedFrom: source._id },
      createdAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.channelCampaigns._materializePage, { campaignId });
    return campaignId;
  },
});

/** Manual conversion from the inbox (booking made by phone, walk-in, ...). */
export const recordConversion = tenantMutation({
  args: { threadId: v.id("channelThreads"), label: v.string() },
  returns: v.union(v.id("campaignRecipients"), v.null()),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "leads.update");
    const thread = await loadByIdInTenant(ctx, "channelThreads", args.threadId);
    const label = args.label.trim();
    if (!label || label.length > 80) throw new ConvexError({ code: "INVALID_TEXT" });
    return await markCampaignConversion(ctx, {
      tenantId: ctx.tenantId,
      channelId: thread.channelId,
      threadKey: thread.threadKey,
      label,
      now: Date.now(),
    });
  },
});

// ---------------------------------------------------------------------------
// Public: reads
// ---------------------------------------------------------------------------

export const list = tenantQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(campaignRowValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("campaigns")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .order("desc")
      .filter((q) =>
        q.or(
          q.eq(q.field("kind"), "channel_template"),
          q.eq(q.field("kind"), "channel_text"),
          q.eq(q.field("kind"), "micro_lab"),
        ),
      )
      .paginate({
        cursor: args.paginationOpts.cursor,
        numItems: Math.min(Math.max(args.paginationOpts.numItems, 1), 50),
      });
    return {
      page: result.page.map(rowOf),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const get = tenantQuery({
  args: { campaignId: v.id("campaigns") },
  returns: v.object({
    campaign: campaignRowValidator,
    channelName: v.optional(v.string()),
    templateName: v.optional(v.string()),
    templateLanguage: v.optional(v.string()),
    messageText: v.optional(v.string()),
    variableBindings: v.optional(v.array(bindingValidator)),
    audience: v.any(),
    audienceSummary: audienceSummaryValidator,
    stats: campaignStatsValidator,
    consentAttestedAt: v.optional(v.number()),
    lastBatchAt: v.optional(v.number()),
    batchSize: v.number(),
    sendSpacingMs: v.number(),
    batchIntervalMs: v.number(),
  }),
  handler: async (ctx, args) => {
    const campaign = await loadChannelCampaign(ctx, args.campaignId);
    const channel = campaign.channelId ? await ctx.db.get(campaign.channelId) : null;
    return {
      campaign: rowOf(campaign),
      channelName: channel?.displayName,
      templateName: campaign.templateName,
      templateLanguage: campaign.templateLanguage,
      messageText: campaign.messageText,
      variableBindings: campaign.variableBindings,
      audience: normalizeAudience(campaign.audience),
      audienceSummary: readAudienceSummary(campaign.audienceSummary),
      stats: readCampaignStats(campaign.stats),
      consentAttestedAt: campaign.consentAttestedAt,
      lastBatchAt: campaign.lastBatchAt,
      batchSize: BATCH_SIZE,
      sendSpacingMs: SEND_SPACING_MS,
      batchIntervalMs: BATCH_INTERVAL_MS,
    };
  },
});

const recipientStatusValidator = v.union(
  v.literal("pending"),
  v.literal("queued"),
  v.literal("dispatching"),
  v.literal("sent"),
  v.literal("delivered"),
  v.literal("read"),
  v.literal("replied"),
  v.literal("clicked"),
  v.literal("failed"),
  v.literal("skipped"),
);

const recipientRowValidator = v.object({
  _id: v.id("campaignRecipients"),
  threadId: v.optional(v.id("channelThreads")),
  threadKey: v.optional(v.string()),
  label: v.string(),
  status: v.string(),
  failureCode: v.optional(v.string()),
  failureReason: v.optional(v.string()),
  dispatchAttempts: v.number(),
  nextAttemptAt: v.optional(v.number()),
  sentAt: v.optional(v.number()),
  deliveredAt: v.optional(v.number()),
  readAt: v.optional(v.number()),
  repliedAt: v.optional(v.number()),
  clickedAt: v.optional(v.number()),
  convertedAt: v.optional(v.number()),
  conversionLabel: v.optional(v.string()),
  updatedAt: v.number(),
});

async function recipientRow(ctx: { db: any }, row: Doc<"campaignRecipients">) {
  const contact = (await ctx.db.get(row.contactId)) as Doc<"contacts"> | null;
  return {
    _id: row._id,
    threadId: row.threadId,
    threadKey: row.threadKey,
    label: contact?.name ?? row.identityValue,
    status: row.status,
    failureCode: row.failureCode,
    failureReason: row.failureReason,
    dispatchAttempts: row.dispatchAttempts ?? 0,
    nextAttemptAt: row.nextAttemptAt,
    sentAt: row.sentAt,
    deliveredAt: row.deliveredAt,
    readAt: row.readAt,
    repliedAt: row.repliedAt,
    clickedAt: row.clickedAt,
    convertedAt: row.convertedAt,
    conversionLabel: row.conversionLabel,
    updatedAt: row.updatedAt,
  };
}

export const listRecipients = tenantQuery({
  args: {
    campaignId: v.id("campaigns"),
    status: v.optional(recipientStatusValidator),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(recipientRowValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const campaign = await loadChannelCampaign(ctx, args.campaignId);
    const numItems = Math.min(Math.max(args.paginationOpts.numItems, 1), 100);
    const query = args.status
      ? ctx.db
          .query("campaignRecipients")
          .withIndex("by_campaign_status", (q) =>
            q.eq("campaignId", campaign._id).eq("status", args.status!),
          )
      : ctx.db
          .query("campaignRecipients")
          .withIndex("by_campaign", (q) => q.eq("campaignId", campaign._id));
    const result = await query.order("desc").paginate({ cursor: args.paginationOpts.cursor, numItems });
    const page = [];
    for (const row of result.page) page.push(await recipientRow(ctx, row));
    return { page, isDone: result.isDone, continueCursor: result.continueCursor };
  },
});

export const listEvents = tenantQuery({
  args: { campaignId: v.id("campaigns"), paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(
      v.object({
        _id: v.id("campaignEvents"),
        type: v.string(),
        payload: v.optional(v.any()),
        createdAt: v.number(),
      }),
    ),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const campaign = await loadChannelCampaign(ctx, args.campaignId);
    const result = await ctx.db
      .query("campaignEvents")
      .withIndex("by_campaign", (q) => q.eq("campaignId", campaign._id))
      .order("desc")
      .paginate({
        cursor: args.paginationOpts.cursor,
        numItems: Math.min(Math.max(args.paginationOpts.numItems, 1), 100),
      });
    return {
      page: result.page.map((row) => ({
        _id: row._id,
        type: row.type,
        payload: row.payload,
        createdAt: row.createdAt,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const exportRecipients = tenantQuery({
  args: { campaignId: v.id("campaigns") },
  returns: v.object({ rows: v.array(recipientRowValidator), capped: v.boolean() }),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "campaigns.create");
    const campaign = await loadChannelCampaign(ctx, args.campaignId);
    const rows = await ctx.db
      .query("campaignRecipients")
      .withIndex("by_campaign", (q) => q.eq("campaignId", campaign._id))
      .take(EXPORT_LIMIT + 1);
    const out = [];
    for (const row of rows.slice(0, EXPORT_LIMIT)) out.push(await recipientRow(ctx, row));
    return { rows: out, capped: rows.length > EXPORT_LIMIT };
  },
});

// ---------------------------------------------------------------------------
// Internal: engine steps (all idempotent + self-rescheduling)
// ---------------------------------------------------------------------------

export const _materializePage = internalMutation({
  args: { campaignId: v.id("campaigns") },
  returns: v.object({ done: v.boolean(), inserted: v.number() }),
  handler: async (ctx, args) => {
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign || (campaign.status ?? "draft") !== "draft") return { done: true, inserted: 0 };
    if (campaign.audienceStatus === "ready" || campaign.audienceStatus === "empty") {
      return { done: true, inserted: 0 };
    }
    if (campaign.audienceStatus === "pending") {
      await ctx.db.patch(campaign._id, { audienceStatus: "materializing" });
    }
    const result = await materializePage(ctx, campaign, Date.now());
    if (!result.done) {
      await ctx.scheduler.runAfter(0, internal.channelCampaigns._materializePage, args);
    }
    return result;
  },
});

export const _clearDraftRecipients = internalMutation({
  args: { campaignId: v.id("campaigns") },
  returns: v.object({ deleted: v.number(), isDone: v.boolean() }),
  handler: async (ctx, args) => {
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign || (campaign.status ?? "draft") !== "draft") return { deleted: 0, isDone: true };
    const rows = await ctx.db
      .query("campaignRecipients")
      .withIndex("by_campaign", (q) => q.eq("campaignId", campaign._id))
      .take(200);
    for (const row of rows) await ctx.db.delete(row._id);
    const isDone = rows.length < 200;
    if (isDone) {
      await ctx.scheduler.runAfter(0, internal.channelCampaigns._materializePage, args);
    } else {
      await ctx.scheduler.runAfter(0, internal.channelCampaigns._clearDraftRecipients, args);
    }
    return { deleted: rows.length, isDone };
  },
});

export const _startScheduled = internalMutation({
  args: { campaignId: v.id("campaigns") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign || campaign.status !== "scheduled") return null;
    const now = Date.now();
    await ctx.db.patch(campaign._id, { status: "running", startedAt: now, updatedAt: now });
    await ctx.db.insert("campaignEvents", {
      tenantId: campaign.tenantId,
      campaignId: campaign._id,
      type: "campaign.launched",
      payload: { scheduled: true },
      createdAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.channelCampaigns._continue, args);
    return null;
  },
});

export const _continue = internalMutation({
  args: { campaignId: v.id("campaigns") },
  returns: v.object({ queued: v.number(), pendingRemaining: v.boolean() }),
  handler: async (ctx, args) => {
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign || campaign.status !== "running") return { queued: 0, pendingRemaining: false };
    const now = Date.now();
    const batch = await queueNextBatch(ctx, campaign, now);
    if (batch.queued > 0) {
      await ctx.db.insert("campaignEvents", {
        tenantId: campaign.tenantId,
        campaignId: campaign._id,
        type: "campaign.batch_queued",
        payload: { queued: batch.queued, pendingRemaining: batch.pendingRemaining },
        createdAt: now,
      });
    }
    if (batch.pendingRemaining) {
      await ctx.scheduler.runAfter(BATCH_INTERVAL_MS, internal.channelCampaigns._continue, args);
    } else {
      await ctx.scheduler.runAfter(
        batch.queued * SEND_SPACING_MS + 30_000,
        internal.channelCampaigns._finalize,
        args,
      );
    }
    return batch;
  },
});

export const _finalize = internalMutation({
  args: { campaignId: v.id("campaigns") },
  returns: v.object({ completed: v.boolean(), waiting: v.boolean() }),
  handler: async (ctx, args) => {
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign || campaign.status !== "running") return { completed: false, waiting: false };
    const now = Date.now();
    const pending = await ctx.db
      .query("campaignRecipients")
      .withIndex("by_campaign_status", (q) => q.eq("campaignId", campaign._id).eq("status", "pending"))
      .first();
    if (pending) {
      const delay = Math.max(1_000, (pending.nextAttemptAt ?? now) - now);
      await ctx.scheduler.runAfter(delay, internal.channelCampaigns._continue, args);
      return { completed: false, waiting: true };
    }
    const queued = await ctx.db
      .query("campaignRecipients")
      .withIndex("by_campaign_status", (q) => q.eq("campaignId", campaign._id).eq("status", "queued"))
      .first();
    if (queued) {
      await ctx.scheduler.runAfter(30_000, internal.channelCampaigns._finalize, args);
      return { completed: false, waiting: true };
    }
    const dispatching = await ctx.db
      .query("campaignRecipients")
      .withIndex("by_campaign_status", (q) => q.eq("campaignId", campaign._id).eq("status", "dispatching"))
      .take(50);
    const stillSettling = dispatching.some(
      (row) => row.failureCode !== "OUTBOX_UNKNOWN" && row.updatedAt > now - UNKNOWN_SETTLE_GRACE_MS,
    );
    if (stillSettling) {
      await ctx.scheduler.runAfter(30_000, internal.channelCampaigns._finalize, args);
      return { completed: false, waiting: true };
    }
    const rates = deriveCampaignRates(readCampaignStats(campaign.stats));
    const status: "completed" | "failed" = rates.sent + rates.unknown > 0 ? "completed" : "failed";
    await ctx.db.patch(campaign._id, {
      status,
      completedAt: now,
      pauseReason: status === "failed" ? "Nenhum envio foi aceite pelo canal." : undefined,
      updatedAt: now,
    });
    await ctx.db.insert("campaignEvents", {
      tenantId: campaign.tenantId,
      campaignId: campaign._id,
      type: status === "completed" ? "campaign.completed" : "campaign.failed",
      payload: { sent: rates.sent, failed: rates.failed, unknown: rates.unknown },
      createdAt: now,
    });
    await emitWebhookEvent(ctx, { tenantId: campaign.tenantId, type: "campaign.completed", eventId: `campaign:${campaign._id}:${status}`, payload: { campaignId: campaign._id, name: campaign.name, status, sent: rates.sent, failed: rates.failed, replied: rates.replied, converted: rates.converted }, now });
    return { completed: status === "completed", waiting: false };
  },
});

export const _cancelPending = internalMutation({
  args: { campaignId: v.id("campaigns") },
  returns: v.object({ processed: v.number(), remaining: v.boolean() }),
  handler: async (ctx, args) => {
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign || campaign.status !== "cancelled") return { processed: 0, remaining: false };
    const now = Date.now();
    const rows = await ctx.db
      .query("campaignRecipients")
      .withIndex("by_campaign_status", (q) => q.eq("campaignId", campaign._id).eq("status", "pending"))
      .take(100);
    let stats = readCampaignStats(campaign.stats);
    for (const row of rows) {
      await ctx.db.patch(row._id, { status: "skipped", failureCode: "CANCELLED", updatedAt: now });
      stats = { ...stats, byStatus: { ...stats.byStatus, pending: Math.max(0, stats.byStatus.pending - 1), skipped: stats.byStatus.skipped + 1 } };
    }
    await ctx.db.patch(campaign._id, { stats, updatedAt: now });
    const remaining = rows.length === 100;
    if (remaining) await ctx.scheduler.runAfter(0, internal.channelCampaigns._cancelPending, args);
    return { processed: rows.length, remaining };
  },
});

/** Rebuild `stats` from recipient rows (repair after a bad deploy/backfill). */
export const _recomputeStats = internalMutation({
  args: { campaignId: v.id("campaigns"), cursor: v.optional(v.string()) },
  returns: v.object({ isDone: v.boolean() }),
  handler: async (ctx, args) => {
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) return { isDone: true };
    const page = await ctx.db
      .query("campaignRecipients")
      .withIndex("by_campaign", (q) => q.eq("campaignId", campaign._id))
      .paginate({ cursor: args.cursor ?? null, numItems: 200 });
    let stats = args.cursor ? readCampaignStats(campaign.stats) : emptyCampaignStats();
    for (const row of page.page) stats = accumulateRecipient(stats, row);
    await ctx.db.patch(campaign._id, { stats, updatedAt: Date.now() });
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.channelCampaigns._recomputeStats, {
        campaignId: campaign._id,
        cursor: page.continueCursor,
      });
    }
    return { isDone: page.isDone };
  },
});

export type { BlockReason };
