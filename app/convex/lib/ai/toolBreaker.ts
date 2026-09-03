/**
 * Circuit breaker for tool calls — the deterministic defence against the
 * failure mode that costs the most in an unattended agent: the repetition loop.
 *
 * Three modes, all counted per turn:
 *  - exact failure: the SAME tool with the SAME arguments failing again. The
 *    model is not learning from the error, so the next identical call does not
 *    execute at all.
 *  - same tool failure: the same tool failing with DIFFERENT arguments. The
 *    tool itself is the problem; it is halted for the rest of the turn.
 *  - no progress: a READ-ONLY tool returning an identical result over and over.
 *    Write tools are excluded by explicit registration, never by heuristic —
 *    guessing which tool is safe to consider "idempotent" is how a booking gets
 *    silently skipped.
 *
 * The block is not silent: it comes back as a teaching error the model reads on
 * the next round, exactly like any other tool failure.
 *
 * Adapted from DeskcommCRM's `lib/agent-engine/agent/tool-breaker.ts` (MIT).
 */
export type BreakerThresholds = {
  exactFailureBlock: number;
  sameToolFailureHalt: number;
  noProgressBlock: number;
};

export const BREAKER_DEFAULTS: BreakerThresholds = {
  exactFailureBlock: 2,
  sameToolFailureHalt: 3,
  noProgressBlock: 3,
};

export type BreakerBlock = { code: "TOOL_BREAKER_BLOCKED"; reason: "exact_failure" | "same_tool_failure" | "no_progress"; message: string };

const MESSAGES: Record<BreakerBlock["reason"], string> = {
  exact_failure:
    "Já tentaste esta ferramenta com exactamente estes argumentos e falhou. Muda a abordagem ou responde ao paciente sem ela.",
  same_tool_failure:
    "Esta ferramenta falhou várias vezes neste turno e foi desligada. Continua sem ela e, se for preciso, passa à equipa.",
  no_progress:
    "Esta consulta está a devolver sempre o mesmo resultado. Usa o que já tens em vez de repetir.",
};

/** A stable signature for (tool, arguments), so "the same call" is well defined. */
export function callSignature(name: string, input: unknown): string {
  return `${name}:${stableStringify(input)}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

export type ToolBreaker = {
  /** Called before executing: a block means do not run the tool at all. */
  check(name: string, input: unknown): BreakerBlock | null;
  /** Called after: feeds the counters. */
  record(name: string, input: unknown, outcome: { status: string; output: unknown }): void;
};

export function createToolBreaker(options: {
  readOnlyTools: readonly string[];
  thresholds?: Partial<BreakerThresholds>;
}): ToolBreaker {
  const thresholds = { ...BREAKER_DEFAULTS, ...(options.thresholds ?? {}) };
  const exactFailures = new Map<string, number>();
  const toolFailures = new Map<string, number>();
  const halted = new Set<string>();
  const repeats = new Map<string, { output: string; count: number }>();

  return {
    check(name, input) {
      if (halted.has(name)) {
        return { code: "TOOL_BREAKER_BLOCKED", reason: "same_tool_failure", message: MESSAGES.same_tool_failure };
      }
      const signature = callSignature(name, input);
      if ((exactFailures.get(signature) ?? 0) >= thresholds.exactFailureBlock) {
        return { code: "TOOL_BREAKER_BLOCKED", reason: "exact_failure", message: MESSAGES.exact_failure };
      }
      const repeat = repeats.get(signature);
      if (
        options.readOnlyTools.includes(name) &&
        repeat &&
        repeat.count >= thresholds.noProgressBlock
      ) {
        return { code: "TOOL_BREAKER_BLOCKED", reason: "no_progress", message: MESSAGES.no_progress };
      }
      return null;
    },
    record(name, input, outcome) {
      const signature = callSignature(name, input);
      if (outcome.status === "error" || outcome.status === "denied") {
        exactFailures.set(signature, (exactFailures.get(signature) ?? 0) + 1);
        const failures = (toolFailures.get(name) ?? 0) + 1;
        toolFailures.set(name, failures);
        if (failures >= thresholds.sameToolFailureHalt) halted.add(name);
        return;
      }
      if (!options.readOnlyTools.includes(name)) return;
      const serialized = stableStringify(outcome.output);
      const previous = repeats.get(signature);
      repeats.set(
        signature,
        previous && previous.output === serialized
          ? { output: serialized, count: previous.count + 1 }
          : { output: serialized, count: 1 },
      );
    },
  };
}
