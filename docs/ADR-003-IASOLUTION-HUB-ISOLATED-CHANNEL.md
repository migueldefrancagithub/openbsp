# ADR-003: iaSolution Hub production channels are isolated per tenant and channel

- Status: accepted
- Date: 2026-08-21

## Context

ADR-002 introduced a removable `lab_bridge` to prove the neutral channel
contracts. That laboratory is not a valid production path: the existing
Alfapay channel belongs exclusively to the AYAmed/ClinicBook operation and may
not be used, reconfigured, tested, or selected as a fallback by OpenBSP.

The iaSolution Hub remains useful as a headless WhatsApp transport for a new
OpenBSP-owned channel. The product must own the interface, data, automation,
auditing, safety gates, and provider-independent domain state.

## Decision

OpenBSP uses a distinct `iasolution_hub` provider with these invariants:

0. Operational territories are immutable boundaries: Alfapay is AYAmed-only,
   the channel added by Miguel on 2026-08-20 is Cindy-only for OTP/password
   recovery, and OpenBSP waits for a third dedicated channel from Sidney.

1. A channel is first reserved as `pending_number`, without secrets, webhook,
   WABA, number, allowlist, or outbound capability.
2. Configuration requires an explicit tenant channel, Hub channel ID, number,
   WABA, access token, per-channel HMAC secret, and pilot allowlist.
3. The server validates `/phone/info` and `/phone/health`, including an exact
   phone-number match, before encrypting credentials.
4. Every inbound request resolves an opaque public channel key and verifies the
   raw body with that channel's HMAC secret. There is no default channel.
5. Idempotency is scoped by channel and provider event/WAMID.
6. Outbound remains disabled until a signed inbound event verifies the webhook.
7. The first outbound mode is always `allowlist`; generic `channels.setSendMode`
   cannot bypass the provider-specific readiness gate.
8. Free-form, interactive, Flow, and document sends require an open 24-hour
   service window. Templates outside the window must be approved in the same
   channel's synchronized catalog.
9. Every successful send must return and persist a provider WAMID. Missing
   WAMID or uncertain network outcomes become `unknown`, never blind retries.
10. Flow responses resolve a persisted same-channel ReplyContext or fail
    closed. ReplyContext is emitted at the top of provider payloads.
11. Legacy `lab_bridge` threads are read-only in the neutral inbox. OpenBSP
    never sends through Alfapay or a laboratory fallback.
12. Neutral chatbot execution requires an explicit `chatbots.channelId`; the
    dispatcher only selects active bots through the exact channel index.
13. Automation state lives in channel-neutral runs, events and dispatches. It
    never mints legacy contacts, conversations, phone numbers, or Meta messages.
14. One automation send is durably queued at a time. The run advances only
    after the shared guarded outbox accepts and persists the provider WAMID.
15. STOP marks the thread stopped, handoff marks it human-owned, and any human
    operator send stops an active run before outbound dispatch.
16. iaSolution operations require `operationalTerritory === "openbsp"`.
    Missing, AYAmed and Cindy territory values fail closed across secrets,
    webhook resolution, health, templates, Flows, outbox and automation.
17. Connection is default-deny until exact OpenBSP channel ID, phone and WABA
    server allowlists are configured. Protected AYAmed/Cindy denylists take
    precedence and fail before provider network or encryption work.

## Data ownership

The neutral channel owns:

- channel lifecycle, phone, WABA, health, webhook evidence and allowlist;
- encrypted per-channel credentials;
- identities, events, threads and outbox;
- channel-specific template catalog;
- Flow 7.3 drafts, provider IDs and persisted outbound ReplyContexts.
- chatbot bindings, neutral runs, audit events, durable dispatches, thread tags
  and human/bot/stopped ownership state.

No AYAmed tenant, patient, appointment, insurance, ClicPay, branding, token,
identifier, deployment, domain, or `OPENBSP_LAB_*` configuration is permitted.

## Deployment gate

This code must not be connected to the Hub until Sidney supplies the third
OpenBSP channel with its own number and the exact ID/number/WABA gates are set
server-side. Cindy is not a temporary substitute. No real message is sent
before a signed inbound round trip and explicit allowlist-only pilot activation.
