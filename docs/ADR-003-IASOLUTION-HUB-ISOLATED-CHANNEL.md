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

## Data ownership

The neutral channel owns:

- channel lifecycle, phone, WABA, health, webhook evidence and allowlist;
- encrypted per-channel credentials;
- identities, events, threads and outbox;
- channel-specific template catalog;
- Flow 7.3 drafts, provider IDs and persisted outbound ReplyContexts.

No AYAmed tenant, patient, appointment, insurance, ClicPay, branding, token,
identifier, deployment, domain, or `OPENBSP_LAB_*` configuration is permitted.

## Deployment gate

This code must not be deployed or connected to the Hub until the new channel
has its own number and the owner supplies the channel metadata through the
secure configuration path. No real message is sent before a signed inbound
round trip and an explicit allowlist-only pilot activation.
