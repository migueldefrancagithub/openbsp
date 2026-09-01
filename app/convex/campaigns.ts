import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import {
  loadByIdInTenant,
  requireCapability,
  tenantMutation,
  tenantQuery,
} from "./lib/customFunctions";
import type { Doc, Id } from "./_generated/dataModel";
import { recordConsentTransition } from "./lib/consent";
import {
  failureFixForCategory,
  isSafeRetryCategory,
} from "./lib/meta/errorClassifier";

const campaignStatusValidator = v.union(
  v.literal("draft"),
  v.literal("scheduled"),
  v.literal("running"),
  v.literal("paused"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled"),
);

const campaignKindValidator = v.union(
  v.literal("template_broadcast"),
  v.literal("micro_lab"),
);

const microCampaignIntentValidator = v.union(
  v.literal("demo"),
  v.literal("pricing"),
  v.literal("human"),
);

const NAME_MIN = 2;
const NAME_MAX = 80;
const E164_REGEX = /^\+[1-9]\d{6,14}$/;
const DEFAULT_BATCH_SIZE = 1000;
const MAX_BATCH_SIZE = 5000;
const MICRO_CAMPAIGN_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1_000;

type CampaignRecipientStatus =
  | "pending"
  | "queued"
  | "dispatching"
  | "sent"
  | "delivered"
  | "read"
  | "replied"
  | "clicked"
  | "failed"
  | "skipped";

const CAMPAIGN_RECIPIENT_STATUS_RANK: Record<CampaignRecipientStatus, number> =
  {
    pending: 0,
    queued: 1,
    dispatching: 2,
    sent: 3,
    delivered: 4,
    read: 5,
    replied: 6,
    clicked: 7,
    failed: 8,
    skipped: 8,
  };

const failureBreakdownValidator = v.array(
  v.object({
    category: v.string(),
    count: v.number(),
    retrySafe: v.boolean(),
    title: v.string(),
    action: v.string(),
  }),
);

function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

function assertName(name: string): string {
  const cleaned = cleanName(name);
  if (cleaned.length < NAME_MIN || cleaned.length > NAME_MAX) {
    throw new ConvexError({
      code: "INVALID_NAME",
      message: `Name must be ${NAME_MIN}-${NAME_MAX} characters.`,
    });
  }
  return cleaned;
}

function normalizePhone(raw: string): string {
  const digits = raw.trim().replace(/\D/g, "");
  return digits ? `+${digits}` : "";
}

function getRecipientIdentity(
  contact: Doc<"contacts">,
  purpose?: "marketing" | "transactional" | "authentication",
): {
  identityKind: "phone" | "bsuid";
  identityValue: string;
} | null {
  if (purpose === "authentication") {
    return contact.e164
      ? { identityKind: "phone", identityValue: contact.e164 }
      : null;
  }
  if (contact.bsuid) {
    return { identityKind: "bsuid", identityValue: contact.bsuid };
  }
  if (contact.e164) {
    return { identityKind: "phone", identityValue: contact.e164 };
  }
  throw new ConvexError({
    code: "CONTACT_NOT_SENDABLE",
    contactId: contact._id,
  });
}

function compactPreview(value: string, limit = 180): string {
  return value.trim().replace(/\s+/g, " ").slice(0, limit);
}

function normalizeChannelE164(value: string | undefined): string | undefined {
  const digits = value?.replace(/\D/g, "") ?? "";
  if (!/^[1-9]\d{7,17}$/.test(digits)) return undefined;
  return `+${digits}`;
}

function probableBsuid(value: string | undefined): string | undefined {
  const clean = value?.trim();
  if (!clean || normalizeChannelE164(clean)) return undefined;
  return clean;
}

function mapOutboxStatusToCampaignRecipientStatus(
  status: string,
): CampaignRecipientStatus {
  if (status === "accepted") return "sent";
  if (status === "delivered") return "delivered";
  if (status === "read") return "read";
  if (status === "queued" || status === "dispatching") return status;
  if (status === "failed" || status === "unknown") return "failed";
  return "failed";
}

function applyCampaignRecipientTimeline(
  recipient: Partial<Doc<"campaignRecipients">> | null,
  status: CampaignRecipientStatus,
  at: number,
  patch: Record<string, unknown>,
) {
  if (status === "sent") {
    if (!recipient?.sentAt) patch.sentAt = at;
  } else if (status === "delivered") {
    if (!recipient?.sentAt) patch.sentAt = at;
    if (!recipient?.deliveredAt) patch.deliveredAt = at;
  } else if (status === "read") {
    if (!recipient?.sentAt) patch.sentAt = at;
    if (!recipient?.deliveredAt) patch.deliveredAt = at;
    if (!recipient?.readAt) patch.readAt = at;
  }
}

function hasCampaignRecipientTimestamp(
  recipient: Partial<Doc<"campaignRecipients">> | null,
  status: CampaignRecipientStatus,
): boolean {
  if (!recipient) return false;
  if (status === "sent") return !!recipient.sentAt;
  if (status === "delivered") return !!recipient.deliveredAt;
  if (status === "read") return !!recipient.readAt;
  if (status === "replied") return !!recipient.repliedAt;
  if (status === "clicked") return !!recipient.clickedAt;
  if (status === "failed") return recipient.status === "failed";
  return recipient.status === status;
}

async function resolveOrCreateChannelCampaignContact(
  ctx: { db: any; tenantId: Id<"tenants"> },
  args: { channelId: Id<"channels">; threadKey: string; now: number },
): Promise<{
  contactId: Id<"contacts">;
  identityKind: "phone" | "bsuid";
  identityValue: string;
}> {
  const thread = (await ctx.db
    .query("channelThreads")
    .withIndex("by_channel_thread", (q: any) =>
      q.eq("channelId", args.channelId).eq("threadKey", args.threadKey),
    )
    .unique()) as Doc<"channelThreads"> | null;
  if (!thread || thread.tenantId !== ctx.tenantId) {
    throw new ConvexError({ code: "THREAD_NOT_FOUND" });
  }

  const identity = thread.identityId
    ? ((await ctx.db.get(thread.identityId)) as Doc<"channelIdentities"> | null)
    : null;
  const e164 =
    normalizeChannelE164(identity?.phone) ?? normalizeChannelE164(thread.threadKey);
  const bsuid =
    probableBsuid(identity?.providerScopedId) ?? probableBsuid(thread.threadKey);
  const displayName = identity?.displayName?.trim() || undefined;
  const username = identity?.username?.trim() || undefined;

  let contact: Doc<"contacts"> | null = null;
  if (e164) {
    contact = await ctx.db
      .query("contacts")
      .withIndex("by_tenant_phone", (q: any) =>
        q.eq("tenantId", ctx.tenantId).eq("e164", e164),
      )
      .unique();
  }
  if (!contact && bsuid) {
    contact = await ctx.db
      .query("contacts")
      .withIndex("by_tenant_bsuid", (q: any) =>
        q.eq("tenantId", ctx.tenantId).eq("bsuid", bsuid),
      )
      .unique();
  }

  if (contact) {
    const nextTags = Array.from(new Set([...(contact.tags ?? []), "campaign_micro"]));
    const patch: Record<string, unknown> = {};
    if (nextTags.length !== contact.tags.length) patch.tags = nextTags;
    if (displayName && !contact.name) patch.name = displayName;
    if (username && !contact.whatsappUsername) patch.whatsappUsername = username;
    if (e164 && !contact.e164) patch.e164 = e164;
    if (bsuid && !contact.bsuid) patch.bsuid = bsuid;
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(contact._id, patch);
    }
    return {
      contactId: contact._id,
      identityKind: e164 ? "phone" : "bsuid",
      identityValue: e164 ?? contact.bsuid ?? bsuid ?? args.threadKey,
    };
  }

  const contactId = await ctx.db.insert("contacts", {
    tenantId: ctx.tenantId,
    e164,
    bsuid: e164 ? bsuid : bsuid ?? args.threadKey,
    whatsappUsername: username,
    name: displayName,
    tags: ["campaign_micro"],
    customAttributes: {
      source: "openbsp_micro_campaign",
      channelId: args.channelId,
      threadKey: args.threadKey,
    },
    createdAt: args.now,
  });
  return {
    contactId,
    identityKind: e164 ? "phone" : "bsuid",
    identityValue: e164 ?? bsuid ?? args.threadKey,
  };
}

