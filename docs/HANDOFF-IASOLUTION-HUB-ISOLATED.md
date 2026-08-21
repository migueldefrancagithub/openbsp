# Handoff: isolated iaSolution Hub channel for OpenBSP

## Final operational territory policy (superseding)

There are three separate territories and they must never be merged:

1. **Alfapay = AYAmed/ClinicBook only.** Hard deny. OpenBSP must not read,
   configure, test, send through, or change its number, WABA, token, webhook,
   HMAC, templates, Flows or allowlist.
2. **The WhatsApp channel Miguel added on 2026-08-20 = Cindy Paciente only.**
   It is reserved for OTP/password recovery. OpenBSP must not configure, test,
   or send through it, even temporarily.
3. **OpenBSP = a future third channel supplied by Sidney.** Current blocker:
   **awaiting the new dedicated OpenBSP channel from Sidney**. Until it exists,
   there is no real configuration, webhook, egress, Flow publication or pilot.

The branch stays prepared. It does not need or request the Cindy channel ID,
number, WABA or token.

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
- unbound legacy bots remain compatible but cannot enter the neutral runtime;
- server-assigned `operationalTerritory`; iaSolution code accepts only
  `openbsp`, while missing, `ayamed`, and `cindy` fail closed;
- default-deny configuration requiring exact server-side allowlists for the
  future OpenBSP Hub channel ID, phone and WABA;
- protected identifier denylists that override allowlists for AYAmed/Cindy.

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
- ReplyContext shape and malformed/array `nfm_reply` rejection;
- exact chatbot/channel isolation and ignored unbound bots;
- keyword and CTWA triggers;
- normalized-event idempotency;
- ordered collect-input continuation and human handoff;
- STOP suppression and human-operator collision prevention.

Current result: **40 test files / 229 tests green**, TypeScript clean, and the
Next.js production build green.

Territory environment gates (values must never be committed):

- `OPENBSP_ALLOWED_HUB_CHANNEL_IDS`
- `OPENBSP_ALLOWED_PHONE_NUMBERS`
- `OPENBSP_ALLOWED_WABA_IDS`
- `OPENBSP_PROTECTED_HUB_CHANNEL_IDS`
- `OPENBSP_PROTECTED_PHONE_NUMBERS`
- `OPENBSP_PROTECTED_WABA_IDS`

All three allowlists are mandatory before configuration. Protected matches
always return `PROTECTED_CHANNEL_HARD_DENY` before Hub health calls or secret
encryption.

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

Blocker: **wait for Sidney to register and provide a third OpenBSP channel.**
Do not substitute the Cindy channel. When the third channel exists, provide
through the secure UI/environment rather than chat:

- new Hub channel ID;
- connected OpenBSP-owned number;
- WABA ID;
- channel token;
- generated per-channel HMAC secret;
- one test sender for the pilot allowlist.

Pilot order:

1. add Alfapay and Cindy identifiers to the protected server denylist;
2. add only the third OpenBSP channel ID, number and WABA to the server allowlist;
3. reserve the OpenBSP channel;
4. connect the new number in the Hub;
5. validate and encrypt credentials;
6. configure the dedicated webhook;
7. prove one signed inbound message and one idempotent replay;
8. check health;
9. enable allowlist-only mode;
10. send one reply inside the 24-hour window;
11. confirm WAMID plus delivered/read receipt;
12. test one published Flow and its `nfm_reply`;
13. bind one draft bot to the exact OpenBSP channel and publish it;
14. prove keyword, STOP and human handoff with the allowlisted sender;
15. confirm zero events in both AYAmed/Alfapay and Cindy.
