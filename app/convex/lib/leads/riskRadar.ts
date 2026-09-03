/**
 * Which conversations are dying quietly.
 *
 * An open demand that went cold and has no guaranteed next step is a patient
 * the clinic is losing without anyone seeing it. The radar makes that visible,
 * and separates two things that look identical on a list: cold with a follow-up
 * already scheduled ("in flight" — the system is still holding it) and cold
 * with nothing at all.
 *
 * Adapted from DeskcommCRM's `lib/leads/risk-radar.ts` (MIT).
 */
export type RiskBucket = "critical" | "at_risk" | "in_flight" | "on_track";

export type StageWindow = { coldHours: number; criticalHours: number };

/** Default when a stage says nothing: cold at a day, critical at three. */
export const DEFAULT_COLD_HOURS = 24;
export const CRITICAL_MULTIPLIER = 3;

/**
 * How long silence is normal depends on the stage.
 *
 * "No reply for two days" is ordinary in a price conversation and is abandonment
 * for someone who asked to book. A single global window makes the radar either
 * noisy or blind, depending on the clinic.
 */
const COLD_HOURS_BY_STATUS: Record<string, number> = {
  new: 4,
  interested: 12,
  asked_price: 24,
  wants_booking: 6,
  awaiting_human: 4,
  booked: 72,
  confirmed: 168,
};

export function resolveStageWindow(leadStatus: string | undefined): StageWindow {
  const coldHours = (leadStatus && COLD_HOURS_BY_STATUS[leadStatus]) || DEFAULT_COLD_HOURS;
  return { coldHours, criticalHours: coldHours * CRITICAL_MULTIPLIER };
}

export type RiskInput = {
  lastActivityAt: number;
  now: number;
  /** A follow-up is scheduled ahead: the system is still carrying this one. */
  inFlight: boolean;
  window: StageWindow;
};

export type RiskResult = { bucket: RiskBucket; hoursSinceActivity: number; onRadar: boolean };

export function classifyRisk({ lastActivityAt, now, inFlight, window }: RiskInput): RiskResult {
  const hoursSinceActivity = Math.max(0, (now - lastActivityAt) / 3_600_000);
  let bucket: RiskBucket;
  if (hoursSinceActivity < window.coldHours) bucket = "on_track";
  else if (inFlight) bucket = "in_flight";
  else if (hoursSinceActivity >= window.criticalHours) bucket = "critical";
  else bucket = "at_risk";
  return { bucket, hoursSinceActivity, onRadar: bucket !== "on_track" };
}

const RANK: Record<RiskBucket, number> = { critical: 0, at_risk: 1, in_flight: 2, on_track: 3 };

/** Triage order: critical first, and within a bucket the coldest first. */
export function compareRisk(
  a: { bucket: RiskBucket; hoursSinceActivity: number },
  b: { bucket: RiskBucket; hoursSinceActivity: number },
): number {
  const byBucket = RANK[a.bucket] - RANK[b.bucket];
  return byBucket !== 0 ? byBucket : b.hoursSinceActivity - a.hoursSinceActivity;
}