export const createContactList = tenantMutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
  },
  returns: v.id("contactLists"),
  handler: async (ctx, args): Promise<Id<"contactLists">> => {
    requireCapability(ctx.role, "campaigns.create");
    const name = assertName(args.name);
    const existing = await ctx.db
      .query("contactLists")
      .withIndex("by_tenant_name", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("name", name),
      )
      .unique();
    if (existing) {
      throw new ConvexError({ code: "LIST_NAME_EXISTS" });
    }
    const now = Date.now();
    return await ctx.db.insert("contactLists", {
      tenantId: ctx.tenantId,
      name,
      description: args.description?.trim() || undefined,
      createdBy: ctx.memberId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const addContactToList = tenantMutation({
  args: {
    listId: v.id("contactLists"),
    contactId: v.id("contacts"),
  },
  returns: v.object({ added: v.boolean() }),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "campaigns.create");
    await loadByIdInTenant(
      ctx as Parameters<typeof loadByIdInTenant>[0],
      "contactLists",
      args.listId,
    );
    await loadByIdInTenant(
      ctx as Parameters<typeof loadByIdInTenant>[0],
      "contacts",
      args.contactId,
    );
    const existing = await ctx.db
      .query("contactListMembers")
      .withIndex("by_list_contact", (q) =>
        q.eq("listId", args.listId).eq("contactId", args.contactId),
      )
      .unique();
    if (existing) return { added: false };

    const now = Date.now();
    await ctx.db.insert("contactListMembers", {
      tenantId: ctx.tenantId,
      listId: args.listId,
      contactId: args.contactId,
      source: "manual",
      addedBy: ctx.memberId,
      addedAt: now,
    });
    await ctx.db.patch(args.listId, { updatedAt: now });
    return { added: true };
  },
});

export const importContactsToList = tenantMutation({
  args: {
    listId: v.id("contactLists"),
    fileName: v.optional(v.string()),
    rows: v.array(
      v.object({
        phone: v.string(),
        name: v.optional(v.string()),
        locale: v.optional(v.string()),
        tags: v.optional(v.array(v.string())),
        marketingConsentProofText: v.optional(v.string()),
        marketingConsentProofUrl: v.optional(v.string()),
      }),
    ),
  },
  returns: v.object({
    created: v.number(),
    updated: v.number(),
    addedToList: v.number(),
    skipped: v.array(v.object({ phone: v.string(), reason: v.string() })),
    consentsRecorded: v.number(),
  }),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "campaigns.create");
    const list = await loadByIdInTenant(
      ctx as Parameters<typeof loadByIdInTenant>[0],
      "contactLists",
      args.listId,
    );
    if (args.rows.length === 0) {
      throw new ConvexError({ code: "EMPTY_IMPORT" });
    }
    if (args.rows.length > 5000) {
      throw new ConvexError({ code: "IMPORT_TOO_LARGE", limit: 5000 });
    }

    const now = Date.now();
    const jobId = await ctx.db.insert("csvImportJobs", {
      tenantId: ctx.tenantId,
      listId: list._id,
      fileName: args.fileName,
      status: "processing",
      totalRows: args.rows.length,
      createdRows: 0,
      updatedRows: 0,
      skippedRows: 0,
      createdBy: ctx.memberId,
      createdAt: now,
    });

    let created = 0;
    let updated = 0;
    let addedToList = 0;
    let consentsRecorded = 0;
    const skipped: Array<{ phone: string; reason: string }> = [];

    for (const row of args.rows) {
      const e164 = normalizePhone(row.phone);
      if (!E164_REGEX.test(e164)) {
        skipped.push({ phone: row.phone, reason: "invalid_e164" });
        continue;
      }

      const existing = await ctx.db
        .query("contacts")
        .withIndex("by_tenant_phone", (q) =>
          q.eq("tenantId", ctx.tenantId).eq("e164", e164),
        )
        .unique();

      let contactId: Id<"contacts">;
      if (existing) {
        const patch: Partial<{ name: string; locale: string; tags: string[] }> = {};
        if (row.name && !existing.name) patch.name = row.name;
        if (row.locale && !existing.locale) patch.locale = row.locale;
        if (row.tags && row.tags.length > 0 && existing.tags.length === 0) {
          patch.tags = row.tags;
        }
        if (Object.keys(patch).length > 0) {
          await ctx.db.patch(existing._id, patch);
          updated++;
        }
        contactId = existing._id;
      } else {
        contactId = await ctx.db.insert("contacts", {
          tenantId: ctx.tenantId,
          e164,
          name: row.name,
          locale: row.locale,
          tags: row.tags ?? [],
          createdAt: now,
        });
        created++;
      }

      const membership = await ctx.db
        .query("contactListMembers")
        .withIndex("by_list_contact", (q) =>
          q.eq("listId", list._id).eq("contactId", contactId),
        )
        .unique();
      if (!membership) {
        await ctx.db.insert("contactListMembers", {
          tenantId: ctx.tenantId,
          listId: list._id,
          contactId,
          source: "csv_import",
          addedBy: ctx.memberId,
          addedAt: now,
        });
        addedToList++;
      }

      if (row.marketingConsentProofText || row.marketingConsentProofUrl) {
        await recordConsentTransition(ctx, {
          tenantId: ctx.tenantId,
          contactId,
          purpose: "marketing",
          newStatus: "granted",
          source: "campaign_csv_import",
          proofText: row.marketingConsentProofText,
          proofUrl: row.marketingConsentProofUrl,
          capturedByMemberId: ctx.memberId,
        });
        consentsRecorded++;
      }
    }

    await ctx.db.patch(jobId, {
      status: "completed",
      createdRows: created,
      updatedRows: updated,
      skippedRows: skipped.length,
      errorSummary: skipped.length > 0 ? { skipped } : undefined,
      completedAt: Date.now(),
    });
    await ctx.db.patch(list._id, { updatedAt: Date.now() });
    return { created, updated, addedToList, skipped, consentsRecorded };
  },
});

export const listContactLists = tenantQuery({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("contactLists"),
      name: v.string(),
      description: v.optional(v.string()),
      memberCount: v.number(),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const lists = await ctx.db
      .query("contactLists")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .order("desc")
      .collect();
    const out = [];
    for (const list of lists) {
      const members = await ctx.db
        .query("contactListMembers")
        .withIndex("by_list", (q) => q.eq("listId", list._id))
        .collect();
      out.push({
        _id: list._id,
        name: list.name,
        description: list.description,
        memberCount: members.length,
        createdAt: list.createdAt,
        updatedAt: list.updatedAt,
      });
    }
    return out;
  },
});

const segmentSourceValidator = v.union(
  v.literal("ctwa_leads"),
  v.literal("campaign_replied"),
  v.literal("campaign_clicked"),
  v.literal("campaign_failed"),
);

export const createListFromSegment = tenantMutation({
  args: {
    name: v.string(),
    source: segmentSourceValidator,
  },
  returns: v.object({
    listId: v.id("contactLists"),
    added: v.number(),
  }),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "campaigns.create");
    const name = assertName(args.name);
    const existing = await ctx.db
      .query("contactLists")
      .withIndex("by_tenant_name", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("name", name),
      )
      .unique();
    if (existing) {
      throw new ConvexError({ code: "LIST_NAME_EXISTS" });
    }

    const now = Date.now();
    const listId = await ctx.db.insert("contactLists", {
      tenantId: ctx.tenantId,
      name,
      description: segmentDescription(args.source),
      createdBy: ctx.memberId,
      createdAt: now,
      updatedAt: now,
    });
    const contactIds = await collectSegmentContactIds(ctx, args.source);
    let added = 0;
    for (const contactId of contactIds) {
      await ctx.db.insert("contactListMembers", {
        tenantId: ctx.tenantId,
        listId,
        contactId,
        source: "segment",
        addedBy: ctx.memberId,
        addedAt: now,
      });
      added++;
    }
    return { listId, added };
  },
});

