# ADR-003: iaSolution Hub channels are isolated per tenant and channel

- Status: accepted
- Date: 2026-08-21
- Updated: 2026-08-31

## Context

ADR-002 introduced a removable `lab_bridge` to prove the neutral channel
contracts. OpenBSP now uses iaSolution Hub as a headless WhatsApp transport for
an authorized Alfapay lab channel that is no longer attached to another
automated operation.

The Hub remains a provider adapter only. OpenBSP owns the product interface,
tenant data, automation, auditing, safety gates and provider-independent domain
state. Meta Graph direct remains the target production architecture once the
Meta business path is ready.

## Decision

OpenBSP uses a distinct `iasolution_hub` provider with these invariants:

1. The Hub channel must be explicitly assigned to `operationalTerritory:
   "openbsp"` by OpenBSP server code. Missing or reserved territories fail
   closed across secrets, webhook resolution, health, templates, Flows, outbox
   and automation.
2. Configuration is default-deny until the exact OpenBSP Hub channel ID, phone
   and WABA are present in server-side allowlists. Protected denylists override
   allowlists before provider network calls or encryption work.
3. A channel can be reserved as `pending_number`, without secrets, webhook,
   WABA, number, allowlist or outbound capability.
4. Configuration requires an explicit tenant channel, Hub channel ID, number,
   WABA, access token, per-channel HMAC secret and pilot allowlist.
5. The server validates `/phone/info` and `/phone/health`, including an exact
   phone-number match, before encrypting credentials.
6. Every inbound request resolves an opaque public channel key and verifies the
   raw body with that channel's HMAC secret. There is no default provider
   fallback.
7. Idempotency is scoped by channel and provider event/WAMID.
8. Outbound remains disabled until a signed inbound event verifies the webhook.
9. The first outbound mode is always `allowlist`; generic channel send-mode
   controls cannot bypass the provider-specific readiness gate.
10. Free-form, interactive, Flow and document sends require an open 24-hour
    service window. Templates outside the window must be approved in the same
    channel's synchronized catalog.
11. Every successful send must return and persist a provider WAMID. Missing
    WAMID or uncertain network outcomes become `unknown`, never blind retries.
12. Flow responses resolve a persisted same-channel ReplyContext or fail
    closed. ReplyContext is emitted at the top of provider payloads.
13. Legacy `lab_bridge` threads are read-only in the neutral inbox. OpenBSP
    never sends through a provider fallback.
14. Neutral chatbot execution requires an explicit `chatbots.channelId`; the
    dispatcher only selects active bots through the exact channel index.
15. Automation state lives in channel-neutral runs, events and dispatches. It
    never mints legacy contacts, conversations, phone numbers or Meta messages.
16. One automation send is durably queued at a time. The run advances only
    after the guarded outbox accepts and persists the provider WAMID.
17. STOP marks the thread stopped, handoff marks it human-owned, and any human
    operator send stops an active run before outbound dispatch.

## Data Ownership

The neutral channel owns:

- channel lifecycle, phone, WABA, health, webhook evidence and allowlist;
- encrypted per-channel credentials;
- identities, events, threads and outbox;
- channel-specific template catalog;
- Flow 7.3 drafts, provider IDs and persisted outbound ReplyContexts;
- chatbot bindings, neutral runs, audit events, durable dispatches, thread
  tags and human/bot/stopped ownership state.

No external operation tenant, deployment, webhook, token, HMAC, brand state or
`OPENBSP_LAB_*` bridge configuration is part of the OpenBSP Hub provider.

## Deployment Gate

The authorized lab channel may be connected only through the OpenBSP Settings
UI after DPA/DPIA acceptance and server allowlist configuration. Real tests are
limited to the configured pilot allowlist. Production campaign sending remains
disabled until Meta Graph direct readiness, compliance and operator approval
are complete.
