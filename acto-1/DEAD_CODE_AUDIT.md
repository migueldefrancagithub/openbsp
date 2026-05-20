# Dead Code / Refactor Audit

Date: 2026-05-15

Scope: `app/src` and `app/convex`, excluding generated Convex files.

Environment note: this migrated Mac did not have working Node/npm in PATH at the start of the pass. I installed a local Node toolchain under `~/.local/opt/node`, ran `npm ci`, and verified the app with typecheck, tests, and production build.

## Security Note

A GitHub PAT was pasted into the session. Treat it as compromised:

- Revoke it in GitHub immediately.
- Do not commit it or place it in `.env`.
- When publishing later, use `gh auth login` or a fine-grained token with least privilege.

## High-Confidence Removal Candidates

Status update, 2026-05-15:

- Installed local Node/npm and restored project dependencies with `npm ci`.
- Verified `npm run typecheck`: pass.
- Verified `npm run test`: 10 files / 60 tests passed.
- Verified `npm run build`: pass, 19 app routes generated.
- Ran `npm audit --omit=dev`: 2 moderate vulnerabilities inherited through `next@16.2.6` / bundled PostCSS. `npm audit fix --force` would downgrade/install a breaking Next version, so this should be handled by a controlled Next upgrade rather than an automatic force fix.
- Removed `useMutation` + `void useMutation` from `ConnectWabaForm.tsx`.
- Removed `notFoundJson` + `void notFoundJson` from `http.ts`.
- Removed `internalAction` + `void internalAction` from `api.ts`.
- Removed `internalAction` + `void internalAction` from `memberInvites.ts`.
- Removed unused `formatFullDateTime` from `relativeTime.ts`.
- Moved default WABA selection in `templates/new/page.tsx` from render-time `setState` into `useEffect`.
- Removed unused `notFoundJson` helper from `lib/apiAuth.ts`.
- Added draft `/privacy` and `/terms` pages and replaced landing footer `href="#"` links.
- Filtered inbox template picker to only show approved templates without variables until variable entry UI exists.
- Removed the disabled "New campaign soon" button; campaigns page now states the transcript-driven build target without a dead CTA.
- Made `META_GRAPH_VERSION` configurable through environment with a safe `v21.0` fallback.
- Added campaign foundation from the live:
  - `contactLists`, `contactListMembers`, `csvImportJobs`, `campaignRecipients`, and `campaignEvents` schema.
  - `campaigns.ts` Convex module for list creation, contact membership, campaign creation, launch, campaign list, and campaign detail.
  - Campaign launch now creates/reuses conversations, checks consent per recipient, queues official template messages through the existing outbox, and links `messages.sentByCampaignId`.
  - Message lifecycle updates now sync back into `campaignRecipients` so campaign analytics track queued/dispatching/sent/delivered/read/failed.
  - Campaign-linked failures now evaluate a safety pause; campaigns auto-pause when failure rate crosses the configured threshold and display `pauseReason` in UI.
  - Campaign failure drilldown now groups failures by Meta category, shows the suggested operator fix, and only exposes retry for retry-safe network/unknown failures.
  - `retrySafeFailures` requeues safe failed recipients with a new outbox message while preserving unsafe Meta policy/marketing-limit failures for cleanup.
  - Failed recipients can now be copied as CSV from campaign cards.
  - Meta quality/pacing failures now open a phone-number circuit breaker and pause the linked campaign.
  - Segment builder creates reusable lists from CTWA leads or previous campaign outcomes: replied, clicked, failed.
  - Campaign and retry dispatch are staggered to provide a first pacing layer instead of blasting every recipient at the same millisecond.
  - CSV rows can now be imported directly into a selected campaign contact list with a persisted `csvImportJobs` audit record.
  - Added Meta failure classifier in `lib/meta/errorClassifier.ts` and stores `metaErrorCategory` on failed campaign recipients.
  - `/app/campaigns` UI for creating folders, adding contacts, importing CSV into lists, creating campaigns, launching campaigns, and seeing recipient status totals.
  - TDD coverage in `convex/_test/campaigns.test.ts` and `convex/_test/metaFailureClassifier.test.ts`.
- Added CTWA lead intelligence from the live:
  - `parseMetaPayload` extracts inbound `referral` context.
  - `ctwaReferrals` persists ad/source metadata and 72h free-entry expiry.
  - Conversations are marked `leadSource=ctwa`, `opportunityStatus=new`, `aiState=eligible`, and `lastCtwaClickAt`.
  - Inbox list/thread now surface CTWA and AI eligibility state.
  - `/app/leads` dashboard now summarizes CTWA referrals, open chats, booked opportunities, free-entry windows, pipeline counts, and recent ad entries.
- Added `/app/support` for coexistence/client intake, billing recovery, blocked-number recovery, and quality/pacing incident playbooks.
- Added state-tracked Embedded Signup sessions in Settings; Meta redirect activates when the required env vars are configured.
- Surfaced dormant BSUID contact-request functionality in `/app/contacts` for BSUID-only contacts.
- Added inbox template variable entry, opportunity value tracking, CTWA booked-value reporting, and AI audit events.
- Added coexistence readiness surface in Settings while full Embedded Signup is still pending.
- Added guarded-AI control plane:
  - Human outbound replies pause CTWA AI eligibility with `aiPausedReason=human_reply`.
  - Agents can update opportunity status and pause/resume AI from the inbox thread.
  - `booked` and `lost` opportunity states pause AI automatically.

### Unused imports / "quiet unused" hacks

1. `app/src/components/settings/ConnectWabaForm.tsx`

