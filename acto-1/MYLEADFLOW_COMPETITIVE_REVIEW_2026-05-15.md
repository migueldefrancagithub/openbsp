# MyLeadFlow Competitive Review - 2026-05-15

## Source status

- `https://panel.myleadflow.app/dashboard` was inspected in an authenticated read-only pass on 2026-05-16 Africa/Maputo time. No create/save/publish/delete/send/disconnect action was submitted.
- Temporary screenshots and sanitized DOM summaries were captured under `/tmp/myleadflow-audit` for local analysis only. Credentials and account secrets were not written into this document.
- `https://chatbot.myleadflow.app/chatbots` loads a separate chatbot shell, but the panel credentials do not authenticate its `/signin` route. The chatbot section below combines the reachable shell, live screenshots, and route hints from the client bundle.
- Meta documentation remains the rule source for WhatsApp templates, Cloud API sends, Flows, and business messaging constraints. CXCast should stay conservative: approved templates, opt-in gates, service-window awareness, CTWA awareness, quality/pacing circuit breakers, DND, and retry classification.
- Public product patterns compared: MyLeadFlow panel/chatbot, Manychat-style automation cleanliness, and broadcast/segment conventions from WhatsApp BSP tools such as respond.io and SleekFlow.

## Authenticated route map

Primary shell:

- `/`: authenticated root; redirects/lands on the workspace dashboard.
- `/dashboard`: workspace hub with quick actions and module cards.
- `/conversations/0`: inbox with channel states, tags, team-member filters, conversation list, and empty detail pane when no thread is selected.
- `/campaigns`: campaign folder/list view.
- `/campaigns/0/broadcasts`: campaign broadcast board.
- `/campaigns/0/broadcasts/create`: 3-step broadcast wizard: compose, recipients, settings.
- `/meta/channel`: Meta business account/channel console.
- `/meta/templates`: WhatsApp template list and create wizard.
- `/meta/flows`: WhatsApp Flows list.
- `/meta/flows/new`: create-flow form.
- `/meta/flows/{flowId}`: flow builder.
- `/meta/quick-links`: quick link manager.
- `/meta/settings/api-help`: template API usage helper.
- `/meta/ecommerce`: catalog and ecommerce integration console.
- `/contacts`: CRM table with search, filters, column controls, bulk action affordance, DND/starred/groups/action columns.
- `/users`: team members.
- `/analytics/reports`: messaging and pricing analytics.
- `/billing`: subscription plan.
- `/settings`: workspace automation rules.
- `/my-account`: personal account settings.

Important routing note: the apparent generic routes `/flows`, `/templates`, `/channels`, `/quick-links`, and `/api-help` return 404. The real Meta surfaces sit under `/meta/*`, and campaign broadcasts are nested under a campaign id.

## Product architecture observed

MyLeadFlow uses a two-level navigation system:

- A fixed left icon rail for global product areas.
- A contextual sidebar per product area, such as Meta: `Channel`, `Ecommerce`, `Templates`, `Quick Links`, `Flows`, `API Help`.
- The main surface is mostly white, dense, and quiet. It avoids marketing hero patterns inside the app.
- Repeated entities use large flat cards or tables, not nested decorative cards.
- Creation flows are either modal/wizard based or full-page editors.

This is why it feels clean: the user always knows the current module, and each module has one dominant job.

## What MyLeadFlow does well

1. **Broadcasts are not hidden inside a table.** Each run is a card with state, batch recovery, metrics, progress, created time, and responses.
2. **Channels have a three-pane model.** Business account -> channel -> health/detail panel. This makes Meta identifiers and phone status easy to inspect.
3. **Templates are operational.** Search, channel/category/status filters, approval badges, preview/edit actions.
4. **Contacts feel like CRM data.** Search, filters, column controls, bulk workflow, DND/starred/groups/action columns.
5. **Settings expose business rules.** Auto reply, DND STOP/START, bot switch, ecommerce switch.
6. **Chatbot is a separate builder.** Folders and bots are presented as their own workspace instead of being buried in settings.

## Deep feature notes

### Dashboard

- Greets the operator and exposes fast actions: new broadcast, add contact, create template.
- Uses cards as product launchers: Inbox, Broadcast, Meta Channels, Templates, Meta Flows, Ecommerce, Contacts, Team Members, Analytics, Chatbot, Billing, Settings.
- Good pattern for CXCast: use the dashboard as an operations console, not a vanity page.

### Inbox

- Conversation list has operational states: all, unassigned, open, active, pending reply, awaiting response, starred, closed.
- Filters by tags and team members are first-class.
- The product assumes multiple operators and assignment workflows, even if the visible UI is simple.

### Campaigns and broadcasts

- Campaigns are folders/containers. Broadcasts live under a selected campaign.
- Broadcast cards show status tabs: all, active, scheduled, completed, cancelled, failed.
- A partially sent campaign exposes `Send Next Batch`, `Batch Complete`, pending count, sent/delivered/read/failed totals, rates, response count, and a log drawer.
- The create wizard forces the operator through compose, recipients, and settings.
- Strategic takeaway: CXCast should make campaign recovery and failure reasons more prominent than MyLeadFlow, because this is the real value behind coexistence and safe sending.

