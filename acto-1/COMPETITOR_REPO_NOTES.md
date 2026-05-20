# Competitor / Reference Repo Notes

Date: 2026-05-15

Purpose: identify what better WhatsApp/omnichannel repos already do well, then decide what OpenBSP should copy, avoid, or beat.

## References Checked

- Chatwoot: https://github.com/chatwoot/chatwoot
- Kapso WhatsApp Cloud Inbox: https://github.com/gokapso/whatsapp-cloud-inbox
- Kapso WhatsApp Broadcasts Example: https://github.com/gokapso/whatsapp-broadcasts-example
- WapiKit: https://pkg.go.dev/github.com/wapikit/wapikit
- OpenWA: https://www.open-wa.org/
- OpenBSP public project signal: https://openbsp.dev/
- Wati CTWA guide: https://www.wati.io/en/blog/set-up-click-to-whatsapp-ads/
- Wati Coexistence help: https://support.wati.io/en/articles/11822402-introducing-whatsapp-coexistence
- YCloud Coexistence guide: https://www.ycloud.com/blog/whatsapp-business-app-coexistence-meta-update
- Respond.io AI Agents: https://respond.io/ai-agents
- Msgie platform: https://msgie.com/
- Clickatell conversation/FEP guide: https://www.clickatell.com/help-center/whatsapp/whatsapp/open-whatsapp-business-conversation/

## What They Do Better Than This Repo Today

### Chatwoot

Strengths:

- Mature shared inbox and agent workflow.
- Omnichannel architecture, assignments, labels, teams, reporting.
- Strong self-hosting story and ecosystem.

Do not copy blindly:

- It is broad helpdesk software. OpenBSP should stay WhatsApp-native and not inherit generic CRM complexity.
- Campaign/coexistence/productized Meta failure intelligence are not its sharpest wedge.

OpenBSP takeaway:

- Copy the discipline of agent workflows and conversation state.
- Beat it on WhatsApp-specific onboarding, campaigns, CTWA attribution, and Meta error explainability.

### Kapso WhatsApp Cloud Inbox

Strengths:

- Compact Cloud API inbox reference.
- Template messages, buttons, media, delivery failure indicators, 24-hour window enforcement.
- Useful mental model for keeping the UI focused.

OpenBSP takeaway:

- OpenBSP already has many of these primitives. The next leap is not another inbox; it is campaigns, lists, and coexistence onboarding.

### Kapso Broadcasts Example

Strengths:

- Broadcast/campaign example close to the live's missing module.
- Useful for seeing a lean campaign flow without building a giant marketing suite first.

OpenBSP takeaway:

- Campaign schema should start small: list + template + recipients + recipient status + failure reason.
- Then add pacing, pausing, and retry logic.

### WapiKit

Strengths:

- Positions around team inbox + campaign manager + cross-platform integrations.
- Mentions Embedded Signup as Tech Provider in cloud SaaS mode.

OpenBSP takeaway:

- Confirms that Embedded Signup/coexistence is product surface, not just backend setup.
- Good reference for packaging "API complexity" into a guided user flow.

### OpenWA / Non-Official Gateway Style Projects

Strengths:

- Multi-session, labels, bulk messaging, dashboard, webhooks, simple API surface.
- Shows demand for easy WhatsApp automation.

Do not copy blindly:

- Many gateway-style projects lean on WhatsApp Web/session automation instead of the official Business Platform. That can be useful for learning UX expectations, but OpenBSP should stay official Cloud API / Meta-compliant.

OpenBSP takeaway:

- Borrow simple dashboard ergonomics.
- Do not build a fragile unofficial sending layer.

## Strategic Positioning For OpenBSP

OpenBSP should become:

- official Meta Cloud API first;
- coexistence-first for businesses already using WhatsApp Business App;
- campaign-first for real business outcomes;
- failure-intelligence-first for account safety;
- CTWA-aware for ad leads;
- guarded-AI, not generic chatbot distribution.

It should not become:

- a generic Chatwoot clone;
- an unofficial WhatsApp Web automation gateway;
- a template-only Cloud API demo;
- an AI bot platform that violates WhatsApp Business policy direction.

## 2026 SaaS Competitor Scan

### Wati

Strengths:

- Strong public education around Click-to-WhatsApp ads, faster lead capture, conversion tracking, and the 72-hour follow-up window.
- Coexistence messaging is clear: keep the Business App while using Cloud API automation.
- Their support docs explicitly frame coexistence as a way to preserve Business App history and continue 1:1 chats.

OpenBSP response:

- We should make the 72-hour CTWA/free-entry window a first-class metric, not a hidden timestamp.
- Coexistence must stay in onboarding/support copy, because this is the wedge that buyers understand.
- OpenBSP should beat Wati with deeper failure drilldown, circuit breaker, and clear retry safety.

### Respond.io

Strengths:

- Positions AI around revenue-critical conversations, lead qualification, CRM updates, routing, product recommendations, and human takeover.
- Strong “AI works alongside humans” promise.
- Emphasizes guardrails, knowledge grounding, and escalation instead of pure chatbot spectacle.

OpenBSP response:

- Keep AI guarded and operational: CTWA lead qualification, status updates, summaries, audit events, and human takeover.
- Avoid selling OpenBSP as a general-purpose chatbot distribution channel.
- Next AI milestone should be “draft + approve” rather than autonomous send.

### Msgie / Similar SMB WhatsApp Suites

Strengths:

- Simple package: shared inbox, campaigns, Google Sheets export/sync, QR/direct links, analytics.
- Clear SMB pricing and “up in minutes” onboarding story.
- Industry outcome copy is concrete.

OpenBSP response:

- CSV export is not enough long-term; add Google Sheets/webhook sync later.
- Add direct chat link/QR generator for campaigns/lead capture.
- Improve industry-specific presets for clinic, real estate, education, and agencies.

### Coexistence-Focused Providers

Strengths:

- YCloud/Wati-style guides sell the “no more choosing between app and API” story well.
- Several providers explain limitations and sync behavior more clearly than typical Cloud API demos.

OpenBSP response:

- Support center should include explicit limitations: Business App edits/revokes may not sync, historical media may be limited, and onboarding mode matters.
- Settings should distinguish manual token setup from coexistence Embedded Signup.

### Pricing/FEP Insight

Clickatell-style FEP guides clarify the nuance:

- CTWA/Facebook Page entry opens a free-entry conversation only when the business responds within 24 hours.
- Once opened, the FEP lasts 72 hours.
- Free-form messages still depend on an open customer service window.

OpenBSP response:

- In CTWA dashboard and inbox, show “FEP open/expired” in plain language.
- Add lead prioritization around “reply before 24h” and “FEP expires soon”.

## Repo-Inspired Refactor Tasks

1. Campaign MVP

- Add campaign runs and recipients.
- Show campaign list by status.
- Support approved no-variable template campaigns first.
- Persist per-recipient status and failure reason.

2. Inbox Hardening

- Keep 24-hour window visibility obvious.
- Add delivery failure badges and drilldowns.
- Show whether a message came from API, Business App echo, campaign, CTWA, or organic inbound.

3. Coexistence Onboarding

- Replace manual WABA fields with guided checklist.
- Add Embedded Signup readiness state.
- Add heartbeat/support warnings for Business App coexistence.

4. Failure Intelligence

- Normalize Meta errors into actionable categories.
- Give each category a plain-language fix.
- Auto-pause campaign runs when failure or quality risk rises.

5. AI Guardrails

- AI must be scoped to a tenant/phone/conversation policy.
- AI should default to CTWA/ad leads only.
- Human reply must pause AI.
- All AI sends must be auditable.
