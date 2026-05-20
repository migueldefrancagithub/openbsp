/**
 * Parse a Meta WhatsApp webhook payload into a flat list of items.
 * Each item gets its own stable eventKey via deriveEventKey, so the same
 * payload can be deduplicated even if Meta retries with different timestamps.
 *
 * Meta 2026 BSUID + Username rollout — actual field shapes per
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids
 *
 *   contacts[] = {
 *     profile: { name: "<NAME>", username?: "@<USERNAME>" },
 *     wa_id?: "<PHONE>",            // optional once user enables username
 *     user_id?: "<BSUID>",          // present from 2026-03-31
 *     parent_user_id?: "<BSUID>"    // only when parent BSUIDs enabled
 *   }
 *
 *   messages[] = {
 *     from?: "<PHONE>",
 *     from_user_id?: "<BSUID>",
 *     from_parent_user_id?: "<BSUID>",
 *     ...
 *   }
 *
 *   statuses[] = {
 *     recipient_id?: "<PHONE>",
 *     recipient_user_id?: "<BSUID>",
 *     recipient_parent_user_id?: "<BSUID>",
 *     ...
 *   }
 */
import { deriveEventKey } from "../idempotency";

export type ParsedIncomingMessage = {
  kind: "message";
  eventKey: string;
  phoneNumberId: string;
  wabaId: string;
  metaTimestamp: number;
  /** E.164 phone for the sender, when Meta provides it. Empty when the user
   *  has hidden their phone behind a username. */
  fromE164: string;
  /** Sender BSUID (Meta `from_user_id` / fallback to `contacts[].user_id`). */
  fromBsuid?: string;
  /** Parent BSUID when parent BSUIDs are enabled for the WABA. */
  fromParentBsuid?: string;
  /** Public WhatsApp username (e.g. `@pablomorales`), when user has set one. */
  fromUsername?: string;
  contactName?: string;
  wamid: string;
  type: string;
  referral?: ParsedReferralContext;
  // raw Meta message object for full fidelity
  raw: Record<string, unknown>;
};

export type ParsedReferralContext = {
  source: "ctwa" | "organic" | "unknown";
  sourceType?: string;
  sourceId?: string;
  sourceUrl?: string;
  headline?: string;
  body?: string;
  mediaType?: string;
  imageUrl?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
};

export type ParsedStatus = {
  kind: "status";
  eventKey: string;
  phoneNumberId: string;
  wabaId: string;
  metaTimestamp: number;
  wamid: string;
  status: "sent" | "delivered" | "read" | "failed";
  recipientE164?: string;
  recipientBsuid?: string;
  recipientParentBsuid?: string;
  errors?: Array<{ code: number; title?: string }>;
  pricing?: { category?: string; pricing_model?: string };
  raw: Record<string, unknown>;
};

export type ParsedUserIdUpdate = {
  kind: "user_id_update";
  eventKey: string;
  phoneNumberId: string;
  wabaId: string;
  metaTimestamp: number;
  /** Phone of the user whose BSUID changed (when Meta provides it). */
  waId?: string;
  previousBsuid: string;
  currentBsuid: string;
  previousParentBsuid?: string;
  currentParentBsuid?: string;
  detail?: string;
  raw: Record<string, unknown>;
};

export type ParsedUserPreference = {
  kind: "user_preference";
  eventKey: string;
  phoneNumberId: string;
  wabaId: string;
  metaTimestamp: number;
  waId?: string;
  bsuid?: string;
  parentBsuid?: string;
  category: string;
  /** Meta-provided value, e.g. "stop" / "resume" for marketing_messages. */
  value: string;
  detail?: string;
  raw: Record<string, unknown>;
};

export type ParsedBusinessUsernameUpdate = {
  kind: "business_username_update";
  eventKey: string;
  wabaId: string;
  metaTimestamp: number;
  displayPhoneNumber?: string;
  username: string;
  status: string;
  raw: Record<string, unknown>;
};

export type ParsedItem =
  | ParsedIncomingMessage
  | ParsedStatus
  | ParsedUserIdUpdate
  | ParsedUserPreference
  | ParsedBusinessUsernameUpdate;

type RawContact = {
  wa_id?: string;
  user_id?: string;
  parent_user_id?: string;
  profile?: { name?: string; username?: string };
};

type RawPayload = {
  object?: string;
  entry?: Array<{
    id?: string;
    time?: number;
    changes?: Array<{
      field?: string;
      value?: {
        messaging_product?: string;
        metadata?: {
          display_phone_number?: string;
          phone_number_id?: string;
        };
        contacts?: Array<RawContact>;
        messages?: Array<Record<string, unknown>>;
        statuses?: Array<Record<string, unknown>>;
        user_id_update?: Array<Record<string, unknown>>;
        user_preferences?: Array<Record<string, unknown>>;
        // Fields below appear on the `business_username_update` change.
        display_phone_number?: string;
        username?: string;
        status?: string;
      };
    }>;
  }>;
};

