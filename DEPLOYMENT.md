# OpenBSP Staging and Production Readiness

## Staging First

- Deploy staging/preview before production.
- Vercel project root directory: `app`.
- The build command is versioned in `app/vercel.json` and should match:

```bash
npx convex deploy --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL --cmd 'npm run build'
```

- Required Vercel env:
  - `CONVEX_DEPLOY_KEY`
  - `NEXT_PUBLIC_CONVEX_SITE_URL`

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

Set these in the target Convex deployment, not in Git:

- `PLATFORM_META_VERIFY_TOKEN`
- `PLATFORM_META_APP_SECRET`
- `META_EMBEDDED_SIGNUP_APP_ID`
- `META_EMBEDDED_SIGNUP_CONFIG_ID`
- `META_EMBEDDED_SIGNUP_REDIRECT_URI`
- `META_EMBEDDED_SIGNUP_APP_SECRET`
- `WABA_TOKEN_ENCRYPTION_KEY_V1`
- `META_GRAPH_VERSION`
- `CONVEX_SITE_URL`

Frontend/runtime public values:

- `NEXT_PUBLIC_CONVEX_URL`
- `NEXT_PUBLIC_CONVEX_SITE_URL`

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
npx convex codegen
npm run test
npm run typecheck
npm run build
npm run predeploy:check -- --target=production --strict
```