### Analytics and pricing

- The analytics module is its own global product area, not buried inside campaigns.
- Sidebar groups reports by audience:
  - Meta: Analytics Report.
  - Teams: Staff Conversation Reports.
  - Contacts: Contact Reports.
- Header controls include business account selector, date range selector, and refresh.
- Summary cards show messages sent, messages delivered, messages failed, total cost, delivery rate, cost per message, total messages, and failed messages.
- The main chart compares sent, delivered, and failed messages over time.
- Pricing analytics is a separate chart section, even when current cost is zero.
- Detailed analytics table breaks data down by date interval, sent, delivered, delivery rate, cost, message category, and country.
- Category badges distinguish marketing from service conversations, and country codes expose regional delivery performance.
- CXCast should go further by adding failure reason, campaign/template source, quality impact, retry safety, and projected Meta spend.

### Meta channels

- Three-pane layout is strong:
  - business accounts
  - channels for the selected account
  - channel health/details
- Shows display name, phone number, phone number id, active status, message availability, refresh/sync/refetch/disconnect actions.
- CXCast should adopt the same clarity, but add more guardrail language: quality rating, messaging tier, webhook health, token age, billing warning, and coexistence status.

### Templates

- List has search, business account, category, status, reset filters, preview/edit/delete.
- Create wizard starts with category selection:
  - Marketing: promotions or business information.
  - Utility: transaction/account/order/customer request.
  - Authentication: OTP/login style flows.
- Marketing template type includes product messages, carousel message, and custom.
- Enforces template-name convention: lowercase, numbers, underscores.
- CXCast should add an iOS/WhatsApp preview and a Meta-rule advisor before submission.

### WhatsApp Flows

- Flow list filters by account/category/status.
- Create flow asks for name, business account, categories, and endpoint toggle.
- Categories observed: Sign Up, Sign In, Appointment Booking, Lead Generation, Contact Us, Customer Support, Survey, Other.
- Builder structure:
  - top bar: back, flow name, Basic/Simple toggle, Publish, Save.
  - left: Flow JSON version selector, screen list, add screen.
  - center: screen title, `Components` / `Data Variables`, component cards.
  - right: phone preview.
- Components observed in the starter screen: Text Heading, Text Body, Footer.
- Footer editor exposes label, action, enabled toggle, variable option, caption, payload items, auto-fill variables, add payload.
- CXCast currently needs a real `Meta Flows` module if we want parity with this part of MyLeadFlow.

### Contacts

- Table is built for scale: observed account has thousands of contacts.
- Search is paired with filters, column configuration, sort controls, bulk actions, DND, starred, groups, and per-row chat action.
- `Explain Match` toggle is a smart touch for fuzzy search or AI-assisted filtering.
- CXCast should keep contact lists/folders and imports close to campaigns, because the live's sales flow depends on audience reuse.

### Settings and automation

- Auto Reply and Bot are treated as mutually sensitive. The UI says auto-reply deactivates the chatbot.
- DND is built around STOP/START keywords and message-code selection.
- Bot enablement is a workspace setting, with channel-specific settings hinted in tabs.
- Ecommerce is a toggle plus a separate Meta/ecommerce configuration page.
- CXCast should implement this as explicit precedence rules: manual operator > DND > bot pause > auto reply > campaign automation.

### Ecommerce

- Connects Meta catalog credentials and ecommerce platform integration.
- Mentions Shopify, WooCommerce, Ecwid, and custom platforms.
- For CXCast, ecommerce should wait until campaigns, templates, contacts, and flows are stable, but cart recovery should remain in the roadmap.

### API help

- Template helper asks for business account and template, then provides integration examples.
- CXCast can make this stronger by generating signed examples for the tenant's own API key, with copyable curl/Node/Python snippets.

### Chatbot

- Separate domain: `https://chatbot.myleadflow.app`.
- Reachable shell shows: create folder, create bot, import bot, profile/sign out.
- Separate `/signin` exists, but the panel credentials returned `invalidCredentials`.
- Live screenshots show a clean bot workspace with folder tiles and a create-bot button.
- Client bundle route hints include `/chatbots`, `/chatbots/[chatbotId]/edit`, `/chatbots/folders/[id]`, and `/aiservices`.
- Inference: chatbot is a separate builder/editor product connected back to the panel, not just a settings toggle.

## UX patterns to borrow without copying

- Keep the app white, compact, and operations-first.
- Use a fixed icon rail plus contextual sidebar for complex product areas.
- Use three-pane layouts for connected accounts, channels, and details.
- Use card boards for campaign broadcasts because status, progress, and recovery need space.
- Use tables for contacts because operators scan and compare many rows.
- Put WhatsApp/mobile previews beside builders, not in a hidden modal.
- Keep creation flows explicit and staged when the user could make an expensive mistake.
- Make status badges and metrics readable before any decorative design.

## UX patterns to improve beyond MyLeadFlow

