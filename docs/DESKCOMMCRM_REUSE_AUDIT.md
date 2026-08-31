# DeskcommCRM Reuse Audit

Source: https://github.com/melgarafael/DeskcommCRM
License: MIT, copyright Rafael Melgaco.

## Fit

DeskcommCRM is a useful reference for the WhatsApp CRM surface: inbox layout,
message bubbles, composer ergonomics, contact side panel, channel health,
automation labels, templates, and AI guardrails.

It should not be copied wholesale into OpenBSP because the core architecture is
different:

- DeskcommCRM: Next.js + Supabase + WAHA/Meta adapters.
- OpenBSP: Next.js + Convex + provider-neutral channel model, iaSolution Hub lab
  today and direct Meta Graph as the target transport.

## Reused In This Pass

Implemented a Deskcomm-inspired channel inbox in OpenBSP without importing the
Supabase/WAHA stack:

- richer message bubbles for text, interactive, flow, media captions, reactions,
  status events and failed events;
- service-window badge and detail panel;
- automation/tag visibility in the conversation list and header;
- channel context panel with provider, connection, webhook, health, outbound
  mode, allowlist verdict and event count;
- auto-scroll for opened threads;
- Convex query contract exposes only safe context fields, not secrets or raw
  provider payloads.

## Next Reuse Targets

1. Composer attachments and template picker, adapted to Convex outbox.
2. Contact side panel actions: notes, tags, owner, next action.
3. Kanban/lead dossier ideas for OpenBSP leads.
4. Agent guardrails: before-send checks, split-message/pacing, human handoff
   labels.
5. Channel health dot in the global navigation.

## Guardrails

- Keep OpenBSP tenant/provider isolation as the source of truth.
- Do not introduce Supabase, WAHA, or Deskcomm env variables.
- Preserve secrets only in Convex/Vercel configuration.
- If a substantial file is copied later, preserve the MIT license notice.
