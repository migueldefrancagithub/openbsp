import { describe, it, expect } from "vitest";
import { deriveEventKey, sha256Hex } from "../lib/idempotency";

describe("deriveEventKey", () => {
  it("produces stable key for incoming message regardless of timestamp", () => {
    const k1 = deriveEventKey({
      kind: "msg",
      phoneNumberId: "123",
      wamid: "wamid.abc",
    });
    const k2 = deriveEventKey({
      kind: "msg",
      phoneNumberId: "123",
      wamid: "wamid.abc",
    });
    expect(k1).toBe(k2);
    expect(k1).toBe("msg:123:wamid.abc");
  });

  it("produces distinct keys per status value (sent vs delivered vs read)", () => {
    const sent = deriveEventKey({
      kind: "status",
      phoneNumberId: "123",
      wamid: "wamid.abc",
      statusValue: "sent",
    });
    const delivered = deriveEventKey({
      kind: "status",
      phoneNumberId: "123",
      wamid: "wamid.abc",
      statusValue: "delivered",
    });
    const read = deriveEventKey({
      kind: "status",
      phoneNumberId: "123",
      wamid: "wamid.abc",
      statusValue: "read",
    });
    expect(new Set([sent, delivered, read]).size).toBe(3);
  });

  it("throws on missing required fields", () => {
    expect(() => deriveEventKey({ kind: "msg" })).toThrow();
    expect(() =>
      deriveEventKey({ kind: "status", phoneNumberId: "1", wamid: "w" }),
    ).toThrow();
  });
});

describe("sha256Hex", () => {
  it("computes correct SHA-256 hex digest", async () => {
    const h = await sha256Hex("hello");
    expect(h).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });
  it("is stable", async () => {
    const a = await sha256Hex("test payload");
    const b = await sha256Hex("test payload");
    expect(a).toBe(b);
  });
});
