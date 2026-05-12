/**
 * Envelope encryption for WABA system user tokens.
 *
 * Master key is held in env var CONVEX_WABA_MASTER_KEY_V<N> as base64 of
 * 32 bytes (AES-256). Rotation: add V<N+1>, run a cron to re-encrypt rows
 * with old keyVersion to new, then remove old env. Decryption picks the key
 * by row.keyVersion.
 *
 * Each encryption uses a fresh random 96-bit IV. Output is base64 to fit
 * in v.string() schema fields.
 */

const KEY_LENGTH_BYTES = 32; // AES-256
const IV_LENGTH_BYTES = 12; // 96-bit GCM

export type Ciphertext = {
  ciphertext: string; // base64
  iv: string; // base64
  keyVersion: number;
};

/**
 * Resolve a master key by version from env. Throws if not set or wrong size.
 */
async function loadMasterKey(version: number): Promise<CryptoKey> {
  const envName = `CONVEX_WABA_MASTER_KEY_V${version}`;
  const raw = process.env[envName];
  if (!raw) {
    throw new Error(`master key not found: ${envName}`);
  }
  const bytes = base64ToBytes(raw);
  if (bytes.length !== KEY_LENGTH_BYTES) {
    throw new Error(
      `master key ${envName} wrong size: expected ${KEY_LENGTH_BYTES}, got ${bytes.length}`,
    );
  }
  return await crypto.subtle.importKey(
    "raw",
    bytes as BufferSource,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Get the current (highest available) key version. We try V1, V2, ... up to
 * V8 — picks the highest one that resolves. Encrypt always uses the highest
 * (latest) key.
 */
export async function getCurrentKeyVersion(): Promise<number> {
  for (let v = 8; v >= 1; v--) {
    if (process.env[`CONVEX_WABA_MASTER_KEY_V${v}`]) return v;
  }
  throw new Error(
    "no CONVEX_WABA_MASTER_KEY_V<N> env var set; refusing to encrypt secrets",
  );
}

export async function encryptSecret(plaintext: string): Promise<Ciphertext> {
  const keyVersion = await getCurrentKeyVersion();
  const key = await loadMasterKey(keyVersion);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  const ptBytes = new TextEncoder().encode(plaintext);
  const ctBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    ptBytes as BufferSource,
  );
  return {
    ciphertext: bytesToBase64(new Uint8Array(ctBuf)),
    iv: bytesToBase64(iv),
    keyVersion,
  };
}

export async function decryptSecret(envelope: Ciphertext): Promise<string> {
  const key = await loadMasterKey(envelope.keyVersion);
  const ct = base64ToBytes(envelope.ciphertext);
  const iv = base64ToBytes(envelope.iv);
  const ptBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    ct as BufferSource,
  );
  return new TextDecoder().decode(ptBuf);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Generate a fresh AES-256 master key as base64. Use for bootstrapping a
 * new env / rotation: run once, paste the output into env vars.
 *
 * NOT exposed via any function — call from a one-off script. Documented
 * here so it's discoverable in the same module.
 */
export async function generateMasterKeyBase64(): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(KEY_LENGTH_BYTES));
  return bytesToBase64(bytes);
}