- `useMutation` is imported but never used.
- `void useMutation;` exists only to silence the unused import.
- Removed.

2. `app/convex/http.ts`

- `notFoundJson` is imported but never used.
- `void notFoundJson;` exists only to silence the unused import.
- Removed.

2b. `app/convex/lib/apiAuth.ts`

- `notFoundJson` was exported but not called anywhere.
- Removed.

3. `app/convex/api.ts`

- `internalAction` is imported but never used.
- `void internalAction;` exists only to silence the unused import.
- Removed.

4. `app/convex/memberInvites.ts`

- `internalAction` is imported but never used.
- `void internalAction;` exists only to silence the unused import.
- Removed.

### Utility functions exported but unused

1. `app/src/lib/relativeTime.ts`

- `formatFullDateTime` appears to be exported but not referenced anywhere in `app/src` or `app/convex`.
- Removed.

2. `app/convex/contactRequest.ts`

- Public actions `send` and `listParentBsuidAccounts` are not referenced by the app UI or HTTP layer.
- Internal helpers `_loadContext` and `_anyWaba` are only used by those public actions.
- Done: BSUID-only contacts now show "Request phone" in `/app/contacts`, invoking the existing Meta contact-request action.

## Components Created But Never Rendered

No high-confidence unused React components found in `app/src/components`.

Checked components and they are rendered:

- `Hero`
- `LogoMarquee`
- `CoreFeatures`
- `GlowFeatures`
- `CommandPalette`
- `KbdHint`
- `ConvexClientProvider`
- `EmptyState`
- `PageHeader`
- `ConversationList`
- `ConversationThread`
- `Composer`
- `MessageBubble`
- `ConnectWabaForm`
- `MembersSection`
- `ApiKeysSection`
- `ImportCsvModal`

## State / Logic Refactor Candidates

1. `app/src/app/app/templates/new/page.tsx`

- `setWhatsappAccountId` is called during render:
  - `if (whatsappAccountId === "" && accounts && accounts.length > 0) { setWhatsappAccountId(accounts[0]._id); }`
- This is not dead code, but it is a React anti-pattern and can cause extra renders.
- Done.

2. `app/src/components/inbox/Composer.tsx`

- `variables: {}` in `onSendTemplate` means templates with variables are intentionally unsupported in the composer.
- Comment says "V1" / "var picker UI comes next".
- Done: quick picker now hides variable templates and explains that variable templates need the fuller composer/campaign flow.

3. `app/src/app/app/campaigns/page.tsx`

- Page is a placeholder with disabled "New campaign soon".
- This is not dead code, but it is product-debt: it should become a real campaign module or be hidden from navigation until the campaign engine exists.
- Done: removed the disabled CTA. The page now frames campaigns as the next build target from the transcript roadmap.

4. `app/src/app/page.tsx`

- Footer links use `href="#"` for Privacy and Terms.
- Done: created draft legal pages and linked to them.

## Commented / Placeholder Code Without Enough Explanation

1. "Quiet unused warning" comments:

- `app/convex/http.ts`
- `app/convex/api.ts`
- `app/convex/memberInvites.ts`

These hide dead imports. Remove instead of preserving.

2. Eslint disables:

- `app/src/components/Hero.tsx`: `jsx-a11y/media-has-caption`
- `app/src/components/LogoMarquee.tsx`: `@next/next/no-img-element`
- `app/src/components/CommandPalette.tsx`: `jsx-a11y/no-autofocus`
- Convex tests: `@typescript-eslint/no-require-imports`

Suggested action: keep only if there is an explicit reason beside the disable line, otherwise replace with compliant code or add a one-line justification.

3. Future/placeholder copy:

- `Variable picker UI ships next`
- `New campaign soon`
- `Requires templates first (E1) and campaigns engine (V1)`

Suggested action: convert to tracked backlog tasks. UI should either ship the feature or hide the affordance.

## Remaining Refactor Task Plan

### Task 1: Safety and repo hygiene

- Revoke leaked GitHub token.
- Keep local Node/npm available through `~/.local/opt/node` / `~/.local/bin`, or install a normal system Node manager later.
- Accept Xcode license so git/dev tooling works.
- Track the moderate Next/PostCSS audit issue and resolve through a deliberate Next upgrade when a patched compatible release is selected.

### Task 2: Remove high-confidence dead imports

- Done for the high-confidence candidates found in this pass.
- Re-run this scan after the campaign engine work lands.

### Task 3: Clean unused utility surface

- Done: removed `formatFullDateTime`.
- Search for other exported utilities after typecheck/lint are available.
- Add a small convention: utilities should be local until used in 2+ places.

### Task 4: Decide fate of `contactRequest`

- Option A: build UI/API entry point for contact request prompts.
- Option B: move it into a future/backlog file outside deployed Convex functions.
- Option C: delete it until BSUID-only contact request UX is scheduled.

### Task 5: React correctness cleanup

- Move `setWhatsappAccountId` defaulting into `useEffect`.
- Audit state variables with React lint once Node is restored.
- Add lint rule to block state updates during render.

### Task 6: Placeholder product cleanup

- Either hide Campaigns nav until campaign engine starts, or make it a real "coming soon" feature flag.
- Create real Privacy/Terms pages or remove dead links.
- Replace "ships next"/"soon" comments with issue-backed TODO format.

### Task 7: Tooling for ongoing dead-code detection

- Add ESLint unused imports/no-unused-vars enforcement.
- Add a dead-code scan script for:
  - unused exports
  - unused React components
  - unused Convex public functions
  - stale TODO/future comments
- Run this in CI before publishing the new GitHub repo.
