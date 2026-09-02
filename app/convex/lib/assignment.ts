import type { Id } from "../_generated/dataModel";

/**
 * Who should own a thread. Phase A only knows the manual choice; Phase B adds
 * round-robin / availability-aware strategies behind this same function so
 * `updateThread` and `createHumanCase` never change.
 */
export type AssignmentStrategy = "manual";

export type AssignmentInput = {
  requestedMemberId?: Id<"members">;
  requestedTeamId?: Id<"teams">;
  clearMember?: boolean;
  clearTeam?: boolean;
};

export type AssignmentDecision = {
  strategy: AssignmentStrategy;
  responsibleMemberId?: Id<"members"> | null;
  assignedTeamId?: Id<"teams"> | null;
};

export function resolveAssignment(input: AssignmentInput): AssignmentDecision {
  return {
    strategy: "manual",
    responsibleMemberId: input.clearMember
      ? null
      : input.requestedMemberId,
    assignedTeamId: input.clearTeam ? null : input.requestedTeamId,
  };
}
