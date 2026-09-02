import { describe, expect, it } from "vitest";
import { authErrorMessage } from "./authErrorMessage";

describe("authErrorMessage", () => {
  it("never exposes an internal server error", () => {
    const result = authErrorMessage(
      new Error("Server Error: Missing environment variable JWT_PRIVATE_KEY at requireEnv"),
      "pt",
      "signUp",
    );

    expect(result).toBe("Não foi possível criar a conta agora. Tente novamente.");
    expect(result).not.toContain("JWT_PRIVATE_KEY");
  });

  it("maps expected authentication failures", () => {
    expect(authErrorMessage(new Error("Invalid credentials"), "en", "signIn")).toBe(
      "Incorrect email or password.",
    );
    expect(authErrorMessage(new Error("Account already exists"), "pt", "signUp")).toContain(
      "Já existe uma conta",
    );
  });
});
