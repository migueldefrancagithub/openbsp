/**
 * When a human undoes what the AI did.
 *
 * The system gives the agent a limit and shows where configuration is missing;
 * neither answers the question that closes the loop: when it gets something
 * wrong, what changes? Without this the AI errs the same way tomorrow and the
 * clinic corrects it again, forever, in silence.
 *
 * What counts is a person moving a card the AI moved LAST. Two shapes, both
 * real signal: sending it back where it came from ("that move was wrong"), and
 * sending it somewhere else ("not there"). What does not count is a colleague
 * reorganising the funnel — counting that would inflate the number with noise.
 *
 * Adapted from DeskcommCRM's `lib/leads/correcao-humana.ts` (MIT).
 */
export type CorrectionKind = "reverted" | "redirected";

export type CorrectionVerdict =
  | { isCorrection: false; why: "ai_did_not_move_it" | "same_status" | "no_previous_status" }
  | { isCorrection: true; kind: CorrectionKind; aiStatus: string; memberStatus: string };

export function classifyCorrection(input: {
  /** Who last moved the stage. */
  lastActor: string | undefined;
  /** Where the stage was before this change (i.e. where the AI left it). */
  fromStatus: string | undefined;
  /** Where the member is moving it now. */
  toStatus: string;
  /** Where the AI had taken it FROM, when known. */
  aiPreviousStatus?: string;
}): CorrectionVerdict {
  if (!input.fromStatus) return { isCorrection: false, why: "no_previous_status" };
  if (input.lastActor !== "ai") return { isCorrection: false, why: "ai_did_not_move_it" };
  if (input.toStatus === input.fromStatus) return { isCorrection: false, why: "same_status" };
  return {
    isCorrection: true,
    kind: input.aiPreviousStatus && input.toStatus === input.aiPreviousStatus ? "reverted" : "redirected",
    aiStatus: input.fromStatus,
    memberStatus: input.toStatus,
  };
}
