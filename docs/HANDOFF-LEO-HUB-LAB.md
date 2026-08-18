# OpenBSP Leo Hub laboratory handoff

## Current state

Branch: `work/openbsp-direct-meta-cleanup`

The OpenBSP repository now contains a working, isolated Leo Hub laboratory
path for a second WhatsApp channel. The direct Meta WhatsApp dispatcher remains
unchanged. No production token or existing Hub connection was added to source
control.

Delivery/read status reconciliation and the neutral thread projection landed
after the original handoff: status events now settle the `channelOutbox` row
they belong to under a strictly monotonic ladder, and inbound events project
into `channelThreads`.

The implementation covers:

- channel-neutral `channels`, `channelSecrets`, `channelIdentities`,
  `channelEvents`, and `channelOutbox` tables;
- encrypted channel token and encrypted HMAC secret;
- token validation through `GET /phone/info`;
- health checks through `GET /phone/info` and `GET /phone/health`;
- outbound text, template, interactive, and WhatsApp Flow API clients;
- recipient allowlist and default-off kill switch;
- deterministic outbound business keys;
- `unknown` outcome for timeouts/5xx instead of unsafe automatic retry;
- automatic conversion of a stale `dispatching` claim to `unknown`, never a
  resend;
- dedicated per-connection webhook URL;
- raw-body HMAC verification using `X-Hub-Signature-256`;
- normalization and deduplication of inbound messages, statuses, and Hub-only
  events;
- a Settings UI for connecting the second channel, copying the HMAC secret,
  checking health, toggling allowlist mode, sending a text test, and viewing
  recent inbound/outbox activity.

## Architecture boundary

```text
OpenBSP channel-neutral core
  channels / identities / events / outbox
        |
        +-- integrations/leoHub (temporary WhatsApp lab)
        |
        +-- Meta WhatsApp adapter (official, existing)
        |
        +-- Meta Instagram adapter (next phase)
```

The laboratory is not imported by:

- `convex/messages.ts`
- `convex/whatsappAccounts.ts`
- `convex/lib/meta/graph.ts`

`providerIndependence.test.ts` continues to enforce that boundary.

## Important files

- `app/convex/schema.ts`
  - neutral channel, secret, identity, event, and outbox tables
- `app/convex/channels.ts`
  - tenant-safe channel/event/outbox queries and kill switch mutation
  - `listThreads` / `listThreadEvents`: neutral multichannel inbox reads
- `app/convex/lib/channels/outboxStatus.ts`
  - pure, provider-agnostic outbound status ladder (no Convex imports)
- `app/convex/lib/channels/projection.ts`
  - status-to-outbox reconciliation and thread projection, applied in the same
    transaction as the event insert
- `app/convex/leoHubLab.ts`
  - authenticated lab configuration, secrets, health, sends, Flow operations,
    outbox settlement, webhook persistence
- `app/convex/integrations/leoHub/client.ts`
  - isolated HTTP client for Hub v1
- `app/convex/integrations/leoHub/webhook.ts`
  - provider payload normalization
- `app/convex/http.ts`
  - `/provider-webhook/leo-hub/{publicId}` route
- `app/src/components/settings/LeoHubLabSection.tsx`
  - operator interface under Settings > WhatsApp
- `docs/ADR-002-LEO-HUB-LAB-ADAPTER.md`
  - decision and removal criteria

## Security invariants

Do not weaken these in follow-up work:

1. The laboratory channel starts with `sendMode = disabled`.
2. `lab_bridge` cannot enter `live` mode.
3. Every recipient must be in `outboundAllowlist`.
4. Only an authenticated owner/admin can configure or send.
5. Channel tokens and webhook secrets never appear in public queries.
6. Webhooks are verified over raw bytes before JSON parsing.
7. The webhook URL is per connection and unrelated to `/whatsapp-webhook`.
8. Duplicate provider events create one `channelEvents` row.
9. Duplicate outbound business keys never resend.
10. Network errors, timeouts, and 5xx outcomes are `unknown`, not retried.
11. Laboratory templates and Flows must use the `obsp_lab_` prefix.
12. Campaigns and bulk sends do not use this adapter.

## Environment

Required in the configured Convex development deployment:

```text
WABA_TOKEN_ENCRYPTION_KEY_V1=<32-byte hex or base64 key>
```

Optional adapter-only overrides:

```text
LEO_HUB_BASE_URL=https://apihub.iasolution.app/api/v1
LEO_HUB_TIMEOUT_MS=8000
```

