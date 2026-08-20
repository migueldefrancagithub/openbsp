# Phase 1: multichannel core

## Goal

Create the channel-neutral foundation required by Instagram and Messenger while
keeping the current WhatsApp product operational. This phase changes domain
contracts and storage only; it does not connect a production Instagram account.

## Non-goals

- Replacing the working WhatsApp tables in one migration.
- Adding a paid channel gateway.
- Deploying or changing production credentials.
- Building the visual Instagram flow editor before event contracts are stable.

## Domain contracts

### `channels`

One tenant-owned connection surface.

- `kind`: `whatsapp`, `instagram`, or `messenger`
- `provider`: `meta_graph`
- `externalAccountId`: WABA, Instagram professional account, or Page ID
- lifecycle: `pending`, `active`, `degraded`, `revoked`, `disconnected`
- encrypted credential reference and health metadata
- unique identity: tenant + kind + external account ID

### `channelIdentities`

Maps a person as observed by a specific channel.

- channel and tenant ownership
- provider-scoped user ID
- optional display name, username, phone, and contact link
- unique identity: channel + provider-scoped user ID

### `channelEvents`

Append-only normalized inbound envelope.

- provider event ID and delivery timestamp
- event kind such as message, comment, mention, reaction, or status
- channel, actor identity, thread key, normalized payload, and raw evidence
- unique idempotency key per channel
- processing lifecycle with attempts and failure detail

### `channelOutbox`

Crash-safe outbound intent.

- channel, recipient identity, thread key, message kind, and payload
- deterministic business key
- lifecycle: queued, dispatching, accepted, delivered, failed, or unknown
- provider message ID and failure classification

## Compatibility path

1. Add the neutral tables without changing current WhatsApp reads or writes.
2. Backfill one `channels` row per existing WhatsApp phone number.
3. Mirror new WhatsApp inbound/outbound activity into neutral envelopes behind a
   feature flag.
4. Compare counts and IDs until parity is proven.
5. Make Instagram use the neutral core first; migrate WhatsApp consumers only
   after parity tests pass.

## Adapter boundary

Provider adapters may translate Meta payloads, call Graph endpoints, and classify
provider failures. They may not own tenant authorization, consent policy,
idempotency, flow state, audit history, or business records.

The first adapters will be:

- `meta/whatsapp`
- `meta/instagram`
- `meta/messenger`

All use the official Meta Graph API and share webhook signature verification,
encrypted secret storage, retry policy, observability, and rate-limit handling.

## Required tests

- Tenant A cannot read or mutate Tenant B channels or identities.
- Replaying the same inbound provider event creates one event.
- Reusing an outbound business key creates one outbox intent.
- Unknown dispatch outcomes are never retried automatically.
- Raw provider payloads never expose access tokens to queries or the browser.
- WhatsApp behavior remains green during backfill and event mirroring.

## Exit criteria

- Neutral schema and validators are versioned.
- Internal APIs register channels, upsert identities, ingest idempotent events,
  and enqueue idempotent outbound intents.
- Existing WhatsApp tests and build remain green.
- An Instagram adapter can be added without modifying tenant, contact, flow, or
  outbox invariants.
