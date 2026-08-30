# Handoff: isolated iaSolution Hub channel for OpenBSP

## Current Operational Policy

The Alfapay channel is authorized by the owner as an exclusive OpenBSP lab
channel. It must still pass OpenBSP's server-side gates before it can be used:

- exact Hub channel ID allowlist;
- exact phone allowlist;
- exact WABA allowlist;
- no match in protected denylists;
- `operationalTerritory === "openbsp"`;
- DPA/DPIA acceptance by the owner;
- dedicated webhook URL and per-channel HMAC secret;
- outbound disabled until a signed inbound round trip verifies the webhook;
- pilot sending limited to the configured allowlist.

No other operation webhook, token, HMAC, provider state or outbound writer is a
fallback for OpenBSP.

## Delivered Implementation

Branch lineage: `codex/whatsapp-hub-channels`, now cherry-picked into the
production finish branch.

Delivered capabilities:

- channel reservation before a number exists (`pending_number`);
- tenant/channel-scoped encrypted access token and HMAC secret;
- exact Hub phone-health validation before configuration;
- dedicated `/provider-webhook/iasolution-hub/{publicId}` route;
- raw-body HMAC SHA-256 verification and 1 MiB payload limit;
- Hub/Meta envelope normalization for text, buttons, lists, statuses and
  `nfm_reply.response_json`;
- WAMID idempotency scoped to the exact channel;
- thread projection and delivery receipt reconciliation;
- default-off outbound, signed-webhook readiness gate and allowlist-only pilot;
- channel-scoped rate limits for outbound, health, template sync and Flow
  publish;
- server-derived recipient, service-window enforcement and no channel fallback;
- text, interactive, document and approved-template dispatch;
- WAMID persistence, `unknown` outcomes and monotonic delivery status;
- ReplyContext at the top of outbound payloads;
- Flow 7.3 drafts, validation, create/update/upload/publish lifecycle;
- server-generated Flow tokens and persisted WAMID/ReplyContext;
- `nfm_reply` failure when context, recipient, thread or response JSON is
  invalid;
- Settings UI for the isolated lifecycle; the legacy lab UI is no longer
  mounted;
- legacy channel threads are read-only in Channel Inbox;
- channel-neutral chatbot runs and events, separate from legacy Meta tables;
- explicit chatbot-to-channel binding in the bot library and Flow Builder;
- inbound, keyword, CTWA and explicit handoff trigger matching per channel;
- durable automation dispatch records feeding the same guarded Hub outbox;
- ordered flow continuation only after the prior send is accepted;
- text, buttons, lists, input collection, conditions, tags, handoff and end
  nodes;
- same-channel approved templates for provider-neutral template nodes;
- STOP/cancel suppression, three-attempt fallback handoff and stale-run
  timeout;
- any human operator send stops the active bot before outbound dispatch;
- unbound legacy bots remain compatible but cannot enter the neutral runtime;
- server-assigned `operationalTerritory` and default-deny allowlists.

## Main Files

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

## Validation Commands

```bash
cd /Users/sidneychambal/openbsp-production-finish/app
npm test -- --run
npm run typecheck
npm run build
```

## Pilot Order

1. Confirm DPA/DPIA acceptance in OpenBSP.
2. Confirm server allowlists and protected denylists are set without exposing
   values.
3. Reserve or reuse the OpenBSP lab channel.
4. Validate Hub health and exact phone/WABA identity.
5. Encrypt credentials through Settings.
6. Configure the dedicated OpenBSP webhook in the Hub.
7. Prove one signed inbound message and one idempotent replay.
8. Enable allowlist-only mode.
9. Send one reply inside the 24-hour window to an allowlisted sender.
10. Confirm WAMID plus delivery receipt.
11. Test one published Flow and its `nfm_reply`.
12. Bind one draft bot to the exact OpenBSP channel and publish it.
13. Prove keyword, STOP and human handoff with the allowlisted sender.

## Residual Guardrails

- no production campaign sending during the lab;
- no outbound outside the allowlist;
- no second writer for the same WhatsApp channel;
- no provider fallback;
- no real token, HMAC or credential in code, docs, commits or handoff text.
