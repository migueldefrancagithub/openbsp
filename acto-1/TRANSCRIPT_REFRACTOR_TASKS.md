# Transcript-Driven Refactor Tasks

Source artifacts:

- `LIVE_AQUI_TRANSCRIPT.md`
- `LIVE_AQUI_TRANSCRIPT_PART2.md`
- `LIVE_AQUI_PRODUCT_INTELLIGENCE_FULL.md`
- `LIVE_AQUI_OPENBSP_GAP_MAP.md`

Goal: turn OpenBSP from a generic WhatsApp Cloud inbox into a coexistence-first SaaS for campaigns, CTWA lead attribution, Meta failure intelligence, and guarded AI handoff.

## Product Principle

The lesson from the live is that clients do not pay for "API access". They pay for:

- keeping their existing WhatsApp Business app and Web workflow;
- sending approved campaigns without sketchy extensions;
- knowing exactly who received, read, replied, clicked, failed, and why;
- preventing account quality damage;
- giving AI only the conversations where it helps.

## Refactor Epic 1: Campaign Engine

### Task 1.1: Replace Placeholder Campaigns Page

- Remove the disabled "New campaign soon" affordance or convert it to a real flow.
- Add real campaign list view:
  - draft
  - scheduled
  - running
  - paused
  - completed
  - failed

Status 2026-05-15: campaign engine build shipped. `/app/campaigns` now creates contact folders/lists, adds existing contacts to a list, creates campaigns from approved no-variable templates, launches campaigns into the existing WhatsApp outbox, and renders recipient status stats.

### Task 1.2: Add Campaign Schema

Subtasks:

- Add `contactLists`.
- Add `contactListMembers`.
- Add `csvImportJobs`.
- Add `campaignRuns`.
- Add `campaignRecipients`.
- Add `campaignEvents`.

Status 2026-05-15: first schema layer shipped. `contactLists`, `contactListMembers`, `csvImportJobs`, `campaignRecipients`, and `campaignEvents` were added; the existing `campaigns` table was expanded into the campaign-run record used by `messages.sentByCampaignId`.

Each `campaignRecipient` should hold:

- `tenantId`
- `campaignRunId`
- `contactId`
- `messageId`
- `recipientIdentityKind`: `phone | bsuid`
- `recipientIdentityValue`
- `status`
- `failureCode`
- `failureReason`
- `metaErrorCategory`
- `clickedButtonPayload`
- `repliedAt`

### Task 1.3: Campaign Dispatch Pipeline

Subtasks:

- Create campaign from approved template + list/folder.
- Validate consent before enqueue.
- Enqueue recipients through existing outbox.
- Batch dispatch with pacing.
- Pause campaign on high failure rate or quality/circuit-breaker warnings.

Status 2026-05-15: launch path shipped for approved templates. Launching a campaign:

- checks campaign/template/list tenant ownership;
- requires campaign start capability;
- requires granted consent per recipient based on template category;
- skips non-consented or unsendable recipients with reason;
- creates/reuses conversations;
- inserts `messages` rows with `sentByCampaignId`;
- schedules the existing official Meta dispatcher;
- syncs message lifecycle status back to `campaignRecipients`.

Status update 2026-05-15: the remaining core campaign controls are now present:

- pacing/batching controls. Done with staggered dispatch scheduling.
- pause campaign on high failure rate or phone-number quality warning. Done.
- variable template composer. Done in inbox composer; campaign CSV/list variable mapping remains future enhancement.
- CSV import directly into a named list. Done.
- automatic pause on failure-rate spike. Done.
- retry-safe failure requeue. Done.
- phone-number quality/circuit-breaker pause. Done.

## Refactor Epic 2: Lists/Folders and CSV Import

### Task 2.1: Promote Current CSV Import

Current import is contact-level only. The live's model needs campaign folders/lists.

Subtasks:

- Import CSV into a named list/folder.
- Deduplicate by BSUID first, then phone.
- Store opt-in proof per row.
- Store invalid rows in `csvImportJobs` result.
- Allow reusing the same list across campaigns.