export function parseMetaPayload(payload: unknown): ParsedItem[] {
  const items: ParsedItem[] = [];
  const p = payload as RawPayload;
  if (!p || p.object !== "whatsapp_business_account") return items;
  if (!Array.isArray(p.entry)) return items;

  for (const entry of p.entry) {
    const wabaId = entry.id ?? "";
    if (!Array.isArray(entry.changes)) continue;

    for (const change of entry.changes) {
      const value = change.value;
      if (!value) continue;

      // ----- business_username_update (no phone metadata) -----
      if (change.field === "business_username_update") {
        const username = value.username ? String(value.username) : "";
        const status = value.status ? String(value.status) : "";
        if (!username && !status) continue;
        const ts =
          typeof entry.time === "number" ? entry.time * 1000 : Date.now();
        items.push({
          kind: "business_username_update",
          eventKey: deriveEventKey({
            kind: "biz_username",
            wabaId,
            username,
            status,
            ts,
          }),
          wabaId,
          metaTimestamp: ts,
          displayPhoneNumber: value.display_phone_number,
          username,
          status,
          raw: value as unknown as Record<string, unknown>,
        });
        continue;
      }

      const phoneNumberId = value.metadata?.phone_number_id ?? "";
      if (!phoneNumberId) continue;

      // ----- user_id_update (BSUID rotation) -----
      if (change.field === "user_id_update") {
        if (!Array.isArray(value.user_id_update)) continue;
        for (const u of value.user_id_update) {
          const uid = u.user_id as
            | { previous?: string; current?: string }
            | undefined;
          if (!uid?.previous || !uid?.current) continue;
          const parent = u.parent_user_id as
            | { previous?: string; current?: string }
            | undefined;
          const tsRaw = u.timestamp;
          const ts =
            typeof tsRaw === "string"
              ? Number(tsRaw) * 1000
              : typeof tsRaw === "number"
                ? tsRaw * 1000
                : Date.now();
          items.push({
            kind: "user_id_update",
            eventKey: deriveEventKey({
              kind: "user_id_update",
              phoneNumberId,
              previous: uid.previous,
              current: uid.current,
            }),
            phoneNumberId,
            wabaId,
            metaTimestamp: ts,
            waId: u.wa_id ? String(u.wa_id) : undefined,
            previousBsuid: uid.previous,
            currentBsuid: uid.current,
            previousParentBsuid: parent?.previous,
            currentParentBsuid: parent?.current,
            detail: u.detail ? String(u.detail) : undefined,
            raw: u,
          });
        }
        continue;
      }

      // ----- user_preferences (marketing opt-in/opt-out) -----
      if (change.field === "user_preferences") {
        if (!Array.isArray(value.user_preferences)) continue;
        for (const up of value.user_preferences) {
          const category = up.category ? String(up.category) : "";
          const valueStr = up.value ? String(up.value) : "";
          if (!category || !valueStr) continue;
          const tsRaw = up.timestamp;
          const ts =
            typeof tsRaw === "number"
              ? tsRaw * 1000
              : typeof tsRaw === "string"
                ? Number(tsRaw) * 1000
                : Date.now();
          items.push({
            kind: "user_preference",
            eventKey: deriveEventKey({
              kind: "user_pref",
              phoneNumberId,
              waId: up.wa_id ? String(up.wa_id) : "",
              bsuid: up.user_id ? String(up.user_id) : "",
              category,
              value: valueStr,
              ts,
            }),
            phoneNumberId,
            wabaId,
            metaTimestamp: ts,
            waId: up.wa_id ? String(up.wa_id) : undefined,
            bsuid: up.user_id ? String(up.user_id) : undefined,
            parentBsuid: up.parent_user_id
              ? String(up.parent_user_id)
              : undefined,
            category,
            value: valueStr,
            detail: up.detail ? String(up.detail) : undefined,
            raw: up,
          });
        }
        continue;
      }

      if (change.field !== "messages") continue;

      // Index contacts both by wa_id (phone) and user_id (BSUID) so we can
      // enrich each message regardless of which identifier the message
      // carries (Meta will populate one, the other, or both).
      const contactsByWaId = new Map<string, RawContact>();
      const contactsByUserId = new Map<string, RawContact>();
      if (Array.isArray(value.contacts)) {
        for (const c of value.contacts) {
          if (c.wa_id) contactsByWaId.set(c.wa_id, c);
          if (c.user_id) contactsByUserId.set(c.user_id, c);
        }
      }

      // Messages
      if (Array.isArray(value.messages)) {
        for (const m of value.messages) {
          const wamid = String(m.id ?? "");
          if (!wamid) continue;
          const fromWaId = m.from ? String(m.from) : "";
          const fromUserId = m.from_user_id ? String(m.from_user_id) : "";
          const fromParentUserId = m.from_parent_user_id
            ? String(m.from_parent_user_id)
            : "";
          const tsRaw = m.timestamp;
          const metaTimestamp =
            typeof tsRaw === "string"
              ? Number(tsRaw) * 1000
              : typeof tsRaw === "number"
                ? tsRaw * 1000
                : Date.now();
          const type = String(m.type ?? "text");

          // Prefer BSUID match (stable identity); fall back to wa_id.
          const contact =
            (fromUserId && contactsByUserId.get(fromUserId)) ||
            (fromWaId && contactsByWaId.get(fromWaId)) ||
            undefined;

          // Resolve canonical identifiers: explicit on the message wins,
          // contacts block fills the rest.
          const bsuid = fromUserId || contact?.user_id || undefined;
          const parentBsuid =
            fromParentUserId || contact?.parent_user_id || undefined;

          // Drop messages we can't identify at all.
          if (!fromWaId && !bsuid) continue;

          items.push({
            kind: "message",
            eventKey: deriveEventKey({ kind: "msg", phoneNumberId, wamid }),
            phoneNumberId,
            wabaId,
            metaTimestamp,
            fromE164: fromWaId ? normalizeWaIdToE164(fromWaId) : "",
            fromBsuid: bsuid,
            fromParentBsuid: parentBsuid,
            fromUsername: contact?.profile?.username,
            contactName: contact?.profile?.name,
            wamid,
            type,
            referral: parseReferralContext(m.referral),
            raw: m,
          });
        }
      }

      // Statuses
      if (Array.isArray(value.statuses)) {
        for (const s of value.statuses) {
          const wamid = String(s.id ?? "");
          const statusValue = String(s.status ?? "");
          if (!wamid || !statusValue) continue;
          if (
            statusValue !== "sent" &&
            statusValue !== "delivered" &&
            statusValue !== "read" &&
            statusValue !== "failed"
          )
            continue;

          const tsRaw = s.timestamp;
          const metaTimestamp =
            typeof tsRaw === "string"
              ? Number(tsRaw) * 1000
              : typeof tsRaw === "number"
                ? tsRaw * 1000
                : Date.now();

          const recipientWaId = s.recipient_id ? String(s.recipient_id) : "";
          const recipientUserId = s.recipient_user_id
            ? String(s.recipient_user_id)
            : "";
          const recipientParentUserId = s.recipient_parent_user_id
            ? String(s.recipient_parent_user_id)
            : "";
          items.push({
            kind: "status",
            eventKey: deriveEventKey({
              kind: "status",
              phoneNumberId,
              wamid,
              statusValue,
            }),
            phoneNumberId,
            wabaId,
            metaTimestamp,
            wamid,
            status: statusValue as ParsedStatus["status"],
            recipientE164: recipientWaId
              ? normalizeWaIdToE164(recipientWaId)
              : undefined,
            recipientBsuid: recipientUserId || undefined,
            recipientParentBsuid: recipientParentUserId || undefined,
            errors: Array.isArray(s.errors)
              ? (s.errors as Array<{ code: number; title?: string }>)
              : undefined,
            pricing: s.pricing as ParsedStatus["pricing"],
            raw: s,
          });
        }
      }
    }
  }

  return items;
}

function parseReferralContext(raw: unknown): ParsedReferralContext | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const sourceType = r.source_type ? String(r.source_type) : undefined;
  const source =
    sourceType === "ad" || sourceType === "post" ? "ctwa" : "unknown";
  return {
    source,
    sourceType,
    sourceId: r.source_id ? String(r.source_id) : undefined,
    sourceUrl: r.source_url ? String(r.source_url) : undefined,
    headline: r.headline ? String(r.headline) : undefined,
    body: r.body ? String(r.body) : undefined,
    mediaType: r.media_type ? String(r.media_type) : undefined,
    imageUrl: r.image_url ? String(r.image_url) : undefined,
    videoUrl: r.video_url ? String(r.video_url) : undefined,
    thumbnailUrl: r.thumbnail_url ? String(r.thumbnail_url) : undefined,
  };
}

/**
 * WhatsApp wa_id is the E.164 phone number WITHOUT the leading "+".
 * Normalize to "+<digits>" for our storage.
 */
export function normalizeWaIdToE164(waId: string): string {
  const digits = waId.replace(/\D/g, "");
  return digits ? `+${digits}` : "";
}
