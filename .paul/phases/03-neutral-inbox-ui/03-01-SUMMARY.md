---
phase: 03-neutral-inbox-ui
plan: 01
subsystem: ui
tags: [nextjs, convex, react, inbox, multichannel]

requires:
  - phase: 02-neutral-inbox
    provides: channelThreads projection, listThreads/listThreadEvents queries
provides:
  - /app/channel-inbox route, independent of the legacy WhatsApp inbox
  - channels.getThread and channels.markThreadRead
  - text composer that explains blocked send states instead of failing opaquely
affects: [04-instagram-adapter, laboratory-removal]

tech-stack:
  added: []
  patterns:
    - "Neutral UI lives in its own directory pair so the laboratory stays deletable"
    - "Send-blocking states are explained in words, computed server-side as a verdict"

key-files:
  created:
    - app/src/app/app/channel-inbox/layout.tsx
    - app/src/app/app/channel-inbox/page.tsx
    - app/src/app/app/channel-inbox/[threadKey]/page.tsx
    - app/src/components/channel-inbox/ChannelThreadList.tsx
    - app/src/components/channel-inbox/ChannelThreadView.tsx
    - app/convex/_test/channelInboxQueries.test.ts
  modified:
    - app/convex/channels.ts
    - app/src/app/app/layout.tsx

key-decisions:
  - "getThread returns a recipientAllowlisted boolean, never the allowlist itself"
  - "Route named channel-inbox, not lab-inbox, because Instagram will use it in Phase 4"
  - "Composer explains kill switch, allowlist and 24h window rather than surfacing error codes"

duration: ~35min
completed: 2026-08-18T21:05:00+02:00
---

# Phase 3 Plan 01: Channel inbox UI

**The neutral `channelThreads` projection now has a screen: pick a channel, read
threads, open one, and reply with text — with blocked send states explained in
plain language instead of raw error codes.**

## Acceptance Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| AC-1: Threads listed per channel | Pass | Newest-first, preview, unread badge, 24h window dot. Empty state points at Settings |
| AC-2: Thread shows normalized messages | Pass | Oldest-first; only `message.*` renders as a bubble, status events render as a subtle inline marker |
| AC-3: Reply possible, blocked states explained | Pass | Three distinct explanations: kill switch, not allowlisted, window closed |
| AC-4: Opening a thread clears unread | Pass | Test asserts only the target thread is zeroed |
| AC-5: Tenant fences on the new mutation | Pass | Second tenant rejected by `getThread` and `markThreadRead`; victim thread unchanged |
| AC-6: Legacy inbox untouched | Pass | `git status` shows no file under `app/src/app/app/inbox/` or `components/inbox/`; no neutral component imports from there |

## Verification Results

```text
npx convex codegen   success
npm run typecheck    clean
npm test -- --run    35 files / 190 tests passed
npm run build        success; /app/channel-inbox and /app/channel-inbox/[threadKey] both registered
```

## Deviations from Plan

| Type | Count | Impact |
|------|-------|--------|
| Spec correction | 2 | Both tightened the result |

**1. `npm run lint` does not exist**

The plan's Task 2 verify command included `npm run lint`. The project has no such
script — scripts are `dev, dev:next, dev:convex, build, start, predeploy:check,
test, test:watch, typecheck`. Dropped it from the verification and relied on
`typecheck` plus `build`. The plan was wrong, not the project.

**2. `getThread` returns a verdict, not the allowlist**

The plan said to return the channel's `outboundAllowlist` so the composer could
explain itself. Shipped a `recipientAllowlisted` boolean computed server-side
instead: sending the whole allowlist to the browser would put every allowlisted
number of every thread into the client for a UI that only needs one yes/no. A
test asserts the string `outboundAllowlist` never appears in the response.

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| Next.js 16 params are Promises even in client components | Followed the repo's existing convention in `templates/[id]/page.tsx`: `use(params)`. Confirmed against the bundled Next 16.2.6 docs that `useSearchParams` needs no Suspense boundary here because every `/app/*` route builds as dynamic |

## Next Phase Readiness

**Ready:** the round trip can now be driven from the product.

**Blockers found outside this plan's scope:**
- `WABA_TOKEN_ENCRYPTION_KEY_V1` is absent from the dev Convex deployment, so
  `leoHubLab.configure` throws `SECRET_ENCRYPTION_KEY_MISSING` and the channel
  cannot be connected anywhere. This blocks the operator test, not the code.
- The Hub webhook targets the Convex site URL, not Vercel. Hosting the UI and
  enabling the round trip are two separate paths; the plan text conflated them.

---
*Phase: 03-neutral-inbox-ui, Plan: 01*
*Completed: 2026-08-18*
