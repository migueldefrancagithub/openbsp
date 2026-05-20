# LIVE AQUI -> OpenBSP Gap Map

Audio source: `/Users/sidneychambal/Desktop/LIVE AQUI.m4a`

Generated artifacts:

- `acto-1/LIVE_AQUI_TRANSCRIPT.md` — first transcript pass, useful until about 01:09, then repetition/noise.
- `acto-1/LIVE_AQUI_TRANSCRIPT_PART2.md` — final-section pass, captures the 01:08 section but also loops on Meta failure logs.
- `acto-1/LIVE_AQUI_PRODUCT_INTELLIGENCE_FULL.md` — structured product intelligence from the whole audio.

## What The Live Is Really Saying

The product opportunity is not "a WhatsApp inbox". The live describes a coexistence-first SaaS for businesses that already sell through WhatsApp Business and suffer from blocks, restrictions, poor campaign visibility, and weak follow-up discipline.

The wedge is:

1. Let the business keep WhatsApp Business App + WhatsApp Web.
2. Add official API capability through Meta coexistence / Embedded Signup.
3. Give them campaigns, templates, lists, analytics, and delivery failure logs.
4. Make CTWA leads and ad attribution measurable.
5. Add AI only where it improves conversion and stops when humans take over.

The strongest business insight: clients do not buy "Cloud API". They buy protection from losing their WhatsApp number, better campaign reporting, and more sales from their existing contact base.

## Product Demonstrated In The Live

Core modules shown or described:

- Account dashboard: connected phone, account quality, messaging/disparo limit.
- Lead control: leads from Click-to-WhatsApp ads, with campaign/adset/ad/media origin.
- Contact folders/lists: "Promo Botox" style folders, CSV/list import, campaign audience selection.
- Template/copy module: submit template/copy, wait for Meta approval, use approved message in campaigns.
- Campaign launcher: select list/folder + template/copy and start broadcast.
- Real-time campaign report: sent/processing, delivered, read, replied, failed, button clicks.
- Failure-log drilldown: Meta blocked user, billing/card issue, invalid/unreachable number, experiment/test number, too many marketing messages, etc.
- Smart opt-out/block button: direct the unhappy recipient to a controlled "block/stop" action instead of WhatsApp-level block/report.
- Hybrid chat: app can reply, but customer still keeps WhatsApp Business app and Web.
- Onboarding support center: videos and guided steps for connection, BM, billing, and Meta app review.
- AI lead handler: handles CTWA/ad leads, not all organic messages; stops when human enters; resets paused/blacklisted state when the same lead comes again from a new ad click.

## What OpenBSP Already Has

The current Convex app already has a strong cloud core:

- Meta webhook endpoint with HMAC verification.
- Webhook event idempotency and async processing.
- Tenant isolation helpers.
- Contacts with `e164`, `bsuid`, parent BSUID, and WhatsApp username.
- Conversation and message tables.
- 24h service-window enforcement for API-side free-text.
- Template sending with category-based consent.
- Outbox pattern with `queued -> dispatching -> sent/failed/unknown`.
- Status webhooks for sent/delivered/read/failed.
- API keys and external REST endpoints.
- Basic inbox, contacts, templates, quick replies, settings screens.

Important: the app already thinks in the right direction for 2026 identity changes. It prefers BSUID over phone for outbound when present.

## Biggest Gaps

1. Campaign engine

OpenBSP has `campaigns` as a small table, but not the real feature. It needs campaign runs, recipients, per-recipient status, batch processing, pacing, failure classification, and live dashboards.

2. Lists/folders/imports

The live's "folder" metaphor is simple and valuable. OpenBSP needs reusable contact lists, CSV import jobs, validation, dedupe, opt-in evidence, and segment membership.

3. Campaign analytics

Current message status exists, but campaign reporting needs a campaign-level aggregation layer:

- queued
- dispatching
- accepted/sent
- delivered
- read
- replied
- clicked button
- failed by reason
- blocked by Meta
- billing/card issue
- invalid identity
- user over-marketed / marketing blocked

4. Meta onboarding/coexistence

`ConnectWabaForm` is manual. The live's product requires Embedded Signup / onboarding flow, BM checklist, billing-status guidance, app review readiness, and support docs.

5. CTWA/ad attribution

The core needs to parse and persist referral/ad context from inbound messages:

- source type: CTWA / organic / unknown
- campaign id/name
- adset id/name
- ad id/name
- creative/media info
- click timestamp
- free-entry-point / 72h window metadata where applicable

6. AI control plane

The live warns against letting AI answer everything. Build AI around state machines:

