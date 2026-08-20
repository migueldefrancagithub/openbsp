# ADR-001: OpenBSP owns the Meta transport

- Status: accepted
- Date: 2026-08-17

## Context

OpenBSP must remain usable without a paid gateway controlling channel access.
The product already contains the primitives needed to connect Meta assets,
verify webhooks, protect access tokens, dispatch messages, and reconcile
delivery state.

## Decision

WhatsApp traffic in the OpenBSP core uses the official Meta Graph API directly.
The core must not import a vendor-specific gateway client, store gateway channel
identifiers, or branch message dispatch by a commercial provider name.

Channel credentials are encrypted at rest. Webhook authenticity, idempotency,
the outbox lifecycle, consent gates, circuit breakers, and audit records remain
OpenBSP responsibilities.

Future Instagram and Messenger transports will implement channel-neutral ports.
Their provider payloads belong inside isolated adapters; domain records and flow
execution must not depend on a reseller's schema.

## Consequences

- OpenBSP controls onboarding, operations, data, and the channel roadmap.
- Meta usage charges and infrastructure costs still apply.
- Convex and Vercel remain current infrastructure choices, not channel
  gatekeepers; they can be revisited independently.
- A regression test prevents the removed gateway from returning to the current
  WhatsApp core.

## Follow-up

1. Introduce channel-neutral `channels`, `identities`, `events`, and `outbox`
   contracts before adding Instagram.
2. Keep Meta webhook verification and token encryption mandatory for every Meta
   adapter.
3. Decide and publish the repository license before external distribution.
