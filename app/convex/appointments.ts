import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalMutation,
  internalAction,
  internalQuery,
} from "./_generated/server";
import {
  tenantMutation,
  tenantQuery,
  loadByIdInTenant,
} from "./lib/customFunctions";
import { sendWhatsAppTemplate } from "./lib/meta/graph";
import type { Id } from "./_generated/dataModel";

const REMINDER_OFFSET_MS = 24 * 60 * 60 * 1000;

// ---------- Public ----------

export const list = tenantQuery({
  args: { fromTs: v.optional(v.number()), limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      _id: v.id("appointments"),
      contactId: v.id("contacts"),
      scheduledFor: v.number(),
      durationMinutes: v.number(),
      status: v.string(),
      professionalName: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const from = args.fromTs ?? Date.now() - 24 * 60 * 60 * 1000;
    const rows = await ctx.db
      .query("appointments")
      .withIndex("by_tenant_when", (q) =>
        q.eq("tenantId", ctx.tenantId).gte("scheduledFor", from),
      )
      .take(Math.min(args.limit ?? 100, 500));
    return rows.map((a) => ({
      _id: a._id,
      contactId: a.contactId,
      scheduledFor: a.scheduledFor,
      durationMinutes: a.durationMinutes,
      status: a.status,
      professionalName: a.professionalName,
    }));
  },
});

export const create = tenantMutation({
  args: {
    contactId: v.id("contacts"),
    scheduledFor: v.number(),
    durationMinutes: v.number(),
    professionalName: v.optional(v.string()),
    location: v.optional(v.string()),
    /** Optional reminder template — when present, schedule a 24h-before reminder. */
    reminderTemplateId: v.optional(v.id("templates")),
    reminderPhoneNumberId: v.optional(v.id("phoneNumbers")),
    reminderVariables: v.optional(v.record(v.string(), v.string())),
  },
  returns: v.id("appointments"),
  handler: async (ctx, args): Promise<Id<"appointments">> => {
    await loadByIdInTenant(
      ctx as Parameters<typeof loadByIdInTenant>[0],
      "contacts",
      args.contactId,
    );
    if (args.scheduledFor < Date.now()) {
      throw new ConvexError({ code: "APPOINTMENT_IN_PAST" });
    }
    const now = Date.now();
    const apptId = await ctx.db.insert("appointments", {
      tenantId: ctx.tenantId,
      contactId: args.contactId,
      scheduledFor: args.scheduledFor,
      durationMinutes: args.durationMinutes,
      status: "scheduled",
      professionalName: args.professionalName,
      location: args.location,
      createdAt: now,
      updatedAt: now,
    });

    // Auto-schedule reminder if template + phone provided
    if (
      args.reminderTemplateId &&
      args.reminderPhoneNumberId &&
      args.reminderVariables &&
      args.scheduledFor - REMINDER_OFFSET_MS > now + 60_000
    ) {
      const tpl = await ctx.db.get(args.reminderTemplateId);
      if (tpl && tpl.tenantId === ctx.tenantId && tpl.status === "approved") {
        const sendAt = args.scheduledFor - REMINDER_OFFSET_MS;
        const schedId = await ctx.db.insert("scheduledMessages", {
          tenantId: ctx.tenantId,
          contactId: args.contactId,
          phoneNumberId: args.reminderPhoneNumberId,
          templateId: args.reminderTemplateId,
          templateVersion: tpl.currentVersion,
          variables: args.reminderVariables,
          sendAt,
          sourceType: "appointment_reminder",
          sourceRef: apptId,
          status: "scheduled",
          attempts: 0,
          createdAt: now,
        });
        await ctx.scheduler.runAt(
          sendAt,
          internal.appointments._executeScheduledMessage,
          { scheduledMessageId: schedId },
        );
      }
    }
    return apptId;
  },
});

export const cancel = tenantMutation({
  args: { appointmentId: v.id("appointments") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const a = await loadByIdInTenant(
      ctx as Parameters<typeof loadByIdInTenant>[0],
      "appointments",
      args.appointmentId,
    );
    if (a.status === "cancelled") return null;
    await ctx.db.patch(args.appointmentId, {
      status: "cancelled",
      updatedAt: Date.now(),
    });
    // Cascade: cancel scheduled reminders for this appointment
    const scheduled = await ctx.db
      .query("scheduledMessages")
      .withIndex("by_tenant_source", (q) =>
        q
          .eq("tenantId", ctx.tenantId)
          .eq("sourceType", "appointment_reminder")
          .eq("sourceRef", args.appointmentId),
      )
      .collect();
    for (const s of scheduled) {
      if (s.status === "scheduled") {
        await ctx.db.patch(s._id, { status: "cancelled" });
      }
    }
    return null;
  },
});

// ---------- Scheduled message executor ----------

