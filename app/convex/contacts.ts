import { v, ConvexError } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import {
  requireCapability,
  tenantMutation,
  tenantQuery,
} from "./lib/customFunctions";
import { recordConsentTransition } from "./lib/consent";
import type { Id } from "./_generated/dataModel";

/**
 * Lookup helper used by Meta `user_preferences` webhook handler.
 * Resolves a contact id from either phone (wa_id) or BSUID. Returns null
 * when neither identifier matches — the webhook will be a no-op.
 */
export const _findByIdentifier = internalQuery({
  args: {
    tenantId: v.id("tenants"),
    bsuid: v.optional(v.string()),
    waId: v.optional(v.string()),
  },
  returns: v.union(v.id("contacts"), v.null()),
  handler: async (ctx, args) => {
    if (args.bsuid) {
      const c = await ctx.db
        .query("contacts")
        .withIndex("by_tenant_bsuid", (q) =>
          q.eq("tenantId", args.tenantId).eq("bsuid", args.bsuid),
        )
        .unique();
      if (c) return c._id;
    }
    if (args.waId) {
      const e164 = args.waId.startsWith("+") ? args.waId : `+${args.waId}`;
      const c = await ctx.db
        .query("contacts")
        .withIndex("by_tenant_phone", (q) =>
          q.eq("tenantId", args.tenantId).eq("e164", e164),
        )
        .unique();
      if (c) return c._id;
    }
    return null;
  },
});

const E164_REGEX = /^\+[1-9]\d{6,14}$/;

/** Strip everything except leading + and digits. */
function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";
  return (hasPlus ? "+" : "+") + digits;
}

/**
 * Find-or-create a contact from a Meta inbound. The identity contract
 * follows Meta's 2026 rollout:
 *   - `bsuid` (Business-Scoped User ID) is the stable identity once it lands
 *     in webhooks (from 2026-03-31). Use it for lookup whenever present.
 *   - `e164` may be missing when the user has enabled WhatsApp usernames.
 *   - `whatsappUsername` is a public alias the user may change at any time.
 *
 * Resolution order: BSUID match → phone match → create new.
 * Whenever we successfully resolve a row we backfill any newly-known field
 * (BSUID, phone, username, name) without overwriting existing values.
 */
export const upsertFromInbound = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    e164: v.optional(v.string()),
    bsuid: v.optional(v.string()),
    parentBsuid: v.optional(v.string()),
    username: v.optional(v.string()),
    name: v.optional(v.string()),
  },
  returns: v.id("contacts"),
  handler: async (ctx, args): Promise<Id<"contacts">> => {
    if (!args.e164 && !args.bsuid) {
      throw new ConvexError({
        code: "MISSING_IDENTITY",
        message: "Inbound contact has neither phone nor BSUID.",
      });
    }

    // 1. Try BSUID — stable across phone changes and survives username opt-in.
    let existing = null;
    if (args.bsuid) {
      existing = await ctx.db
        .query("contacts")
        .withIndex("by_tenant_bsuid", (q) =>
          q.eq("tenantId", args.tenantId).eq("bsuid", args.bsuid),
        )
        .unique();
    }
    // 2. Fall back to phone — for users who haven't gotten BSUID yet, or for
    //    contacts created via CSV import (phone-only).
    if (!existing && args.e164) {
      existing = await ctx.db
        .query("contacts")
        .withIndex("by_tenant_phone", (q) =>
          q.eq("tenantId", args.tenantId).eq("e164", args.e164),
        )
        .unique();
    }

    if (existing) {
      const patch: Partial<{
        e164: string;
        bsuid: string;
        parentBsuid: string;
        whatsappUsername: string;
        name: string;
      }> = {};
      if (args.e164 && !existing.e164) patch.e164 = args.e164;
      if (args.bsuid && !existing.bsuid) patch.bsuid = args.bsuid;
      if (args.parentBsuid && !existing.parentBsuid)
        patch.parentBsuid = args.parentBsuid;
      // Username can change — always reflect the latest from Meta.
      if (args.username && args.username !== existing.whatsappUsername) {
        patch.whatsappUsername = args.username;
      }
      if (args.name && !existing.name) patch.name = args.name;
      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(existing._id, patch);
      }
      return existing._id;
    }

    return await ctx.db.insert("contacts", {
      tenantId: args.tenantId,
      e164: args.e164,
      bsuid: args.bsuid,
      parentBsuid: args.parentBsuid,
      whatsappUsername: args.username,
      name: args.name,
      tags: [],
      createdAt: Date.now(),
    });
  },
});


/**
 * Apply a Meta `user_id_update` webhook: the same end-user's BSUID rotated.
 * Find the existing contact by previous BSUID (or by wa_id when the user
 * didn't have a BSUID before) and patch it in place. NEVER create a
 * duplicate row — that would split conversation history.
 */
