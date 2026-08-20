---
phase: 02-neutral-inbox
plan: 02
completed: 2026-08-18T19:55:00+02:00
duration: ~12min
---

# Phase 2 Plan 02: Webhook route end-to-end coverage

**The `/provider-webhook/leo-hub/` route is now proven as one chain — publicId
validation, real AES-GCM secret decryption, raw-byte HMAC verification, JSON
parse, normalization, ingest, reconciliation and thread projection — closing the
gap where every part was tested but the whole never was.**

## AC Result

| Criterion | Status |
|-----------|--------|
| AC-1: The real webhook route settles an outbox row end to end | Pass |

Covered: happy path (200, `{accepted:1,duplicates:0}`, outbox → `delivered`,
thread created), replay (`{accepted:0,duplicates:1}`, `updatedAt` unchanged),
tampered body (401, nothing written), wrong secret (401), missing signature
(401), malformed publicId (404), unknown publicId (404).

## Files Changed

| File | Change |
|------|--------|
| `app/convex/_test/leoHubWebhookRoute.test.ts` | Created — 6 tests driving the route via `t.fetch`, zero direct mutation calls |

Tests 180 → 186. Files 33 → 34. Typecheck clean. No source file touched.

## Evidence the test has teeth

Storing a webhook secret different from the one used to sign fails the happy
path and the replay test, which proves the encrypt/decrypt and HMAC chain is
genuinely exercised rather than incidentally satisfied. Restored and verified
byte-identical afterwards.

## What this does and does not de-risk

**Does:** the route's own logic, signature handling over exact bytes, and the
full write path behind it.

**Does not:** whether the Hub's real payload matches the Meta `value` shape this
adapter normalizes. Only live traffic answers that, and that still needs the
operator round trip.

---
*Completed: 2026-08-18*