Status 2026-05-15: shipped. Campaigns can now import CSV-style rows directly into a selected contact list/folder. The import:

- creates or updates contacts;
- adds imported contacts to `contactListMembers`;
- records marketing consent proof when provided;
- stores a `csvImportJobs` audit row;
- returns invalid-row details;
- exposes the flow in `/app/campaigns` through "Import CSV to list".

### Task 2.2: Segment Builder

Subtasks:

- Segment by tag/list.
- Segment by previous campaign status.
- Segment by replied/clicked/failed.
- Segment by CTWA/ad source.

Status 2026-05-15: first segment builder shipped in `/app/campaigns`. Operators can create reusable lists from CTWA ad leads and previous campaign outcomes: replied, clicked, or failed. Tag-based segmentation remains future work.

## Refactor Epic 3: Meta Failure Intelligence

### Task 3.1: Normalize Meta Errors

Current messages have `failureCode` and `failureReason`, but campaign reporting needs actionable categories.

Create classifier:

- `billing_issue`
- `blocked_by_meta`
- `recipient_over_marketed`
- `invalid_recipient`
- `experiment_or_test_number`
- `template_rejected_or_paused`
- `quality_limit_or_pacing`
- `network_or_unknown`

Status 2026-05-15: initial classifier shipped in `convex/lib/meta/errorClassifier.ts` and is now applied when campaign-linked messages fail.

### Task 3.2: Failure UI

Subtasks:

- Campaign failure drilldown.
- Per-recipient failure table.
- Suggested fix per error category.
- Export failed contacts.
- "Retry safe failures" only for categories that are safe to retry.

Status 2026-05-15: failure intelligence UI shipped. Failed campaign-linked messages trigger `_evaluateSafetyPause`; if the failure rate crosses the configured threshold, the campaign is paused and `pauseReason` is shown in `/app/campaigns`. Campaign cards now include failure drilldown, category-specific operator fixes, and a retry action that only requeues `network_or_unknown` failures.

Status update 2026-05-15: failed-contact export shipped. Campaign cards can copy failed recipients as CSV for cleanup/support, and Meta quality/pacing failures now open a phone-number circuit breaker and pause the linked campaign.

## Refactor Epic 4: Coexistence / Embedded Signup

### Task 4.1: Replace Manual WABA Form

Current `ConnectWabaForm` requires manual Meta IDs and system user token. The live's product needs guided coexistence onboarding.

Subtasks:

- Add onboarding checklist:
  - BM exists
  - BM verified
  - billing configured
  - privacy policy URL
  - terms URL
  - Meta app configured
  - webhook verified
- Add Embedded Signup callback handler.
- Discover WABA and phone numbers after signup.
- Persist connection with tenant fence.

Status 2026-05-15: product surface shipped. Settings now includes a coexistence readiness checklist for Business Manager, verification, billing, privacy/terms URLs, advanced access scopes, webhook verification, Business App continuity, and support escalation. It also creates state-tracked Embedded Signup sessions and launches the Meta redirect when `META_EMBEDDED_SIGNUP_APP_ID`, `META_EMBEDDED_SIGNUP_CONFIG_ID`, and `META_EMBEDDED_SIGNUP_REDIRECT_URI` are configured. Full post-callback WABA/phone discovery still depends on live Meta credentials.

### Task 4.2: Support Center

Subtasks:

- Add connection guide page.
- Add "what to ask the client" checklist.
- Add billing/card troubleshooting.
- Add blocked/restricted number replacement guide.

Status 2026-05-15: shipped at `/app/support`. The page now covers connection readiness, client intake, billing/card recovery, restricted-number handling, and quality/pacing incident response, with fast links back to settings, campaigns, CTWA leads, privacy, and terms.

## Refactor Epic 5: CTWA Lead Attribution

### Task 5.1: Parse Referral Context

Extend `parseMetaPayload` and webhook processing to persist:

