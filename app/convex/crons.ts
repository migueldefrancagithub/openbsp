import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * Meta sync safety nets. Webhooks (message_template_status_update,
 * phone_number_quality_update, account_update) are the real-time signal;
 * these sweeps recover anything a missed webhook would leave stale.
 */
const crons = cronJobs();

// debug_token introspection per account — detects revoked/expiring tokens.
crons.interval(
  "meta token health sweep",
  { hours: 6 },
  internal.whatsappAccounts.sweepTokenHealth,
  {},
);

// quality_rating / messaging tier / verified name pull per phone number.
crons.interval(
  "meta phone quality sweep",
  { hours: 6 },
  internal.whatsappAccounts.sweepPhoneQuality,
  {},
);

// Template status refresh across all accounts (webhook is primary).
crons.daily(
  "meta template status sweep",
  { hourUTC: 4, minuteUTC: 30 },
  internal.templates.sweepTemplateStatuses,
  {},
);

// Stale chatbot flow runs → timed_out (frees contacts stuck mid-flow).
crons.interval(
  "chatbot stale run sweep",
  { hours: 1 },
  internal.chatbotFlows.sweepStaleRuns,
  {},
);

// Stale channel-neutral automation runs (iaSolution Hub) → timed_out.
// The legacy sweep above only covers chatbotFlowRuns; this one was written in
// Phase 4 but never registered, so neutral runs could stay "active" forever.
crons.interval(
  "channel automation stale run sweep",
  { hours: 1 },
  internal.channelAutomation.sweepStaleRuns,
  {},
);

// Reminders whose scheduled due-marker was lost become "due" within 5 min.
crons.interval(
  "thread reminder overdue sweep",
  { minutes: 5 },
  internal.inboxOperations.sweepOverdueReminders,
  {},
);

// Retention policy report (no deletion in this phase).
crons.daily(
  "retention candidates report",
  { hourUTC: 3, minuteUTC: 0 },
  internal.retention.runDaily,
  {},
);

// Durable follow-ups: claim due tasks every minute (≤10, ≤5 during campaigns).
crons.interval("follow-up executor", { minutes: 1 }, internal.followUps.runDue, {});

// Claims whose dispatch job never settled are requeued (or failed after 3).
crons.interval("follow-up stale claim sweep", { minutes: 10 }, internal.followUps.sweepStaleClaims, {});

// Ops alerts: unconfirmed outbox rows and human-case SLA breaches.
crons.interval("ops unknown outbox sweep", { minutes: 10 }, internal.ops.sweepUnknownOutbox, {});
crons.interval("ops sla breach sweep", { minutes: 5 }, internal.ops.sweepSlaBreaches, {});
// Work that a person owes: suggestions awaiting approval, expired snoozes,
// and replies the provider never took.
crons.interval("ops pending work sweep", { minutes: 10 }, internal.ops.sweepPendingWork, {});

// Reports: rebuild today + yesterday per tenant from index-bounded scans.
crons.interval("analytics daily rollups", { hours: 1 }, internal.analyticsRollups.runHourly, {});

// AI turns stuck in processing (action lost) are failed and the team notified.
crons.interval("ai stale turn sweep", { minutes: 10 }, internal.aiRuntime.sweepStaleTurns, {});

// Outbound webhooks: signed deliveries with backoff; dead-letter after 8 tries.
crons.interval("webhook delivery", { minutes: 1 }, internal.outboundWebhooks.deliverDue, {});

export default crons;