export const _claimAndDispatch = internalMutation({
  args: { scheduledMessageId: v.id("scheduledMessages") },
  returns: v.union(
    v.object({
      tenantId: v.id("tenants"),
      contactId: v.id("contacts"),
      phoneNumberId: v.id("phoneNumbers"),
      templateId: v.id("templates"),
      templateVersion: v.number(),
      variables: v.record(v.string(), v.string()),
      messageId: v.id("messages"),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const sm = await ctx.db.get(args.scheduledMessageId);
    if (!sm) return null;
    if (sm.status !== "scheduled") return null;

    // 1. Check appointment still valid (if applicable)
    if (sm.sourceType === "appointment_reminder" && sm.sourceRef) {
      const appt = await ctx.db.get(sm.sourceRef as Id<"appointments">);
      if (!appt || appt.status !== "scheduled") {
        await ctx.db.patch(args.scheduledMessageId, {
          status: "skipped_appointment_invalid",
        });
        return null;
      }
    }

    // 2. Check consent matching template category
    const tpl = await ctx.db.get(sm.templateId);
    if (!tpl || tpl.status !== "approved") {
      await ctx.db.patch(args.scheduledMessageId, {
        status: "failed",
        failureReason: "template not approved",
      });
      return null;
    }
    const purpose: "marketing" | "transactional" | "authentication" =
      tpl.category === "marketing"
        ? "marketing"
        : tpl.category === "authentication"
          ? "authentication"
          : "transactional";
    const consent = await ctx.db
      .query("currentConsents")
      .withIndex("by_tenant_contact_purpose_channel", (q) =>
        q
          .eq("tenantId", sm.tenantId)
          .eq("contactId", sm.contactId)
          .eq("purpose", purpose)
          .eq("channel", "whatsapp"),
      )
      .unique();
    if (!consent || consent.status !== "granted") {
      await ctx.db.patch(args.scheduledMessageId, {
        status: "skipped_consent",
      });
      return null;
    }

    // 3. Check phone number circuit breaker
    const phone = await ctx.db.get(sm.phoneNumberId);
    if (!phone) {
      await ctx.db.patch(args.scheduledMessageId, {
        status: "failed",
        failureReason: "phone number not found",
      });
      return null;
    }
    if (
      phone.circuitBreakerUntil &&
      phone.circuitBreakerUntil > Date.now()
    ) {
      await ctx.db.patch(args.scheduledMessageId, {
        status: "skipped_quality",
      });
      return null;
    }

    // 4. Find or create conversation
    let conv = await ctx.db
      .query("conversations")
      .withIndex("by_tenant_phone_contact", (q) =>
        q
          .eq("tenantId", sm.tenantId)
          .eq("phoneNumberId", sm.phoneNumberId)
          .eq("contactId", sm.contactId),
      )
      .filter((q) => q.neq(q.field("status"), "closed"))
      .first();
    let conversationId: Id<"conversations">;
    if (conv) {
      conversationId = conv._id;
    } else {
      conversationId = await ctx.db.insert("conversations", {
        tenantId: sm.tenantId,
        phoneNumberId: sm.phoneNumberId,
        contactId: sm.contactId,
        status: "open",
        lastMessageAt: Date.now(),
        unreadCount: 0,
        tags: [],
      });
      conv = await ctx.db.get(conversationId);
    }

    // 5. Build template message + queue
    const ver = await ctx.db
      .query("templateVersions")
      .withIndex("by_template_version", (q) =>
        q.eq("templateId", sm.templateId).eq("version", sm.templateVersion),
      )
      .unique();
    if (!ver) {
      await ctx.db.patch(args.scheduledMessageId, {
        status: "failed",
        failureReason: "template version missing",
      });
      return null;
    }
    const orderedValues = [...ver.parameterSchema]
      .sort((a, b) => a.index - b.index)
      .map((p) => sm.variables[String(p.index)] ?? "");

    const businessKey = `scheduled:${args.scheduledMessageId}`;
    const messageId = await ctx.db.insert("messages", {
      tenantId: sm.tenantId,
      conversationId,
      direction: "outgoing",
      businessKey,
      type: "template",
      content: {
        template: {
          name: tpl.name,
          language: tpl.language,
          version: sm.templateVersion,
          variables: orderedValues,
        },
      },
      status: "queued",
      dispatchAttempts: 0,
      sentByScheduledMessageId: args.scheduledMessageId,
      templateId: sm.templateId,
      templateVersion: sm.templateVersion,
      pricingCategory:
        tpl.category === "marketing"
          ? "marketing"
          : tpl.category === "authentication"
            ? "authentication"
            : "utility",
      createdAt: Date.now(),
    });
    await ctx.db.patch(args.scheduledMessageId, {
      status: "dispatching",
      claimedAt: Date.now(),
      resultMessageId: messageId,
      attempts: sm.attempts + 1,
    });

    return {
      tenantId: sm.tenantId,
      contactId: sm.contactId,
      phoneNumberId: sm.phoneNumberId,
      templateId: sm.templateId,
      templateVersion: sm.templateVersion,
      variables: sm.variables,
      messageId,
    };
  },
});

export const _markScheduledSent = internalMutation({
  args: { scheduledMessageId: v.id("scheduledMessages") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const sm = await ctx.db.get(args.scheduledMessageId);
    if (!sm) return null;
    if (sm.status === "dispatching") {
      await ctx.db.patch(args.scheduledMessageId, { status: "sent" });
    }
    return null;
  },
});

/**
 * Fires at sendAt. Re-validates everything atomically + queues the
 * outbound message, which the existing _dispatchOne action will handle.
 */
export const _executeScheduledMessage = internalAction({
  args: { scheduledMessageId: v.id("scheduledMessages") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const claim: {
      messageId: Id<"messages">;
    } | null = await ctx.runMutation(internal.appointments._claimAndDispatch, {
      scheduledMessageId: args.scheduledMessageId,
    });
    if (!claim) return null;
    // Hand the actual Meta POST to the existing dispatcher (template path)
    await ctx.runAction(internal.messages._dispatchOne, {
      messageId: claim.messageId,
    });
    await ctx.runMutation(internal.appointments._markScheduledSent, {
      scheduledMessageId: args.scheduledMessageId,
    });
    return null;
  },
});

// Quiet unused warning; reserved for future cron timeout sweep.
void sendWhatsAppTemplate;
