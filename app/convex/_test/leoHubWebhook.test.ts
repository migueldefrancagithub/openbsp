import { describe, expect, it } from "vitest";
import { normalizeWebhook } from "../integrations/leoHub/webhook";

const SHA = "a".repeat(64);

describe("Leo Hub webhook normalization", () => {
  it("normalizes the documented inbound message shape", () => {
    const events = normalizeWebhook(
      {
        messaging_product: "whatsapp",
        metadata: {
          display_phone_number: "258860000000",
          phone_number_id: "PHONE_LAB",
        },
        contacts: [
          {
            profile: { name: "Maria Cliente" },
            wa_id: "258840000099",
          },
        ],
        messages: [
          {
            from: "258840000099",
            id: "wamid.LAB.1",
            timestamp: "1785071400",
            type: "text",
            text: { body: "Oi" },
            direction: "inbound",
            normalized_text: "Oi",
            conversation_window: { is_open: true },
          },
        ],
      },
      SHA,
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventKey: "message:wamid.LAB.1",
      providerEventId: "wamid.LAB.1",
      eventKind: "message.text",
      direction: "incoming",
      actorProviderScopedId: "258840000099",
      actorDisplayName: "Maria Cliente",
      actorPhone: "258840000099",
      threadKey: "258840000099",
      providerTimestamp: 1_785_071_400_000,
      payload: {
        normalizedText: "Oi",
        conversationWindow: { is_open: true },
      },
    });
  });

  it("uses distinct keys for message status progression", () => {
    const events = normalizeWebhook(
      {
        statuses: [
          {
            id: "wamid.LAB.2",
            status: "delivered",
            recipient_id: "258840000099",
            timestamp: "1785071500",
          },
          {
            id: "wamid.LAB.2",
            status: "read",
            recipient_id: "258840000099",
            timestamp: "1785071600",
          },
        ],
      },
      SHA,
    );
    expect(events.map((event) => event.eventKey)).toEqual([
      "status:wamid.LAB.2:delivered",
      "status:wamid.LAB.2:read",
    ]);
    expect(events.every((event) => event.direction === "outgoing")).toBe(true);
    expect(events.every((event) => event.threadKey === undefined)).toBe(true);
  });

  it("preserves Hub-only events without coupling the core schema", () => {
    const events = normalizeWebhook(
      {
        type: "template_link_click",
        direction: "inbound",
        message_id: "wamid.LAB.3",
        to: "258840000099",
        link: { target_url: "https://example.test" },
      },
      SHA,
    );
    expect(events[0]).toMatchObject({
      eventKey: "event:template_link_click:wamid.LAB.3",
      eventKind: "event.template_link_click",
      direction: "incoming",
      actorProviderScopedId: "258840000099",
    });
  });

  it("derives a deterministic fallback key when no provider id exists", () => {
    const first = normalizeWebhook({ type: "unknown" }, SHA);
    const replay = normalizeWebhook({ type: "unknown" }, SHA);
    expect(first[0].eventKey).toBe(`event:unknown:${SHA}`);
    expect(replay[0].eventKey).toBe(first[0].eventKey);
  });
});

describe("envelope shapes the Hub actually delivers", () => {
  const value = {
    contacts: [{ wa_id: "258840000099", profile: { name: "Tester" } }],
    messages: [
      {
        id: "wamid.ENV",
        from: "258840000099",
        type: "text",
        timestamp: "1755500000",
        text: { body: "teste openbsp" },
      },
    ],
  };

  // Hub deliveries may arrive as a flattened value, a complete Meta envelope or
  // a `body` wrapper. The laboratory normalizer has to agree across all three,
  // or an enveloped delivery is stored as event.unknown: no thread, no bubble,
  // and a webhook that looks healthy while producing nothing usable.
  it("normalizes the flattened value shape", () => {
    const events = normalizeWebhook(value, "sha-flat");
    expect(events).toHaveLength(1);
    expect(events[0].eventKind).toBe("message.text");
    expect(events[0].threadKey).toBe("258840000099");
  });

  it("normalizes the complete entry/changes/value envelope", () => {
    const events = normalizeWebhook(
      { object: "whatsapp_business_account", entry: [{ changes: [{ value }] }] },
      "sha-envelope",
    );
    expect(events).toHaveLength(1);
    expect(events[0].eventKind).toBe("message.text");
    expect(events[0].providerEventId).toBe("wamid.ENV");
  });

  it("normalizes a body wrapper around either shape", () => {
    expect(normalizeWebhook({ body: value }, "sha-body")[0].eventKind).toBe(
      "message.text",
    );
    expect(
      normalizeWebhook(
        { body: { entry: [{ changes: [{ value }] }] } },
        "sha-body-envelope",
      )[0].eventKind,
    ).toBe("message.text");
  });

  it("still falls back for a shape it does not recognize", () => {
    const events = normalizeWebhook({ type: "ping" }, "sha-ping");
    expect(events[0].eventKind).toBe("event.ping");
  });
});
