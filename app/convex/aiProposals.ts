import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { loadByIdInTenant, requireCapability, tenantMutation, tenantQuery } from "./lib/customFunctions";
import { writeAudit } from "./lib/audit";
import { findOrCreateContactForThread } from "./lib/channels/contactBridge";
import { recordThreadSystemEvent } from "./lib/channels/systemEvents";
import { upsertOpsAlert } from "./lib/opsAlerts";
import { FIELD_LABEL_PT, normalizeValue, type ProposalField } from "./lib/ai/proposals";

/**
 * The queue where what the AI heard waits for a person.
 *
 * Approving and ignoring are BOTH decisions and both are recorded. Ignoring is
 * not "nothing happened": it is the signal that the assistant read the
 * conversation wrong, and it is fed back into the next prompt so the same
 * suggestion does not come back word for word.
 */
const proposalValidator = v.object({
  _id: v.id("aiProposals"),
  kind: v.string(),
  threadId: v.id("channelThreads"),
  threadKey: v.string(),
  channelId: v.id("channels"),
  patientName: v.optional(v.string()),
  field: v.optional(v.string()),
  value: v.optional(v.string()),
  previousValue: v.optional(v.string()),
  action: v.optional(v.string()),
  excerpt: v.optional(v.string()),
  status: v.string(),
  decidedByName: v.optional(v.string()),
  decidedAt: v.optional(v.number()),
  expiresAt: v.number(),
  createdAt: v.number(),
});

