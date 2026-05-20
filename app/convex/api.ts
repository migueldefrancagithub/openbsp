/**
 * API-key-scoped mutations and queries. These mirror the in-app entry points
 * but accept an explicit `tenantId` (provided by the HTTP layer after
 * resolving a Bearer token) instead of deriving it from a Convex Auth
 * session.
 *
 * Each handler enforces the same tenant fence as tenantQuery/tenantMutation
 * by passing the resolved tenantId to loadByIdInTenant equivalents.
 */
import { v, ConvexError } from "convex/values";
import {
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { requireConsent } from "./lib/consent";
import type { Id } from "./_generated/dataModel";

// ---------- Contacts ----------

const E164_REGEX = /^\+[1-9]\d{6,14}$/;

const BSUID_REGEX = /^[A-Z]{2}\.[A-Za-z0-9]{1,128}$/;

export const upsertContact = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    e164: v.optional(v.string()),
    bsuid: v.optional(v.string()),
    name: v.optional(v.string()),
  },
  returns: v.object({
    contactId: v.id("contacts"),
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    if (!args.e164 && !args.bsuid) {
      throw new ConvexError({
        code: "MISSING_IDENTITY",
        message: "Must provide phone or bsuid.",
      });
    }
    if (args.e164 && !E164_REGEX.test(args.e164)) {
      throw new ConvexError({ code: "INVALID_E164" });
    }
    if (args.bsuid && !BSUID_REGEX.test(args.bsuid)) {
      throw new ConvexError({ code: "INVALID_BSUID" });
    }

    let existing = null;
    if (args.bsuid) {
      existing = await ctx.db
        .query("contacts")
        .withIndex("by_tenant_bsuid", (q) =>
          q.eq("tenantId", args.tenantId).eq("bsuid", args.bsuid),
        )
        .unique();
    }
    if (!existing && args.e164) {
      existing = await ctx.db
        .query("contacts")
        .withIndex("by_tenant_phone", (q) =>
          q.eq("tenantId", args.tenantId).eq("e164", args.e164),
        )
        .unique();
    }
    if (existing) {
      const patch: Partial<{ e164: string; bsuid: string; name: string }> = {};
      if (args.e164 && !existing.e164) patch.e164 = args.e164;
      if (args.bsuid && !existing.bsuid) patch.bsuid = args.bsuid;
      if (args.name && !existing.name) patch.name = args.name;
      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(existing._id, patch);
      }
      return { contactId: existing._id, created: false };
    }
    const contactId = await ctx.db.insert("contacts", {
      tenantId: args.tenantId,
      e164: args.e164,
      bsuid: args.bsuid,
      name: args.name,
      tags: [],
      createdAt: Date.now(),
    });
    return { contactId, created: true };
  },
});

export const listContacts = internalQuery({
  args: { tenantId: v.id("tenants"), limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      _id: v.id("contacts"),
      e164: v.optional(v.string()),
      bsuid: v.optional(v.string()),
      whatsapp_username: v.optional(v.string()),
      name: v.optional(v.string()),
      tags: v.array(v.string()),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("contacts")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .order("desc")
      .take(Math.min(args.limit ?? 100, 500));
    return rows.map((c) => ({
      _id: c._id,
      e164: c.e164,
      bsuid: c.bsuid,
      whatsapp_username: c.whatsappUsername,
      name: c.name,
      tags: c.tags,
      createdAt: c.createdAt,
    }));
  },
});

// ---------- Templates ----------

