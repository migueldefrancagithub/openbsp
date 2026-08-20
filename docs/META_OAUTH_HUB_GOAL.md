# Meta OAuth Hub Goal

Goal: finish OpenBSP's Meta provider path with evidence, not guesses. Use the
Loop Library frame plus the oauth-hub-zdg repository as reference material, but
do not copy AGPL code into OpenBSP.

## Source Inputs

- Loop Library: https://signals.forwardfuture.ai/loop-library/?category=engineering
- Reference repo: https://github.com/pedroherpeto/oauth-hub-zdg
- Meta docs to re-check in Chrome when logged in:
  - Embedded Signup overview/version/implementation
  - Onboard WhatsApp Business app users / Coexistence
  - Business-scoped user IDs
  - Account model evolution / onboarding
  - Reconnect offboarded coexistence clients

## Loop Frame

### OpenBSP Meta Evidence Loop

Runs when we touch Meta onboarding, COEX, webhooks, BSUID, templates, or channel
health. It stops only when the code, UI, tests, and browser smoke check all
prove the same claim.

Prompt:
> Re-read current Meta docs and current OpenBSP code. Pick one provider-readiness
> gap, implement one bounded fix, add regression coverage, run test/typecheck/
> build/codegen/diff-check plus browser smoke, then record evidence and remaining
> blockers. Ask before production credentials, App Review submission, or any
> real customer WABA action.

## oauth-hub-zdg Findings

Useful ideas to adapt:

- Multi-app Meta config model: each app has its own app id, app secret, Graph
  version, WABA config id, verify token, webhook URLs, and forward destinations.
- Signed OAuth state: HMAC token with TTL carrying channel/app/lang.
- Per-app webhook URLs: `/webhook/app/<id>` with product aliases.
- Webhook signature verification on the raw body with `X-Hub-Signature-256`.
- Transactional relay mode: forward webhooks without storing history.
- Public embed connect launcher gated per app.
- WABA Embedded Signup popup captures `waba_id` and `phone_number_id` from
  postMessage, exchanges `code` server-side, then subscribes the app to the WABA.
- Token/debug fallbacks: `debug_token`, granular scopes, Business Manager WABA
  discovery, phone-number listing.
- App Review evidence runner: runs real Graph calls, captures HTTP status,
  `x-fb-trace-id`, `x-fb-request-id`, response body, redacted curl, and a
  downloadable evidence document.
- Mission Control UI: live webhook console, channel health cards, source-safe
  payload viewer, command palette, i18n.

Do not copy:

- AGPL implementation code, CSS, HTML, or exact UI.
- JSON-file store architecture.
- Admin password auth model.
- Messenger/Instagram product surface until WhatsApp provider path is stable.

## Current OpenBSP Coverage

Already present:

- Convex webhook raw-body HMAC verification.
- `/whatsapp-webhook` verify-token handshake.
- Embedded Signup session table and callback flow.
- Code exchange with v4 SDK support.
- `debug_token` introspection and granular WABA validation.
- Server-side WABA/phone resolution from token.
- WABA `subscribed_apps`.
- Token health cron and channel health console.
- BSUID/parent BSUID contact display and consent context.
- Meta admission readiness checklist.

Missing or weaker than reference:

- No first-class Meta App Review evidence runner.
- No downloadable evidence pack with trace/request ids and redacted curl.
- No per-tenant/provider webhook live console equivalent.
- No public embed connect launcher for controlled onboarding outside settings.
- No transactional webhook relay mode.
- No provider app registry UI; current provider app config is env-based.
- No explicit reconnect/offboarded COEX recovery workflow in UI.

## Implementation Order

1. Evidence runner backend for WhatsApp only.
   - Source connected WABA/token from existing tenant channel.
   - Run safe read-only Graph checks by default.
   - Capture status, trace id, request id, endpoint, response summary.
   - Redact tokens in every returned artifact.
   - Optional writes must require an explicit UI toggle and recipient when needed.

2. Evidence UI in Settings or Channels.
   - Select connected WABA/phone.
   - Show required ids, read-only checks, failures, trace ids.
   - Download text evidence pack for Meta App Review.

3. COEX reconnect/recovery checklist.
   - Detect disconnected/offboarded status from account update webhooks.
   - Surface reconnect action and evidence path.
   - Keep sending blocked until account/token/webhook health is green.

4. Embed connect launcher.
   - Generate signed, tenant-scoped connect URL.
   - Reuse compliance gate before any WABA connection.
   - Confirm state cannot connect into the wrong tenant.

5. Provider app registry.
   - Keep env provider config as default.
   - Add database-backed provider app records only when we need multiple Meta
     apps or white-label providers.

## Acceptance Gates

- No copied AGPL code.
- `npm run test`
- `npm run typecheck`
- `npm run build`
- `npx convex codegen`
- `git diff --check`
- Browser smoke on `/app/settings`, `/app/channels`, and `/app/chatbots`.
- Evidence runner tests prove token redaction and read-only default.
- Production remains blocked until real Meta envs, domain, DPA/DPIA, App Review,
  and user-approved customer WABA actions are ready.