export const createDraftCampaign = tenantMutation({
  args: {
    name: v.string(),
    listId: v.id("contactLists"),
    templateId: v.id("templates"),
  },
  returns: v.id("campaigns"),
  handler: async (ctx, args): Promise<Id<"campaigns">> => {
    requireCapability(ctx.role, "campaigns.create");
    const name = assertName(args.name);
    const list = await loadByIdInTenant(
      ctx as Parameters<typeof loadByIdInTenant>[0],
      "contactLists",
      args.listId,
    );
    const template = await loadByIdInTenant(
      ctx as Parameters<typeof loadByIdInTenant>[0],
      "templates",
      args.templateId,
    );
    if (template.status !== "approved") {
      throw new ConvexError({ code: "TEMPLATE_NOT_APPROVED" });
    }
    const version = await ctx.db
      .query("templateVersions")
      .withIndex("by_template_version", (q) =>
        q.eq("templateId", template._id).eq("version", template.currentVersion),
      )
      .unique();
    if (!version) {
      throw new ConvexError({ code: "TEMPLATE_VERSION_MISSING" });
    }
    if (version.parameterSchema.length > 0) {
      throw new ConvexError({ code: "VARIABLE_TEMPLATES_UNSUPPORTED" });
    }

    const members = await ctx.db
      .query("contactListMembers")
      .withIndex("by_list", (q) => q.eq("listId", list._id))
      .collect();
    if (members.length === 0) {
      throw new ConvexError({ code: "EMPTY_CONTACT_LIST" });
    }

    const now = Date.now();
    const campaignId = await ctx.db.insert("campaigns", {
      tenantId: ctx.tenantId,
      name,
      kind: "template_broadcast",
      listId: list._id,
      templateId: template._id,
      templateVersion: template.currentVersion,
      status: "draft",
      createdBy: ctx.memberId,
      createdAt: now,
      updatedAt: now,
    });

    const seenContacts = new Set<string>();
    for (const member of members) {
      if (seenContacts.has(member.contactId)) continue;
      seenContacts.add(member.contactId);
      const contact = await ctx.db.get(member.contactId);
      if (!contact || contact.tenantId !== ctx.tenantId) continue;
      const identity = getRecipientIdentity(contact, purposeFromTemplate(template));
      if (!identity) continue;
      await ctx.db.insert("campaignRecipients", {
        tenantId: ctx.tenantId,
        campaignId,
        contactId: contact._id,
        identityKind: identity.identityKind,
        identityValue: identity.identityValue,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });
    }

    await ctx.db.insert("campaignEvents", {
      tenantId: ctx.tenantId,
      campaignId,
      type: "campaign.created",
      payload: { listId: list._id, templateId: template._id },
      createdAt: now,
    });

    return campaignId;
  },
});

export const _beginMicroCampaign = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    memberId: v.id("members"),
    channelId: v.id("channels"),
    clientNonce: v.string(),
    name: v.string(),
    text: v.string(),
  },
  returns: v.object({
    campaignId: v.id("campaigns"),
    existing: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const channel = await ctx.db.get(args.channelId);
    if (
      !channel ||
      channel.tenantId !== args.tenantId ||
      channel.provider !== "iasolution_hub" ||
      channel.operationalTerritory !== "openbsp"
    ) {
      throw new ConvexError({ code: "HUB_CHANNEL_NOT_FOUND" });
    }
    const businessKey = `hub:micro:${args.channelId}:${args.clientNonce}`;
    const existing = await ctx.db
      .query("campaigns")
      .withIndex("by_tenant_business_key", (q) =>
        q.eq("tenantId", args.tenantId).eq("businessKey", businessKey),
      )
      .unique();
    if (existing) {
      return { campaignId: existing._id, existing: true };
    }

    const now = Date.now();
    const name = assertName(args.name.trim() || "Micro campaign");
    const campaignId = await ctx.db.insert("campaigns", {
      tenantId: args.tenantId,
      name,
      kind: "micro_lab",
      businessKey,
      channelId: channel._id,
      contentPreview: compactPreview(args.text),
      status: "running",
      createdBy: args.memberId,
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("campaignEvents", {
      tenantId: args.tenantId,
      campaignId,
      type: "campaign.micro.created",
      payload: {
        channelId: channel._id,
        channelName: channel.displayName,
        contentPreview: compactPreview(args.text, 120),
      },
      createdAt: now,
    });
    return { campaignId, existing: false };
  },
});

export const _recordMicroCampaignRecipient = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    campaignId: v.id("campaigns"),
    channelId: v.id("channels"),
    threadKey: v.string(),
    outboxId: v.optional(v.id("channelOutbox")),
    dispatchStatus: v.string(),
    providerMessageId: v.optional(v.string()),
    failureReason: v.optional(v.string()),
  },
  returns: v.id("campaignRecipients"),
  handler: async (ctx, args) => {
    const campaign = await ctx.db.get(args.campaignId);
    if (
      !campaign ||
      campaign.tenantId !== args.tenantId ||
      campaign.kind !== "micro_lab" ||
      campaign.channelId !== args.channelId
    ) {
      throw new ConvexError({ code: "CAMPAIGN_NOT_FOUND" });
    }
    const now = Date.now();
    const contact = await resolveOrCreateChannelCampaignContact(
      { db: ctx.db, tenantId: args.tenantId },
      { channelId: args.channelId, threadKey: args.threadKey, now },
    );
    const nextStatus = mapOutboxStatusToCampaignRecipientStatus(
      args.dispatchStatus,
    );

    let recipient: Doc<"campaignRecipients"> | null = null;
    if (args.outboxId) {
      recipient = await ctx.db
        .query("campaignRecipients")
        .withIndex("by_channel_outbox", (q) =>
          q.eq("channelOutboxId", args.outboxId),
        )
        .first();
    }
    if (!recipient) {
      const candidates = await ctx.db
        .query("campaignRecipients")
        .withIndex("by_campaign", (q) => q.eq("campaignId", campaign._id))
        .collect();
      recipient =
        candidates.find(
          (row) =>
            row.channelId === args.channelId && row.threadKey === args.threadKey,
        ) ?? null;
    }

    if (!recipient) {
      const patch: Record<string, unknown> = {};
      applyCampaignRecipientTimeline(null, nextStatus, now, patch);
      const recipientId = await ctx.db.insert("campaignRecipients", {
        tenantId: args.tenantId,
        campaignId: campaign._id,
        contactId: contact.contactId,
        channelId: args.channelId,
        channelOutboxId: args.outboxId,
        threadKey: args.threadKey,
        identityKind: contact.identityKind,
        identityValue: contact.identityValue,
        status: nextStatus,
        providerMessageId: args.providerMessageId,
        failureReason:
          nextStatus === "failed" ? args.failureReason?.slice(0, 500) : undefined,
        createdAt: now,
        updatedAt: now,
        ...patch,
      });
      await ctx.db.insert("campaignEvents", {
        tenantId: args.tenantId,
        campaignId: campaign._id,
        campaignRecipientId: recipientId,
        type: `campaign.recipient.${nextStatus}`,
        payload: {
          channelId: args.channelId,
          channelOutboxId: args.outboxId,
          providerMessageId: args.providerMessageId,
          threadKey: args.threadKey,
          source: "hub_micro_campaign",
          ...(nextStatus === "failed"
            ? { failureReason: args.failureReason?.slice(0, 500) }
            : {}),
        },
        createdAt: now,
      });
      await ctx.db.patch(campaign._id, { updatedAt: now });
      return recipientId;
    }

    const patch: Record<string, unknown> = {
      contactId: contact.contactId,
      identityKind: contact.identityKind,
      identityValue: contact.identityValue,
      providerMessageId: args.providerMessageId ?? recipient.providerMessageId,
      channelOutboxId: args.outboxId ?? recipient.channelOutboxId,
      updatedAt: now,
    };
    const shouldAdvance =
      CAMPAIGN_RECIPIENT_STATUS_RANK[nextStatus] >
        CAMPAIGN_RECIPIENT_STATUS_RANK[recipient.status] ||
      nextStatus === "failed";
    if (shouldAdvance) patch.status = nextStatus;
    if (nextStatus === "failed") {
      patch.failureReason = args.failureReason?.slice(0, 500);
    }
    const hadTimestamp = hasCampaignRecipientTimestamp(recipient, nextStatus);
    applyCampaignRecipientTimeline(recipient, nextStatus, now, patch);
    await ctx.db.patch(recipient._id, patch);
    if (shouldAdvance || !hadTimestamp) {
      await ctx.db.insert("campaignEvents", {
        tenantId: args.tenantId,
        campaignId: campaign._id,
        campaignRecipientId: recipient._id,
        type: `campaign.recipient.${nextStatus}`,
        payload: {
          channelId: args.channelId,
          channelOutboxId: args.outboxId,
          providerMessageId: args.providerMessageId,
          previousStatus: recipient.status,
          threadKey: args.threadKey,
          source: "hub_micro_campaign",
          ...(nextStatus === "failed"
            ? { failureReason: args.failureReason?.slice(0, 500) }
            : {}),
        },
        createdAt: now,
      });
      await ctx.db.patch(campaign._id, { updatedAt: now });
    }
    return recipient._id;
  },
});

