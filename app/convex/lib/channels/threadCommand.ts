/**
 * Who is in command of a conversation — one question, one answer.
 *
 * The same state used to be re-derived in the thread list, the header and the
 * operations panel out of five different fields (`responsibleMemberId`,
 * `automationMode`, `openHumanCaseId`, `dnd`, `snoozedUntil`), and partial
 * readings are how a screen ends up disagreeing with itself about whether the
 * AI is answering. This is a pure function over the row the query already
 * loads; it creates no new state to keep in sync.
 *
 * Adapted from DeskcommCRM's `lib/inbox/comando-da-conversa.ts` (MIT), with our
 * vocabulary: the mirror is the runtime's, so every reason here is something
 * that actually stops `aiRuntime.claimTurn` or the outbound gate.
 */

export type ThreadCommandWho = "member" | "ai" | "nobody" | "waiting" | "closed";

export type ThreadSilenceReason =
  /** Someone took the conversation; only handing it back frees the AI. */
  | "member_in_command"
  /** Paused on purpose, or the AI handed the conversation over. */
  | "paused"
  /** A human case is open: resuming is blocked until it is resolved. */
  | "human_case_open"
  /** The patient asked to stop. Nothing to resume — that is the patient's call. */
  | "opted_out"
  /** Snoozed: it comes back on its own. */
  | "snoozed";

export type ThreadCommandFacts = {
  closedAt?: number;
  responsibleMemberId?: unknown;
  automationMode?: string;
  openHumanCaseId?: unknown;
  dnd?: boolean;
  snoozedUntil?: number;
  /**
   * Does this channel have a published, active agent? `undefined` means "not
   * known yet" and is treated as yes — claiming there is no AI because a read
   * did not come back is the same lie in reverse.
   */
  aiAvailable?: boolean;
};

export type ThreadCommand = {
  who: ThreadCommandWho;
  /** Why the AI is silent. `null` while it is answering. */
  reason: ThreadSilenceReason | null;
  /** Would the AI answer the patient's next message? */
  aiActive: boolean;
  /** Is there a lock a member could hand back to the AI? */
  resumable: boolean;
};

export function threadCommand(facts: ThreadCommandFacts, now: number): ThreadCommand {
  const closed = !!facts.closedAt;
  const optedOut = facts.dnd === true;
  const caseOpen = !!facts.openHumanCaseId;
  const snoozed = !!facts.snoozedUntil && facts.snoozedUntil > now;
  const stopped = facts.automationMode === "stopped";
  const humanMode = facts.automationMode === "human";
  const hasMember = !!facts.responsibleMemberId;

  const aiActive = !closed && !optedOut && !caseOpen && !snoozed && !stopped && !humanMode;

  // Order matters: the strongest and widest lock names the reason, because the
  // reason decides which button the screen offers. Naming the weaker one would
  // offer a hand-back that the runtime would refuse anyway.
  const reason: ThreadSilenceReason | null = aiActive
    ? null
    : closed
      ? null // A closed conversation is not silence, it is absence of subject.
      : optedOut
        ? "opted_out"
        : caseOpen
          ? "human_case_open"
          : snoozed
            ? "snoozed"
            : hasMember
              ? "member_in_command"
              : "paused";

  // A member keeps naming the conversation even after it is closed: on the
  // "closed" tab, "who handled this?" is the only question that matters, and
  // that the conversation ended is already said by the status beside it.
  const who: ThreadCommandWho = hasMember
    ? "member"
    : closed
      ? "closed"
      : aiActive
        ? facts.aiAvailable === false
          ? "nobody"
          : "ai"
        : "waiting";

  return {
    who,
    reason,
    aiActive,
    // Opt-out cancels the hand-back: resuming does not undo it, the outbound
    // gate would refuse, and a button that cannot work is worse than none.
    // Snoozed is left out on purpose: it undoes itself, and offering a
    // hand-back for a state that is already coming back is a decorative
    // control. Every other lock needs someone to act.
    resumable: !closed && !optedOut && !caseOpen && !snoozed && (stopped || humanMode || (hasMember && !aiActive)),
  };
}

export const COMMAND_LABEL_PT: Record<ThreadCommandWho, string> = {
  member: "Em atendimento",
  ai: "IA a responder",
  nobody: "Sem agente no ar",
  waiting: "À espera da equipa",
  closed: "Encerrada",
};

export const COMMAND_LABEL_EN: Record<ThreadCommandWho, string> = {
  member: "Being handled",
  ai: "AI answering",
  nobody: "No agent live",
  waiting: "Waiting for the team",
  closed: "Closed",
};

export const SILENCE_LABEL_PT: Record<ThreadSilenceReason, string> = {
  member_in_command: "IA pausada — alguém assumiu",
  paused: "IA pausada",
  human_case_open: "Caso humano aberto",
  opted_out: "Paciente pediu para não receber mensagens",
  snoozed: "Adiada — volta sozinha",
};

export const SILENCE_LABEL_EN: Record<ThreadSilenceReason, string> = {
  member_in_command: "AI paused — someone took over",
  paused: "AI paused",
  human_case_open: "Human case open",
  opted_out: "Patient asked not to be messaged",
  snoozed: "Snoozed — comes back on its own",
};

/**
 * Which commands the "queue" tab asks for.
 *
 * In a tenant with a live agent, "needs a person now" is `waiting`: the agent
 * handles the rest. In a tenant with no agent live, `ai` describes nobody, and
 * those conversations are waiting for a person too — leaving them out would
 * make a fresh install's queue open empty with real patients unanswered.
 */
export function queueCommands(aiAvailable?: boolean): ThreadCommandWho[] {
  return aiAvailable === false ? ["waiting", "nobody", "ai"] : ["waiting", "nobody"];
}

/** Since when this conversation has been waiting: the patient's last message. */
export function waitingSince(facts: { lastInboundAt?: number; createdAt: number }): number {
  return facts.lastInboundAt ?? facts.createdAt;
}
