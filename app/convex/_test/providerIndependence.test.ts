// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const coreFiles = [
  ".env.example",
  "convex/messages.ts",
  "convex/schema.ts",
  "convex/whatsappAccounts.ts",
];

const removedGatewayMarkers = [
  "leoHub",
  "leo_hub",
  "LEO_HUB",
  "apihub.iasolution.app",
];

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("provider independence", () => {
  it("keeps the OpenBSP core free of the removed gateway", () => {
    for (const file of coreFiles) {
      const content = source(file);
      for (const marker of removedGatewayMarkers) {
        expect(content, `${file} contains ${marker}`).not.toContain(marker);
      }
    }
  });

  it("dispatches WhatsApp messages through the official Meta transport", () => {
    const messages = source("convex/messages.ts");

    expect(messages).toContain("sendWhatsAppText");
    expect(messages).toContain("sendWhatsAppTemplate");
    expect(messages).toContain("sendWhatsAppMarketingTemplate");
    expect(messages).toContain("sendWhatsAppInteractive");
  });

  it("checks channel credentials through Meta token introspection", () => {
    const accounts = source("convex/whatsappAccounts.ts");

    expect(accounts).toContain("debugToken");
    expect(accounts).toContain("REQUIRED_SCOPES");
  });
});
