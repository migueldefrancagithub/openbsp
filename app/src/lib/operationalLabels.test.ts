import { describe, expect, it } from "vitest";
import {
  channelStateLabel,
  roleLabel,
  sendModeLabel,
  signupStateLabel,
  templateCategoryLabel,
  tokenStateLabel,
  verticalLabel,
} from "./operationalLabels";

describe("operational labels", () => {
  it("localizes workspace identity instead of exposing enum codes", () => {
    expect(roleLabel("owner", "pt")).toBe("Proprietário");
    expect(roleLabel("owner", "en")).toBe("Owner");
    expect(verticalLabel("clinic", "pt")).toBe("Clínica");
    expect(verticalLabel("clinic", "en")).toBe("Clinic");
  });

  it("localizes channel states and send safety", () => {
    expect(channelStateLabel("pending_number", "pt")).toBe("Aguardando número");
    expect(channelStateLabel("pending_number", "en")).toBe("Waiting for number");
    expect(sendModeLabel("disabled", "pt")).toBe("Envios desativados");
    expect(sendModeLabel("allowlist", "en")).toBe("Allowlist only");
  });

  it("localizes token storage and humanizes unknown values", () => {
    expect(tokenStateLabel("legacy_plaintext", "pt")).toBe("Legado sem encriptação");
    expect(channelStateLabel("provider_review", "en")).toBe("Provider review");
  });

  it("localizes signup states and template categories", () => {
    expect(signupStateLabel("callback_received", "pt")).toBe("Retorno recebido");
    expect(signupStateLabel("connected", "en")).toBe("Connected");
    expect(templateCategoryLabel("utility", "pt")).toBe("Utilidade");
    expect(templateCategoryLabel("authentication", "en")).toBe("Authentication");
  });
});
