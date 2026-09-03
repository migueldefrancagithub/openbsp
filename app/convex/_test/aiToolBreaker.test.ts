import { describe, expect, it } from "vitest";
import { callSignature, createToolBreaker } from "../lib/ai/toolBreaker";

const READ_ONLY = ["consultar_agenda"];
const fail = { status: "error", output: { error: "TOOL_FAILED" } };
const ok = (output: unknown) => ({ status: "ok", output });

describe("the tool circuit breaker", () => {
  it("stops the same call with the same arguments after it keeps failing", () => {
    const breaker = createToolBreaker({ readOnlyTools: READ_ONLY });
    const input = { serviceId: "s1", date: "2026-09-10" };
    expect(breaker.check("consultar_agenda", input)).toBeNull();
    breaker.record("consultar_agenda", input, fail);
    expect(breaker.check("consultar_agenda", input)).toBeNull();
    breaker.record("consultar_agenda", input, fail);
    const blocked = breaker.check("consultar_agenda", input);
    expect(blocked).toMatchObject({ reason: "exact_failure" });
    // The block teaches instead of going silent.
    expect(blocked!.message).toMatch(/muda a abordagem/i);
  });

  it("halts a tool that fails with different arguments — the tool is the problem", () => {
    const breaker = createToolBreaker({ readOnlyTools: READ_ONLY });
    for (const date of ["2026-09-10", "2026-09-11", "2026-09-12"]) {
      breaker.record("consultar_agenda", { serviceId: "s1", date }, fail);
    }
    expect(breaker.check("consultar_agenda", { serviceId: "s1", date: "2026-09-13" })).toMatchObject({
      reason: "same_tool_failure",
    });
    // Other tools keep working.
    expect(breaker.check("reservar_slot", { serviceId: "s1" })).toBeNull();
  });

  it("blocks a read-only call that keeps returning the same thing", () => {
    const breaker = createToolBreaker({ readOnlyTools: READ_ONLY });
    const input = { serviceId: "s1", date: "2026-09-10" };
    for (let i = 0; i < 3; i += 1) breaker.record("consultar_agenda", input, ok({ slots: [] }));
    expect(breaker.check("consultar_agenda", input)).toMatchObject({ reason: "no_progress" });
  });

  it("never applies no-progress to a write tool, even when it repeats", () => {
    const breaker = createToolBreaker({ readOnlyTools: READ_ONLY });
    const input = { serviceId: "s1", startAt: 1 };
    for (let i = 0; i < 5; i += 1) breaker.record("reservar_slot", input, ok({ appointmentId: "a1" }));
    // A write tool is excluded by registration, not heuristic: guessing here is
    // how a real booking gets silently skipped.
    expect(breaker.check("reservar_slot", input)).toBeNull();
  });

  it("treats argument order as the same call, and different arguments as different", () => {
    expect(callSignature("t", { a: 1, b: 2 })).toBe(callSignature("t", { b: 2, a: 1 }));
    expect(callSignature("t", { a: 1 })).not.toBe(callSignature("t", { a: 2 }));
  });
});
