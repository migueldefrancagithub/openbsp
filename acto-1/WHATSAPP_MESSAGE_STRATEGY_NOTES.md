# WhatsApp Message Strategy Notes

Date: 2026-05-15

## What the product should enforce

- Utility messages must stay transactional: appointment reminders, payment confirmations, delivery updates, account/service notices, and support follow-ups tied to a user action.
- Marketing messages require clear permission evidence, relevance, and a simple opt-out path. Promotional permission should not be bundled with transactional updates.
- Authentication messages should stay OTP-only: no promotions, no discounts, no persuasive copy.
- The system should preview the exact message before submit/launch and warn when copy likely changes category or cost.

## Cost-saving strategy

- Prefer free-form replies inside the 24-hour customer service window when a user has messaged recently.
- Prefer utility templates inside the 24-hour customer service window when a structured template is needed.
- Prioritize Click-to-WhatsApp leads while the 72-hour free-entry window is open.
- Use marketing templates only for contacts with marketing consent, and send first to small high-intent cohorts.
- Ramp one new marketing use case at a time and monitor quality/read/block signals for 7-10 days before scaling.

## Sources checked

- WhatsApp Business, Best Practices for Marketing Messages on WhatsApp, April 2026 PDF: https://whatsappbusiness.com/wp-content/uploads/2026/04/Best-Practices-for-Marketing-Messages-on-WhatsApp-.pdf
- Gupshup pricing update summary for Meta's July 1, 2025 per-message model: https://docs.gupshup.io/docs/pricing-updates-on-the-whatsapp-business-platform
- Infobip template compliance notes covering category reclassification, quality rating, template pacing, and pausing: https://www.infobip.com/docs/whatsapp/compliance/template-compliance
- 360dialog free vs billed message summary for service windows, Free Entry Point windows, and template billing: https://docs.360dialog.com/docs/get-started/pricing/free-vs-billed-messages

## Product changes created from this research

- `src/lib/whatsappTemplateAdvisor.ts`: category, cost, risk, and strategy helper.
- `src/components/WhatsAppIosPreview.tsx`: iOS-style message preview with billing and guardrails.
- Template creation now includes Utility, Marketing, and Authentication mock presets.
- Campaign creation now includes a cost/quality planner and selected-template iOS preview.
