# PROJECT.md — OpenBSP-Convex

> Inferred by `/paul:plan` on 2026-08-18 from `PROJECT.md` (repo root),
> `docs/PHASE_1_MULTICHANNEL_CORE_PLAN.md`, `docs/ADR-001-DIRECT-META-TRANSPORT.md`,
> `docs/ADR-002-LEO-HUB-LAB-ADAPTER.md`, and `docs/HANDOFF-LEO-HUB-LAB.md`.
> PAUL was never initialized in this repo; this file is the reconstruction.

## What this is

Fork of **wakit** (open-source WhatsApp Business platform), rewritten on
**Convex + Next.js + Vercel** instead of Supabase + Cloudflare Pages.
Upstream is Unlicense (public domain).

Anchor vertical: clinics in Portugal / EU. WABA jurisdiction PT/EU.

## Value proposition

A multichannel business messaging platform where contacts, conversations,
automations, consent, and audit history belong to the product — not to any
paid gateway. Channels are pluggable adapters over channel-neutral contracts.

## Fixed decisions

| Axis | Decision | Reason |
|---|---|---|
| Backend | Convex | Reactive queries, durable functions, scheduled jobs, TS schema |
| Frontend | Next.js (App Router) | Vercel SSR/RSC first-class |
| Deploy | Vercel + Convex | Preview deployments, edge |
| WABA jurisdiction | PT / EU | Cleaner Meta path, standard KYC. MZ deferred |
| Transport | Official Meta Graph API | ADR-001: direct, vendor-independent |
| Horizon | Future project, no validated client yet | "Bem feito" beats "rápido" |
| Language | Code in English | Standard do Dani |

## Constraints

1. **Provider independence.** The domain must not depend on a paid gateway.
   `convex/messages.ts`, `convex/whatsappAccounts.ts`, and
   `convex/lib/meta/graph.ts` must never import a third-party bridge.
   `convex/_test/providerIndependence.test.ts` enforces this.
2. **Adapter boundary.** Adapters may translate provider payloads, call
   provider endpoints, and classify provider failures. They may **not** own
   tenant authorization, consent policy, idempotency, flow state, audit
   history, or business records.
3. **Tenant fences are absolute.** Tenant A can never read or mutate Tenant B
   data. Every neutral table carries `tenantId` and every query checks it.
4. **Idempotency everywhere.** Replaying an inbound provider event creates one
   event. Reusing an outbound business key creates one outbox intent.
5. **`unknown` is never auto-retried.** Timeouts, network errors, and 5xx map
   to `unknown`, which requires evidence to resolve — never a blind resend.
   *Validated in Phase 2:* inbound provider evidence may advance an outbox row
   but may never write `unknown`, and matching is strictly by
   `providerMessageId` — never by recipient plus timestamp.
6. **Outbound status only ever advances.** queued → dispatching → accepted →
   delivered → read. `failed` and `unknown` are off-ladder outcomes. A provider
   failure arriving after a proven delivery records evidence without
   downgrading the row. *Established in Phase 2.*
7. **Laboratory and future channels read through `channelThreads`,** not the
   legacy `conversations` table, which is bound to `phoneNumbers` and cannot
   represent a non-WhatsApp channel. *Established in Phase 2.*
8. **Secrets never leave the server.** Channel tokens and webhook secrets are
   encrypted at rest and never appear in public queries or the browser.
9. **Webhooks are verified over raw bytes** before JSON parsing.
10. **The Leo Hub laboratory is removable** (ADR-002). It starts default-off,
   is allowlist-only, can never enter `live` mode, and is excluded from
   campaigns and bulk dispatch. Its removal criteria are in ADR-002.
11. **No production credentials in source control.** Deploys and secret entry
   are the user's action, not Claude's.

## Non-goals for the current milestone

- Replacing the working WhatsApp tables in one migration.
- Adding a paid channel gateway to the product path.
- Building the visual Instagram flow editor before event contracts are stable.
- Deploying or changing production credentials.
