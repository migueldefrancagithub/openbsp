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

export default crons;
