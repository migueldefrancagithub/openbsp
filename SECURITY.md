# Security Notes

## Secrets

- Never commit `.env`, `.env.local`, Meta app secrets, access tokens, cookies, or request captures.
- Use `app/.env.example` as the committed template for local setup.
- Keep raw browser audit captures out of Git. `acto-1/myleadflow-audit/`, HAR files, Playwright auth state, and reports are ignored because they can contain cookies, auth headers, or screenshots of API tokens.

## GitHub

- `main` should stay protected by CI before merging.
- GitHub Actions runs with `contents: read` by default in this repo.
- Store production credentials in GitHub Actions secrets or the deployment platform, not in repository files.

## Local Checks

Run these before publishing a branch:

```bash
cd app
npm run test
npm run typecheck
npm run build
```

If the local machine only has Bun available, the equivalent commands are:

```bash
cd app
bun run test
bun run typecheck
bun run build
```
