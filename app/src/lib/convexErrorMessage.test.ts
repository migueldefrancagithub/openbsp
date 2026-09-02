import { describe, expect, it } from "vitest";
import {
  CONVEX_ERROR_MESSAGES,
  convexErrorCode,
  convexErrorMessage,
  isConvexErrorCode,
} from "./convexErrorMessage";

class FakeConvexError extends Error {
  data: unknown;
  constructor(data: unknown) {
    super(`Uncaught ConvexError: ${JSON.stringify(data)}`);
    this.data = data;
  }
}

describe("convexErrorMessage", () => {
  it("maps known codes to PT by default and EN on request", () => {
    const error = new FakeConvexError({ code: "RECIPIENT_NOT_ALLOWLISTED" });
    expect(convexErrorCode(error)).toBe("RECIPIENT_NOT_ALLOWLISTED");
    expect(isConvexErrorCode(error, "RECIPIENT_NOT_ALLOWLISTED")).toBe(true);
    expect(convexErrorMessage(error, "pt")).toContain("lista autorizada");
    expect(convexErrorMessage(error, "en")).toContain("allowlist");
  });

  it("reads the code out of a serialized action error message", () => {
    const error = new Error(
      'Uncaught ConvexError: {"code":"SERVICE_WINDOW_EXPIRED"}\n    at handler (../convex/iaSolutionHub.ts:1447:13)',
    );
    expect(convexErrorMessage(error, "pt")).toContain("janela de 24h");
  });

  it("never shows raw JSON or stack traces for unknown codes", () => {
    const error = new FakeConvexError({ code: "SOMETHING_NEW", extra: 1 });
    const text = convexErrorMessage(error, "pt");
    expect(text).not.toContain("{");
    expect(text).toContain("SOMETHING_NEW");
  });

  it("explains server errors, missing functions and network failures", () => {
    expect(
      convexErrorMessage(new Error("[CONVEX M(clinic:createService)] [Request ID: abc] Server Error"), "pt"),
    ).toContain("erro inesperado");
    expect(
      convexErrorMessage(
        new Error("Could not find public function for 'clinic:createService'. Did you forget to run `npx convex dev`?"),
        "en",
      ),
    ).toContain("newer than the server");
    expect(convexErrorMessage(new TypeError("Failed to fetch"), "pt")).toContain("Sem ligação");
  });

  it("falls back to the caller text for plain errors", () => {
    expect(convexErrorMessage(new Error("boom"), "pt", "Falhou.")).toBe("Falhou.");
    expect(convexErrorMessage(undefined, "en", "Failed.")).toBe("Failed.");
  });

  it("has PT and EN copy for every entry", () => {
    for (const [code, pair] of Object.entries(CONVEX_ERROR_MESSAGES)) {
      expect(pair[0].length, code).toBeGreaterThan(3);
      expect(pair[1].length, code).toBeGreaterThan(3);
      expect(pair[0]).not.toContain("{");
    }
  });
});