- source: `ctwa | organic | campaign_reply | unknown`
- campaign id/name
- adset id/name
- ad id/name
- creative/media info
- click timestamp
- CTWA/free-entry window expiry

Status 2026-05-15: shipped for inbound CTWA referrals. Webhook parsing now extracts Meta `referral` context, persists `ctwaReferrals`, marks conversations as `leadSource=ctwa`, sets `lastCtwaClickAt`, initializes `opportunityStatus=new`, and makes the conversation `aiState=eligible`.

### Task 5.2: Lead Dashboard

Subtasks:

- New leads from ads.
- Replies by campaign/ad/adset.
- Opportunity/booked/lost status.
- Revenue attribution placeholder.

Status 2026-05-15: CTWA lead dashboard shipped at `/app/leads`. It summarizes total referrals, open CTWA chats, booked opportunities, free-entry windows, pipeline counts, booked value, and recent ad entries linked back to inbox conversations.

## Refactor Epic 6: Guarded AI

### Task 6.1: AI Eligibility Rules

Default behavior from the live:

- AI handles CTWA/ad leads.
- AI does not handle organic by default.
- Human reply pauses AI.
- Opportunity/booking pauses AI.
- New CTWA click can reset a paused/blacklisted lead.

Subtasks:

- Add `aiConversationState`.
- Add `aiPausedReason`.
- Add `lastHumanMessageAt`.
- Add `lastCtwaClickAt`.
- Add `opportunityStatus`.

Status 2026-05-15: core guardrail layer shipped. CTWA conversations are marked AI eligible on inbound referral. Human outbound replies now pause AI with `aiPausedReason=human_reply`. Agents can update opportunity status and manually pause/resume AI from the inbox thread. `booked`/`lost` statuses pause AI automatically.

### Task 6.2: Audit and Override

Subtasks:

- Show AI state in inbox.
- Manual pause/resume.
- Store AI-generated messages in audit log.
- Prevent AI sending outside allowed window/template rules.

Status 2026-05-15: inbox shows CTWA/AI state, manual pause/resume, opportunity value, and AI audit logging. Outbound AI sender is intentionally blocked until the AI provider/agent contract is selected.

## Refactor Epic 7: Remove or Ship Dormant Identity Features

### Task 7.1: Decide `contactRequest.ts`

This file implements useful BSUID/contact-request work, but it is not surfaced.

Options:

- Ship it:
  - add a UI action on BSUID-only contacts;
  - add an API route;
  - add audit log.
- Park it:
  - move to a future feature branch/backlog, outside deployed Convex functions.
- Delete it:
  - reintroduce only when BSUID-only UX becomes scheduled.

Status 2026-05-15: shipped as a visible contacts action. BSUID-only contacts now expose "Request phone" in `/app/contacts`, which calls the existing Meta contact-request action with an operator-editable message. API-route/audit-log hardening remains future work.

## Refactor Epic 8: Legal and Security Hygiene

### Task 8.1: Remove Placeholder Legal Links

- Replace `href="#"` Privacy/Terms links with real pages or remove links.

### Task 8.2: Token and Secret Discipline

- Never paste PATs in chat.
- Store GitHub auth in keyring through `gh`.
- Keep Meta tokens out of local repo.
- Ensure `.env.local` is ignored.

## Execution Order

1. Finish dead-code cleanup and restore Node/tooling.
2. Build campaign schema and list/folder import.
3. Wire campaign dispatch through existing outbox.
4. Build campaign analytics and Meta failure classifier.
5. Add CTWA attribution.
6. Replace manual WABA connection with Embedded Signup.
7. Add guarded AI.
8. Decide/polish dormant BSUID contact-request feature.

## Definition of Done

OpenBSP reaches the "live lesson" bar when a tenant can:

1. connect WABA/coexistence cleanly;
2. import a named list with consent proof;
3. choose an approved template;
4. launch a campaign;
5. see delivered/read/replied/clicked/failed in real time;
6. understand every Meta failure in plain language;
7. track CTWA lead source;
8. let AI answer ad leads but stop on human takeover.
