# STATE.md — OpenBSP-Convex

> PAUL was initialized retroactively on 2026-08-18 by `/paul:plan`, inferred
> from the repo's existing docs. Phase 1 history is reconstructed from
> `docs/HANDOFF-LEO-HUB-LAB.md` and commit `02fbed7`, not from PAUL artifacts.

## Current Position

Milestone: v0.1 Channel-neutral multichannel core
Phase: 2 of 5 (Neutral inbox projection and outbox reconciliation) — Complete
Plans: 02-01 and 02-02 complete (both loops closed)
Status: Ready for next PLAN — Phase 3 (Channel-neutral automation runtime)
Last activity: 2026-08-18 19:54 CAT — UNIFY complete for 02-02 (webhook route end-to-end coverage)

Working checkout: /Users/sidneychambal/openbsp
Branch: work/openbsp-direct-meta-cleanup (at 02fbed7 when this plan was written)

Progress:
- Milestone: [████░░░░░░] 40%
- Phase 2: [██████████] 100%

## Loop Position

Current loop state:
```
PLAN ──▶ APPLY ──▶ UNIFY
  ✓        ✓        ✓     [Loop complete — ready for next PLAN]
```

## Decisions

| Date | Decision | Source | Binding on |
|---|---|---|---|
| 2026-08-17 | WhatsApp transport is the official Meta Graph API, vendor-independent | ADR-001 | all channel work |
| 2026-08-18 | Leo Hub is a removable `lab_bridge` adapter over neutral contracts; may not be imported by `messages.ts`, `whatsappAccounts.ts`, or the direct Meta transport | ADR-002 | Phases 2–5 |
| 2026-08-18 | Laboratory events are **not** mirrored into legacy `conversations`/`messages`; `conversations.phoneNumberId` is `v.id("phoneNumbers")` and minting fake rows is forbidden. A neutral thread projection is the route instead | ADR-002 + plan 02-01 | Phases 2–4 |
| 2026-08-18 | Inbound evidence may never write `unknown` to `channelOutbox`; `unknown` is written only by the dispatch path | plan 02-01 | Phases 2–5 |

| 2026-08-18 | Outbound status only ever advances; `failed`/`unknown` are off-ladder outcomes that cannot overwrite proven progress | SUMMARY 02-01 | Phases 3–5 |
| 2026-08-18 | `decideOutboxTransition` permits `unknown` → advance on evidence, wider than plan 02-01's "do nothing". Call site still matches strictly by `providerMessageId`, so it is unreachable for Hub today and reserved for adapters that return an id before failing | APPLY 02-01 deviation | Phase 4 |

## Open gaps carried forward

- Real second-channel round trip not yet run. Needs the user's real Hub
  credentials and Hub-side webhook configuration. Not automatable.
- `channelOutbox` rows that reached `unknown` have no `providerMessageId`, so
  no inbound status can match them. Resolving needs a provider-side lookup.
- No real round trip yet. Plan 02-02 closed the route-level gap: the full HTTP
  chain (HMAC over raw bytes, decrypt, normalize, ingest, reconcile, project) is
  now proven end to end. What remains unproven is whether the Hub's real payload
  matches the Meta `value` shape the adapter normalizes — only live traffic
  answers that, and it needs operator credentials and a physical handset.
- Phase 2 schema changes went to the **development** Convex deployment only.
  Production still needs the same schema before this ships.
- The neutral thread projection has no UI; `listThreads`/`listThreadEvents` are
  backend-ready and gated behind the first real round trip.
- Chatbot/flow runtime still keyed to the legacy WhatsApp path (Phase 3).
- No direct Meta Instagram adapter yet (Phase 4).
- Settings UI sends text only; template/interactive/Flow actions are
  backend-ready but unexposed.

## Session Continuity

Last session: 2026-08-18 19:54 CAT
Stopped at: Loops closed for 02-01 and 02-02; Phase 2 complete
Next action: Commit Phase 2, then /paul:plan for Phase 3 (Channel-neutral automation runtime)
Resume file: .paul/phases/02-neutral-inbox/02-01-SUMMARY.md
