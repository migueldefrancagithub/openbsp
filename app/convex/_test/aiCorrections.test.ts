import { describe, expect, it } from "vitest";
import { classifyCorrection } from "../lib/ai/corrections";
import { classifyRisk, compareRisk, resolveStageWindow } from "../lib/leads/riskRadar";

describe("a human undoing what the AI did", () => {
  it("only counts when the AI moved it last", () => {
    // A colleague reorganising the funnel says nothing about the assistant.
    expect(
      classifyCorrection({ lastActor: "member", fromStatus: "booked", toStatus: "interested" }),
    ).toMatchObject({ isCorrection: false, why: "ai_did_not_move_it" });
    expect(classifyCorrection({ lastActor: "ai", fromStatus: undefined, toStatus: "booked" })).toMatchObject({
      isCorrection: false,
      why: "no_previous_status",
    });
    expect(classifyCorrection({ lastActor: "ai", fromStatus: "booked", toStatus: "booked" })).toMatchObject({
      isCorrection: false,
      why: "same_status",
    });
  });

  it("tells a revert from a redirect, because both are signal", () => {
    expect(
      classifyCorrection({ lastActor: "ai", fromStatus: "booked", toStatus: "interested", aiPreviousStatus: "interested" }),
    ).toMatchObject({ isCorrection: true, kind: "reverted", aiStatus: "booked", memberStatus: "interested" });
    expect(
      classifyCorrection({ lastActor: "ai", fromStatus: "booked", toStatus: "lost", aiPreviousStatus: "interested" }),
    ).toMatchObject({ isCorrection: true, kind: "redirected" });
  });
});

describe("the risk radar", () => {
  const now = 1_800_000_000_000;
  const hoursAgo = (hours: number) => now - hours * 3_600_000;

  it("reads silence against the stage, not one global window", () => {
    // Six hours quiet is abandonment for someone who asked to book and normal
    // for a confirmed appointment.
    expect(resolveStageWindow("wants_booking").coldHours).toBeLessThan(resolveStageWindow("confirmed").coldHours);
    const booking = classifyRisk({ lastActivityAt: hoursAgo(7), now, inFlight: false, window: resolveStageWindow("wants_booking") });
    const confirmed = classifyRisk({ lastActivityAt: hoursAgo(7), now, inFlight: false, window: resolveStageWindow("confirmed") });
    expect(booking.onRadar).toBe(true);
    expect(confirmed.bucket).toBe("on_track");
  });

  it("separates cold-with-a-follow-up from cold-with-nothing", () => {
    const window = resolveStageWindow("interested");
    const held = classifyRisk({ lastActivityAt: hoursAgo(40), now, inFlight: true, window });
    const dropped = classifyRisk({ lastActivityAt: hoursAgo(40), now, inFlight: false, window });
    expect(held.bucket).toBe("in_flight");
    expect(dropped.bucket).toBe("critical");
  });

  it("triages critical first and, within a bucket, the coldest first", () => {
    const items = [
      { bucket: "in_flight" as const, hoursSinceActivity: 100 },
      { bucket: "critical" as const, hoursSinceActivity: 30 },
      { bucket: "critical" as const, hoursSinceActivity: 90 },
      { bucket: "at_risk" as const, hoursSinceActivity: 10 },
    ];
    expect([...items].sort(compareRisk).map((item) => `${item.bucket}:${item.hoursSinceActivity}`)).toEqual([
      "critical:90",
      "critical:30",
      "at_risk:10",
      "in_flight:100",
    ]);
  });
});
