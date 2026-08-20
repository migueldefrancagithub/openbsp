# ROADMAP.md — OpenBSP-Convex

> Inferred by `/paul:plan` on 2026-08-18 from `docs/PHASE_1_MULTICHANNEL_CORE_PLAN.md`,
> `docs/ADR-002-LEO-HUB-LAB-ADAPTER.md`, and the "Recommended next Claude Code
> tasks" section of `docs/HANDOFF-LEO-HUB-LAB.md`.

## Milestone v0.1 — Channel-neutral multichannel core

Status: **In progress**

Goal: prove that channels are pluggable adapters over neutral contracts, using
a removable WhatsApp laboratory as the first non-Meta adapter, without ever
making the domain depend on it.

---

### Phase 1 — Multichannel core contracts

Status: **Complete** (commit `02fbed7`)

Neutral `channels`, `channelSecrets`, `channelIdentities`, `channelEvents`,
and `channelOutbox` tables. Removable `lab_bridge` Leo Hub adapter proving the
contracts end to end: encrypted token + HMAC, per-connection webhook, raw-body
signature verification, inbound normalization and dedup, deterministic
outbound business keys, `unknown` outcomes, default-off kill switch,
allowlist, Settings operator UI.

Evidence: `docs/HANDOFF-LEO-HUB-LAB.md`, `docs/ADR-002-LEO-HUB-LAB-ADAPTER.md`.
31 test files / 155 tests green, TypeScript clean, production build green.

---

### Phase 2 — Neutral inbox projection and outbox reconciliation

Status: **Complete** (plan 02-01, 2026-08-18)

Closes the gap the handoff records as a known limitation: inbound Hub events
land in `channelEvents` but are stranded there — no thread view, and delivery
statuses never settle the `channelOutbox` row they belong to.

Scope (handoff items 2 and 3):
- Reconcile neutral status events to `channelOutbox` monotonically.
- Add a neutral conversation/thread projection for the multichannel inbox.

Deliberately **not** mirrored into legacy `conversations`/`messages`:
`conversations.phoneNumberId` is `v.id("phoneNumbers")`, so mirroring would
require minting fake WhatsApp phone-number rows for a laboratory channel —
which ADR-002 forbids. The neutral projection is the boundary-respecting route.

Plans: `02-01` and `02-02` — complete. All ACs pass. Tests 155 → 186.
Delivered: monotonic status ladder (`lib/channels/outboxStatus.ts`), same-transaction
reconciliation and thread projection (`lib/channels/projection.ts`), `channelThreads`,
and the tenant-fenced `channels.listThreads` / `channels.listThreadEvents` reads.

Plan 02-02 added end-to-end coverage of the `/provider-webhook/leo-hub/` route.

Not delivered, by design: no inbox UI (gated behind the first real round trip), and
`unknown` outbox rows remain unresolvable without a provider-side message lookup.
Still unproven: whether the Hub's live payload matches the normalized shape.

---

### Phase 3 — Channel inbox UI

Status: **Complete** (plan 03-01, 2026-08-18)

`/app/channel-inbox`: channel picker, thread list, thread view, text composer.
Independent of the legacy `/app/inbox` so the laboratory stays deletable.

---

### Phase 4 — Channel-neutral automation runtime

Status: **Next**

Move chatbot/flow execution onto normalized `channelEvents` so both WhatsApp
adapters — and later Instagram — run without provider branches. Depends on
Phase 2's thread projection being the automation's input surface.

Handoff item 4.

---

### Phase 5 — Direct Meta Instagram adapter

Status: **Not started**

Implement a direct Meta Graph Instagram adapter against the same neutral
contracts. Import the Instagram pack as behavior/reference only — do not copy
its tenant fallback or secret handling.

Handoff item 5.

---

### Phase 6 — Direct Meta WhatsApp completion and laboratory removal

Status: **Not started**

Satisfy the ADR-002 removal criteria (production Embedded Signup, signed
webhook ingestion, token/scope and phone health, full message-kind coverage,
inbound normalization, outbox reconciliation for unknown outcomes), then delete
the laboratory adapter and UI and disconnect its neutral channel.

---

## Deferred / parallel

- Real second-channel round trip with redacted evidence (handoff item 1) —
  requires the user's real Hub credentials and manual Hub-side webhook setup.
  Not automatable by Claude.
- UI for templates, interactives, and `obsp_lab_` Flow lifecycle (handoff
  item 6) — explicitly gated behind the text/webhook path passing real tests.