The optional variables are intentionally not in `.env.example`, because that
file is part of the direct Meta provider-independence guard. The adapter has
safe defaults.

`CONVEX_SITE_URL` is used to render the full webhook URL in Settings. Convex
normally supplies it automatically.

## First real test

1. In Leo Hub, connect a new test number as a new channel. Do not reuse the
   current active channel.
2. In OpenBSP, open `Settings > WhatsApp > WhatsApp laboratory bridge`.
3. Enter the new Hub channel ID and its channel token.
4. Add only the test recipient number to the allowlist.
5. Generate and copy the HMAC secret before submitting the form.
6. Submit. The backend validates the token, encrypts both secrets, and leaves
   the kill switch active.
7. Copy the dedicated webhook URL shown by OpenBSP.
8. In the Hub channel webhook settings, set that URL and paste the exact HMAC
   secret copied in step 5.
9. Send a WhatsApp message from the allowlisted test phone to the new channel.
10. Confirm one new row appears under `Inbound events`.
11. Click `Check health`.
12. Click `Enable allowlist`.
13. Send `Ping do OpenBSP Lab` from the Settings test form.
14. Confirm the outbox result is `accepted` and the phone receives the message.
15. Disable the laboratory again when the test ends.

## Template and interactive actions

These are implemented as authenticated Convex actions but do not yet have UI
forms:

- `leoHubLab.sendTemplate`
- `leoHubLab.sendInteractive`

Templates must start with `obsp_lab_`. Text sends are the recommended first
test because they require an open 24-hour customer-service window.

## WhatsApp Flow actions

Implemented authenticated actions:

- `leoHubLab.inspectFlows`
- `leoHubLab.createLabFlow`
- `leoHubLab.uploadLabFlowAsset`
- `leoHubLab.publishLabFlow`

Only flows whose names start with `obsp_lab_` can be created or modified by the
laboratory adapter. The intended lifecycle is create container, upload
`flow.json`, then publish.

## Verification already run

```bash
cd /Users/sidneychambal/openbsp/app
npm test -- --run \
  convex/_test/leoHubLabClient.test.ts \
  convex/_test/leoHubWebhook.test.ts \
  convex/_test/leoHubLabCore.test.ts \
  convex/_test/providerIndependence.test.ts
npm run typecheck
```

Result at handoff: 4 test files, 17 tests passed, TypeScript clean.

Convex bindings were regenerated with `npx convex codegen`. The command used
the repository's configured development deployment; no production credentials
were entered during this work.

## Known limitations

- Hub inbound events are **not** mirrored into the legacy WhatsApp
  `conversations/messages` tables, and this is intentional, not a gap.
  `conversations.phoneNumberId` is `v.id("phoneNumbers")`, so mirroring a
  laboratory channel would require minting fake WhatsApp phone-number rows —
  ADR-002 forbids the laboratory from reaching into the WhatsApp domain.
  The channel-neutral `channelThreads` projection is the supported read
  surface, and it is the same surface Instagram will use.
- Hub inbound events do not start the legacy chatbot flow runtime.
- The Settings UI currently sends text only. Templates, interactives, and Flow
  operations are backend-ready.
- The neutral thread projection has no UI yet. `channels.listThreads` and
  `channels.listThreadEvents` are backend-ready; wiring them into a screen is
  gated behind the first real round trip passing.
- `channelOutbox` rows that reached `unknown` carry no `providerMessageId`,
  because the send never returned one. No inbound status can match them, and
  matching by recipient plus timestamp is deliberately not attempted — that
  could mark an unsent message delivered. Resolving those needs a provider-side
  message lookup.
- The repository does not yet contain the direct Instagram adapter.
- Hub webhook retry guarantees are not documented, so OpenBSP must retain its
  own deduplication and evidence.

## Recommended next Claude Code tasks

1. Run the real second-channel text round trip and save redacted evidence.
2. Reconcile neutral status events to `channelOutbox` monotonically.
3. Add a neutral conversation projection for the new multichannel inbox.
4. Move chatbot execution onto normalized `channelEvents`, then support both
   WhatsApp adapters without provider branches.
5. Import the Instagram pack as behavior/reference and implement a direct Meta
   Instagram adapter against the same neutral contracts.
6. Add UI for templates, interactives, and `obsp_lab_` Flow lifecycle only
   after the text/webhook path passes real tests.

Do not copy the Instagram pack's tenant fallback or secret handling into
OpenBSP. Preserve OpenBSP tenant fences, HMAC validation, encrypted secrets,
idempotency, and outbox semantics.
