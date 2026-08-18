import { describe, expect, it } from "vitest";
import {
  OUTBOX_STATUS_RANK,
  decideOutboxTransition,
  mapProviderStatusToOutboxStatus,
} from "../lib/channels/outboxStatus";

describe("mapProviderStatusToOutboxStatus", () => {
  it("translates the provider vocabulary the adapter emits", () => {
    expect(mapProviderStatusToOutboxStatus("status.sent")).toBe("accepted");
    expect(mapProviderStatusToOutboxStatus("status.delivered")).toBe(
      "delivered",
    );
    expect(mapProviderStatusToOutboxStatus("status.read")).toBe("read");
    expect(mapProviderStatusToOutboxStatus("status.failed")).toBe("failed");
  });

  it("ignores vocabulary it does not recognize instead of guessing", () => {
    expect(mapProviderStatusToOutboxStatus("status.played")).toBeNull();
    expect(mapProviderStatusToOutboxStatus("status.deleted")).toBeNull();
    expect(mapProviderStatusToOutboxStatus("message.text")).toBeNull();
    expect(mapProviderStatusToOutboxStatus("")).toBeNull();
  });
});

describe("OUTBOX_STATUS_RANK", () => {
  it("keeps failed and unknown off the progress ladder", () => {
    expect(OUTBOX_STATUS_RANK.failed).toBeUndefined();
    expect(OUTBOX_STATUS_RANK.unknown).toBeUndefined();
  });

  it("orders progress strictly", () => {
    expect(OUTBOX_STATUS_RANK.queued).toBeLessThan(
      OUTBOX_STATUS_RANK.dispatching,
    );
    expect(OUTBOX_STATUS_RANK.dispatching).toBeLessThan(
      OUTBOX_STATUS_RANK.accepted,
    );
    expect(OUTBOX_STATUS_RANK.accepted).toBeLessThan(
      OUTBOX_STATUS_RANK.delivered,
    );
    expect(OUTBOX_STATUS_RANK.delivered).toBeLessThan(OUTBOX_STATUS_RANK.read);
  });
});

describe("decideOutboxTransition", () => {
  it("advances accepted to delivered to read (AC-1)", () => {
    expect(
      decideOutboxTransition({ current: "accepted", incoming: "delivered" }),
    ).toEqual({ nextStatus: "delivered", recordFailureReason: false });
    expect(
      decideOutboxTransition({ current: "delivered", incoming: "read" }),
    ).toEqual({ nextStatus: "read", recordFailureReason: false });
  });

  it("never regresses on a late or out-of-order event (AC-2)", () => {
    for (const incoming of ["accepted", "delivered"] as const) {
      expect(
        decideOutboxTransition({ current: "read", incoming }),
      ).toEqual({ nextStatus: null, recordFailureReason: false });
    }
    expect(
      decideOutboxTransition({ current: "delivered", incoming: "accepted" }),
    ).toEqual({ nextStatus: null, recordFailureReason: false });
  });

  it("treats a repeated event as a no-op (AC-4)", () => {
    expect(
      decideOutboxTransition({ current: "delivered", incoming: "delivered" }),
    ).toEqual({ nextStatus: null, recordFailureReason: false });
  });

  it("keeps a proven delivery when a failure arrives later (AC-3)", () => {
    expect(
      decideOutboxTransition({ current: "delivered", incoming: "failed" }),
    ).toEqual({ nextStatus: null, recordFailureReason: true });
    expect(
      decideOutboxTransition({ current: "read", incoming: "failed" }),
    ).toEqual({ nextStatus: null, recordFailureReason: true });
  });

  it("accepts a failure when nothing has been proven yet", () => {
    expect(
      decideOutboxTransition({ current: "accepted", incoming: "failed" }),
    ).toEqual({ nextStatus: "failed", recordFailureReason: true });
  });

  it("does not reopen a failed row", () => {
    for (const incoming of ["accepted", "delivered", "read", "failed"] as const) {
      expect(
        decideOutboxTransition({ current: "failed", incoming }),
      ).toEqual({ nextStatus: null, recordFailureReason: false });
    }
  });

  it("resolves an unknown row from evidence, never from a guess", () => {
    // Reachable only if a provider hands back a message id and then fails the
    // follow-up. The match is still strictly by providerMessageId at the call
    // site, so this resolves on evidence rather than on a recipient guess.
    expect(
      decideOutboxTransition({ current: "unknown", incoming: "delivered" }),
    ).toEqual({ nextStatus: "delivered", recordFailureReason: false });
    expect(
      decideOutboxTransition({ current: "unknown", incoming: "failed" }),
    ).toEqual({ nextStatus: "failed", recordFailureReason: true });
  });

  it("never produces unknown as an outcome of inbound evidence", () => {
    const currents = [
      "queued",
      "dispatching",
      "accepted",
      "delivered",
      "read",
      "failed",
      "unknown",
    ];
    const incomings = ["accepted", "delivered", "read", "failed", null] as const;
    for (const current of currents) {
      for (const incoming of incomings) {
        const result = decideOutboxTransition({ current, incoming });
        expect(result.nextStatus).not.toBe("unknown");
      }
    }
  });

  it("does nothing when the provider status was unrecognized", () => {
    expect(
      decideOutboxTransition({ current: "accepted", incoming: null }),
    ).toEqual({ nextStatus: null, recordFailureReason: false });
  });
});
