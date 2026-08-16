# Hotseat Coex API - BSUID, Coexistence and Tech Provider Notes

Date: 2026-06-26

## Summary

The Hotseat discussion focused on Meta's recent WhatsApp platform changes around:

- Coexistence (COEX) between WhatsApp Business App and Cloud API.
- Tech Provider setup, permissions and app approval videos.
- BSUID (Business-Scoped User ID) and the impact on outbound messaging.
- How to explain COEX to agencies, franchises and clients that still do not understand the new Meta flow.

## Audio Notes

Participant concern:

- BSUID makes sense for marketing throttling and anti-spam.
- The risk is authentication and utility messages: if a user never contacted the business, the business may not have BSUID yet.
- If Meta fully blocks phone-based sending in those cases, many companies could lose critical communication paths.

Specialist reply:

- The BSUID requirement mainly affects outbound sending logic.
- Most real usage is Utility and Marketing.
- Since the client still has WhatsApp Business App access in COEX, they can capture opt-in or user interaction through the app or web navigation.
- The bigger practical impact is campaign sending, especially Marketing and Utility.

## Product Interpretation For OpenBSP

OpenBSP should treat contact identity as a dual model:

- Phone/E.164: still required for imports, OTP/authentication flows and phone-first operations.
- BSUID: preferred for Marketing and Utility once known, because it survives WhatsApp username adoption and phone privacy changes.

The system should not assume every contact has a phone number after the username/BSUID rollout.

## Rules We Now Enforce

- Inbound webhooks must store `user_id` as contact BSUID.
- Status webhooks must update delivery state with `recipient_user_id` when present.
- `user_id_update` webhooks must rotate stored BSUID safely.
- Campaigns can send to BSUID-only contacts for Marketing/Utility when consent exists.
- Authentication templates require phone identity. BSUID-only contacts are excluded before campaign launch/dispatch.
- BSUID-only contacts can use contact-request flows to ask the user to share phone info when phone is required.

## Loop Run - 2026-06-26

Fresh check from the Hotseat discussion: the risk is not "BSUID everywhere";
the real product boundary is per template purpose. Marketing/Utility should
prefer BSUID when known, but Authentication/OTP must stay phone-first. OpenBSP
now enforces this twice:

- campaign materialization excludes BSUID-only contacts for Authentication templates;
- dispatcher fails any Authentication template that reaches dispatch without a phone identity.

This prevents late Meta failures for OTP sends while keeping BSUID-ready
Marketing/Utility campaigns working.

## Operational Notes

- Agencies/franchises need a simple COEX explanation before onboarding.
- Tech Provider approval needs video evidence, app setup evidence, webhook proof and a clean Embedded Signup path.
- OpenBSP should keep an evidence pack ready for Meta review.
- COEX recovery should show operator and client steps when Meta sends partner removal/offboarding events.

## Source To Recheck

- Meta BSUID docs: https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids
- Meta screen recording guide: https://developers.facebook.com/docs/app-review/submission-guide/screen-recordings/
- Meta WhatsApp App Review guide: https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/app-review/
