import { bytesToHex } from "../idempotency";

/**
 * Verify Meta webhook HMAC signature.
 * - rawBodyBytes MUST be the raw request body bytes (NOT JSON.parsed and
 *   re-stringified — JSON serialization may differ).
 * - signatureHeader is the X-Hub-Signature-256 header value, expected to
 *   start with "sha256=".
 * - Comparison uses constant-time equality to prevent timing attacks.
 */
export async function verifyMetaHmac(
  rawBodyBytes: Uint8Array,
  signatureHeader: string | null,
  appSecret: string,
): Promise<{ ok: boolean; bodySha256: string }> {
  const bodySha256 = bytesToHex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", rawBodyBytes as BufferSource),
    ),
  );

  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) {
    return { ok: false, bodySha256 };
  }
  const providedHex = signatureHeader.slice("sha256=".length);
  const provided = hexToBytes(providedHex);
  if (provided.length !== 32) return { ok: false, bodySha256 };

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const computedBuf = await crypto.subtle.sign(
    "HMAC",
    key,
    rawBodyBytes as BufferSource,
  );
  const computed = new Uint8Array(computedBuf);

  return { ok: constantTimeEqual(computed, provided), bodySha256 };
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) return new Uint8Array(0);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) return new Uint8Array(0);
    out[i] = byte;
  }
  return out;
}

export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
