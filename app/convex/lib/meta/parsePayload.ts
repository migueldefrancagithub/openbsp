/**
 * Parse a Meta WhatsApp webhook payload into a flat list of items.
 * Each item gets its own stable eventKey via deriveEventKey, so the same
 * payload can be deduplicated even if Meta retries with different timestamps.
 */
import { deriveEventKey } from "../idempotency";

export type ParsedIncomingMessage = {
  kind: "message";
  eventKey: string;
  phoneNumberId: string;
  wabaId: string;
  metaTimestamp: number;
  fromE164: string;
  contactName?: string;
  wamid: string;
  type: string;
  // raw Meta message object for full fidelity
  raw: Record<string, unknown>;
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
  errors?: Array<{ code: number; title?: string }>;
  pricing?: { category?: string; pricing_model?: string };
  raw: Record<string, unknown>;
};

export type ParsedItem = ParsedIncomingMessage | ParsedStatus;

type RawPayload = {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        messaging_product?: string;
        metadata?: {
          display_phone_number?: string;
          phone_number_id?: string;
        };
        contacts?: Array<{
          wa_id?: string;
          profile?: { name?: string };
        }>;
        messages?: Array<Record<string, unknown>>;
        statuses?: Array<Record<string, unknown>>;
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
      if (change.field !== "messages") continue;
      const value = change.value;
      if (!value) continue;
      const phoneNumberId = value.metadata?.phone_number_id ?? "";
      if (!phoneNumberId) continue;

      const contactsByWaId = new Map<string, { name?: string }>();
      if (Array.isArray(value.contacts)) {
        for (const c of value.contacts) {
          if (c.wa_id) contactsByWaId.set(c.wa_id, { name: c.profile?.name });
        }
      }

      // Messages
      if (Array.isArray(value.messages)) {
        for (const m of value.messages) {
          const wamid = String(m.id ?? "");
          if (!wamid) continue;
          const fromWaId = String(m.from ?? "");
          const tsRaw = m.timestamp;
          const metaTimestamp =
            typeof tsRaw === "string"
              ? Number(tsRaw) * 1000
              : typeof tsRaw === "number"
                ? tsRaw * 1000
                : Date.now();
          const type = String(m.type ?? "text");
          const contact = contactsByWaId.get(fromWaId);
          items.push({
            kind: "message",
            eventKey: deriveEventKey({ kind: "msg", phoneNumberId, wamid }),
            phoneNumberId,
            wabaId,
            metaTimestamp,
            fromE164: normalizeWaIdToE164(fromWaId),
            contactName: contact?.name,
            wamid,
            type,
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

          const recipientWaId = String(s.recipient_id ?? "");
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

/**
 * WhatsApp wa_id is the E.164 phone number WITHOUT the leading "+".
 * Normalize to "+<digits>" for our storage.
 */
export function normalizeWaIdToE164(waId: string): string {
  const digits = waId.replace(/\D/g, "");
  return digits ? `+${digits}` : "";
}