export const _finishMicroCampaignLaunch = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    campaignId: v.id("campaigns"),
  },
  returns: v.object({
    status: campaignStatusValidator,
    total: v.number(),
    failed: v.number(),
  }),
  handler: async (ctx, args) => {
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign || campaign.tenantId !== args.tenantId) {
      throw new ConvexError({ code: "CAMPAIGN_NOT_FOUND" });
    }
    const recipients = await ctx.db
      .query("campaignRecipients")
      .withIndex("by_campaign", (q) => q.eq("campaignId", campaign._id))
      .collect();
    const failed = recipients.filter((row) => row.status === "failed").length;
    const accepted = recipients.length - failed;
    const status: "completed" | "failed" =
      accepted > 0 ? "completed" : "failed";
    const now = Date.now();
    if (!campaign.completedAt || campaign.status !== status) {
      await ctx.db.patch(campaign._id, {
        status,
        completedAt: now,
        updatedAt: now,
        pauseReason:
          status === "failed"
            ? "No micro-campaign recipients were accepted by the channel."
            : undefined,
      });
      await ctx.db.insert("campaignEvents", {
        tenantId: args.tenantId,
        campaignId: campaign._id,
        type: "campaign.micro.completed",
        payload: { total: recipients.length, accepted, failed },
        createdAt: now,
      });
    }
    return { status, total: recipients.length, failed };
  },
});

export const _markChannelMicroCampaignEngagement = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    channelId: v.id("channels"),
    threadKey: v.string(),
    receivedAt: v.number(),
    intent: v.optional(microCampaignIntentValidator),
  },
  returns: v.union(
    v.literal("marked_replied"),
    v.literal("marked_clicked"),
    v.literal("noop"),
  ),
  handler: async (ctx, args) => {
    const cutoff = args.receivedAt - MICRO_CAMPAIGN_LOOKBACK_MS;
    const candidates = await ctx.db
      .query("campaignRecipients")
      .withIndex("by_tenant_channel_thread", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("channelId", args.channelId)
          .eq("threadKey", args.threadKey),
      )
      .order("desc")
      .take(20);

    let recipient: Doc<"campaignRecipients"> | null = null;
    for (const candidate of candidates) {
      if (candidate.createdAt > args.receivedAt || candidate.createdAt < cutoff) {
        continue;
      }
      if (candidate.status === "failed" || candidate.status === "skipped") {
        continue;
      }
      const campaign = await ctx.db.get(candidate.campaignId);
      if (
        campaign?.tenantId === args.tenantId &&
        campaign.kind === "micro_lab" &&
        campaign.channelId === args.channelId
      ) {
        recipient = candidate;
        break;
      }
    }
    if (!recipient) return "noop";

    const clicked = !!args.intent;
    const nextStatus: CampaignRecipientStatus = clicked ? "clicked" : "replied";
    const alreadyRecorded = clicked ? !!recipient.clickedAt : !!recipient.repliedAt;
    if (alreadyRecorded && recipient.status === nextStatus) {
      return "noop";
    }

    const patch: Record<string, unknown> = {
      updatedAt: args.receivedAt,
    };
    if (
      CAMPAIGN_RECIPIENT_STATUS_RANK[nextStatus] >
      CAMPAIGN_RECIPIENT_STATUS_RANK[recipient.status]
    ) {
      patch.status = nextStatus;
    }
    if (clicked) {
      if (!recipient.clickedAt) patch.clickedAt = args.receivedAt;
      if (!recipient.clickedButtonPayload) {
        patch.clickedButtonPayload = `intent:${args.intent}`;
      }
    }
    if (!recipient.repliedAt) patch.repliedAt = args.receivedAt;

    await ctx.db.patch(recipient._id, patch);
    await ctx.db.insert("campaignEvents", {
      tenantId: args.tenantId,
      campaignId: recipient.campaignId,
      campaignRecipientId: recipient._id,
      type: clicked ? "campaign.recipient.clicked" : "campaign.recipient.replied",
      payload: clicked ? { intent: args.intent } : undefined,
      createdAt: args.receivedAt,
    });
    await ctx.db.patch(recipient.campaignId, { updatedAt: args.receivedAt });
    return clicked ? "marked_clicked" : "marked_replied";
  },
});

export const recordConversion = tenantMutation({
  args: {
    campaignRecipientId: v.id("campaignRecipients"),
    label: v.optional(v.string()),
    valueMinor: v.optional(v.number()),
    currency: v.optional(v.string()),
  },
  returns: v.object({ converted: v.boolean() }),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "campaigns.start");
    const recipient = await ctx.db.get(args.campaignRecipientId);
    if (!recipient || recipient.tenantId !== ctx.tenantId) {
      throw new ConvexError({ code: "CAMPAIGN_RECIPIENT_NOT_FOUND" });
    }
    const campaign = await ctx.db.get(recipient.campaignId);
    if (!campaign || campaign.tenantId !== ctx.tenantId) {
      throw new ConvexError({ code: "CAMPAIGN_NOT_FOUND" });
    }
    if (recipient.convertedAt) {
      return { converted: false };
    }
    const now = Date.now();
    const label = args.label?.trim().slice(0, 80) || "Manual conversion";
    await ctx.db.patch(recipient._id, {
      convertedAt: now,
      conversionLabel: label,
      conversionValueMinor: args.valueMinor,
      conversionCurrency: args.currency?.trim().slice(0, 12) || undefined,
      updatedAt: now,
    });
    await ctx.db.insert("campaignEvents", {
      tenantId: ctx.tenantId,
      campaignId: campaign._id,
      campaignRecipientId: recipient._id,
      type: "campaign.recipient.converted",
      payload: {
        label,
        valueMinor: args.valueMinor,
        currency: args.currency?.trim().slice(0, 12),
      },
      createdAt: now,
    });
    await ctx.db.patch(campaign._id, { updatedAt: now });
    return { converted: true };
  },
});

export const launchCampaign = tenantMutation({
  args: {
    campaignId: v.id("campaigns"),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    queued: v.number(),
    skippedConsent: v.number(),
    skippedUnsuitable: v.number(),
    pendingRemaining: v.number(),
  }),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "campaigns.start");
    const campaign = await loadByIdInTenant(
      ctx as Parameters<typeof loadByIdInTenant>[0],
      "campaigns",
      args.campaignId,
    );
    if ((campaign.status ?? "draft") !== "draft") {
      throw new ConvexError({
        code: "CAMPAIGN_NOT_DRAFT",
        status: campaign.status ?? "draft",
      });
    }
    if (!campaign.templateId || !campaign.templateVersion) {
      throw new ConvexError({ code: "CAMPAIGN_TEMPLATE_MISSING" });
    }
    const templateVersion = campaign.templateVersion;
    const template = await loadByIdInTenant(
      ctx as Parameters<typeof loadByIdInTenant>[0],
      "templates",
      campaign.templateId,
    );
    if (template.status !== "approved") {
      throw new ConvexError({ code: "TEMPLATE_NOT_APPROVED" });
    }
    const version = await ctx.db
      .query("templateVersions")
      .withIndex("by_template_version", (q) =>
        q.eq("templateId", template._id).eq("version", templateVersion),
      )
      .unique();
    if (!version) throw new ConvexError({ code: "TEMPLATE_VERSION_MISSING" });
    if (version.parameterSchema.length > 0) {
      throw new ConvexError({ code: "VARIABLE_TEMPLATES_UNSUPPORTED" });
    }

    const phoneNumber = await findCampaignPhoneNumber(ctx, template.whatsappAccountId);
    if (!phoneNumber) {
      throw new ConvexError({ code: "PHONE_NUMBER_NOT_CONNECTED" });
    }

    const recipients = await ctx.db
      .query("campaignRecipients")
      .withIndex("by_campaign", (q) => q.eq("campaignId", campaign._id))
      .collect();
    if (recipients.length === 0) {
      throw new ConvexError({ code: "CAMPAIGN_HAS_NO_RECIPIENTS" });
    }

    const purpose =
      template.category === "marketing"
        ? "marketing"
        : template.category === "authentication"
          ? "authentication"
          : "transactional";
    const batchSize = normalizeBatchSize(args.batchSize);
    const now = Date.now();
    const batch = await queuePendingCampaignBatch(ctx, {
      campaign,
      template,
      templateVersion,
      phoneNumber,
      purpose,
      batchSize,
      now,
      eventType: "campaign.recipient.queued",
    });

    await ctx.db.patch(campaign._id, {
      status: batch.queued > 0 ? "running" : "failed",
      startedAt: now,
      updatedAt: now,
      pauseReason:
        batch.queued > 0
          ? undefined
          : "No recipients could be queued. Check consent and contact identities.",
    });
    await ctx.db.insert("campaignEvents", {
      tenantId: ctx.tenantId,
      campaignId: campaign._id,
      type: "campaign.launched",
      payload: { ...batch, batchSize },
      createdAt: now,
    });
    return batch;
  },
});