- AI eligible only for CTWA/ad leads by default.
- Human message pauses AI.
- Appointment/opportunity pauses AI.
- New CTWA click can reset paused/blacklist state for that lead.
- All AI actions must be visible and overrideable in the inbox.

7. Failure and compliance intelligence

OpenBSP stores failure reason/code, but needs productized explainability:

- show exact Meta error category
- group by actionable cause
- recommend fix
- suspend risky campaigns automatically
- warn when quality rating or failure rate is degrading

8. Billing/subscription

The live's system gates access based on subscription payment. OpenBSP currently does not appear to have billing/subscription enforcement.

## Build Order

### Phase 0: Recover Dev Environment

- Install Node/npm on this M4. Done locally under `~/.local/opt/node`.
- Accept Xcode license so `git`, `python3`, and `swift` stop failing.
- Run `npm ci`, tests, typecheck, and build inside `app`. Done: typecheck pass, 44 tests pass, production build pass.
- Make `META_GRAPH_VERSION` configurable instead of hardcoded. Done with `META_GRAPH_VERSION` env fallback to `v21.0`.

### Phase 1: Campaign Foundation

Add schema:

- `contactLists`
- `contactListMembers`
- `csvImportJobs`
- `campaignRuns`
- `campaignRecipients`
- `campaignEvents`

Build:

- list/folder CRUD
- CSV import with validation and dedupe
- create campaign from approved template + list
- enqueue recipients through existing outbox
- aggregate status from message webhooks

### Phase 2: Live Campaign Dashboard

Build dashboard with:

- totals and conversion funnel
- delivered/read/replied/clicked/failed
- failed-by-reason drilldown
- per-recipient log
- export failed contacts
- "retry safe failures" only where safe

### Phase 3: Coexistence Onboarding

Replace manual WABA connection with guided flow:

- Tech Provider readiness checklist
- BM verification checklist
- privacy policy and terms URL checks
- Embedded Signup callback handling
- WABA/phone number discovery
- billing/card status guidance
- onboarding video/help center inside app

### Phase 4: CTWA Intelligence

Persist ad referral context and add lead dashboard:

- lead source and ad attribution
- 72h CTWA/free-entry metadata
- status: new, contacted, replied, opportunity, booked, lost
- campaign/adset/ad performance
- handoff from AI to human

### Phase 5: AI Guarded Automation

Add AI only after attribution and campaign logging are solid:

- AI rules per tenant/phone number
- only CTWA by default
- stop on human reply
- stop on opportunity/booked state
- reset paused state on new CTWA click
- full audit log of AI messages

## Decisions To Keep

- Keep Convex as the cloud core. The existing outbox, idempotency, and reactive query model match the product.
- Do not copy Chatwoot complexity. The live's product wins because it is simpler for the client.
- Campaigns and analytics matter more than a beautiful generic CRM.
- BSUID/username support is not optional. It is a platform survival requirement.
- Human override must be first-class. AI is a controlled assistant, not the owner of the inbox.

## Meta Facts To Verify Before Coding

These are audio-derived and must be checked against current Meta docs before implementation. Quick verification pass on 2026-05-15:

- Meta's official Postman workspace was updated on 2026-05-11 and lists WhatsApp Cloud API, Business Management API, Flows API, and Embedded Signup as current building blocks: https://www.postman.com/meta/whatsapp-business-platform/overview
- Meta's Embedded Signup collection says Tech Providers/Solution Partners use it to onboard businesses to WhatsApp Cloud API and should request Advanced Access for `business_management` and `whatsapp_business_management`: https://www.postman.com/meta/whatsapp-business-platform/documentation/du6gzjv/embedded-signup
- Current Cloud API overview confirms WABA/phone-number/template/webhook fundamentals, token/scopes, throughput limits, and pair rate-limit error behavior: https://meta-preview.mintlify.io/docs/whatsapp/cloud-api/overview
- Coexistence implementation details remain volatile. 360dialog's current client docs describe message echoes from the Business App via `smb_message_echoes`, 13-day Business App activity heartbeat, and SMB-oriented eligibility/restrictions. Use this as a market/partner signal, then confirm against Meta docs before coding: https://docs.360dialog.com/docs/resources/phone-numbers/coexistence

Still open before implementation:

- Exact Embedded Signup flow for WhatsApp Business App users / coexistence.
- Which countries and account types are unsupported for coexistence.
- Exact scopes required for Tech Provider and advanced access.
- Exact CTWA free-entry / 72h messaging rules.
- Current BSUID field names and outbound recipient contract.
- Current marketing message pacing / per-user block behavior.
- Current Graph API version and deprecation schedule.
