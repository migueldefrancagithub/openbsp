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
            wa_id: "258860439352",
          },
        ],
        messages: [
          {
            from: "258860439352",
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
      actorProviderScopedId: "258860439352",
      actorDisplayName: "Maria Cliente",
      actorPhone: "258860439352",
      threadKey: "258860439352",
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
            recipient_id: "258860439352",
            timestamp: "1785071500",
          },
          {
            id: "wamid.LAB.2",
            status: "read",
            recipient_id: "258860439352",
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
  });

  it("preserves Hub-only events without coupling the core schema", () => {
    const events = normalizeWebhook(
      {
        type: "template_link_click",
        direction: "inbound",
        message_id: "wamid.LAB.3",
        to: "258860439352",
        link: { target_url: "https://example.test" },
      },
      SHA,
    );
    expect(events[0]).toMatchObject({
      eventKey: "event:template_link_click:wamid.LAB.3",
      eventKind: "event.template_link_click",
      direction: "incoming",
      actorProviderScopedId: "258860439352",
    });
  });

  it("derives a deterministic fallback key when no provider id exists", () => {
    const first = normalizeWebhook({ type: "unknown" }, SHA);
    const replay = normalizeWebhook({ type: "unknown" }, SHA);
    expect(first[0].eventKey).toBe(`event:unknown:${SHA}`);
    expect(replay[0].eventKey).toBe(first[0].eventKey);
  });
});