export const sendNextBatch = tenantMutation({
  args: {
    campaignId: v.id("campaigns"),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    queued: v.number(),
    skippedConsent: v.number(),
    skippedUnsuitable: v.number(),
    pendingRemaining: v.number(),
  }),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "campaigns.start");
    const campaign = await loadByIdInTenant(
      ctx as Parameters<typeof loadByIdInTenant>[0],
      "campaigns",
      args.campaignId,
    );
    if ((campaign.status ?? "draft") !== "running") {
      throw new ConvexError({
        code: "CAMPAIGN_NOT_RUNNING",
        status: campaign.status ?? "draft",
      });
    }
    if (!campaign.templateId || !campaign.templateVersion) {
      throw new ConvexError({ code: "CAMPAIGN_TEMPLATE_MISSING" });
    }
    const template = await loadByIdInTenant(
      ctx as Parameters<typeof loadByIdInTenant>[0],
      "templates",
      campaign.templateId,
    );
    if (template.status !== "approved") {
      throw new ConvexError({ code: "TEMPLATE_NOT_APPROVED" });
    }
    const version = await ctx.db
      .query("templateVersions")
      .withIndex("by_template_version", (q) =>
        q.eq("templateId", template._id).eq("version", campaign.templateVersion!),
      )
      .unique();
    if (!version) throw new ConvexError({ code: "TEMPLATE_VERSION_MISSING" });
    if (version.parameterSchema.length > 0) {
      throw new ConvexError({ code: "VARIABLE_TEMPLATES_UNSUPPORTED" });
    }

    const phoneNumber = await findCampaignPhoneNumber(ctx, template.whatsappAccountId);
    if (!phoneNumber) {
      throw new ConvexError({ code: "PHONE_NUMBER_NOT_CONNECTED" });
    }
    const purpose =
      template.category === "marketing"
        ? "marketing"
        : template.category === "authentication"
          ? "authentication"
          : "transactional";
    const now = Date.now();
    const batchSize = normalizeBatchSize(args.batchSize);
    const batch = await queuePendingCampaignBatch(ctx, {
      campaign,
      template,
      templateVersion: campaign.templateVersion,
      phoneNumber,
      purpose,
      batchSize,
      now,
      eventType: "campaign.recipient.next_batch_queued",
    });
    await ctx.db.patch(campaign._id, { updatedAt: now });
    await ctx.db.insert("campaignEvents", {
      tenantId: ctx.tenantId,
      campaignId: campaign._id,
      type: "campaign.next_batch",
      payload: { ...batch, batchSize },
      createdAt: now,
    });
    return batch;
  },
});

export const retrySafeFailures = tenantMutation({
  args: { campaignId: v.id("campaigns") },
  returns: v.object({
    retried: v.number(),
    skippedUnsafe: v.number(),
    skippedConsent: v.number(),
  }),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "campaigns.start");
    const campaign = await loadByIdInTenant(
      ctx as Parameters<typeof loadByIdInTenant>[0],
      "campaigns",
      args.campaignId,
    );
    if (!campaign.templateId) {
      throw new ConvexError({ code: "CAMPAIGN_TEMPLATE_REQUIRED" });
    }
    const template = await loadByIdInTenant(
      ctx as Parameters<typeof loadByIdInTenant>[0],
      "templates",
      campaign.templateId,
    );
    if (template.status !== "approved") {
      throw new ConvexError({ code: "TEMPLATE_NOT_APPROVED" });
    }
    const phoneNumber = await findCampaignPhoneNumber(ctx, template.whatsappAccountId);
    if (!phoneNumber) {
      throw new ConvexError({ code: "NO_AVAILABLE_PHONE_NUMBER" });
    }

    const purpose =
      template.category === "marketing"
        ? "marketing"
        : template.category === "authentication"
          ? "authentication"
          : "transactional";
    const failedRecipients = await ctx.db
      .query("campaignRecipients")
      .withIndex("by_campaign_status", (q) =>
        q.eq("campaignId", campaign._id).eq("status", "failed"),
      )
      .collect();
    const now = Date.now();
    let retried = 0;
    let skippedUnsafe = 0;
    let skippedConsent = 0;

    for (const recipient of failedRecipients) {
      if (!isSafeRetryCategory(recipient.metaErrorCategory)) {
        skippedUnsafe++;
        continue;
      }
      const contact = await ctx.db.get(recipient.contactId);
      if (
        !contact ||
        contact.tenantId !== ctx.tenantId ||
        !hasSendIdentityForPurpose(contact, purpose)
      ) {
        skippedUnsafe++;
        continue;
      }
      if (!(await hasGrantedConsent(ctx, { contactId: contact._id, purpose }))) {
        skippedConsent++;
        continue;
      }
      const conversationId = await findOrCreateCampaignConversation(ctx, {
        phoneNumberId: phoneNumber._id,
        contactId: contact._id,
        now,
      });
      const previousRetryEvents = await ctx.db
        .query("campaignEvents")
        .withIndex("by_recipient", (q) =>
          q.eq("campaignRecipientId", recipient._id),
        )
        .collect();
      const retryNumber =
        previousRetryEvents.filter(
          (event: Doc<"campaignEvents">) =>
            event.type === "campaign.recipient.retry_queued",
        ).length + 1;
      const messageId = await ctx.db.insert("messages", {
        tenantId: ctx.tenantId,
        conversationId,
        direction: "outgoing",
        businessKey: `campaign:${campaign._id}:${recipient._id}:retry:${retryNumber}:tpl:${template._id}:v${campaign.templateVersion ?? template.currentVersion}`,
        type: "template",
        content: {
          template: {
            name: template.name,
            language: template.language,
            version: campaign.templateVersion ?? template.currentVersion,
            variables: [],
          },
        },
        status: "queued",
        dispatchAttempts: 0,
        sentByCampaignId: campaign._id,
        templateId: template._id,
        templateVersion: campaign.templateVersion ?? template.currentVersion,
        pricingCategory:
          template.category === "marketing"
            ? "marketing"
            : template.category === "authentication"
              ? "authentication"
              : "utility",
        createdAt: now,
      });
      await ctx.db.patch(recipient._id, {
        messageId,
        status: "queued",
        failureCode: undefined,
        failureReason: undefined,
        metaErrorCategory: undefined,
        updatedAt: now,
      });
      await ctx.db.patch(conversationId, { lastMessageAt: now });
      await ctx.scheduler.runAfter(
        Math.max(1, retried * 1500),
        internal.messages._dispatchOne,
        {
          messageId,
        },
      );
      await ctx.db.insert("campaignEvents", {
        tenantId: ctx.tenantId,
        campaignId: campaign._id,
        campaignRecipientId: recipient._id,
        type: "campaign.recipient.retry_queued",
        messageId,
        payload: { retryNumber },
        createdAt: now,
      });
      retried++;
    }

    if (retried > 0) {
      await ctx.db.patch(campaign._id, {
        status: "running",
        pauseReason: undefined,
        updatedAt: now,
      });
    }

    return { retried, skippedUnsafe, skippedConsent };
  },
});