async function decorate(ctx: { db: any }, row: Doc<"aiProposals">) {
  const thread = (await ctx.db.get(row.threadId)) as Doc<"channelThreads"> | null;
  const identity = thread?.identityId ? ((await ctx.db.get(thread.identityId)) as Doc<"channelIdentities"> | null) : null;
  const decidedBy = row.decidedBy ? ((await ctx.db.get(row.decidedBy)) as Doc<"members"> | null) : null;
  const user = decidedBy ? await ctx.db.get(decidedBy.userId) : null;
  return {
    _id: row._id,
    kind: row.kind,
    threadId: row.threadId,
    threadKey: thread?.threadKey ?? "",
    channelId: thread?.channelId as Id<"channels">,
    patientName: identity?.displayName,
    field: row.field,
    value: row.value,
    previousValue: row.previousValue,
    action: row.action,
    excerpt: row.excerpt,
    status: row.status,
    decidedByName: user?.name ?? user?.email,
    decidedAt: row.decidedAt,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

export const listPending = tenantQuery({
  args: { threadId: v.optional(v.id("channelThreads")) },
  returns: v.array(proposalValidator),
  handler: async (ctx, args) => {
    const rows = args.threadId
      ? ((await ctx.db
          .query("aiProposals")
          .withIndex("by_thread_status", (q) => q.eq("threadId", args.threadId!).eq("status", "pending"))
          .take(20)) as Doc<"aiProposals">[])
      : ((await ctx.db
          .query("aiProposals")
          .withIndex("by_tenant_status", (q) => q.eq("tenantId", ctx.tenantId).eq("status", "pending"))
          .order("desc")
          .take(50)) as Doc<"aiProposals">[]);
    // A tenant-scoped read still has to fence per row: the thread index is not
    // tenant-scoped by itself.
    const mine = rows.filter((row) => row.tenantId === ctx.tenantId);
    return await Promise.all(mine.map((row) => decorate(ctx, row)));
  },
});

export const listDecided = tenantQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.object({ page: v.array(proposalValidator), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("aiProposals")
      .withIndex("by_tenant_status", (q) => q.eq("tenantId", ctx.tenantId))
      .order("desc")
      .paginate({ cursor: args.paginationOpts.cursor, numItems: Math.min(Math.max(args.paginationOpts.numItems, 1), 50) });
    const decided = result.page.filter((row) => row.status !== "pending");
    return {
      page: await Promise.all(decided.map((row) => decorate(ctx, row))),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const decide = tenantMutation({
  args: {
    proposalId: v.id("aiProposals"),
    decision: v.union(v.literal("approve"), v.literal("dismiss")),
  },
  returns: v.object({ applied: v.boolean() }),
  handler: async (ctx, args) => {
    requireCapability(ctx.role, "inbox.custom_fields");
    const proposal = await loadByIdInTenant(ctx, "aiProposals", args.proposalId);
    if (proposal.status !== "pending") throw new ConvexError({ code: "PROPOSAL_NOT_PENDING" });
    const now = Date.now();
    const thread = (await ctx.db.get(proposal.threadId)) as Doc<"channelThreads"> | null;
    if (!thread) throw new ConvexError({ code: "NOT_FOUND" });

    let applied = false;
    if (args.decision === "approve") {
      if (proposal.kind === "contact_field" && proposal.field && proposal.value) {
        const identity = thread.identityId ? ((await ctx.db.get(thread.identityId)) as Doc<"channelIdentities"> | null) : null;
        const contact = await findOrCreateContactForThread({ db: ctx.db, tenantId: ctx.tenantId }, thread, identity);
        if (contact.erasedAt) throw new ConvexError({ code: "PROPOSAL_CONTACT_ANONYMISED" });
        const field = proposal.field as ProposalField;
        const value = normalizeValue(field, proposal.value);
        if (field === "name") {
          await ctx.db.patch(contact._id, { name: value });
        } else {
          const attributes = { ...((contact.customAttributes ?? {}) as Record<string, unknown>), email: value };
          await ctx.db.patch(contact._id, { customAttributes: attributes });
        }
        applied = true;
      } else if (proposal.kind === "next_action" && proposal.action) {
        await ctx.db.patch(thread._id, { nextStep: proposal.action, nextStepDueAt: now, updatedAt: now });
        applied = true;
      }
    }

    await ctx.db.patch(proposal._id, {
      status: args.decision === "approve" ? "approved" : "dismissed",
      decidedBy: ctx.memberId,
      decidedAt: now,
      updatedAt: now,
    });
    await recordThreadSystemEvent(ctx, {
      thread,
      kind: args.decision === "approve" ? "proposal.approved" : "proposal.dismissed",
      severity: "info",
      actorType: "member",
      actorMemberId: ctx.memberId,
      payload: { kind: proposal.kind, field: proposal.field },
      dedupeKey: `proposal:${proposal._id}:${args.decision}`,
      now,
    });
    await writeAudit(ctx, {
      action: args.decision === "approve" ? "ai.proposal.approved" : "ai.proposal.dismissed",
      targetType: "aiProposal",
      targetId: proposal._id,
      payload: {
        kind: proposal.kind,
        field: proposal.field,
        // Both sides travel: whoever audits this later must not have to trust
        // that the previous value is still on the record.
        before: proposal.previousValue,
        after: proposal.value ?? proposal.action,
      },
    });
    return { applied };
  },
});

/**
 * What nobody decides expires — and the expiry has a destination.
 *
 * A deadline whose end depends on someone else acting is not a deadline, it is
 * a condition. Without this the pending item would sit forever as a badge that
 * simulates attention while postponing the decision.
 */
export const sweepExpired = internalMutation({
  args: {},
  returns: v.object({ expired: v.number() }),
  handler: async (ctx) => {
    const now = Date.now();
    const due = (await ctx.db
      .query("aiProposals")
      .withIndex("by_status_expires", (q) => q.eq("status", "pending").lt("expiresAt", now))
      .take(100)) as Doc<"aiProposals">[];
    const byTenant = new Map<string, Doc<"aiProposals">[]>();
    for (const row of due) {
      await ctx.db.patch(row._id, { status: "expired", updatedAt: now });
      const list = byTenant.get(row.tenantId) ?? [];
      list.push(row);
      byTenant.set(row.tenantId, list);
    }
    for (const [tenantId, rows] of byTenant) {
      await upsertOpsAlert(ctx, {
        tenantId: tenantId as Id<"tenants">,
        kind: "proposal.expired",
        businessKey: `proposal:expired:${new Date(now).toISOString().slice(0, 10)}`,
        severity: "warn",
        title: `${rows.length} proposta(s) da IA venceram sem ninguém decidir.`,
        payload: {
          count: rows.length,
          fields: rows.map((row) => (row.field ? FIELD_LABEL_PT[row.field as ProposalField] : "próxima acção")),
        },
        href: "/app?tab=proposals",
        reopen: true,
        now,
      });
    }
    return { expired: due.length };
  },
});
