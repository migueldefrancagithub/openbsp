import type { Doc, Id } from "../../_generated/dataModel";

/**
 * Operator-facing thread timeline ("what happened and why").
 *
 * These rows are written in the same transaction as the automation / inbox
 * mutation that produced the outcome, so the inbox can explain a silent bot,
 * a pilot-gate block or a rejected send without reading provider payloads.
 *
 * Never write provider raw payloads, tokens or full phone numbers into
 * `payload`.
 */
export const THREAD_SYSTEM_EVENT_KINDS = [
  "automation.started",
  "automation.completed",
  "automation.handoff",
  "automation.stopped",
  "automation.paused_by_operator",
  "automation.failed",
  "pilot.recipient_not_allowlisted",
  "pilot.allowlist_requested",
  "outbox.failed",
  "handoff.case_opened",
  "handoff.case_assigned",
  "handoff.case_resolved",
  "handoff.returned_to_ai",
  "lead.status_changed",
  "lead.intent_changed",
  "inbox.assigned",
  "inbox.snoozed",
  "inbox.unsnoozed",
  "inbox.closed",
  "inbox.reopened",
  "agenda.booked",
  "agenda.confirmed",
  "agenda.cancelled",
  "agenda.attended",
  "agenda.no_show",
  "followup.sent",
  "followup.failed",
  "followup.stopped",
  "ai.replied",
  "ai.handoff",
  "ai.failed",
  "ai.skipped",
  "ai.paused",
  "ai.resumed",
  "ai.suggested",
  "ai.approved",
  "ai.discarded",
  "ai.mode_changed",
  /** The reply committed the clinic to something and nothing is carrying it. */
  "ai.promise_unowned",
] as const;

export type ThreadSystemEventKind = (typeof THREAD_SYSTEM_EVENT_KINDS)[number];
export type ThreadSystemEventSeverity = "info" | "warning" | "error";
export type ThreadSystemEventActor = "member" | "automation" | "system";

type ThreadRef = Pick<
  Doc<"channelThreads">,
  "_id" | "tenantId" | "channelId" | "threadKey"
>;

export type RecordThreadSystemEventArgs = {
  thread: ThreadRef;
  kind: ThreadSystemEventKind;
  severity: ThreadSystemEventSeverity;
  actorType: ThreadSystemEventActor;
  code?: string;
  actorMemberId?: Id<"members">;
  chatbotId?: Id<"chatbots">;
  runId?: Id<"channelAutomationRuns">;
  humanCaseId?: Id<"humanCases">;
  payload?: Record<string, string | number | boolean | undefined>;
  /** Idempotency key scoped to the thread. Replays return `null`. */
  dedupeKey: string;
  now?: number;
};

const JSON_CODE_RE = /"code"\s*:\s*"([A-Z][A-Z0-9_]+)"/;
const BARE_CODE_RE = /\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/;

/**
 * Pull a machine-readable code out of a failure reason string. Automation
 * dispatch failures carry the ConvexError payload inside `error.message`
 * (`Uncaught ConvexError: {"code":"RECIPIENT_NOT_ALLOWLISTED"}`), so the
 * outbound gates in the Hub adapter stay untouched while the inbox still
 * learns the exact reason.
 */
export function extractErrorCode(reason: string | undefined): string | undefined {
  if (!reason) return undefined;
  const json = JSON_CODE_RE.exec(reason);
  if (json) return json[1];
  const bare = BARE_CODE_RE.exec(reason);
  return bare ? bare[1] : undefined;
}

export async function recordThreadSystemEvent(
  ctx: { db: any },
  args: RecordThreadSystemEventArgs,
): Promise<Id<"threadSystemEvents"> | null> {
  const existing = await ctx.db
    .query("threadSystemEvents")
    .withIndex("by_thread_dedupe", (q: any) =>
      q.eq("threadId", args.thread._id).eq("dedupeKey", args.dedupeKey),
    )
    .first();
  if (existing) return null;
  return await ctx.db.insert("threadSystemEvents", {
    tenantId: args.thread.tenantId,
    channelId: args.thread.channelId,
    threadId: args.thread._id,
    threadKey: args.thread.threadKey,
    kind: args.kind,
    severity: args.severity,
    code: args.code?.slice(0, 120),
    actorType: args.actorType,
    actorMemberId: args.actorMemberId,
    chatbotId: args.chatbotId,
    runId: args.runId,
    humanCaseId: args.humanCaseId,
    payload: args.payload,
    dedupeKey: args.dedupeKey.slice(0, 200),
    createdAt: args.now ?? Date.now(),
  });
}

/** Keep only the last four digits so the timeline never leaks a full number. */
export function maskPhone(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 6) return "•••";
  return `•••${digits.slice(-4)}`;
}
