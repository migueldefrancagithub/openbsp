import { describe, it, expect } from "vitest";
import { verifyMetaHmac, hexToBytes, constantTimeEqual } from "../lib/meta/verify";

const SECRET = "test-app-secret";

async function signBody(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );
  return (
    "sha256=" +
    Array.from(new Uint8Array(sigBuf), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("")
  );
}

describe("verifyMetaHmac", () => {
  it("accepts a valid signature", async () => {
    const body = '{"object":"whatsapp_business_account","entry":[]}';
    const sig = await signBody(SECRET, body);
    const result = await verifyMetaHmac(
      new TextEncoder().encode(body),
      sig,
      SECRET,
    );
    expect(result.ok).toBe(true);
    expect(result.bodySha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects a tampered body", async () => {
    const body = '{"object":"whatsapp_business_account","entry":[]}';
    const sig = await signBody(SECRET, body);
    const tampered = body + " ";
    const result = await verifyMetaHmac(
      new TextEncoder().encode(tampered),
      sig,
      SECRET,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects when signature header is missing", async () => {
    const body = '{"x":1}';
    const result = await verifyMetaHmac(
      new TextEncoder().encode(body),
      null,
      SECRET,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects malformed signature header (no sha256= prefix)", async () => {
    const body = '{"x":1}';
    const result = await verifyMetaHmac(
      new TextEncoder().encode(body),
      "abc123",
      SECRET,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects wrong-length hex signature", async () => {
    const body = '{"x":1}';
    const result = await verifyMetaHmac(
      new TextEncoder().encode(body),
      "sha256=abcd",
      SECRET,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects when signed with a different secret", async () => {
    const body = '{"x":1}';
    const sig = await signBody("other-secret", body);
    const result = await verifyMetaHmac(
      new TextEncoder().encode(body),
      sig,
      SECRET,
    );
    expect(result.ok).toBe(false);
  });
});

describe("constantTimeEqual", () => {
  it("returns true for equal arrays", () => {
    expect(
      constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])),
    ).toBe(true);
  });
  it("returns false for unequal", () => {
    expect(
      constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4])),
    ).toBe(false);
  });
  it("returns false for different lengths", () => {
    expect(
      constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3])),
    ).toBe(false);
  });
});

describe("hexToBytes", () => {
  it("decodes valid hex", () => {
    expect(Array.from(hexToBytes("01ff"))).toEqual([1, 255]);
  });
  it("returns empty for odd-length hex", () => {
    expect(hexToBytes("abc").length).toBe(0);
  });
  it("returns empty for non-hex chars", () => {
    expect(hexToBytes("zz").length).toBe(0);
  });
});
