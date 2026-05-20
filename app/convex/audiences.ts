import { ConvexError, v } from "convex/values";
import {
  requireCapability,
  tenantMutation,
  tenantQuery,
} from "./lib/customFunctions";
import type { Doc, Id } from "./_generated/dataModel";

const NAME_MIN = 2;
const NAME_MAX = 80;
const SAMPLE_LIMIT = 25;

const consentStatusValidator = v.union(
  v.literal("granted"),
  v.literal("revoked"),
  v.literal("unknown"),
);

const leadSourceValidator = v.union(
  v.literal("ctwa"),
  v.literal("organic"),
  v.literal("campaign_reply"),
  v.literal("unknown"),
);

const opportunityStatusValidator = v.union(
  v.literal("new"),
  v.literal("contacted"),
  v.literal("replied"),
  v.literal("opportunity"),
  v.literal("booked"),
  v.literal("lost"),
);

const campaignRecipientStatusValidator = v.union(
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

const audienceCriteriaValidator = v.object({
  logic: v.optional(v.union(v.literal("all"), v.literal("any"))),
  search: v.optional(v.string()),
  includeTags: v.optional(v.array(v.string())),
  excludeTags: v.optional(v.array(v.string())),
  marketingConsent: v.optional(
    v.union(v.literal("any"), consentStatusValidator),
  ),
  transactionalConsent: v.optional(
    v.union(v.literal("any"), consentStatusValidator),
  ),
  leadSources: v.optional(v.array(leadSourceValidator)),
  opportunityStatuses: v.optional(v.array(opportunityStatusValidator)),
  ctwaWindow: v.optional(
    v.union(
      v.literal("any"),
      v.literal("open"),
      v.literal("expiring_6h"),
      v.literal("expired"),
    ),
  ),
  createdAfter: v.optional(v.number()),
  createdBefore: v.optional(v.number()),
  lastMessageAfter: v.optional(v.number()),
  lastMessageBefore: v.optional(v.number()),
  campaignId: v.optional(v.id("campaigns")),
  templateId: v.optional(v.id("templates")),
  campaignRecipientStatuses: v.optional(
    v.array(campaignRecipientStatusValidator),
  ),
  excludeMarketingRevoked: v.optional(v.boolean()),
});

const audienceSampleValidator = v.object({
  contactId: v.id("contacts"),
  displayName: v.string(),
  phone: v.optional(v.string()),
  bsuid: v.optional(v.string()),
  tags: v.array(v.string()),
  marketingConsent: consentStatusValidator,
  transactionalConsent: consentStatusValidator,
  leadSources: v.array(leadSourceValidator),
  opportunityStatuses: v.array(opportunityStatusValidator),
  lastMessageAt: v.optional(v.number()),
  lastCtwaClickAt: v.optional(v.number()),
  matchReasons: v.array(v.string()),
});

type ConsentStatus = "granted" | "revoked" | "unknown";
type LeadSource = "ctwa" | "organic" | "campaign_reply" | "unknown";
type OpportunityStatus =
  | "new"
  | "contacted"
  | "replied"
  | "opportunity"
  | "booked"
  | "lost";
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

type AudienceCriteria = {
  logic?: "all" | "any";
  search?: string;
  includeTags?: string[];
  excludeTags?: string[];
  marketingConsent?: ConsentStatus | "any";
  transactionalConsent?: ConsentStatus | "any";
  leadSources?: LeadSource[];
  opportunityStatuses?: OpportunityStatus[];
  ctwaWindow?: "any" | "open" | "expiring_6h" | "expired";
  createdAfter?: number;
  createdBefore?: number;
  lastMessageAfter?: number;
  lastMessageBefore?: number;
  campaignId?: Id<"campaigns">;
  templateId?: Id<"templates">;
  campaignRecipientStatuses?: CampaignRecipientStatus[];
  excludeMarketingRevoked?: boolean;
};

type NormalizedCriteria = AudienceCriteria & {
  logic: "all" | "any";
  search?: string;
  includeTags: string[];
  excludeTags: string[];
  marketingConsent: ConsentStatus | "any";
  transactionalConsent: ConsentStatus | "any";
  leadSources: LeadSource[];
  opportunityStatuses: OpportunityStatus[];
  ctwaWindow: "any" | "open" | "expiring_6h" | "expired";
  campaignRecipientStatuses: CampaignRecipientStatus[];
  excludeMarketingRevoked: boolean;
};

type CampaignHit = {
  campaignId: Id<"campaigns">;
  templateId?: Id<"templates">;
  status: CampaignRecipientStatus;
};

type AudienceProfile = {
  contact: Doc<"contacts">;
  displayName: string;
  marketingConsent: ConsentStatus;
  transactionalConsent: ConsentStatus;
  leadSources: LeadSource[];
  opportunityStatuses: OpportunityStatus[];
  lastMessageAt?: number;
  lastCtwaClickAt?: number;
  hasOpenCtwa: boolean;
  hasExpiringCtwa: boolean;
  hasExpiredCtwa: boolean;
  campaignHits: CampaignHit[];
  searchBlob: string;
};

type EvaluationCheck = {
  key: string;
  pass: boolean;
  reason?: string;
};

export const preview = tenantQuery({
  args: { criteria: audienceCriteriaValidator },
  returns: v.object({
    count: v.number(),
    sample: v.array(audienceSampleValidator),
    excludedMarketingRevoked: v.number(),
    activeFilters: v.number(),
  }),
  handler: async (ctx, args) => {
    const evaluated = await evaluateAudience(ctx, args.criteria);
    return {
      count: evaluated.matched.length,
      sample: evaluated.matched.slice(0, SAMPLE_LIMIT).map((row) => row.sample),
      excludedMarketingRevoked: evaluated.excludedMarketingRevoked,
      activeFilters: evaluated.activeFilters,
    };
  },
});

export const saveAsList = tenantMutation({
  args: {
    name: v.string(),
    criteria: audienceCriteriaValidator,
  },
  returns: v.object({
    listId: v.id("contactLists"),
    matched: v.number(),
    added: v.number(),
    excludedMarketingRevoked: v.number(),
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

    const evaluated = await evaluateAudience(ctx, args.criteria);
    const now = Date.now();
    const criteria = normalizeCriteria(args.criteria);
    const listId = await ctx.db.insert("contactLists", {
      tenantId: ctx.tenantId,
      name,
      description: buildAudienceDescription(criteria, evaluated.matched.length),
      audienceCriteria: criteria,
      audienceSnapshotAt: now,
      audienceMatchedCount: evaluated.matched.length,
      audienceExcludedMarketingRevoked: evaluated.excludedMarketingRevoked,
      createdBy: ctx.memberId,
      createdAt: now,
      updatedAt: now,
    });

    let added = 0;
    const seen = new Set<string>();
    for (const row of evaluated.matched) {
      if (seen.has(row.sample.contactId)) continue;
      seen.add(row.sample.contactId);
      await ctx.db.insert("contactListMembers", {
        tenantId: ctx.tenantId,
        listId,
        contactId: row.sample.contactId,
        source: "audience_builder",
        addedBy: ctx.memberId,
        addedAt: now,
      });
      added++;
    }

    return {
      listId,
      matched: evaluated.matched.length,
      added,
      excludedMarketingRevoked: evaluated.excludedMarketingRevoked,
    };
  },
});

function assertName(name: string): string {
  const cleaned = name.trim().replace(/\s+/g, " ");
  if (cleaned.length < NAME_MIN || cleaned.length > NAME_MAX) {
    throw new ConvexError({
      code: "INVALID_NAME",
      message: `Name must be ${NAME_MIN}-${NAME_MAX} characters.`,
    });
  }
  return cleaned;
}

async function evaluateAudience(
  ctx: { db: any; tenantId: Id<"tenants"> },
  rawCriteria: AudienceCriteria,
) {
  const criteria = normalizeCriteria(rawCriteria);
  const now = Date.now();
  const [contacts, conversations, campaigns] = await Promise.all([
    ctx.db
      .query("contacts")
      .withIndex("by_tenant", (q: any) => q.eq("tenantId", ctx.tenantId))
      .collect(),
    ctx.db
      .query("conversations")
      .withIndex("by_tenant_lastmsg", (q: any) =>
        q.eq("tenantId", ctx.tenantId),
      )
      .collect(),
    ctx.db
      .query("campaigns")
      .withIndex("by_tenant", (q: any) => q.eq("tenantId", ctx.tenantId))
      .collect(),
  ]);

  const conversationsByContact = new Map<string, Array<Doc<"conversations">>>();
  for (const conversation of conversations) {
    const bucket = conversationsByContact.get(conversation.contactId) ?? [];
    bucket.push(conversation);
    conversationsByContact.set(conversation.contactId, bucket);
  }
  const campaignsById = new Map<string, Doc<"campaigns">>();
  for (const campaign of campaigns) campaignsById.set(campaign._id, campaign);

  const matched: Array<{ sample: AudienceSample; sortAt: number }> = [];
  let excludedMarketingRevoked = 0;
  const activeFilters = countActiveFilters(criteria);

  for (const contact of contacts) {
    if (contact.erasedAt) continue;
    const profile = await buildProfile(ctx, {
      contact,
      conversations: conversationsByContact.get(contact._id) ?? [],
      campaignsById,
      criteria,
      now,
    });

    const explicitlyExcluded = hasAnyNormalizedTag(
      contact.tags,
      criteria.excludeTags,
    );
    if (explicitlyExcluded) continue;

    const checks = buildChecks(profile, criteria);
    const checksWithoutMarketing = checks.filter(
      (check) => check.key !== "marketingConsent",
    );
    const safetyExcludes =
      criteria.excludeMarketingRevoked &&
      profile.marketingConsent === "revoked";

    if (
      safetyExcludes &&
      passesChecks(checksWithoutMarketing, criteria.logic)
    ) {
      excludedMarketingRevoked++;
    }
    if (safetyExcludes) continue;
    if (!passesChecks(checks, criteria.logic)) continue;

    const matchReasons = checks
      .filter((check) => check.pass && check.reason)
      .map((check) => check.reason!);
    matched.push({
      sample: {
        contactId: contact._id,
        displayName: profile.displayName,
        phone: contact.e164,
        bsuid: contact.bsuid,
        tags: contact.tags,
        marketingConsent: profile.marketingConsent,
        transactionalConsent: profile.transactionalConsent,
        leadSources: profile.leadSources,
        opportunityStatuses: profile.opportunityStatuses,
        lastMessageAt: profile.lastMessageAt,
        lastCtwaClickAt: profile.lastCtwaClickAt,
        matchReasons,
      },
      sortAt: profile.lastMessageAt ?? contact.createdAt,
    });
  }

  matched.sort((a, b) => b.sortAt - a.sortAt || a.sample.displayName.localeCompare(b.sample.displayName));
  return { matched, excludedMarketingRevoked, activeFilters };
}

type AudienceSample = {
  contactId: Id<"contacts">;
  displayName: string;
  phone?: string;
  bsuid?: string;
  tags: string[];
  marketingConsent: ConsentStatus;
  transactionalConsent: ConsentStatus;
  leadSources: LeadSource[];
  opportunityStatuses: OpportunityStatus[];
  lastMessageAt?: number;
  lastCtwaClickAt?: number;
  matchReasons: string[];
};

async function buildProfile(
  ctx: { db: any; tenantId: Id<"tenants"> },
  args: {
    contact: Doc<"contacts">;
    conversations: Array<Doc<"conversations">>;
    campaignsById: Map<string, Doc<"campaigns">>;
    criteria: NormalizedCriteria;
    now: number;
  },
): Promise<AudienceProfile> {
  const [marketing, transactional, referrals, recipients] = await Promise.all([
    loadConsent(ctx, args.contact._id, "marketing"),
    loadConsent(ctx, args.contact._id, "transactional"),
    ctx.db
      .query("ctwaReferrals")
      .withIndex("by_contact", (q: any) =>
        q.eq("tenantId", ctx.tenantId).eq("contactId", args.contact._id),
      )
      .collect(),
    ctx.db
      .query("campaignRecipients")
      .withIndex("by_contact", (q: any) =>
        q.eq("tenantId", ctx.tenantId).eq("contactId", args.contact._id),
      )
      .collect(),
  ]);

  const leadSources = uniqueNonEmpty(
    args.conversations.map((conversation) => conversation.leadSource ?? "unknown"),
  ) as LeadSource[];
  const opportunityStatuses = uniqueNonEmpty(
    args.conversations.map(
      (conversation) => conversation.opportunityStatus ?? "new",
    ),
  ) as OpportunityStatus[];
  const lastMessageAt = maxOptional(
    args.conversations.map((conversation) => conversation.lastMessageAt),
  );
  const lastCtwaClickAt = maxOptional([
    ...args.conversations.map((conversation) => conversation.lastCtwaClickAt),
    ...referrals.map((referral: Doc<"ctwaReferrals">) => referral.clickedAt),
  ]);
  const hasOpenCtwa = referrals.some(
    (referral: Doc<"ctwaReferrals">) =>
      referral.freeEntryWindowExpiresAt > args.now,
  );
  const hasExpiringCtwa = referrals.some(
    (referral: Doc<"ctwaReferrals">) =>
      referral.freeEntryWindowExpiresAt > args.now &&
      referral.freeEntryWindowExpiresAt <= args.now + 6 * 60 * 60 * 1000,
  );
  const hasExpiredCtwa =
    referrals.length > 0 &&
    referrals.every(
      (referral: Doc<"ctwaReferrals">) =>
        referral.freeEntryWindowExpiresAt <= args.now,
    );
  const campaignHits = recipients
    .map((recipient: Doc<"campaignRecipients">) => {
      const campaign = args.campaignsById.get(recipient.campaignId);
      if (!campaign || campaign.tenantId !== ctx.tenantId) return null;
      return {
        campaignId: recipient.campaignId,
        templateId: campaign.templateId,
        status: recipient.status as CampaignRecipientStatus,
      };
    })
    .filter(Boolean) as CampaignHit[];

  const displayName =
    args.contact.name ??
    args.contact.whatsappUsername ??
    args.contact.e164 ??
    args.contact.bsuid ??
    "Unknown contact";
  const searchBlob = [
    displayName,
    args.contact.e164,
    args.contact.bsuid,
    args.contact.whatsappUsername,
    args.contact.locale,
    args.contact.tags.join(" "),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return {
    contact: args.contact,
    displayName,
    marketingConsent: marketing,
    transactionalConsent: transactional,
    leadSources: leadSources.length > 0 ? leadSources : ["unknown"],
    opportunityStatuses,
    lastMessageAt,
    lastCtwaClickAt,
    hasOpenCtwa,
    hasExpiringCtwa,
    hasExpiredCtwa,
    campaignHits,
    searchBlob,
  };
}

async function loadConsent(
  ctx: { db: any; tenantId: Id<"tenants"> },
  contactId: Id<"contacts">,
  purpose: "marketing" | "transactional",
): Promise<ConsentStatus> {
  const consent = await ctx.db
    .query("currentConsents")
    .withIndex("by_tenant_contact_purpose_channel", (q: any) =>
      q
        .eq("tenantId", ctx.tenantId)
        .eq("contactId", contactId)
        .eq("purpose", purpose)
        .eq("channel", "whatsapp"),
    )
    .unique();
  return (consent?.status ?? "unknown") as ConsentStatus;
}

function buildChecks(
  profile: AudienceProfile,
  criteria: NormalizedCriteria,
): EvaluationCheck[] {
  const checks: EvaluationCheck[] = [];
  if (criteria.search) {
    checks.push({
      key: "search",
      pass: profile.searchBlob.includes(criteria.search),
      reason: "search",
    });
  }
  if (criteria.includeTags.length > 0) {
    const hit = firstMatchingTag(profile.contact.tags, criteria.includeTags);
    checks.push({
      key: "includeTags",
      pass: Boolean(hit),
      reason: hit ? `tag:${hit}` : undefined,
    });
  }
  if (criteria.marketingConsent !== "any") {
    checks.push({
      key: "marketingConsent",
      pass: profile.marketingConsent === criteria.marketingConsent,
      reason: `marketing:${criteria.marketingConsent}`,
    });
  }
  if (criteria.transactionalConsent !== "any") {
    checks.push({
      key: "transactionalConsent",
      pass: profile.transactionalConsent === criteria.transactionalConsent,
      reason: `transactional:${criteria.transactionalConsent}`,
    });
  }
  if (criteria.leadSources.length > 0) {
    const source = profile.leadSources.find((value) =>
      criteria.leadSources.includes(value),
    );
    checks.push({
      key: "leadSources",
      pass: Boolean(source),
      reason: source ? `source:${source}` : undefined,
    });
  }
  if (criteria.opportunityStatuses.length > 0) {
    const status = profile.opportunityStatuses.find((value) =>
      criteria.opportunityStatuses.includes(value),
    );
    checks.push({
      key: "opportunityStatuses",
      pass: Boolean(status),
      reason: status ? `status:${status}` : undefined,
    });
  }
  if (criteria.ctwaWindow !== "any") {
    const pass =
      criteria.ctwaWindow === "open"
        ? profile.hasOpenCtwa
        : criteria.ctwaWindow === "expiring_6h"
          ? profile.hasExpiringCtwa
          : profile.hasExpiredCtwa;
    checks.push({
      key: "ctwaWindow",
      pass,
      reason: pass ? `ctwa:${criteria.ctwaWindow}` : undefined,
    });
  }
  if (criteria.createdAfter !== undefined) {
    checks.push({
      key: "createdAfter",
      pass: profile.contact.createdAt >= criteria.createdAfter,
      reason: "created:after",
    });
  }
  if (criteria.createdBefore !== undefined) {
    checks.push({
      key: "createdBefore",
      pass: profile.contact.createdAt <= criteria.createdBefore,
      reason: "created:before",
    });
  }
  if (criteria.lastMessageAfter !== undefined) {
    checks.push({
      key: "lastMessageAfter",
      pass:
        profile.lastMessageAt !== undefined &&
        profile.lastMessageAt >= criteria.lastMessageAfter,
      reason: "last_message:after",
    });
  }
  if (criteria.lastMessageBefore !== undefined) {
    checks.push({
      key: "lastMessageBefore",
      pass:
        profile.lastMessageAt !== undefined &&
        profile.lastMessageAt <= criteria.lastMessageBefore,
      reason: "last_message:before",
    });
  }
  if (
    criteria.campaignId ||
    criteria.templateId ||
    criteria.campaignRecipientStatuses.length > 0
  ) {
    const hit = profile.campaignHits.find((campaignHit) => {
      if (criteria.campaignId && campaignHit.campaignId !== criteria.campaignId) {
        return false;
      }
      if (criteria.templateId && campaignHit.templateId !== criteria.templateId) {
        return false;
      }
      if (
        criteria.campaignRecipientStatuses.length > 0 &&
        !criteria.campaignRecipientStatuses.includes(campaignHit.status)
      ) {
        return false;
      }
      return true;
    });
    checks.push({
      key: "campaign",
      pass: Boolean(hit),
      reason: hit ? `campaign:${hit.status}` : undefined,
    });
  }
  return checks;
}

function passesChecks(checks: EvaluationCheck[], logic: "all" | "any") {
  if (checks.length === 0) return true;
  return logic === "all"
    ? checks.every((check) => check.pass)
    : checks.some((check) => check.pass);
}

function normalizeCriteria(criteria: AudienceCriteria): NormalizedCriteria {
  return {
    ...criteria,
    logic: criteria.logic ?? "all",
    search: criteria.search?.trim().toLowerCase() || undefined,
    includeTags: normalizeStringArray(criteria.includeTags),
    excludeTags: normalizeStringArray(criteria.excludeTags),
    marketingConsent: criteria.marketingConsent ?? "any",
    transactionalConsent: criteria.transactionalConsent ?? "any",
    leadSources: uniqueNonEmpty(criteria.leadSources ?? []) as LeadSource[],
    opportunityStatuses: uniqueNonEmpty(
      criteria.opportunityStatuses ?? [],
    ) as OpportunityStatus[],
    ctwaWindow: criteria.ctwaWindow ?? "any",
    campaignRecipientStatuses: uniqueNonEmpty(
      criteria.campaignRecipientStatuses ?? [],
    ) as CampaignRecipientStatus[],
    excludeMarketingRevoked: criteria.excludeMarketingRevoked !== false,
  };
}

function normalizeStringArray(values: string[] | undefined) {
  return uniqueNonEmpty(
    (values ?? []).map((value) => value.trim().toLowerCase()),
  ).slice(0, 50);
}

function uniqueNonEmpty<T extends string>(values: T[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function hasAnyNormalizedTag(tags: string[], wanted: string[]) {
  if (wanted.length === 0) return false;
  const normalized = new Set(tags.map((tag) => tag.trim().toLowerCase()));
  return wanted.some((tag) => normalized.has(tag));
}

function firstMatchingTag(tags: string[], wanted: string[]) {
  if (wanted.length === 0) return null;
  const normalized = new Map(
    tags.map((tag) => [tag.trim().toLowerCase(), tag] as const),
  );
  for (const tag of wanted) {
    const match = normalized.get(tag);
    if (match) return match;
  }
  return null;
}

function maxOptional(values: Array<number | undefined>) {
  const present = values.filter(
    (value): value is number => value !== undefined,
  );
  return present.length > 0 ? Math.max(...present) : undefined;
}

function countActiveFilters(criteria: NormalizedCriteria) {
  let count = 0;
  if (criteria.search) count++;
  if (criteria.includeTags.length > 0) count++;
  if (criteria.excludeTags.length > 0) count++;
  if (criteria.marketingConsent !== "any") count++;
  if (criteria.transactionalConsent !== "any") count++;
  if (criteria.leadSources.length > 0) count++;
  if (criteria.opportunityStatuses.length > 0) count++;
  if (criteria.ctwaWindow !== "any") count++;
  if (criteria.createdAfter !== undefined) count++;
  if (criteria.createdBefore !== undefined) count++;
  if (criteria.lastMessageAfter !== undefined) count++;
  if (criteria.lastMessageBefore !== undefined) count++;
  if (criteria.campaignId) count++;
  if (criteria.templateId) count++;
  if (criteria.campaignRecipientStatuses.length > 0) count++;
  return count;
}

function buildAudienceDescription(criteria: NormalizedCriteria, matched: number) {
  const parts = ["Audience Builder snapshot", `${matched} matched`];
  if (criteria.excludeMarketingRevoked) {
    parts.push("marketing opt-outs excluded");
  }
  if (criteria.includeTags.length > 0) {
    parts.push(`tags: ${criteria.includeTags.join(", ")}`);
  }
  if (criteria.leadSources.length > 0) {
    parts.push(`sources: ${criteria.leadSources.join(", ")}`);
  }
  if (criteria.campaignRecipientStatuses.length > 0) {
    parts.push(`campaign: ${criteria.campaignRecipientStatuses.join(", ")}`);
  }
  return parts.join(" | ");
}
