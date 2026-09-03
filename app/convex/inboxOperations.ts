import { makeFunctionReference, paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import {
  loadByIdInTenant,
  requireCapability,
  requireRoleAtLeast,
  tenantMutation,
  tenantQuery,
} from "./lib/customFunctions";
import { writeAudit } from "./lib/audit";
import { threadHasMessageEvent } from "./lib/channels/threadVisibility";
import { threadCommand, waitingSince } from "./lib/channels/threadCommand";
import { applyThreadUpdate, threadUpdateArgs } from "./lib/channels/threadUpdate";
import { findOrCreateContactForThread } from "./lib/channels/contactBridge";
import { recordConsentTransition } from "./lib/consent";
import type { MutationCtx } from "./_generated/server";
import {
  extractErrorCode,
  maskPhone,
  recordThreadSystemEvent,
} from "./lib/channels/systemEvents";

const filterValidator = v.union(
  v.literal("all"),
  v.literal("mine"),
  v.literal("unassigned"),
  v.literal("open"),
  v.literal("active"),
  v.literal("awaiting_team"),
  v.literal("awaiting_patient"),
  v.literal("starred"),
  v.literal("snoozed"),
  v.literal("closed"),
);

const inboxStatusValidator = v.union(
  v.literal("open"),
  v.literal("active"),
  v.literal("awaiting_team"),
  v.literal("awaiting_patient"),
  v.literal("snoozed"),
  v.literal("closed"),
);

const leadStatusValidator = v.union(
  v.literal("new"),
  v.literal("interested"),
  v.literal("asked_price"),
  v.literal("wants_booking"),
  v.literal("awaiting_human"),
  v.literal("booked"),
  v.literal("confirmed"),
  v.literal("attended"),
  v.literal("no_show"),
  v.literal("lost"),
);

type OperationalStatus =
  | "open"
  | "active"
  | "awaiting_team"
  | "awaiting_patient"
  | "snoozed"
  | "closed";

const markReminderDue = makeFunctionReference<
  "mutation",
  { reminderId: Id<"threadReminders"> },
  null
>("inboxOperations:_markReminderDue");

function deriveStatus(thread: Doc<"channelThreads">, now: number): OperationalStatus {
  if (thread.closedAt || thread.inboxStatus === "closed") return "closed";
  if (
    thread.inboxStatus === "snoozed" &&
    thread.snoozedUntil &&
    thread.snoozedUntil > now
  ) {
    return "snoozed";
  }
  if (
    thread.openHumanCaseId ||
    thread.inboxStatus === "awaiting_team" ||
    thread.leadStatus === "awaiting_human" ||
    thread.automationMode === "human"
  ) {
    return "awaiting_team";
  }
  if (thread.inboxStatus === "awaiting_patient") return "awaiting_patient";
  if (thread.inboxStatus === "active") return "active";
  if (
    thread.lastInboundAt &&
    (!thread.lastOutboundAt || thread.lastInboundAt > thread.lastOutboundAt)
  ) {
    return "open";
  }
  if (
    thread.lastOutboundAt &&
    (!thread.lastInboundAt || thread.lastOutboundAt >= thread.lastInboundAt)
  ) {
    return "awaiting_patient";
  }
  return "open";
}

function matchesFilter(
  thread: Doc<"channelThreads">,
  filter: string,
  status: OperationalStatus,
  memberId?: Id<"members">,
): boolean {
  if (filter === "all") return status !== "closed";
  if (filter === "mine") {
    return status !== "closed" && !!memberId && thread.responsibleMemberId === memberId;
  }
  if (filter === "unassigned") {
    return status !== "closed" && !thread.responsibleMemberId;
  }
  if (filter === "starred") return status !== "closed" && !!thread.starredAt;
  return status === filter;
}

function normalizedPhone(value?: string): string | undefined {
  const digits = value?.replace(/\D/g, "") ?? "";
  return /^[1-9]\d{7,17}$/.test(digits) ? `+${digits}` : undefined;
}

async function getThreadIdentity(ctx: { db: any }, thread: Doc<"channelThreads">) {
  return thread.identityId
    ? ((await ctx.db.get(thread.identityId)) as Doc<"channelIdentities"> | null)
    : null;
}

async function findContact(
  ctx: { db: any; tenantId: Id<"tenants"> },
  thread: Doc<"channelThreads">,
  identity: Doc<"channelIdentities"> | null,
) {
  const phone = normalizedPhone(identity?.phone ?? thread.threadKey);
  if (phone) {
    const contact = await ctx.db
      .query("contacts")
      .withIndex("by_tenant_phone", (q: any) =>
        q.eq("tenantId", ctx.tenantId).eq("e164", phone),
      )
      .unique();
    if (contact) return contact as Doc<"contacts">;
  }
  const scopedId = identity?.providerScopedId ?? thread.threadKey;
  if (scopedId && !normalizedPhone(scopedId)) {
    return (await ctx.db
      .query("contacts")
      .withIndex("by_tenant_bsuid", (q: any) =>
        q.eq("tenantId", ctx.tenantId).eq("bsuid", scopedId),
      )
      .unique()) as Doc<"contacts"> | null;
  }
  return null;
}

async function hasMessageEvent(ctx: { db: any }, thread: Doc<"channelThreads">) {
  return await threadHasMessageEvent(ctx, thread);
}

async function memberLabel(ctx: { db: any }, memberId?: Id<"members">) {
  if (!memberId) return undefined;
  const member = (await ctx.db.get(memberId)) as Doc<"members"> | null;
  if (!member) return undefined;
  const user = await ctx.db.get(member.userId);
  return user?.name ?? user?.email ?? undefined;
}

async function teamLabel(ctx: { db: any }, teamId?: Id<"teams">) {
  if (!teamId) return undefined;
  const team = (await ctx.db.get(teamId)) as Doc<"teams"> | null;
  return team?.name;
}

async function audit(
  ctx: {
    db: any;
    tenantId: Id<"tenants">;
    memberId: Id<"members">;
  },
  action: string,
  threadId: Id<"channelThreads">,
  payload?: unknown,
) {
  await writeAudit(ctx, {
    action,
    targetType: "channel_thread",
    targetId: threadId,
    payload,
  });
}

const threadSummaryValidator = v.object({
  _id: v.id("channelThreads"),
  channelId: v.id("channels"),
  threadKey: v.string(),
  displayName: v.optional(v.string()),
  phone: v.optional(v.string()),
  lastEventAt: v.number(),
  lastEventKind: v.string(),
  lastPreview: v.optional(v.string()),
  unreadCount: v.number(),
  serviceWindowExpiresAt: v.optional(v.number()),
  tags: v.array(v.string()),
  leadSource: v.optional(v.string()),
  leadStatus: v.optional(v.string()),
  intent: v.optional(v.string()),
  nextStep: v.optional(v.string()),
  nextStepDueAt: v.optional(v.number()),
  responsibleMemberId: v.optional(v.id("members")),
  responsibleName: v.optional(v.string()),
  assignedTeamId: v.optional(v.id("teams")),
  assignedTeamName: v.optional(v.string()),
  inboxStatus: inboxStatusValidator,
  starred: v.boolean(),
  snoozedUntil: v.optional(v.number()),
  automationMode: v.optional(v.string()),
  dnd: v.boolean(),
  /** An automatic reply was blocked because the number is outside the pilot allowlist. */
  pilotBlocked: v.boolean(),
  openCaseSlaDueAt: v.optional(v.number()),
  openCaseUrgency: v.optional(v.string()),
  dueReminderCount: v.number(),
  firstResponseDueAt: v.optional(v.number()),
  slaBreached: v.boolean(),
  aiSuggestionPending: v.boolean(),
  aiMode: v.optional(v.string()),
  /** Who is in command, by the single resolver in lib/channels/threadCommand. */
  command: v.string(),
  commandReason: v.optional(v.string()),
  /** Since when the patient has been waiting — the queue's ordering label. */
  waitingSince: v.number(),
});

/** Is there a published, active agent bound to this channel? */
async function channelHasLiveAgent(
  ctx: { db: any },
  tenantId: Id<"tenants">,
  channelId: Id<"channels">,
): Promise<boolean> {
  const agents = (await ctx.db
    .query("aiAgents")
    .withIndex("by_tenant_channel_status", (q: any) =>
      q.eq("tenantId", tenantId).eq("channelId", channelId).eq("status", "active"),
    )
    .take(10)) as Doc<"aiAgents">[];
  return agents.some((agent) => !!agent.publishedVersionId && agent.mode !== "sandbox");
}

export const listThreads = tenantQuery({
  args: {
    channelId: v.id("channels"),
    filter: filterValidator,
    search: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(threadSummaryValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const channel = await ctx.db.get(args.channelId);
    if (!channel || channel.tenantId !== ctx.tenantId) {
      throw new ConvexError({ code: "CHANNEL_NOT_FOUND" });
    }
    const result = await ctx.db
      .query("channelThreads")
      .withIndex("by_channel_last_event", (q) => q.eq("channelId", args.channelId))
      .order("desc")
      .paginate({
        cursor: args.paginationOpts.cursor,
        numItems: Math.min(Math.max(args.paginationOpts.numItems, 1), 100),
      });
    const now = Date.now();
    const search = args.search?.trim().toLowerCase() ?? "";
    // One read per page, not per row: "does this channel have an agent live?"
    // is a channel-wide fact, and it changes what the queue means.
    const aiAvailable = await channelHasLiveAgent(ctx, ctx.tenantId, args.channelId);
    const page = [];
    for (const thread of result.page) {
      if (!(await hasMessageEvent(ctx, thread))) continue;
      const identity = await getThreadIdentity(ctx, thread);
      const displayName = identity?.displayName;
      const phone = identity?.phone ?? normalizedPhone(thread.threadKey);
      // Same recipient derivation as the outbound gate: the allowlist itself
      // never leaves the server, only the verdict does.
      const recipient = identity?.phone ?? thread.threadKey;
      const pilotBlocked =
        !!thread.pilotBlockedAt && !channel.outboundAllowlist.includes(recipient);
      const openCase = thread.openHumanCaseId
        ? ((await ctx.db.get(thread.openHumanCaseId)) as Doc<"humanCases"> | null)
        : null;
      const dueReminders = (await ctx.db
        .query("threadReminders")
        .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
        .take(10)) as Doc<"threadReminders">[];
      const dueReminderCount = dueReminders.filter((row) => row.status === "due").length;
      const haystack = `${displayName ?? ""} ${phone ?? ""} ${thread.threadKey} ${thread.lastPreview ?? ""}`.toLowerCase();
      if (search && !haystack.includes(search)) continue;
      const inboxStatus = deriveStatus(thread, now);
      if (!matchesFilter(thread, args.filter, inboxStatus, ctx.memberId)) continue;
      const command = threadCommand({ ...thread, aiAvailable }, now);
      page.push({
        _id: thread._id,
        channelId: thread.channelId,
        threadKey: thread.threadKey,
        displayName,
        phone,
        lastEventAt: thread.lastEventAt,
        lastEventKind: thread.lastEventKind,
        lastPreview: thread.lastPreview,
        unreadCount: thread.unreadCount,
        serviceWindowExpiresAt: thread.serviceWindowExpiresAt,
        tags: thread.tags ?? [],
        leadSource: thread.leadSource,
        leadStatus: thread.leadStatus,
        intent: thread.intent,
        nextStep: thread.nextStep,
        nextStepDueAt: thread.nextStepDueAt,
        responsibleMemberId: thread.responsibleMemberId,
        responsibleName: await memberLabel(ctx, thread.responsibleMemberId),
        assignedTeamId: thread.assignedTeamId,
        assignedTeamName: await teamLabel(ctx, thread.assignedTeamId),
        inboxStatus,
        starred: !!thread.starredAt,
        snoozedUntil: thread.snoozedUntil,
        automationMode: thread.automationMode,
        dnd: thread.dnd ?? false,
        pilotBlocked,
        openCaseSlaDueAt: openCase?.slaDueAt,
        openCaseUrgency: openCase?.urgency,
        dueReminderCount,
        aiSuggestionPending:
          (await ctx.db
            .query("aiTurns")
            .withIndex("by_thread_status", (q) => q.eq("threadId", thread._id).eq("status", "awaiting_approval"))
            .first()) !== null,
        aiMode: thread.aiMode,
        firstResponseDueAt: thread.firstResponseDueAt,
        command: command.who,
        commandReason: command.reason ?? undefined,
        waitingSince: waitingSince(thread),
        slaBreached:
          (!!thread.firstResponseDueAt && thread.firstResponseDueAt < now && !thread.closedAt) ||
          (!!openCase && openCase.slaDueAt < now),
      });
    }
    return {
      page,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

const timelineSystemEventValidator = v.object({
  _id: v.id("threadSystemEvents"),
  kind: v.string(),
  severity: v.string(),
  code: v.optional(v.string()),
  actorType: v.string(),
  actorName: v.optional(v.string()),
  botName: v.optional(v.string()),
  humanCaseId: v.optional(v.id("humanCases")),
  payload: v.optional(v.any()),
  createdAt: v.number(),
});

const timelineOutboxValidator = v.object({
  _id: v.id("channelOutbox"),
  status: v.string(),
  messageKind: v.string(),
  preview: v.optional(v.string()),
  code: v.optional(v.string()),
  failureReason: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

function outboxPreview(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  if (typeof record.text === "string") return record.text.slice(0, 160);
  if (typeof record.templateName === "string") return `Template: ${record.templateName}`;
  if (typeof record.filename === "string") return record.filename.slice(0, 120);
  return undefined;
}

/**
 * Everything the thread timeline shows that is NOT a provider event: system
 * events (automation outcomes, pilot blocks, handoffs) and outbox rows that
 * never became a provider event because the send was rejected or never
 * confirmed. Each list is take-limited; the client merges by timestamp.
 */
export const listThreadTimelineExtras = tenantQuery({
  args: {
    threadId: v.id("channelThreads"),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    systemEvents: v.array(timelineSystemEventValidator),
    failedOutbox: v.array(timelineOutboxValidator),
  }),
  handler: async (ctx, args) => {
    const thread = await loadByIdInTenant(ctx, "channelThreads", args.threadId);
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);
    const rows = (await ctx.db
      .query("threadSystemEvents")
      .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
      .order("desc")
      .take(limit)) as Doc<"threadSystemEvents">[];
    const botNames = new Map<string, string | undefined>();
    const memberNames = new Map<string, string | undefined>();
    const systemEvents = [];
    for (const row of rows) {
      let botName: string | undefined;
      if (row.chatbotId) {
        if (!botNames.has(row.chatbotId)) {
          const bot = (await ctx.db.get(row.chatbotId)) as Doc<"chatbots"> | null;
          botNames.set(row.chatbotId, bot?.name);
        }
        botName = botNames.get(row.chatbotId);
      }
      let actorName: string | undefined;
      if (row.actorMemberId) {
        if (!memberNames.has(row.actorMemberId)) {
          memberNames.set(row.actorMemberId, await memberLabel(ctx, row.actorMemberId));
        }
        actorName = memberNames.get(row.actorMemberId);
      }
      systemEvents.push({
        _id: row._id,
        kind: row.kind,
        severity: row.severity,
        code: row.code,
        actorType: row.actorType,
        actorName,
        botName,
        humanCaseId: row.humanCaseId,
        payload: row.payload,
        createdAt: row.createdAt,
      });
    }
    const failedOutbox = [];
    for (const status of ["failed", "unknown"] as const) {
      const outbox = (await ctx.db
        .query("channelOutbox")
        .withIndex("by_channel_thread_status", (q) =>
          q
            .eq("channelId", thread.channelId)
            .eq("threadKey", thread.threadKey)
            .eq("status", status),
        )
        .order("desc")
        .take(20)) as Doc<"channelOutbox">[];
      for (const row of outbox) {
        failedOutbox.push({
          _id: row._id,
          status: row.status,
          messageKind: row.messageKind,
          preview: outboxPreview(row.payload),
          code: extractErrorCode(row.failureReason),
          failureReason: row.failureReason?.slice(0, 200),
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        });
      }
    }
    return { systemEvents, failedOutbox };
  },
});

/**
 * Operational state of one thread for the header: the open human case (with
 * SLA) and the pilot verdict. The case table is the source of truth; the
 * `openHumanCaseId` cache on the thread only serves list rows.
 */
export const getThreadOps = tenantQuery({
  args: { threadId: v.id("channelThreads") },
  returns: v.object({
    openCase: v.union(
      v.object({
        _id: v.id("humanCases"),
        reason: v.string(),
        urgency: v.string(),
        question: v.string(),
        status: v.string(),
        responsibleMemberId: v.optional(v.id("members")),
        responsibleName: v.optional(v.string()),
        slaDueAt: v.number(),
        createdAt: v.number(),
      }),
      v.null(),
    ),
    pilotBlocked: v.boolean(),
    /** Why the last automatic send did not go out, when it did not. */
    retention: v.union(v.object({ code: v.string(), at: v.number() }), v.null()),
    command: v.string(),
    commandReason: v.optional(v.string()),
    ai: v.union(
      v.object({
        agentName: v.string(),
        status: v.union(v.literal("responding"), v.literal("paused"), v.literal("handed_off"), v.literal("off")),
        turns: v.number(),
        lastTurnAt: v.optional(v.number()),
        pausedReason: v.optional(v.string()),
        mode: v.string(),
        overridden: v.boolean(),
        pendingSuggestion: v.boolean(),
      }),
      v.null(),
    ),
  }),
  handler: async (ctx, args) => {
    const thread = await loadByIdInTenant(ctx, "channelThreads", args.threadId);
    let ai: { agentName: string; status: "responding" | "paused" | "handed_off" | "off"; turns: number; lastTurnAt?: number; pausedReason?: string; mode: string; overridden: boolean; pendingSuggestion: boolean } | null = null;
    const pendingSuggestion =
      (await ctx.db
        .query("aiTurns")
        .withIndex("by_thread_status", (q) => q.eq("threadId", thread._id).eq("status", "awaiting_approval"))
        .first()) !== null;
    let agentForMode: Doc<"aiAgents"> | null = null;
    for (const status of ["active", "paused", "handed_off"] as const) {
      const run = await ctx.db
        .query("aiRuns")
        .withIndex("by_thread_status", (q) => q.eq("threadId", thread._id).eq("status", status))
        .first();
      if (run) {
        const agent = await ctx.db.get(run.agentId);
        agentForMode = agent;
        ai = {
          agentName: agent?.name ?? "IA",
          status: status === "active" ? (agent?.status === "active" ? "responding" : "off") : status,
          turns: run.turnsCount,
          lastTurnAt: run.lastTurnAt,
          pausedReason: run.pausedReason,
          mode: thread.aiMode ?? agent?.mode ?? "copilot",
          overridden: !!thread.aiMode,
          pendingSuggestion,
        };
        break;
      }
    }
    if (!ai) {
      // No run yet: still show the toggle when a published agent covers this channel.
      const actives = await ctx.db
        .query("aiAgents")
        .withIndex("by_tenant_channel_status", (q) => q.eq("tenantId", ctx.tenantId).eq("channelId", thread.channelId).eq("status", "active"))
        .take(1);
      agentForMode = actives[0] ?? null;
      if (agentForMode) {
        ai = { agentName: agentForMode.name, status: "off", turns: 0, mode: thread.aiMode ?? agentForMode.mode ?? "copilot", overridden: !!thread.aiMode, pendingSuggestion };
      }
    }
    // The most recent thing that stopped a send. Read from the durable system
    // events, so the screen and the engine cannot disagree about the reason.
    const systemEvents = (await ctx.db
      .query("threadSystemEvents")
      .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
      .order("desc")
      .take(12)) as Doc<"threadSystemEvents">[];
    const blocking = systemEvents.find(
      (event) => !!event.code && (event.severity === "warning" || event.severity === "error"),
    );
    const retention =
      blocking && blocking.createdAt > (thread.lastOutboundAt ?? 0)
        ? { code: blocking.code as string, at: blocking.createdAt }
        : null;
    const recent = (await ctx.db
      .query("humanCases")
      .withIndex("by_thread", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("threadId", thread._id),
      )
      .order("desc")
      .take(5)) as Doc<"humanCases">[];
    const open = recent.find((row) => row.status !== "resolved") ?? null;
    const command = threadCommand(
      { ...thread, aiAvailable: !!agentForMode && !!agentForMode.publishedVersionId && agentForMode.mode !== "sandbox" },
      Date.now(),
    );
    return {
      retention,
      command: command.who,
      commandReason: command.reason ?? undefined,
      openCase: open
        ? {
            _id: open._id,
            reason: open.reason,
            urgency: open.urgency,
            question: open.question,
            status: open.status,
            responsibleMemberId: open.responsibleMemberId,
            responsibleName: await memberLabel(ctx, open.responsibleMemberId),
            slaDueAt: open.slaDueAt,
            createdAt: open.createdAt,
          }
        : null,
      pilotBlocked: !!thread.pilotBlockedAt,
      ai,
    };
  },
});

/**
 * Record a consent decision from the conversation (e.g. the patient said yes
 * to reminders on WhatsApp). The consent domain stays on `contacts`
 * (currentConsents + consentEvents, the same rows campaign gates read); the
 * thread is bridged to its contact by phone/BSUID, creating one if needed.
 */
export const recordConsent = tenantMutation({
  args: {
    threadId: v.id("channelThreads"),
    purpose: v.union(v.literal("marketing"), v.literal("transactional")),
    status: v.union(v.literal("granted"), v.literal("revoked")),
    proofText: v.string(),
  },
  returns: v.object({ contactId: v.id("contacts") }),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "contacts.record_consent");
    const thread = await loadByIdInTenant(ctx, "channelThreads", args.threadId);
    const proofText = args.proofText.trim();
    if (proofText.length < 5 || proofText.length > 500) {
      throw new ConvexError({ code: "INVALID_CONSENT_PROOF" });
    }
    const identity = await getThreadIdentity(ctx, thread);
    const contact = await findOrCreateContactForThread(ctx, thread, identity);
    await recordConsentTransition(ctx as unknown as MutationCtx, {
      tenantId: ctx.tenantId,
      contactId: contact._id,
      purpose: args.purpose,
      newStatus: args.status,
      source: "inbox_manual",
      proofText,
      capturedByMemberId: ctx.memberId,
    });
    await audit(ctx, "inbox.consent.recorded", thread._id, {
      contactId: contact._id,
      purpose: args.purpose,
      status: args.status,
    });
    return { contactId: contact._id };
  },
});

/**
 * An agent cannot edit the pilot allowlist (that is an admin action in
 * Settings with an explicit re-arm), but they can leave a traceable request:
 * a system event on the thread plus a reminder for the first active admin.
 * One request per thread per day.
 */
export const requestAllowlistInclusion = tenantMutation({
  args: { threadId: v.id("channelThreads") },
  returns: v.object({
    requested: v.boolean(),
    reminderId: v.optional(v.id("threadReminders")),
  }),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "pilot.request_allowlist");
    const thread = await loadByIdInTenant(ctx, "channelThreads", args.threadId);
    const identity = await getThreadIdentity(ctx, thread);
    const phone = identity?.phone ?? thread.threadKey;
    const now = Date.now();
    const day = new Date(now).toISOString().slice(0, 10);
    const eventId = await recordThreadSystemEvent(ctx, {
      thread,
      kind: "pilot.allowlist_requested",
      severity: "info",
      actorType: "member",
      actorMemberId: ctx.memberId,
      payload: { phone: maskPhone(phone) },
      dedupeKey: `pilot:${thread._id}:requested:${day}`,
      now,
    });
    if (!eventId) return { requested: false };
    const members = (await ctx.db
      .query("members")
      .withIndex("by_tenant_user", (q) => q.eq("tenantId", ctx.tenantId))
      .take(100)) as Doc<"members">[];
    const admin =
      members.find(
        (member) =>
          member.status === "active" &&
          (member.role === "owner" || member.role === "admin"),
      ) ?? members.find((member) => member._id === ctx.memberId);
    if (!admin) return { requested: true };
    const dueAt = now + 60 * 60 * 1000;
    const reminderId = await ctx.db.insert("threadReminders", {
      tenantId: ctx.tenantId,
      threadId: thread._id,
      note: `Pedido de inclusão no piloto: ${phone}`,
      dueAt,
      status: "scheduled",
      assignedMemberId: admin._id,
      createdBy: ctx.memberId,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAt(dueAt, markReminderDue, { reminderId });
    await audit(ctx, "inbox.pilot.allowlist_requested", thread._id, {
      reminderId,
      assignedMemberId: admin._id,
    });
    return { requested: true, reminderId };
  },
});

export const getPatientContext = tenantQuery({
  args: { threadId: v.id("channelThreads") },
  returns: v.object({
    contact: v.optional(
      v.object({
        _id: v.id("contacts"),
        name: v.optional(v.string()),
        phone: v.optional(v.string()),
        username: v.optional(v.string()),
        locale: v.optional(v.string()),
        tags: v.array(v.string()),
        customAttributes: v.optional(v.any()),
      }),
    ),
    consents: v.array(
      v.object({ purpose: v.string(), status: v.string(), effectiveAt: v.number() }),
    ),
    notes: v.array(
      v.object({
        _id: v.id("threadInternalNotes"),
        body: v.string(),
        authorName: v.optional(v.string()),
        mentionedMemberIds: v.array(v.id("members")),
        createdAt: v.number(),
      }),
    ),
    reminders: v.array(
      v.object({
        _id: v.id("threadReminders"),
        note: v.string(),
        dueAt: v.number(),
        status: v.string(),
        assignedMemberName: v.optional(v.string()),
      }),
    ),
    attachments: v.array(
      v.object({
        _id: v.id("channelAttachments"),
        fileName: v.string(),
        contentType: v.string(),
        size: v.number(),
        caption: v.optional(v.string()),
        status: v.string(),
        url: v.optional(v.string()),
        createdAt: v.number(),
      }),
    ),
    appointments: v.array(
      v.object({
        _id: v.id("clinicAppointments"),
        serviceName: v.string(),
        startAt: v.number(),
        endAt: v.number(),
        status: v.string(),
      }),
    ),
    campaigns: v.array(
      v.object({
        campaignId: v.id("campaigns"),
        name: v.string(),
        campaignStatus: v.string(),
        recipientStatus: v.string(),
        updatedAt: v.number(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const thread = await loadByIdInTenant(
      ctx as Parameters<typeof loadByIdInTenant>[0],
      "channelThreads",
      args.threadId,
    );
    const identity = await getThreadIdentity(ctx, thread);
    const contact = await findContact(ctx, thread, identity);
    const noteRows = await ctx.db
      .query("threadInternalNotes")
      .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
      .order("desc")
      .take(50);
    const reminderRows = await ctx.db
      .query("threadReminders")
      .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
      .order("desc")
      .take(50);
    const attachmentRows = await ctx.db
      .query("channelAttachments")
      .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
      .order("desc")
      .take(30);
    const appointmentRows = await ctx.db
      .query("clinicAppointments")
      .withIndex("by_thread", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("threadId", thread._id),
      )
      .order("desc")
      .take(20);
    const campaignRows = await ctx.db
      .query("campaignRecipients")
      .withIndex("by_tenant_channel_thread", (q) =>
        q
          .eq("tenantId", ctx.tenantId)
          .eq("channelId", thread.channelId)
          .eq("threadKey", thread.threadKey),
      )
      .order("desc")
      .take(20);

    const consents = [];
    if (contact) {
      for (const purpose of ["marketing", "transactional", "authentication"] as const) {
        const consent = await ctx.db
          .query("currentConsents")
          .withIndex("by_tenant_contact_purpose_channel", (q) =>
            q
              .eq("tenantId", ctx.tenantId)
              .eq("contactId", contact._id)
              .eq("purpose", purpose)
              .eq("channel", "whatsapp"),
          )
          .unique();
        if (consent) {
          consents.push({
            purpose,
            status: consent.status,
            effectiveAt: consent.effectiveAt,
          });
        }
      }
    }

    const notes = [];
    for (const note of noteRows) {
      notes.push({
        _id: note._id,
        body: note.body,
        authorName: await memberLabel(ctx, note.createdBy),
        mentionedMemberIds: note.mentionedMemberIds,
        createdAt: note.createdAt,
      });
    }
    const reminders = [];
    for (const reminder of reminderRows) {
      reminders.push({
        _id: reminder._id,
        note: reminder.note,
        dueAt: reminder.dueAt,
        status: reminder.status,
        assignedMemberName: await memberLabel(ctx, reminder.assignedMemberId),
      });
    }
    const attachments = [];
    for (const attachment of attachmentRows) {
      attachments.push({
        _id: attachment._id,
        fileName: attachment.fileName,
        contentType: attachment.contentType,
        size: attachment.size,
        caption: attachment.caption,
        status: attachment.status,
        url: (await ctx.storage.getUrl(attachment.storageId)) ?? undefined,
        createdAt: attachment.createdAt,
      });
    }
    const appointments = [];
    for (const appointment of appointmentRows) {
      const service = await ctx.db.get(appointment.serviceId);
      appointments.push({
        _id: appointment._id,
        serviceName: service?.name ?? "Serviço",
        startAt: appointment.startAt,
        endAt: appointment.endAt,
        status: appointment.status,
      });
    }
    const campaigns = [];
    for (const recipient of campaignRows) {
      const campaign = await ctx.db.get(recipient.campaignId);
      if (!campaign || campaign.tenantId !== ctx.tenantId) continue;
      campaigns.push({
        campaignId: campaign._id,
        name: campaign.name,
        campaignStatus: campaign.status ?? "draft",
        recipientStatus: recipient.status,
        updatedAt: recipient.updatedAt,
      });
    }

    return {
      contact: contact
        ? {
            _id: contact._id,
            name: contact.name,
            phone: contact.e164,
            username: contact.whatsappUsername,
            locale: contact.locale,
            tags: contact.tags,
            customAttributes: contact.customAttributes,
          }
        : undefined,
      consents,
      notes,
      reminders,
      attachments,
      appointments,
      campaigns,
    };
  },
});

export const listCloseReasons = tenantQuery({
  args: {},
  returns: v.array(
    v.object({ _id: v.id("threadCloseReasons"), name: v.string() }),
  ),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("threadCloseReasons")
      .withIndex("by_tenant", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("active", true),
      )
      .take(100);
    return rows.map((row) => ({ _id: row._id, name: row.name }));
  },
});

export const createCloseReason = tenantMutation({
  args: { name: v.string() },
  returns: v.id("threadCloseReasons"),
  handler: async (ctx, args) => {
    requireRoleAtLeast(ctx.role, "admin");
    const name = args.name.trim().replace(/\s+/g, " ").slice(0, 80);
    if (name.length < 2) throw new ConvexError({ code: "INVALID_CLOSE_REASON" });
    const existing = await ctx.db
      .query("threadCloseReasons")
      .withIndex("by_tenant_name", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("name", name),
      )
      .unique();
    if (existing) return existing._id;
    const now = Date.now();
    return await ctx.db.insert("threadCloseReasons", {
      tenantId: ctx.tenantId,
      name,
      active: true,
      createdBy: ctx.memberId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateThread = tenantMutation({
  args: {
    threadId: v.id("channelThreads"),
    ...threadUpdateArgs,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { threadId, ...update } = args;
    const thread = await loadByIdInTenant(
      ctx as Parameters<typeof loadByIdInTenant>[0],
      "channelThreads",
      threadId,
    );
    if (update.responsibleMemberId) {
      await loadByIdInTenant(
        ctx as Parameters<typeof loadByIdInTenant>[0],
        "members",
        update.responsibleMemberId,
      );
    }
    if (update.assignedTeamId) {
      await loadByIdInTenant(
        ctx as Parameters<typeof loadByIdInTenant>[0],
        "teams",
        update.assignedTeamId,
      );
    }
    if (update.closeReasonId) {
      await loadByIdInTenant(
        ctx as Parameters<typeof loadByIdInTenant>[0],
        "threadCloseReasons",
        update.closeReasonId,
      );
    }
    await applyThreadUpdate(ctx, thread, update);
    return null;
  },
});

/**
 * Audited changes on a thread (who changed what, when). Read from the
 * operational audit sink by target; newest first, bounded.
 */
export const listThreadHistory = tenantQuery({
  args: {
    threadId: v.id("channelThreads"),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("clinicAuditEvents"),
      action: v.string(),
      actorName: v.optional(v.string()),
      actorKind: v.optional(v.string()),
      payload: v.optional(v.any()),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const thread = await loadByIdInTenant(ctx, "channelThreads", args.threadId);
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);
    const rows = (await ctx.db
      .query("clinicAuditEvents")
      .withIndex("by_target", (q) =>
        q
          .eq("tenantId", ctx.tenantId)
          .eq("targetType", "channel_thread")
          .eq("targetId", thread._id),
      )
      .order("desc")
      .take(limit)) as Doc<"clinicAuditEvents">[];
    const names = new Map<string, string | undefined>();
    const result = [];
    for (const row of rows) {
      if (!names.has(row.actorMemberId)) {
        names.set(row.actorMemberId, await memberLabel(ctx, row.actorMemberId));
      }
      result.push({
        _id: row._id,
        action: row.action,
        actorName: names.get(row.actorMemberId),
        actorKind: row.actorKind,
        payload: row.payload,
        createdAt: row.createdAt,
      });
    }
    return result;
  },
});

export const addInternalNote = tenantMutation({
  args: {
    threadId: v.id("channelThreads"),
    body: v.string(),
    mentionedMemberIds: v.array(v.id("members")),
  },
  returns: v.id("threadInternalNotes"),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "messages.send");
    const thread = await loadByIdInTenant(
      ctx as Parameters<typeof loadByIdInTenant>[0],
      "channelThreads",
      args.threadId,
    );
    const body = args.body.trim();
    if (!body || body.length > 4_000) {
      throw new ConvexError({ code: "INVALID_INTERNAL_NOTE" });
    }
    const mentioned = [];
    for (const memberId of Array.from(new Set(args.mentionedMemberIds))) {
      await loadByIdInTenant(
        ctx as Parameters<typeof loadByIdInTenant>[0],
        "members",
        memberId,
      );
      mentioned.push(memberId);
    }
    const now = Date.now();
    const noteId = await ctx.db.insert("threadInternalNotes", {
      tenantId: ctx.tenantId,
      threadId: thread._id,
      body,
      mentionedMemberIds: mentioned,
      createdBy: ctx.memberId,
      createdAt: now,
      updatedAt: now,
    });
    await audit(ctx, "inbox.note.created", thread._id, {
      noteId,
      mentionedMemberIds: mentioned,
    });
    return noteId;
  },
});

export const createReminder = tenantMutation({
  args: {
    threadId: v.id("channelThreads"),
    note: v.string(),
    dueAt: v.number(),
    assignedMemberId: v.optional(v.id("members")),
  },
  returns: v.id("threadReminders"),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "messages.send");
    const thread = await loadByIdInTenant(
      ctx as Parameters<typeof loadByIdInTenant>[0],
      "channelThreads",
      args.threadId,
    );
    const note = args.note.trim();
    if (!note || note.length > 500 || args.dueAt <= Date.now()) {
      throw new ConvexError({ code: "INVALID_REMINDER" });
    }
    const assignedMemberId = args.assignedMemberId ?? ctx.memberId;
    await loadByIdInTenant(
      ctx as Parameters<typeof loadByIdInTenant>[0],
      "members",
      assignedMemberId,
    );
    const now = Date.now();
    const reminderId = await ctx.db.insert("threadReminders", {
      tenantId: ctx.tenantId,
      threadId: thread._id,
      note,
      dueAt: args.dueAt,
      status: "scheduled",
      assignedMemberId,
      createdBy: ctx.memberId,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAt(args.dueAt, markReminderDue, {
      reminderId,
    });
    await ctx.db.patch(thread._id, {
      nextStep: note,
      nextStepDueAt: args.dueAt,
      updatedAt: now,
    });
    await audit(ctx, "inbox.reminder.created", thread._id, { reminderId, dueAt: args.dueAt });
    return reminderId;
  },
});

export const _markReminderDue = internalMutation({
  args: { reminderId: v.id("threadReminders") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const reminder = await ctx.db.get(args.reminderId);
    if (!reminder || reminder.status !== "scheduled") return null;
    await ctx.db.patch(reminder._id, { status: "due", updatedAt: Date.now() });
    return null;
  },
});

/**
 * Safety net for reminders whose scheduled `_markReminderDue` was lost (e.g.
 * a deploy that dropped a scheduled function). Global index, tiny pages.
 */
export const sweepOverdueReminders = internalMutation({
  args: { limit: v.optional(v.number()) },
  returns: v.object({ marked: v.number() }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const rows = (await ctx.db
      .query("threadReminders")
      .withIndex("by_status_due", (q) => q.eq("status", "scheduled").lt("dueAt", now))
      .take(Math.min(Math.max(args.limit ?? 200, 1), 500))) as Doc<"threadReminders">[];
    for (const reminder of rows) {
      await ctx.db.patch(reminder._id, { status: "due", updatedAt: now });
    }
    return { marked: rows.length };
  },
});

export const setReminderStatus = tenantMutation({
  args: {
    reminderId: v.id("threadReminders"),
    status: v.union(v.literal("completed"), v.literal("cancelled")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "messages.send");
    const reminder = await loadByIdInTenant(
      ctx as Parameters<typeof loadByIdInTenant>[0],
      "threadReminders",
      args.reminderId,
    );
    if (reminder.status === args.status) return null;
    await ctx.db.patch(reminder._id, { status: args.status, updatedAt: Date.now() });
    await audit(ctx, `inbox.reminder.${args.status}`, reminder.threadId, {
      reminderId: reminder._id,
    });
    return null;
  },
});

export const generateAttachmentUploadUrl = tenantMutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    requireCapability(ctx.role, "messages.send");
    return await ctx.storage.generateUploadUrl();
  },
});

export const registerAttachment = tenantMutation({
  args: {
    threadId: v.id("channelThreads"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    contentType: v.string(),
    size: v.number(),
    caption: v.optional(v.string()),
  },
  returns: v.object({
    attachmentId: v.id("channelAttachments"),
    url: v.string(),
  }),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "messages.send");
    const thread = await loadByIdInTenant(
      ctx as Parameters<typeof loadByIdInTenant>[0],
      "channelThreads",
      args.threadId,
    );
    const allowedTypes = new Set([
      "application/pdf",
      "image/jpeg",
      "image/png",
      "audio/mpeg",
      "audio/ogg",
      "audio/webm",
    ]);
    if (!allowedTypes.has(args.contentType) || args.size <= 0 || args.size > 16 * 1024 * 1024) {
      throw new ConvexError({ code: "ATTACHMENT_NOT_ALLOWED" });
    }
    const url = await ctx.storage.getUrl(args.storageId);
    if (!url) throw new ConvexError({ code: "ATTACHMENT_NOT_FOUND" });
    const now = Date.now();
    const attachmentId = await ctx.db.insert("channelAttachments", {
      tenantId: ctx.tenantId,
      threadId: thread._id,
      storageId: args.storageId,
      fileName: args.fileName.trim().slice(0, 180) || "ficheiro",
      contentType: args.contentType,
      size: args.size,
      caption: args.caption?.trim().slice(0, 1_024) || undefined,
      status: "uploaded",
      createdBy: ctx.memberId,
      createdAt: now,
      updatedAt: now,
    });
    await audit(ctx, "inbox.attachment.uploaded", thread._id, {
      attachmentId,
      contentType: args.contentType,
      size: args.size,
    });
    return { attachmentId, url };
  },
});

export const settleAttachment = tenantMutation({
  args: {
    attachmentId: v.id("channelAttachments"),
    status: v.union(v.literal("sent"), v.literal("failed")),
    outboxId: v.optional(v.id("channelOutbox")),
    failureReason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "messages.send");
    const attachment = await loadByIdInTenant(
      ctx as Parameters<typeof loadByIdInTenant>[0],
      "channelAttachments",
      args.attachmentId,
    );
    if (args.outboxId) {
      await loadByIdInTenant(
        ctx as Parameters<typeof loadByIdInTenant>[0],
        "channelOutbox",
        args.outboxId,
      );
    }
    await ctx.db.patch(attachment._id, {
      status: args.status,
      outboxId: args.outboxId,
      failureReason: args.failureReason?.slice(0, 500),
      updatedAt: Date.now(),
    });
    await audit(ctx, `inbox.attachment.${args.status}`, attachment.threadId, {
      attachmentId: attachment._id,
      outboxId: args.outboxId,
    });
    return null;
  },
});
