# OpenBSP Staging and Production Readiness

## How deploys actually work (since commit `37a4761`)

Vercel and Convex are deployed **separately**:

- `app/vercel.json` runs only `npm run build`. Vercel never publishes Convex
  functions, in production or in previews.
- Convex functions and schema are published **manually** from a checkout of
  `main` with `npx convex deploy` (production) or `npx convex dev --once`
  (development). `npx convex codegen` only regenerates bindings and does
  **not** publish anything.

Order for every production release:

1. Merge to `main`.
2. From `app/`: `npx convex deploy` (publishes schema + functions to the
   production deployment; run backfills afterwards if the release requires
   them).
3. Let Vercel build `main` (or trigger a redeploy). Vercel picks up the
   frontend only.

Publishing the frontend before the backend leaves the UI calling functions that
do not exist yet ("Could not find public function ..."). Publishing the backend
first is always safe because schema changes are expand-only.

## Staging First

- Deploy staging/preview before production.
- Vercel project root directory: `app`.

### Preview against an existing Convex deployment

```bash
cd app
vercel pull --yes --environment=preview
NEXT_PUBLIC_CONVEX_URL=https://<deployment>.convex.cloud \
NEXT_PUBLIC_CONVEX_SITE_URL=https://<deployment>.convex.site \
  vercel build --target=preview --yes
vercel deploy --prebuilt --target=preview --yes
```

Pass `--target=preview` explicitly. A bare `vercel deploy` on a freshly linked
project targets production.

- Required Vercel env (all environments):
  - `NEXT_PUBLIC_CONVEX_URL`
  - `NEXT_PUBLIC_CONVEX_SITE_URL`
- `CONVEX_DEPLOY_KEY` is only needed if CI/Vercel ever deploys Convex. Today
  nothing does; keep it out of Vercel unless that changes.

Run this before staging or production:

```bash
cd app
npm run predeploy:check -- --target=staging --strict
```

For production:

```bash
cd app
npm run predeploy:check -- --target=production --strict
```

## Convex Environment Variables

Set these in the target Convex deployment (`npx convex env set`), never in Git.
`scripts/predeploy-check.mjs` verifies the same list.

Required:

- `SITE_URL` (public https URL of the Next.js app; used by Convex Auth)
- `JWT_PRIVATE_KEY` and `JWKS` (Convex Auth key pair)
- `PLATFORM_META_VERIFY_TOKEN`
- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY` (AI agents,
  Phase C; at least one, or let each clinic store its own key in Settings › AI —
  tenant keys are encrypted with `WABA_TOKEN_ENCRYPTION_KEY_V1`)
- `WABA_TOKEN_ENCRYPTION_KEY_V1` (32 bytes as 64 hex chars or base64; back it
  up offline)
- `META_GRAPH_VERSION` (for example `v25.0`)

Meta Graph direct readiness (warnings until the Meta path is ready):

- `PLATFORM_META_APP_SECRET`
- `META_EMBEDDED_SIGNUP_APP_ID`
- `META_EMBEDDED_SIGNUP_CONFIG_ID`
- `META_EMBEDDED_SIGNUP_REDIRECT_URI`
- `META_EMBEDDED_SIGNUP_APP_SECRET`

Hub lab channel gating (default-deny allowlists, see ADR-003):

- `OPENBSP_ALLOWED_HUB_CHANNEL_IDS`, `OPENBSP_ALLOWED_PHONE_NUMBERS`,
  `OPENBSP_ALLOWED_WABA_IDS`
- `OPENBSP_PROTECTED_HUB_CHANNEL_IDS`, `OPENBSP_PROTECTED_PHONE_NUMBERS`,
  `OPENBSP_PROTECTED_WABA_IDS`

`CONVEX_SITE_URL` and `CONVEX_CLOUD_URL` are provided by Convex itself and
must not be set by hand.

Frontend/runtime public values (Vercel):

- `NEXT_PUBLIC_CONVEX_URL`
- `NEXT_PUBLIC_CONVEX_SITE_URL`

## Local development

`app/.env.local` (git-ignored) must point at the **development** deployment:

```
CONVEX_DEPLOYMENT=dev:<dev-deployment-name>
NEXT_PUBLIC_CONVEX_URL=https://<dev-deployment-name>.convex.cloud
NEXT_PUBLIC_CONVEX_SITE_URL=https://<dev-deployment-name>.convex.site
```

An `anonymous:` or `local:` value means the app is talking to a throwaway local
backend without the environment variables above; nothing tested there proves
anything about production.

## Meta Configuration

- Embedded Signup redirect URI: `https://<final-domain>/embedded-signup/callback`
- Webhook callback URL: `https://<convex-site>/whatsapp-webhook`
- Webhook verify token must equal `PLATFORM_META_VERIFY_TOKEN`.
- Keep staging and production Meta/Convex/Vercel secrets separated.

## Production Gate

Before connecting real WABAs:

- DPA must be signed in tenant `rgpd.dpaSignedAt`.
- DPIA must be completed in tenant `rgpd.dpiaCompletedAt`.
- `WABA_TOKEN_ENCRYPTION_KEY_V1` must be configured and backed up offline.
- The previously exposed GitHub token must be revoked and replaced with a minimal-scope token.
- Local checks must pass:

```bash
cd app
npx convex dev --once   # codegen alone does NOT publish functions
npm run test
npm run typecheck
npm run build
npm run predeploy:check -- --target=production --strict
```
