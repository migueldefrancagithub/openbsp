# OpenBSP delivery review - 2026-09-09

## Release scope

Base: main `6ed407f19c176c7d77bdb7c6516fc048f2cfbe57` (PR #33).
Branch: `codex/delivery-review`.
Production frontend: https://openbsp-ashy.vercel.app
Production backend: `prod:effervescent-butterfly-531`.

This is a corrective release for the existing CRM, campaigns and operational
experience. It is not certification of every historical roadmap item.
No provider configuration, credentials, allowlists or external projects changed.
No real WhatsApp messages sent during this review.

## Corrections and evidence

| Area | Correction | Evidence |
| --- | --- | --- |
| CRM | Inbox, AI tools, handoff and appointment state changes map to the active pipeline | Convex regression suite |
| CRM | Selecting a stage that pauses AI preserves the chosen stage | Explicit-stage regression |
| CRM | Archived stage redirects follow the current active target, bounded to 100 hops and fail closed on invalid/cross-tenant chains | Redirect-chain regression |
| CRM | Many archived columns cannot hide live stages | 105 archived-stage regression |
| Campaigns | Audience selector uses real custom/system CRM stages | Tenant isolation and materialization tests |
| Campaigns | Empty picked audience remains empty; ambiguous identities fail closed | Preview/materialization regressions |
| Campaigns | Opaque provider identifiers preserved; phone aliases deduplicated | Identity regression |
| Campaigns | Draft channel, message type and audience updated atomically | Draft revision regression |
| Campaigns | Old scheduled cleanup/materialization cannot corrupt a newer draft | Stale-job and duplicate-cleanup regressions |
| Campaigns | Inbound recency uses inbound time, not delivery/status activity | Inbound-recency regression |
| Campaigns | Recent-send suppression uses indexed send time | Indexed bounded query |
| Campaigns | Preview refreshes every minute, eligibility still uses server time | UI subscription + backend gates |
| UI | Main operational copy uses business/contact terminology and response deadlines | Source review |
| UI | Compact theme control fits the navigation rail | Authenticated production screenshot exposed original overlap |
| Dependencies | baseline-browser-mapping and Vitest security patches | Clean npm install; audit reports zero known vulnerabilities |

## Verification before merge

- 85 test files, 435 tests passed, including RBAC/isolation and campaign safety.
- TypeScript typecheck passed.
- 275 Convex error codes mapped to PT/EN.
- Optimized Next.js build passed using webpack (local Turbopack worker constrained
  by sandbox; cloud deployment must independently pass its normal build).
- Convex production dry-run accepted the expanded schema and three new indexes.
- Production preflight in strict mode passed. Secret values were checked in
  memory only, not written to reports or source.

## External readiness and limits

- Authenticated production workspace displayed no AI provider ready and no agents.
  Owner must configure/test the provider in Settings > AI, then create and publish
  an agent with knowledge, tools and handoff policy. Autonomous AI is not ready
  for customer acceptance until this is done and tested.
- Direct Meta Graph signup credentials remain absent. Existing Hub lab remains
  the configured integration; this review does not certify Meta coexistence.
- Real send/delivery/reply/opt-out acceptance remains to be exercised on the
  authorized lab audience only. No bulk-send permission was widened.
- Archiving a column preserves history and migrates assignment in bounded
  batches; it does not retroactively apply entry actions to historical leads.
- Production smoke tests verify navigation and rendering, not a substitute for
  an actual provider end-to-end test.
- Preflight retains an older credential-rotation warning. Its historical status
  was not independently verified in this review; no credential rotation performed.

## Release and acceptance

Merge to main, deploy Convex first, then build the frontend from the merged clean
checkout. Verify production alias and authenticated CRM/campaign/Inbox screens
on desktop/mobile in PT/EN. Record final merge/deployment identifiers in the
delivery handoff after publication.

Acceptance exercise: create/edit/reorder a stage, move a lead and reload; select
that stage in an unsent campaign draft; confirm audience, message and schedule
before any authorized live send. Test AI only after provider setup succeeds.