export const listApprovedTemplates = internalQuery({
  args: { tenantId: v.id("tenants") },
  returns: v.array(
    v.object({
      _id: v.id("templates"),
      name: v.string(),
      language: v.string(),
      category: v.string(),
      parameterIndices: v.array(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    const tpls = await ctx.db
      .query("templates")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .filter((q) => q.eq(q.field("status"), "approved"))
      .collect();
    const out = [];
    for (const t of tpls) {
      const ver = await ctx.db
        .query("templateVersions")
        .withIndex("by_template_version", (q) =>
          q.eq("templateId", t._id).eq("version", t.currentVersion),
        )
        .unique();
      out.push({
        _id: t._id,
        name: t.name,
        language: t.language,
        category: t.category,
        parameterIndices: (ver?.parameterSchema ?? [])
          .map((p) => p.index)
          .sort((a, b) => a - b),
      });
    }
    return out;
  },
});

// ---------- Conversations ----------

export const findOrCreateConversation = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    e164: v.optional(v.string()),
    bsuid: v.optional(v.string()),
    phoneNumberId: v.optional(v.id("phoneNumbers")),
  },
  returns: v.object({
    conversationId: v.id("conversations"),
    contactId: v.id("contacts"),
    phoneNumberId: v.id("phoneNumbers"),
    serviceWindowExpiresAt: v.optional(v.number()),
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    if (!args.e164 && !args.bsuid) {
      throw new ConvexError({
        code: "MISSING_IDENTITY",
        message: "Must provide phone or bsuid.",
      });
    }
    if (args.e164 && !E164_REGEX.test(args.e164)) {
      throw new ConvexError({ code: "INVALID_E164" });
    }
    if (args.bsuid && !BSUID_REGEX.test(args.bsuid)) {
      throw new ConvexError({ code: "INVALID_BSUID" });
    }

    // Resolve sending phone number. If unspecified, pick the tenant's first.
    let pnId: Id<"phoneNumbers">;
    if (args.phoneNumberId) {
      const phone = await ctx.db.get(args.phoneNumberId);
      if (!phone || phone.tenantId !== args.tenantId) {
        throw new ConvexError({ code: "PHONE_NUMBER_NOT_FOUND" });
      }
      pnId = phone._id;
    } else {
      const phone = await ctx.db
        .query("phoneNumbers")
        .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
        .first();
      if (!phone) {
        throw new ConvexError({ code: "NO_PHONE_NUMBER_CONNECTED" });
      }
      pnId = phone._id;
    }

    // Upsert contact — BSUID match first (stable identity), then phone.
    let contact = null;
    if (args.bsuid) {
      contact = await ctx.db
        .query("contacts")
        .withIndex("by_tenant_bsuid", (q) =>
          q.eq("tenantId", args.tenantId).eq("bsuid", args.bsuid),
        )
        .unique();
    }
    if (!contact && args.e164) {
      contact = await ctx.db
        .query("contacts")
        .withIndex("by_tenant_phone", (q) =>
          q.eq("tenantId", args.tenantId).eq("e164", args.e164),
        )
        .unique();
    }
    if (!contact) {
      const id = await ctx.db.insert("contacts", {
        tenantId: args.tenantId,
        e164: args.e164,
        bsuid: args.bsuid,
        tags: [],
        createdAt: Date.now(),
      });
      const c = await ctx.db.get(id);
      if (!c) throw new ConvexError({ code: "CONTACT_INSERT_FAILED" });
      contact = c;
    }

    // Find existing non-closed conversation.
    let conv = await ctx.db
      .query("conversations")
      .withIndex("by_tenant_phone_contact", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("phoneNumberId", pnId)
          .eq("contactId", contact._id),
      )
      .filter((q) => q.neq(q.field("status"), "closed"))
      .first();

    if (conv) {
      return {
        conversationId: conv._id,
        contactId: contact._id,
        phoneNumberId: pnId,
        serviceWindowExpiresAt: conv.serviceWindowExpiresAt,
        created: false,
      };
    }

    const conversationId = await ctx.db.insert("conversations", {
      tenantId: args.tenantId,
      phoneNumberId: pnId,
      contactId: contact._id,
      status: "open",
      lastMessageAt: Date.now(),
      unreadCount: 0,
      tags: [],
    });
    return {
      conversationId,
      contactId: contact._id,
      phoneNumberId: pnId,
      serviceWindowExpiresAt: undefined,
      created: true,
    };
  },
});

// ---------- Send text via API ----------

export const sendTextAsApi = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    conversationId: v.id("conversations"),
    text: v.string(),
    clientNonce: v.string(),
    apiKeyId: v.id("apiKeys"),
  },
  returns: v.object({
    messageId: v.id("messages"),
    status: v.string(),
  }),
  handler: async (ctx, args) => {
    const trimmed = args.text.trim();
    if (trimmed.length === 0) throw new ConvexError({ code: "EMPTY_TEXT" });
    if (trimmed.length > 4096) {
      throw new ConvexError({ code: "TEXT_TOO_LONG", limit: 4096 });
    }

    const conv = await ctx.db.get(args.conversationId);
    if (!conv || conv.tenantId !== args.tenantId) {
      throw new ConvexError({ code: "CONVERSATION_NOT_FOUND" });
    }

    const now = Date.now();
    if (!conv.serviceWindowExpiresAt || conv.serviceWindowExpiresAt <= now) {
      throw new ConvexError({
        code: "SERVICE_WINDOW_EXPIRED",
        message: "24h service window is closed. Use a template instead.",
      });
    }

    await requireConsent(ctx, {
      tenantId: args.tenantId,
      contactId: conv.contactId,
      purpose: "transactional",
    });

    const businessKey = `api:text:${args.conversationId}:${args.apiKeyId}:${args.clientNonce}`;
    const existing = await ctx.db
      .query("messages")
      .withIndex("by_business_key", (q) => q.eq("businessKey", businessKey))
      .unique();
    if (existing) {
      return { messageId: existing._id, status: existing.status };
    }

    const messageId = await ctx.db.insert("messages", {
      tenantId: args.tenantId,
      conversationId: args.conversationId,
      direction: "outgoing",
      businessKey,
      type: "text",
      content: { text: { body: trimmed } },
      status: "queued",
      dispatchAttempts: 0,
      createdAt: now,
    });
    await ctx.db.patch(args.conversationId, { lastMessageAt: now });
    await ctx.scheduler.runAfter(0, internal.messages._dispatchOne, {
      messageId,
    });
    return { messageId, status: "queued" };
  },
});

