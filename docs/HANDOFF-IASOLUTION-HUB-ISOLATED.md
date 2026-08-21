# Handoff: isolated iaSolution Hub channel for OpenBSP

## Delivered locally

Branch: `codex/whatsapp-hub-channels`

The implementation is local and intentionally not deployed. It introduces a
new `iasolution_hub` provider and leaves the former `lab_bridge`/Alfapay path
outside the new send flow.

Delivered capabilities:

- channel reservation before a number exists (`pending_number`);
- tenant/channel-scoped encrypted access token and HMAC secret;
- exact Hub phone-health validation before configuration;
- dedicated `/provider-webhook/iasolution-hub/{publicId}` route;
- raw-body HMAC SHA-256 verification and 1 MiB payload limit;
- Hub/Meta envelope normalization for text, buttons, lists, statuses and
  `nfm_reply.response_json`;
- WAMID idempotency scoped to the exact channel;
- thread projection and dedicated delivery receipt reconciliation;
- default-off outbound, signed-webhook readiness gate and allowlist-only pilot;
- channel-scoped rate limits for outbound, health, template sync and Flow publish;
- server-derived recipient, service-window enforcement and no channel fallback;
- text, interactive, document and approved-template dispatch;
- WAMID persistence, `unknown` outcomes and monotonic delivery status;
- ReplyContext at the top of outbound payloads;
- Flow 7.3 drafts, validation, create/update/upload/publish lifecycle;
- server-generated Flow tokens and persisted WAMID/ReplyContext;
- `nfm_reply` failure when context, recipient, thread or response JSON is invalid;
- Settings UI for the isolated lifecycle; the legacy lab UI is no longer mounted;
- legacy channel threads are read-only in Channel Inbox;
- channel-neutral chatbot runs and events, separate from legacy Meta tables;
- explicit chatbot-to-channel binding in the bot library and Flow Builder;
- inbound, keyword, CTWA and explicit handoff trigger matching per channel;
- durable automation dispatch records feeding the same guarded Hub outbox;
- ordered flow continuation only after the prior send is accepted;
- text, buttons, lists, input collection, conditions, tags, handoff and end nodes;
- same-channel approved templates for provider-neutral template nodes;
- STOP/cancel suppression, three-attempt fallback handoff and stale-run timeout;
- any human operator send stops the active bot before outbound dispatch;
- unbound legacy bots remain compatible but cannot enter the neutral runtime.

## Main files

- `app/convex/iaSolutionHub.ts`
- `app/convex/channelAutomation.ts`
- `app/convex/chatbots.ts`
- `app/convex/integrations/iaSolutionHub/client.ts`
- `app/convex/integrations/iaSolutionHub/webhook.ts`
- `app/convex/http.ts`
- `app/convex/schema.ts`
- `app/convex/channels.ts`
- `app/src/components/settings/IaSolutionHubSection.tsx`
- `app/src/components/channel-inbox/ChannelThreadView.tsx`
- `app/src/app/app/chatbots/page.tsx`
- `docs/ADR-003-IASOLUTION-HUB-ISOLATED-CHANNEL.md`

## Test evidence

New test suites cover:

- pending channels without secrets or send capability;
- two tenants/channels receiving the same WAMID without collision;
- no provider fallback to `lab_bridge`;
- webhook/HMAC success, replay, tampering and unknown public IDs;
- kill switch, verified webhook, allowlist and service window;
- WAMID persistence and monotonic delivery receipts;
- same-channel approved template enforcement;
- Flow 7.3 domain isolation;
- ReplyContext shape and malformed/array `nfm_reply` rejection.
- exact chatbot/channel isolation and ignored unbound bots;
- keyword and CTWA triggers;
- normalized-event idempotency;
- ordered collect-input continuation and human handoff;
- STOP suppression and human-operator collision prevention.

Current result: **40 test files / 228 tests green**, TypeScript clean, and the
Next.js production build green.

Validation commands:

```bash
cd /Users/sidneychambal/openbsp-status-thread-fix-1787224776/app
npm test -- --run
npm run typecheck
npm run build
```

## Still intentionally blocked

- no Convex/Vercel deployment;
- no Hub webhook configuration;
- no real token or HMAC stored;
- no number/WABA connected;
- no outbound message;
- no Flow publication to Meta/Hub;
- no real CTWA or template test;
- existing bots are not silently attached to the new channel;
- no bot is bound or activated against a real Hub channel until that channel is
  connected, webhook-verified and in allowlist-only mode.

## Inputs required for the controlled pilot

When available, provide through the secure UI/environment rather than chat:

- new Hub channel ID;
- connected OpenBSP-owned number;
- WABA ID;
- channel token;
- generated per-channel HMAC secret;
- one test sender for the pilot allowlist.

Pilot order:

1. reserve the OpenBSP channel;
2. connect the new number in the Hub;
3. validate and encrypt credentials;
4. configure the dedicated webhook;
5. prove one signed inbound message and one idempotent replay;
6. check health;
7. enable allowlist-only mode;
8. send one reply inside the 24-hour window;
9. confirm WAMID plus delivered/read receipt;
10. test one published Flow and its `nfm_reply`;
11. bind one draft bot to the exact OpenBSP channel and publish it;
12. prove keyword, STOP and human handoff with the allowlisted sender;
13. confirm zero events in AYAmed/Alfapay.