export const rotateBsuid = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    previousBsuid: v.string(),
    currentBsuid: v.string(),
    previousParentBsuid: v.optional(v.string()),
    currentParentBsuid: v.optional(v.string()),
    waId: v.optional(v.string()),
  },
  returns: v.union(v.id("contacts"), v.null()),
  handler: async (ctx, args) => {
    // 1. Try previous BSUID first.
    let target = await ctx.db
      .query("contacts")
      .withIndex("by_tenant_bsuid", (q) =>
        q.eq("tenantId", args.tenantId).eq("bsuid", args.previousBsuid),
      )
      .unique();
    // 2. Fall back to phone (user that hadn't been seen with BSUID yet).
    if (!target && args.waId) {
      const e164 = args.waId.startsWith("+") ? args.waId : `+${args.waId}`;
      target = await ctx.db
        .query("contacts")
        .withIndex("by_tenant_phone", (q) =>
          q.eq("tenantId", args.tenantId).eq("e164", e164),
        )
        .unique();
    }
    if (!target) return null;
    await ctx.db.patch(target._id, {
      bsuid: args.currentBsuid,
      parentBsuid: args.currentParentBsuid ?? target.parentBsuid,
    });
    return target._id;
  },
});

// ---------- Public ----------

export const list = tenantQuery({
  args: { limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      _id: v.id("contacts"),
      e164: v.optional(v.string()),
      bsuid: v.optional(v.string()),
      parentBsuid: v.optional(v.string()),
      whatsappUsername: v.optional(v.string()),
      name: v.optional(v.string()),
      locale: v.optional(v.string()),
      tags: v.array(v.string()),
      createdAt: v.number(),
      marketingConsent: v.union(
        v.literal("granted"),
        v.literal("revoked"),
        v.literal("unknown"),
      ),
      marketingConsentAt: v.optional(v.number()),
      transactionalConsent: v.union(
        v.literal("granted"),
        v.literal("revoked"),
        v.literal("unknown"),
      ),
      transactionalConsentAt: v.optional(v.number()),
      lastConversationAt: v.optional(v.number()),
      lastLeadSource: v.optional(v.string()),
      opportunityStatus: v.optional(v.string()),
      serviceWindowExpiresAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("contacts")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .order("desc")
      .take(Math.min(args.limit ?? 200, 1000));

    const result = [];
    for (const c of rows) {
      const marketing = await ctx.db
        .query("currentConsents")
        .withIndex("by_tenant_contact_purpose_channel", (q) =>
          q
            .eq("tenantId", ctx.tenantId)
            .eq("contactId", c._id)
            .eq("purpose", "marketing")
            .eq("channel", "whatsapp"),
        )
        .unique();
      const transactional = await ctx.db
        .query("currentConsents")
        .withIndex("by_tenant_contact_purpose_channel", (q) =>
          q
            .eq("tenantId", ctx.tenantId)
            .eq("contactId", c._id)
            .eq("purpose", "transactional")
            .eq("channel", "whatsapp"),
        )
        .unique();
      const latestConversation = await ctx.db
        .query("conversations")
        .withIndex("by_tenant_contact_lastmsg", (q) =>
          q.eq("tenantId", ctx.tenantId).eq("contactId", c._id),
        )
        .order("desc")
        .first();
      result.push({
        _id: c._id,
        e164: c.e164,
        bsuid: c.bsuid,
        parentBsuid: c.parentBsuid,
        whatsappUsername: c.whatsappUsername,
        name: c.name,
        locale: c.locale,
        tags: c.tags,
        createdAt: c.createdAt,
        marketingConsent: (marketing?.status ?? "unknown") as
          | "granted"
          | "revoked"
          | "unknown",
        marketingConsentAt: marketing?.effectiveAt,
        transactionalConsent: (transactional?.status ?? "unknown") as
          | "granted"
          | "revoked"
          | "unknown",
        transactionalConsentAt: transactional?.effectiveAt,
        lastConversationAt: latestConversation?.lastMessageAt,
        lastLeadSource: latestConversation?.leadSource,
        opportunityStatus: latestConversation?.opportunityStatus,
        serviceWindowExpiresAt: latestConversation?.serviceWindowExpiresAt,
      });
    }
    return result;
  },
});

/**
 * Bulk-import contacts from CSV. Each row may include a marketing consent
 * proof (proofText or proofUrl) — when present we record a granted marketing
 * consent transition. Otherwise marketing stays "unknown".
 *
 * Idempotent on (tenant, e164): re-importing the same number does NOT
 * duplicate, but DOES patch the name if it was missing and records a new
 * consent event if proof is provided (audit trail).
 */
export const bulkImport = tenantMutation({
  args: {
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
    skipped: v.array(
      v.object({ phone: v.string(), reason: v.string() }),
    ),
    consentsRecorded: v.number(),
  }),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "contacts.import");
    if (args.rows.length === 0) {
      throw new ConvexError({ code: "EMPTY_IMPORT" });
    }
    if (args.rows.length > 5000) {
      throw new ConvexError({ code: "IMPORT_TOO_LARGE", limit: 5000 });
    }

    let created = 0;
    let updated = 0;
    let consentsRecorded = 0;
    const skipped: Array<{ phone: string; reason: string }> = [];
    const now = Date.now();

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
        const patch: Partial<{
          name: string;
          locale: string;
          tags: string[];
        }> = {};
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

      if (row.marketingConsentProofText || row.marketingConsentProofUrl) {
        await recordConsentTransition(ctx, {
          tenantId: ctx.tenantId,
          contactId,
          purpose: "marketing",
          newStatus: "granted",
          source: "csv_import",
          proofText: row.marketingConsentProofText,
          proofUrl: row.marketingConsentProofUrl,
          capturedByMemberId: ctx.memberId,
        });
        consentsRecorded++;
      }
    }

    return { created, updated, skipped, consentsRecorded };
  },
});