// ---------- Send template via API ----------

export const sendTemplateAsApi = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    conversationId: v.id("conversations"),
    templateName: v.string(),
    language: v.string(),
    variables: v.record(v.string(), v.string()),
    clientNonce: v.string(),
    apiKeyId: v.id("apiKeys"),
  },
  returns: v.object({
    messageId: v.id("messages"),
    status: v.string(),
  }),
  handler: async (ctx, args) => {
    const conv = await ctx.db.get(args.conversationId);
    if (!conv || conv.tenantId !== args.tenantId) {
      throw new ConvexError({ code: "CONVERSATION_NOT_FOUND" });
    }

    const tpl = await ctx.db
      .query("templates")
      .withIndex("by_tenant_name_lang", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("name", args.templateName)
          .eq("language", args.language),
      )
      .unique();
    if (!tpl) throw new ConvexError({ code: "TEMPLATE_NOT_FOUND" });
    if (tpl.status !== "approved") {
      throw new ConvexError({
        code: "TEMPLATE_NOT_APPROVED",
        status: tpl.status,
      });
    }

    const ver = await ctx.db
      .query("templateVersions")
      .withIndex("by_template_version", (q) =>
        q.eq("templateId", tpl._id).eq("version", tpl.currentVersion),
      )
      .unique();
    if (!ver) throw new ConvexError({ code: "VERSION_NOT_FOUND" });

    const purpose: "marketing" | "transactional" | "authentication" =
      tpl.category === "marketing"
        ? "marketing"
        : tpl.category === "authentication"
          ? "authentication"
          : "transactional";
    await requireConsent(ctx, {
      tenantId: args.tenantId,
      contactId: conv.contactId,
      purpose,
    });

    const orderedParams = [...ver.parameterSchema].sort(
      (a, b) => a.index - b.index,
    );
    const orderedValues: string[] = [];
    for (const p of orderedParams) {
      const key = String(p.index);
      const val = args.variables[key];
      if (!val || val.trim().length === 0) {
        throw new ConvexError({
          code: "MISSING_TEMPLATE_VARIABLE",
          index: p.index,
        });
      }
      orderedValues.push(val);
    }

    const businessKey = `api:tpl:${args.conversationId}:${tpl._id}:v${tpl.currentVersion}:${args.clientNonce}`;
    const existing = await ctx.db
      .query("messages")
      .withIndex("by_business_key", (q) => q.eq("businessKey", businessKey))
      .unique();
    if (existing) {
      return { messageId: existing._id, status: existing.status };
    }

    const now = Date.now();
    const messageId = await ctx.db.insert("messages", {
      tenantId: args.tenantId,
      conversationId: args.conversationId,
      direction: "outgoing",
      businessKey,
      type: "template",
      content: {
        template: {
          name: tpl.name,
          language: tpl.language,
          version: tpl.currentVersion,
          variables: orderedValues,
        },
      },
      status: "queued",
      dispatchAttempts: 0,
      templateId: tpl._id,
      templateVersion: tpl.currentVersion,
      pricingCategory:
        tpl.category === "marketing"
          ? "marketing"
          : tpl.category === "authentication"
            ? "authentication"
            : "utility",
      createdAt: now,
    });
    await ctx.db.patch(args.conversationId, { lastMessageAt: now });
    await ctx.scheduler.runAfter(0, internal.messages._dispatchOne, {
      messageId,
    });
    return { messageId, status: "queued" };
  },
});