export const _markInboundEngagement = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    contactId: v.id("contacts"),
    receivedAt: v.number(),
    buttonPayload: v.optional(v.string()),
  },
  returns: v.union(
    v.literal("marked_replied"),
    v.literal("marked_clicked"),
    v.literal("noop"),
  ),
  handler: async (ctx, args) => {
    const candidates = await ctx.db
      .query("campaignRecipients")
      .withIndex("by_contact", (q) =>
        q.eq("tenantId", args.tenantId).eq("contactId", args.contactId),
      )
      .collect();
    const recipient = candidates
      .filter((row) =>
        ["queued", "dispatching", "sent", "delivered", "read", "replied"].includes(
          row.status,
        ),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt)[0];
    if (!recipient) return "noop";

    const clicked = !!args.buttonPayload;
    if (recipient.status === "clicked" && clicked) return "noop";
    const nextStatus = clicked ? "clicked" : "replied";
    await ctx.db.patch(recipient._id, {
      status: nextStatus,
      clickedButtonPayload: clicked
        ? args.buttonPayload?.slice(0, 500)
        : recipient.clickedButtonPayload,
      clickedAt: clicked ? (recipient.clickedAt ?? args.receivedAt) : recipient.clickedAt,
      repliedAt: args.receivedAt,
      updatedAt: args.receivedAt,
    });
    await ctx.db.insert("campaignEvents", {
      tenantId: args.tenantId,
      campaignId: recipient.campaignId,
      campaignRecipientId: recipient._id,
      type: clicked ? "campaign.recipient.clicked" : "campaign.recipient.replied",
      payload: clicked ? { buttonPayload: args.buttonPayload } : undefined,
      createdAt: args.receivedAt,
    });
    return clicked ? "marked_clicked" : "marked_replied";
  },
});

export const listCampaigns = tenantQuery({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("campaigns"),
      name: v.string(),
      kind: campaignKindValidator,
      status: campaignStatusValidator,
      channelName: v.optional(v.string()),
      contentPreview: v.optional(v.string()),
      listName: v.optional(v.string()),
      templateName: v.optional(v.string()),
      pauseReason: v.optional(v.string()),
      stats: v.object({
        total: v.number(),
        pending: v.number(),
        queued: v.number(),
        dispatching: v.number(),
        sent: v.number(),
        delivered: v.number(),
        read: v.number(),
        replied: v.number(),
        clicked: v.number(),
        converted: v.number(),
        failed: v.number(),
        skipped: v.number(),
      }),
      failureBreakdown: failureBreakdownValidator,
      startedAt: v.optional(v.number()),
      completedAt: v.optional(v.number()),
      createdAt: v.number(),
      updatedAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("campaigns")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .order("desc")
      .collect();
    const out = [];
    for (const campaign of rows) {
      out.push(await describeCampaign(ctx, campaign));
    }
    return out;
  },
});

