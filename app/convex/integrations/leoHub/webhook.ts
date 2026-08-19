export type NormalizedHubEvent = {
  eventKey: string;
  providerEventId?: string;
  eventKind: string;
  direction: "incoming" | "outgoing";
  actorProviderScopedId?: string;
  actorDisplayName?: string;
  actorPhone?: string;
  threadKey?: string;
  providerTimestamp?: number;
  payload: Record<string, unknown>;
};

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function timestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1_000 : value;
  }
  if (typeof value !== "string" || !value.trim()) return undefined;
  if (/^\d+$/.test(value)) {
    const parsed = Number(value);
    return parsed < 10_000_000_000 ? parsed * 1_000 : parsed;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function firstObject(value: unknown): JsonObject | null {
  return Array.isArray(value) ? object(value[0]) : null;
}

function direction(value: unknown): "incoming" | "outgoing" {
  return value === "outbound" || value === "outgoing"
    ? "outgoing"
    : "incoming";
}

/**
 * The Hub has been observed delivering the flattened Meta `value` object, the
 * complete `entry[].changes[].value` envelope, and both wrapped in `body`.
 * Peel those wrappers so the rest of this module only ever sees `value`.
 *
 * Without this, an enveloped delivery falls through to the catch-all branch and
 * a real text message is stored as `event.unknown`: no thread, no bubble, and a
 * webhook that looks healthy while producing nothing usable.
 */
function unwrapEnvelope(root: JsonObject | null): JsonObject | null {
  if (!root) return null;
  const inner = object(root.body);
  const base = inner && !root.messages && !root.statuses ? inner : root;

  if (base.messages || base.statuses || base.contacts) return base;

  const entry = firstObject(base.entry);
  const change = firstObject(entry?.changes);
  const value = object(change?.value);
  return value ?? base;
}

/**
 * The Hub sends the Meta `value` shape directly instead of wrapping it in
 * `object/entry/changes`. Normalize that shape at the adapter boundary so
 * the channel core never depends on Hub-only enrichment fields.
 */
export function normalizeWebhook(
  input: unknown,
  rawBodySha256: string,
): NormalizedHubEvent[] {
  const root = unwrapEnvelope(object(input));
  if (!root) return [];

  const contact = firstObject(root.contacts);
  const profile = object(contact?.profile);
  const contactId =
    string(contact?.user_id) ??
    string(contact?.wa_id) ??
    string(root.recipient) ??
    string(root.to);
  const contactName = string(profile?.name);
  const contactPhone = string(contact?.wa_id) ?? string(root.to);
  const events: NormalizedHubEvent[] = [];

  if (Array.isArray(root.messages)) {
    for (const candidate of root.messages) {
      const message = object(candidate);
      if (!message) continue;
      const providerEventId = string(message.id);
      const messageType = string(message.type) ?? "unknown";
      const actor =
        string(message.from_user_id) ??
        string(message.from) ??
        contactId;
      const eventDirection = direction(message.direction ?? root.direction);
      const eventKey = providerEventId
        ? `message:${providerEventId}`
        : `message:${messageType}:${rawBodySha256}`;
      events.push({
        eventKey,
        providerEventId,
        eventKind: `message.${messageType}`,
        direction: eventDirection,
        actorProviderScopedId: actor,
        actorDisplayName: contactName,
        actorPhone: contactPhone,
        threadKey: actor,
        providerTimestamp: timestamp(message.timestamp),
        payload: {
          message,
          ...(contact ? { contact } : {}),
          ...(root.metadata ? { metadata: root.metadata } : {}),
          ...(message.normalized_text
            ? { normalizedText: message.normalized_text }
            : {}),
          ...(message.conversation_window
            ? { conversationWindow: message.conversation_window }
            : {}),
        },
      });
    }
  }

  if (Array.isArray(root.statuses)) {
    for (const candidate of root.statuses) {
      const status = object(candidate);
      if (!status) continue;
      const providerEventId = string(status.id);
      const statusName = string(status.status) ?? "unknown";
      const actor = string(status.recipient_id) ?? contactId;
      events.push({
        eventKey: providerEventId
          ? `status:${providerEventId}:${statusName}`
          : `status:${statusName}:${rawBodySha256}`,
        providerEventId,
        eventKind: `status.${statusName}`,
        direction: "outgoing",
        actorProviderScopedId: actor,
        actorPhone: actor,
        threadKey: actor,
        providerTimestamp: timestamp(status.timestamp),
        payload: { status },
      });
    }
  }

  if (events.length === 0) {
    const topType = string(root.type) ?? "unknown";
    const providerEventId = string(root.message_id) ?? string(root.id);
    events.push({
      eventKey: providerEventId
        ? `event:${topType}:${providerEventId}`
        : `event:${topType}:${rawBodySha256}`,
      providerEventId,
      eventKind: `event.${topType}`,
      direction: direction(root.direction),
      actorProviderScopedId: contactId,
      actorDisplayName: contactName,
      actorPhone: contactPhone,
      threadKey: contactId,
      providerTimestamp: timestamp(root.timestamp),
      payload: root,
    });
  }

  return events;
}
