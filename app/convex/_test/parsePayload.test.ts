import { describe, it, expect } from "vitest";
import { parseMetaPayload, normalizeWaIdToE164 } from "../lib/meta/parsePayload";

const messagePayload = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "WABA_ID_123",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: {
              display_phone_number: "351912000000",
              phone_number_id: "PHONE_ID_1",
            },
            contacts: [
              { profile: { name: "Maria" }, wa_id: "351912345678" },
            ],
            messages: [
              {
                from: "351912345678",
                id: "wamid.AAAA",
                timestamp: "1700000000",
                type: "text",
                text: { body: "Olá" },
              },
            ],
          },
        },
      ],
    },
  ],
};

const statusPayload = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "WABA_ID_123",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { phone_number_id: "PHONE_ID_1" },
            statuses: [
              {
                id: "wamid.BBBB",
                status: "delivered",
                timestamp: "1700000010",
                recipient_id: "351912345678",
                pricing: { category: "utility", pricing_model: "PMP" },
              },
            ],
          },
        },
      ],
    },
  ],
};

describe("parseMetaPayload", () => {
  it("parses a message event with contact name", () => {
    const items = parseMetaPayload(messagePayload);
    expect(items).toHaveLength(1);
    const m = items[0];
    expect(m.kind).toBe("message");
    if (m.kind === "message") {
      expect(m.phoneNumberId).toBe("PHONE_ID_1");
      expect(m.wabaId).toBe("WABA_ID_123");
      expect(m.fromE164).toBe("+351912345678");
      expect(m.contactName).toBe("Maria");
      expect(m.wamid).toBe("wamid.AAAA");
      expect(m.type).toBe("text");
      expect(m.eventKey).toBe("msg:PHONE_ID_1:wamid.AAAA");
      expect(m.metaTimestamp).toBe(1700000000 * 1000);
    }
  });

  it("parses a status event", () => {
    const items = parseMetaPayload(statusPayload);
    expect(items).toHaveLength(1);
    const s = items[0];
    expect(s.kind).toBe("status");
    if (s.kind === "status") {
      expect(s.wamid).toBe("wamid.BBBB");
      expect(s.status).toBe("delivered");
      expect(s.recipientE164).toBe("+351912345678");
      expect(s.pricing?.category).toBe("utility");
      expect(s.eventKey).toBe("status:PHONE_ID_1:wamid.BBBB:delivered");
    }
  });

  it("ignores wrong object", () => {
    expect(parseMetaPayload({ object: "page", entry: [] })).toEqual([]);
  });

  it("ignores wrong field", () => {
    const x = {
      object: "whatsapp_business_account",
      entry: [{ id: "X", changes: [{ field: "account_update", value: {} }] }],
    };
    expect(parseMetaPayload(x)).toEqual([]);
  });

  it("ignores entry without phone_number_id", () => {
    const x = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "X",
          changes: [
            {
              field: "messages",
              value: { messages: [{ id: "wamid.X", from: "1", type: "text" }] },
            },
          ],
        },
      ],
    };
    expect(parseMetaPayload(x)).toEqual([]);
  });

  it("handles mixed messages + statuses in one payload", () => {
    const x = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA",
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "P1" },
                messages: [
                  { from: "351900000001", id: "wamid.M1", timestamp: "1", type: "text" },
                ],
                statuses: [
                  { id: "wamid.S1", status: "sent", timestamp: "2" },
                ],
              },
            },
          ],
        },
      ],
    };
    const items = parseMetaPayload(x);
    expect(items).toHaveLength(2);
    expect(items[0].kind).toBe("message");
    expect(items[1].kind).toBe("status");
  });
});

describe("normalizeWaIdToE164", () => {
  it("prepends +", () => {
    expect(normalizeWaIdToE164("351912345678")).toBe("+351912345678");
  });
  it("strips non-digits", () => {
    expect(normalizeWaIdToE164("+351 912 345 678")).toBe("+351912345678");
  });
  it("returns empty for empty input", () => {
    expect(normalizeWaIdToE164("")).toBe("");
  });
});
