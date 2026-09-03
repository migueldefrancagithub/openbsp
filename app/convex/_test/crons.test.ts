import { describe, expect, it } from "vitest";
import crons from "../crons";

describe("scheduled jobs", () => {
  it("registers every sweep the product relies on", () => {
    const names = Object.keys((crons as unknown as { crons: Record<string, unknown> }).crons);
    expect(names).toEqual(
      expect.arrayContaining([
        "meta token health sweep",
        "meta phone quality sweep",
        "meta template status sweep",
        "chatbot stale run sweep",
        "channel automation stale run sweep",
        "thread reminder overdue sweep",
        "retention candidates report",
      ]),
    );
  });
});