- Add a "why this is safe/blocked" layer to campaigns, templates, and outbound sends.
- Show exact Meta failure category, recommended fix, and whether retry is safe.
- Add coexistence status and Business App activity indicators to channel health.
- Add preview warnings for marketing vs utility vs authentication categories.
- Add AI pause/handoff visibility in the inbox.
- Avoid creating separate products that feel disconnected; chatbot can be a separate workbench, but it should share CXCast navigation, identity, contacts, and logs.

## What CXCast now has

- `/app/campaigns`: broadcast-style cards with status tabs, search, safe retry/send-next-batch, log drawer, metrics, rates, response count, and failure export.
- `/app/channels`: MyLeadFlow-like channel console with business accounts, WhatsApp numbers, phone details, health status, copyable IDs, and safe actions.
- `/app/templates`: filterable template console with category/status badges and preview/edit actions.
- `/app/contacts`: CRM-like contact table with search, sort, explain-match, DND/starred/groups/action columns.
- `/app/chatbots`: real Convex-backed chatbot studio with folders, bots, trigger kind, draft/active/paused states, and guarded activation.
- `/app/settings`: automation controls for auto-reply, DND message codes, bot enablement, and ecommerce enablement.
- `/app`: dashboard module grid for Inbox, Broadcast, Meta Channels, Templates, Chatbots, and Ecommerce.
- `/app/analytics`: first dedicated analytics report page with account-window style filters, sent/delivered/failed/cost summary, messaging chart, detailed category/country table, breakdown panels, CSV export, and Convex-backed aggregation from outbound messages.

## Strategic differences

- CXCast should keep **WhatsApp coexistence and Meta safety** as the signature, not copy MyLeadFlow's generic light SaaS layout.
- Our broadcast cards should always show **why sending is safe or blocked**, not only delivery stats.
- Our chatbot should be **guardrail-first**: CTWA qualifier, keyword bot, inbound triage, human handoff, DND respect, and service-window awareness.
- The app should keep a clean Manychat-like surface, but the intelligence should sit in compliance, cost, and escalation controls.

## Remaining gaps

1. Persist automation settings from `/app/settings` into Convex instead of local UI state.
2. Add real bot flow nodes: trigger, condition, message, template send, tag/list update, wait, handoff, stop.
3. Add chatbot execution audit events tied to conversations.
4. Add Meta template preview with header/body/footer/buttons for exact WhatsApp rendering.
5. Add campaign event stream from actual `campaignEvents` in the log drawer.
6. Add columns configuration and bulk actions to contacts.
7. Add channel refresh actions wired to Meta Graph API token/phone health calls.
8. Add ecommerce catalog/cart recovery tables once product catalog scope is chosen.
9. Add Meta Flows tables and UI: flow records, versions, screens, components, data variables, endpoint settings, publish status, and preview.
10. Add a broadcast creation wizard with compose, recipients, and settings steps instead of only editing campaign records.
11. Analytics first pass is implemented. Remaining work: staff conversation reports, contact reports, campaign/template source breakdown, and Meta pricing import when conversation cost payloads are available.

## Suggested CXCast build tasks from this pass

### Task 1: Meta Flows foundation

- Create Convex tables for `metaFlows`, `metaFlowVersions`, `metaFlowScreens`, `metaFlowComponents`, `metaFlowVariables`, and `metaFlowPublishEvents`.
- Add `/app/flows` or `/app/meta/flows` with list, filters, draft/published status, and create flow.
- Add read-only phone preview first; make save/publish guarded and explicit.

### Task 2: Flow builder UI

- Implement version selector, screen sidebar, component list, data variables tab, and preview panel.
- Start with components needed for lead generation: heading, body, text input, phone/email input, dropdown, checkbox, footer/action.
- Add endpoint toggle, payload items, and variable binding.

### Task 3: Template creation wizard

- Upgrade template creation to a staged flow with category/type/name/language/account.
- Add WhatsApp iOS preview, variable validation, category advisor, and Meta rejection risk hints.

### Task 4: Broadcast wizard and recovery

- Add compose -> recipients -> settings wizard.
- Add "send next batch", event log drawer, failed export, safe retry, and condition tracking indicators.

### Task 5: Channel health console

- Expand channel detail with coexistence eligibility, embedded signup status, webhook health, token health, quality rating, messaging tier, and billing status.

### Task 6: Chatbot workbench

- Keep chatbot in CXCast instead of a disconnected domain.
- Add folders, bot cards, node editor, execution logs, and inbox handoff state.
- Enforce DND, human override, campaign safety, and CTWA rules before any bot sends.

### Task 7: Analytics reports

- Done: `/app/analytics` with clean left-context report navigation: Meta, Teams, Contacts.
- Done: Convex query aggregates sent, delivered, failed, cost, category, and country over selectable windows.
- Done: summary cards for delivery health, failure health, spend, cost per delivered, and total messages.
- Done: chart for sent vs delivered vs failed and detailed table by interval/category/country with delivery-rate badges.
- Done: CXCast-only retry-safety and quality-risk labels.
- Next: staff reports, contact reports, campaign/template/source dimensions, and spend forecast once Meta pricing payloads are richer.
