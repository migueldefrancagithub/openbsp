import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  encryptSecret,
  decryptSecret,
  generateMasterKeyBase64,
  bytesToBase64,
  base64ToBytes,
  getCurrentKeyVersion,
} from "../lib/meta/secrets";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  // Set a 32-byte all-zero key for deterministic tests (only the IV varies).
  const zeroKey = bytesToBase64(new Uint8Array(32));
  process.env.CONVEX_WABA_MASTER_KEY_V1 = zeroKey;
});

afterEach(() => {
  // Restore env
  for (const k of Object.keys(process.env)) {
    if (k.startsWith("CONVEX_WABA_MASTER_KEY_V")) delete process.env[k];
  }
  Object.assign(process.env, ORIGINAL_ENV);
});

describe("envelope encryption", () => {
  it("encrypts and decrypts a token round-trip", async () => {
    const plaintext = "EAABCDEF1234567890_long_test_token";
    const env = await encryptSecret(plaintext);
    expect(env.keyVersion).toBe(1);
    expect(env.iv).toBeTruthy();
    expect(env.ciphertext).toBeTruthy();
    expect(env.ciphertext).not.toContain(plaintext);
    const decrypted = await decryptSecret(env);
    expect(decrypted).toBe(plaintext);
  });

  it("uses fresh IV every encrypt (ciphertexts differ for same plaintext)", async () => {
    const a = await encryptSecret("same");
    const b = await encryptSecret("same");
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("decrypt fails when ciphertext tampered", async () => {
    const env = await encryptSecret("token");
    // flip a byte in the ciphertext
    const bytes = base64ToBytes(env.ciphertext);
    bytes[0] = bytes[0] ^ 0xff;
    const tampered = { ...env, ciphertext: bytesToBase64(bytes) };
    await expect(decryptSecret(tampered)).rejects.toThrow();
  });

  it("picks highest available key version on encrypt, decrypts at correct version", async () => {
    process.env.CONVEX_WABA_MASTER_KEY_V2 = bytesToBase64(
      new Uint8Array(32).fill(7),
    );
    expect(await getCurrentKeyVersion()).toBe(2);

    const env = await encryptSecret("multi-version");
    expect(env.keyVersion).toBe(2);

    // V1 row (encrypted earlier with V1 key) still decrypts when V2 is set.
    const v1Env = await (async () => {
      delete process.env.CONVEX_WABA_MASTER_KEY_V2;
      const e = await encryptSecret("legacy");
      process.env.CONVEX_WABA_MASTER_KEY_V2 = bytesToBase64(
        new Uint8Array(32).fill(7),
      );
      return e;
    })();
    expect(v1Env.keyVersion).toBe(1);
    expect(await decryptSecret(v1Env)).toBe("legacy");
  });

  it("throws if no master key env var is set", async () => {
    delete process.env.CONVEX_WABA_MASTER_KEY_V1;
    await expect(encryptSecret("x")).rejects.toThrow(/MASTER_KEY/);
  });

  it("generateMasterKeyBase64 returns a 32-byte key", async () => {
    const b64 = await generateMasterKeyBase64();
    const bytes = base64ToBytes(b64);
    expect(bytes.length).toBe(32);
  });
});
