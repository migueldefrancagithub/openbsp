/**
 * Channel-neutral outbound status ladder.
 *
 * Pure module: no Convex imports, no database access. It unit-tests without a
 * harness and is reusable by any provider adapter over the neutral contracts.
 *
 * The ladder only ever advances. Inbound provider evidence can move an outbox
 * row forward, never backward, because provider status webhooks arrive out of
 * order and a late "sent" must not erase a proven "read".
 */

export type OutboxStatus =
  | "queued"
  | "dispatching"
  | "accepted"
  | "delivered"
  | "read"
  | "failed"
  | "unknown";

/**
 * Progress ranks. `failed` and `unknown` are deliberately absent: they are
 * outcomes, not progress, and comparing them on this scale would let a
 * provider failure overwrite a proven delivery.
 */
export const OUTBOX_STATUS_RANK: Record<string, number> = {
  queued: 0,
  dispatching: 1,
  accepted: 2,
  delivered: 3,
  read: 4,
};

/** Statuses that prove the message reached the recipient. */
const TERMINAL_SUCCESS = new Set(["delivered", "read"]);

/**
 * Translate a normalized provider event kind into a neutral outbox status.
 *
 * Returns null for anything unrecognized, so unknown provider vocabulary is
 * ignored rather than guessed at.
 */
export function mapProviderStatusToOutboxStatus(
  eventKind: string,
): OutboxStatus | null {
  switch (eventKind) {
    case "status.sent":
      return "accepted";
    case "status.delivered":
      return "delivered";
    case "status.read":
      return "read";
    case "status.failed":
      return "failed";
    default:
      return null;
  }
}

export type OutboxTransition = {
  /** Status to write, or null to leave the row's status untouched. */
  nextStatus: OutboxStatus | null;
  /** Whether the provider's failure reason should be recorded as evidence. */
  recordFailureReason: boolean;
};

const NO_CHANGE: OutboxTransition = {
  nextStatus: null,
  recordFailureReason: false,
};

/**
 * Decide how an outbox row should react to inbound provider evidence.
 *
 * Never returns "unknown": that status is written only by the dispatch path,
 * where it means "we do not know whether the provider accepted this". Inbound
 * evidence always knows something, so it can only resolve or be ignored.
 */
export function decideOutboxTransition(args: {
  current: string;
  incoming: OutboxStatus | null;
}): OutboxTransition {
  const { current, incoming } = args;
  if (incoming === null) return NO_CHANGE;

  if (incoming === "failed") {
    // A failure arriving after proof of delivery is contradictory. Keep the
    // proven outcome and keep the provider's reason for operator review.
    if (TERMINAL_SUCCESS.has(current)) {
      return { nextStatus: null, recordFailureReason: true };
    }
    if (current === "failed") return NO_CHANGE;
    return { nextStatus: "failed", recordFailureReason: true };
  }

  const incomingRank = OUTBOX_STATUS_RANK[incoming];
  if (incomingRank === undefined) return NO_CHANGE;

  // A row sitting on an off-ladder outcome (failed / unknown) has no rank.
  // `unknown` rows are resolvable by evidence; `failed` rows are not reopened.
  const currentRank = OUTBOX_STATUS_RANK[current];
  if (currentRank === undefined) {
    if (current === "unknown") {
      return { nextStatus: incoming, recordFailureReason: false };
    }
    return NO_CHANGE;
  }

  if (incomingRank > currentRank) {
    return { nextStatus: incoming, recordFailureReason: false };
  }
  return NO_CHANGE;
}
