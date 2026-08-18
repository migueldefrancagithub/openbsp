# ADR-002: Leo Hub is a removable WhatsApp laboratory adapter

- Status: accepted
- Date: 2026-08-18

## Context

OpenBSP needs a working WhatsApp prototype before direct Meta onboarding is
complete. A Hub channel can shorten that feedback loop, but the product must
not make contacts, conversations, automations, consent, audit history, or
Instagram depend on a paid gateway.

The existing OpenBSP WhatsApp path is an official Meta Graph transport. It has
its own WABA credentials, webhook, idempotency, outbox, health checks, and
circuit breakers. Reintroducing a provider branch into those files would risk
routing real traffic through the wrong connection.

## Decision

Leo Hub is allowed only as a removable `lab_bridge` adapter over the
channel-neutral contracts.

The laboratory must use:

- a second Hub channel and second test number;
- a dedicated OpenBSP channel record;
- an encrypted channel token and encrypted per-channel HMAC secret;
- a dedicated webhook path and neutral event store;
- a default-off kill switch;
- an explicit recipient allowlist;
- an idempotent, crash-safe neutral outbox;
- names prefixed with `obsp_lab_` for templates and WhatsApp Flows.

The adapter may call Hub endpoints and normalize Hub payloads. It may not be
imported by `messages.ts`, `whatsappAccounts.ts`, or the direct Meta transport.
Campaign and bulk dispatch are not permitted through the laboratory.

## Consequences

- A prototype can send, receive, inspect health, use templates/interactives,
  and manage laboratory WhatsApp Flows without touching the existing WABA.
- Incoming Hub events appear in `channelEvents`, not the legacy WhatsApp inbox
  or chatbot runtime. A channel-neutral automation runtime is separate work.
- Instagram still requires a direct Meta Graph adapter.
- Removing the laboratory means deleting the adapter/UI and disconnecting its
  neutral channel. Domain data does not need a provider migration.

## Removal criteria

Remove or disable the laboratory after direct Meta supports:

1. production Embedded Signup;
2. signed webhook ingestion;
3. token/scopes and phone health checks;
4. text, templates, interactives, media, and WhatsApp Flows;
5. inbound message/status normalization;
6. outbox reconciliation for unknown outcomes.