export const getCampaign = tenantQuery({
  args: { campaignId: v.id("campaigns") },
  returns: v.object({
    _id: v.id("campaigns"),
    name: v.string(),
    kind: campaignKindValidator,
    status: campaignStatusValidator,
    channelName: v.optional(v.string()),
    contentPreview: v.optional(v.string()),
    listName: v.optional(v.string()),
    templateName: v.optional(v.string()),
    pauseReason: v.optional(v.string()),
    stats: v.object({
      total: v.number(),
      pending: v.number(),
      queued: v.number(),
      dispatching: v.number(),
      sent: v.number(),
      delivered: v.number(),
      read: v.number(),
      replied: v.number(),
      clicked: v.number(),
      converted: v.number(),
      failed: v.number(),
      skipped: v.number(),
    }),
    failureBreakdown: failureBreakdownValidator,
    recipients: v.array(
      v.object({
        _id: v.id("campaignRecipients"),
        contactId: v.id("contacts"),
        displayName: v.string(),
        identityKind: v.union(v.literal("phone"), v.literal("bsuid")),
        identityValue: v.string(),
        status: v.string(),
        failureCode: v.optional(v.string()),
        failureReason: v.optional(v.string()),
        metaErrorCategory: v.optional(v.string()),
        sentAt: v.optional(v.number()),
        deliveredAt: v.optional(v.number()),
        readAt: v.optional(v.number()),
        repliedAt: v.optional(v.number()),
        clickedAt: v.optional(v.number()),
        convertedAt: v.optional(v.number()),
        conversionLabel: v.optional(v.string()),
      }),
    ),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    const campaign = await loadByIdInTenant(
      ctx as Parameters<typeof loadByIdInTenant>[0],
      "campaigns",
      args.campaignId,
    );
    const summary = await describeCampaign(ctx, campaign);
    const recipients = await ctx.db
      .query("campaignRecipients")
      .withIndex("by_campaign", (q) => q.eq("campaignId", campaign._id))
      .collect();
    const recipientRows = [];
    for (const recipient of recipients) {
      const contact = await ctx.db.get(recipient.contactId);
      recipientRows.push({
        _id: recipient._id,
        contactId: recipient.contactId,
        displayName:
          contact?.name ??
          contact?.whatsappUsername ??
          contact?.e164 ??
          contact?.bsuid ??
          "(unknown)",
        identityKind: recipient.identityKind,
        identityValue: recipient.identityValue,
        status: recipient.status,
        failureCode: recipient.failureCode,
        failureReason: recipient.failureReason,
        metaErrorCategory: recipient.metaErrorCategory,
        sentAt: recipient.sentAt,
        deliveredAt: recipient.deliveredAt,
        readAt: recipient.readAt,
        repliedAt: recipient.repliedAt,
        clickedAt: recipient.clickedAt,
        convertedAt: recipient.convertedAt,
        conversionLabel: recipient.conversionLabel,
      });
    }
    return { ...summary, recipients: recipientRows };
  },
});

export const listEvents = tenantQuery({
  args: {
    campaignId: v.id("campaigns"),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("campaignEvents"),
      type: v.string(),
      createdAt: v.number(),
      messageId: v.optional(v.id("messages")),
      campaignRecipientId: v.optional(v.id("campaignRecipients")),
      payload: v.optional(v.any()),
      recipient: v.optional(
        v.object({
          contactId: v.id("contacts"),
          displayName: v.string(),
          identityKind: v.union(v.literal("phone"), v.literal("bsuid")),
          identityValue: v.string(),
          status: v.string(),
          failureCode: v.optional(v.string()),
          failureReason: v.optional(v.string()),
          metaErrorCategory: v.optional(v.string()),
          sentAt: v.optional(v.number()),
          deliveredAt: v.optional(v.number()),
          readAt: v.optional(v.number()),
          repliedAt: v.optional(v.number()),
          clickedAt: v.optional(v.number()),
          convertedAt: v.optional(v.number()),
          conversionLabel: v.optional(v.string()),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    await loadByIdInTenant(
      ctx as Parameters<typeof loadByIdInTenant>[0],
      "campaigns",
      args.campaignId,
    );
    const limit = Math.min(150, Math.max(1, Math.floor(args.limit ?? 80)));
    const events = await ctx.db
      .query("campaignEvents")
      .withIndex("by_campaign", (q) => q.eq("campaignId", args.campaignId))
      .order("desc")
      .take(limit);

    const out = [];
    for (const event of events) {
      let recipientInfo:
        | {
            contactId: Id<"contacts">;
            displayName: string;
            identityKind: "phone" | "bsuid";
            identityValue: string;
            status: string;
            failureCode?: string;
            failureReason?: string;
            metaErrorCategory?: string;
            sentAt?: number;
            deliveredAt?: number;
            readAt?: number;
            repliedAt?: number;
            clickedAt?: number;
            convertedAt?: number;
            conversionLabel?: string;
          }
        | undefined;
      if (event.campaignRecipientId) {
        const recipient = await ctx.db.get(event.campaignRecipientId);
        if (recipient && recipient.tenantId === ctx.tenantId) {
          const contact = await ctx.db.get(recipient.contactId);
          recipientInfo = {
            contactId: recipient.contactId,
            displayName:
              contact?.name ??
              contact?.whatsappUsername ??
              contact?.e164 ??
              contact?.bsuid ??
              "(unknown)",
            identityKind: recipient.identityKind,
            identityValue: recipient.identityValue,
            status: recipient.status,
            failureCode: recipient.failureCode,
            failureReason: recipient.failureReason,
            metaErrorCategory: recipient.metaErrorCategory,
            sentAt: recipient.sentAt,
            deliveredAt: recipient.deliveredAt,
            readAt: recipient.readAt,
            repliedAt: recipient.repliedAt,
            clickedAt: recipient.clickedAt,
            convertedAt: recipient.convertedAt,
            conversionLabel: recipient.conversionLabel,
          };
        }
      }
      out.push({
        _id: event._id,
        type: event.type,
        createdAt: event.createdAt,
        messageId: event.messageId,
        campaignRecipientId: event.campaignRecipientId,
        payload: event.payload,
        recipient: recipientInfo,
      });
    }
    return out;
  },
});

export const exportFailedContacts = tenantQuery({
  args: { campaignId: v.id("campaigns") },
  returns: v.array(
    v.object({
      contactId: v.id("contacts"),
      displayName: v.string(),
      phone: v.optional(v.string()),
      bsuid: v.optional(v.string()),
      status: v.string(),
      failureCode: v.optional(v.string()),
      failureReason: v.optional(v.string()),
      metaErrorCategory: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    await loadByIdInTenant(
      ctx as Parameters<typeof loadByIdInTenant>[0],
      "campaigns",
      args.campaignId,
    );
    const recipients = await ctx.db
      .query("campaignRecipients")
      .withIndex("by_campaign_status", (q) =>
        q.eq("campaignId", args.campaignId).eq("status", "failed"),
      )
      .collect();
    const rows = [];
    for (const recipient of recipients) {
      const contact = await ctx.db.get(recipient.contactId);
      if (!contact || contact.tenantId !== ctx.tenantId) continue;
      rows.push({
        contactId: contact._id,
        displayName:
          contact.name ??
          contact.whatsappUsername ??
          contact.e164 ??
          contact.bsuid ??
          "(unknown)",
        phone: contact.e164,
        bsuid: contact.bsuid,
        status: recipient.status,
        failureCode: recipient.failureCode,
        failureReason: recipient.failureReason,
        metaErrorCategory: recipient.metaErrorCategory,
      });
    }
    return rows;
  },
});

async function describeCampaign(
  ctx: { db: any; tenantId: Id<"tenants"> },
  campaign: Doc<"campaigns">,
) {
  const [list, template, channel, recipients] = await Promise.all([
    campaign.listId ? ctx.db.get(campaign.listId) : null,
    campaign.templateId ? ctx.db.get(campaign.templateId) : null,
    campaign.channelId ? ctx.db.get(campaign.channelId) : null,
    ctx.db
      .query("campaignRecipients")
      .withIndex("by_campaign", (q: any) => q.eq("campaignId", campaign._id))
      .collect(),
  ]);
  return {
    _id: campaign._id,
    name: campaign.name,
    kind: campaign.kind ?? "template_broadcast",
    status: campaign.status ?? "draft",
    channelName:
      channel?.tenantId === ctx.tenantId ? channel.displayName : undefined,
    contentPreview: campaign.contentPreview,
    listName: list?.tenantId === ctx.tenantId ? list.name : undefined,
    templateName:
      template?.tenantId === ctx.tenantId ? template.name : undefined,
    pauseReason: campaign.pauseReason,
    stats: countRecipientStatuses(recipients),
    failureBreakdown: buildFailureBreakdown(recipients),
    startedAt: campaign.startedAt,
    completedAt: campaign.completedAt,
    createdAt: campaign.createdAt,
    updatedAt: campaign.updatedAt,
  };
}

function buildFailureBreakdown(recipients: Array<Doc<"campaignRecipients">>) {
  const counts = new Map<string, number>();
  for (const recipient of recipients) {
    if (recipient.status !== "failed") continue;
    const category = recipient.metaErrorCategory ?? "network_or_unknown";
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([category, count]) => {
      const fix = failureFixForCategory(category);
      return {
        category,
        count,
        retrySafe: fix.retrySafe,
        title: fix.title,
        action: fix.action,
      };
    })
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
}

function countRecipientStatuses(recipients: Array<Doc<"campaignRecipients">>) {
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
    converted: 0,
    failed: 0,
    skipped: 0,
  };
  for (const r of recipients) {
    if (r.convertedAt) stats.converted++;
    if (r.status === "failed") stats.failed++;
    else if (r.status === "skipped") stats.skipped++;
    else if (r.status === "clicked") stats.clicked++;
    else if (r.status === "replied") stats.replied++;
    else if (r.status === "read") stats.read++;
    else if (r.status === "delivered") stats.delivered++;
    else if (r.status === "sent") stats.sent++;
    else if (r.status === "dispatching") stats.dispatching++;
    else if (r.status === "queued") stats.queued++;
    else stats.pending++;
  }
  return stats;
}

function segmentDescription(source: string): string {
  if (source === "ctwa_leads") return "Contacts from Click-to-WhatsApp leads.";
  if (source === "campaign_replied") return "Contacts who replied to a campaign.";
  if (source === "campaign_clicked") return "Contacts who clicked a campaign button.";
  return "Contacts who failed in a previous campaign.";
}

async function collectSegmentContactIds(
  ctx: { db: any; tenantId: Id<"tenants"> },
  source: "ctwa_leads" | "campaign_replied" | "campaign_clicked" | "campaign_failed",
): Promise<Array<Id<"contacts">>> {
  const ids = new Set<Id<"contacts">>();
  if (source === "ctwa_leads") {
    const conversations = await ctx.db
      .query("conversations")
      .withIndex("by_tenant_lastmsg", (q: any) => q.eq("tenantId", ctx.tenantId))
      .collect();
    for (const conversation of conversations) {
      if (conversation.leadSource === "ctwa") ids.add(conversation.contactId);
    }
    return Array.from(ids);
  }

  const desiredStatus =
    source === "campaign_replied"
      ? "replied"
      : source === "campaign_clicked"
        ? "clicked"
        : "failed";
  const campaigns = await ctx.db
    .query("campaigns")
    .withIndex("by_tenant", (q: any) => q.eq("tenantId", ctx.tenantId))
    .collect();
  for (const campaign of campaigns) {
    const recipients = await ctx.db
      .query("campaignRecipients")
      .withIndex("by_campaign_status", (q: any) =>
        q.eq("campaignId", campaign._id).eq("status", desiredStatus),
      )
      .collect();
    for (const recipient of recipients) {
      ids.add(recipient.contactId);
    }
  }
  return Array.from(ids);
}

export const _evaluateSafetyPause = internalMutation({
  args: {
    campaignId: v.id("campaigns"),
    threshold: v.optional(v.number()),
    minFailed: v.optional(v.number()),
  },
  returns: v.object({
    paused: v.boolean(),
    failureRate: v.number(),
    failed: v.number(),
    considered: v.number(),
  }),
  handler: async (ctx, args) => {
    const threshold = args.threshold ?? 0.2;
    const minFailed = args.minFailed ?? 5;
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign || campaign.status !== "running") {
      return { paused: false, failureRate: 0, failed: 0, considered: 0 };
    }
    const recipients = await ctx.db
      .query("campaignRecipients")
      .withIndex("by_campaign", (q) => q.eq("campaignId", args.campaignId))
      .collect();
    const considered = recipients.filter(
      (r) =>
        r.status === "sent" ||
        r.status === "delivered" ||
        r.status === "read" ||
        r.status === "failed",
    ).length;
    const failed = recipients.filter((r) => r.status === "failed").length;
    const failureRate = considered > 0 ? failed / considered : 0;
    if (failed >= minFailed && failureRate >= threshold) {
      const now = Date.now();
      await ctx.db.patch(args.campaignId, {
        status: "paused",
        pausedAt: now,
        failureRatePausedAt: now,
        failureRateThreshold: threshold,
        pauseReason: `Paused automatically because failure rate reached ${Math.round(
          failureRate * 100,
        )}% (${failed}/${considered}).`,
        updatedAt: now,
      });
      await ctx.db.insert("campaignEvents", {
        tenantId: campaign.tenantId,
        campaignId: args.campaignId,
        type: "campaign.auto_paused.failure_rate",
        payload: { threshold, minFailed, failed, considered, failureRate },
        createdAt: now,
      });
      return { paused: true, failureRate, failed, considered };
    }
    return { paused: false, failureRate, failed, considered };
  },
});

function normalizeBatchSize(batchSize?: number): number {
  if (batchSize === undefined) return DEFAULT_BATCH_SIZE;
  const rounded = Math.floor(batchSize);
  if (!Number.isFinite(rounded) || rounded < 1) {
    throw new ConvexError({
      code: "INVALID_BATCH_SIZE",
      message: "Batch size must be at least 1.",
    });
  }
  return Math.min(rounded, MAX_BATCH_SIZE);
}

async function queuePendingCampaignBatch(
  ctx: {
    db: any;
    scheduler: any;
    tenantId: Id<"tenants">;
  },
  args: {
    campaign: Doc<"campaigns">;
    template: Doc<"templates">;
    templateVersion: number;
    phoneNumber: Doc<"phoneNumbers">;
    purpose: "marketing" | "transactional" | "authentication";
    batchSize: number;
    now: number;
    eventType: string;
  },
): Promise<{
  queued: number;
  skippedConsent: number;
  skippedUnsuitable: number;
  pendingRemaining: number;
}> {
  const pendingRecipients = await ctx.db
    .query("campaignRecipients")
    .withIndex("by_campaign_status", (q: any) =>
      q.eq("campaignId", args.campaign._id).eq("status", "pending"),
    )
    .collect();
  const orderedRecipients = pendingRecipients
    .slice()
    .sort(
      (a: Doc<"campaignRecipients">, b: Doc<"campaignRecipients">) =>
        a.createdAt - b.createdAt,
    );

  let queued = 0;
  let skippedConsent = 0;
  let skippedUnsuitable = 0;

  for (const recipient of orderedRecipients) {
    if (queued >= args.batchSize) break;
    const contact = await ctx.db.get(recipient.contactId);
    if (
      !contact ||
      contact.tenantId !== ctx.tenantId ||
      !hasSendIdentityForPurpose(contact, args.purpose)
    ) {
      skippedUnsuitable++;
      await markRecipientSkipped(
        ctx,
        recipient,
        args.purpose === "authentication"
          ? "authentication_requires_phone_identity"
          : "missing_send_identity",
        args.now,
      );
      continue;
    }
    if (
      !(await hasGrantedConsent(ctx, {
        contactId: contact._id,
        purpose: args.purpose,
      }))
    ) {
      skippedConsent++;
      await markRecipientSkipped(ctx, recipient, "consent_required", args.now);
      continue;
    }

    const conversationId = await findOrCreateCampaignConversation(ctx, {
      phoneNumberId: args.phoneNumber._id,
      contactId: contact._id,
      now: args.now,
    });
    const businessKey = `campaign:${args.campaign._id}:${recipient._id}:tpl:${args.template._id}:v${args.templateVersion}`;
    const existing = await ctx.db
      .query("messages")
      .withIndex("by_business_key", (q: any) => q.eq("businessKey", businessKey))
      .unique();
    const messageId =
      existing?._id ??
      (await ctx.db.insert("messages", {
        tenantId: ctx.tenantId,
        conversationId,
        direction: "outgoing",
        businessKey,
        type: "template",
        content: {
          template: {
            name: args.template.name,
            language: args.template.language,
            version: args.templateVersion,
            variables: [],
          },
        },
        status: "queued",
        dispatchAttempts: 0,
        sentByCampaignId: args.campaign._id,
        templateId: args.template._id,
        templateVersion: args.templateVersion,
        pricingCategory:
          args.template.category === "marketing"
            ? "marketing"
            : args.template.category === "authentication"
              ? "authentication"
              : "utility",
        createdAt: args.now,
      }));

    await ctx.db.patch(recipient._id, {
      messageId,
      status: existing?.status === "dispatching" ? "dispatching" : "queued",
      updatedAt: args.now,
    });
    await ctx.db.patch(conversationId, { lastMessageAt: args.now });
    await ctx.scheduler.runAfter(
      Math.max(1, queued * 1500),
      internal.messages._dispatchOne,
      {
        messageId,
      },
    );
    await ctx.db.insert("campaignEvents", {
      tenantId: ctx.tenantId,
      campaignId: args.campaign._id,
      campaignRecipientId: recipient._id,
      type: args.eventType,
      messageId,
      payload: { batchSize: args.batchSize },
      createdAt: args.now,
    });
    queued++;
  }

  const remaining = await ctx.db
    .query("campaignRecipients")
    .withIndex("by_campaign_status", (q: any) =>
      q.eq("campaignId", args.campaign._id).eq("status", "pending"),
    )
    .collect();

  return {
    queued,
    skippedConsent,
    skippedUnsuitable,
    pendingRemaining: remaining.length,
  };
}

function hasSendIdentity(contact: Doc<"contacts">): boolean {
  return !!(contact.bsuid || contact.e164);
}

function hasSendIdentityForPurpose(
  contact: Doc<"contacts">,
  purpose: "marketing" | "transactional" | "authentication",
): boolean {
  if (purpose === "authentication") return !!contact.e164;
  return hasSendIdentity(contact);
}

function purposeFromTemplate(
  template: Doc<"templates">,
): "marketing" | "transactional" | "authentication" {
  return template.category === "marketing"
    ? "marketing"
    : template.category === "authentication"
      ? "authentication"
      : "transactional";
}

async function hasGrantedConsent(
  ctx: { db: any; tenantId: Id<"tenants"> },
  args: {
    contactId: Id<"contacts">;
    purpose: "marketing" | "transactional" | "authentication";
  },
): Promise<boolean> {
  const current = await ctx.db
    .query("currentConsents")
    .withIndex("by_tenant_contact_purpose_channel", (q: any) =>
      q
        .eq("tenantId", ctx.tenantId)
        .eq("contactId", args.contactId)
        .eq("purpose", args.purpose)
        .eq("channel", "whatsapp"),
    )
    .unique();
  return current?.status === "granted";
}

async function findCampaignPhoneNumber(
  ctx: { db: any; tenantId: Id<"tenants"> },
  whatsappAccountId: Id<"whatsappAccounts">,
): Promise<Doc<"phoneNumbers"> | null> {
  const rows = await ctx.db
    .query("phoneNumbers")
    .withIndex("by_tenant", (q: any) => q.eq("tenantId", ctx.tenantId))
    .collect();
  return (
    rows.find(
      (phone: Doc<"phoneNumbers">) =>
        phone.whatsappAccountId === whatsappAccountId &&
        (!phone.circuitBreakerUntil || phone.circuitBreakerUntil <= Date.now()),
    ) ?? null
  );
}

async function findOrCreateCampaignConversation(
  ctx: { db: any; tenantId: Id<"tenants"> },
  args: {
    phoneNumberId: Id<"phoneNumbers">;
    contactId: Id<"contacts">;
    now: number;
  },
): Promise<Id<"conversations">> {
  const existing = await ctx.db
    .query("conversations")
    .withIndex("by_tenant_phone_contact", (q: any) =>
      q
        .eq("tenantId", ctx.tenantId)
        .eq("phoneNumberId", args.phoneNumberId)
        .eq("contactId", args.contactId),
    )
    .filter((q: any) => q.neq(q.field("status"), "closed"))
    .first();
  if (existing) return existing._id;
  return await ctx.db.insert("conversations", {
    tenantId: ctx.tenantId,
    phoneNumberId: args.phoneNumberId,
    contactId: args.contactId,
    status: "open",
    lastMessageAt: args.now,
    unreadCount: 0,
    tags: ["campaign"],
  });
}

async function markRecipientSkipped(
  ctx: { db: any; tenantId: Id<"tenants"> },
  recipient: Doc<"campaignRecipients">,
  reason: string,
  now: number,
): Promise<void> {
  await ctx.db.patch(recipient._id, {
    status: "skipped",
    failureReason: reason,
    updatedAt: now,
  });
  await ctx.db.insert("campaignEvents", {
    tenantId: ctx.tenantId,
    campaignId: recipient.campaignId,
    campaignRecipientId: recipient._id,
    type: "campaign.recipient.skipped",
    payload: { reason },
    createdAt: now,
  });
}
