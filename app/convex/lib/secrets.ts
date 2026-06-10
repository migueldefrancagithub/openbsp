const PRIMARY_KEY_VERSION = 1;

type SecretKeyStatus =
  | { configured: true; keyVersion: number }
  | { configured: false; reason: "missing" | "invalid"; message: string };

function keyEnvNames(keyVersion: number): string[] {
  return [
    `WABA_TOKEN_ENCRYPTION_KEY_V${keyVersion}`,
    keyVersion === 1 ? "WABA_TOKEN_ENCRYPTION_KEY" : "",
    `OPENBSP_SECRET_KEY_V${keyVersion}`,
  ].filter(Boolean);
}

function readKeyMaterial(keyVersion: number): string | null {
  for (const name of keyEnvNames(keyVersion)) {
    const value = process.env[name];
    if (value?.trim()) return value.trim();
  }
  return null;
}

export function getSecretEncryptionStatus(): SecretKeyStatus {
  const material = readKeyMaterial(PRIMARY_KEY_VERSION);
  if (!material) {
    return {
      configured: false,
      reason: "missing",
      message:
        "Set WABA_TOKEN_ENCRYPTION_KEY_V1 to a 32-byte hex or base64 key.",
    };
  }
  try {
    parseKeyMaterial(material);
    return { configured: true, keyVersion: PRIMARY_KEY_VERSION };
  } catch (error) {
    return {
      configured: false,
      reason: "invalid",
      message:
        error instanceof Error
          ? error.message
          : "Invalid WABA token encryption key.",
    };
  }
}

export function isSecretEncryptionConfigured(): boolean {
  return getSecretEncryptionStatus().configured;
}

export function allowPlaintextSecretStorageForTests(): boolean {
  return (
    process.env.NODE_ENV === "test" ||
    process.env.VITEST === "true" ||
    process.env.CONVEX_TEST === "true"
  );
}

export async function encryptSecret(
  plaintext: string,
): Promise<{ ciphertext: string; keyVersion: number; encryptedAt: number }> {
  const keyVersion = PRIMARY_KEY_VERSION;
  const key = await importSecretKey(keyVersion, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded),
  );
  return {
    ciphertext: `aes256gcm:v1:${toBase64Url(iv)}:${toBase64Url(encrypted)}`,
    keyVersion,
    encryptedAt: Date.now(),
  };
}

export async function decryptSecret(
  ciphertext: string,
  keyVersion = PRIMARY_KEY_VERSION,
): Promise<string> {
  const [, formatVersion, ivPart, encryptedPart] = ciphertext.split(":");
  if (!ciphertext.startsWith("aes256gcm:") || formatVersion !== "v1") {
    throw new Error("Unsupported secret ciphertext format.");
  }
  if (!ivPart || !encryptedPart) {
    throw new Error("Malformed secret ciphertext.");
  }
  const key = await importSecretKey(keyVersion, ["decrypt"]);
  const iv = fromBase64Url(ivPart);
  const encrypted = fromBase64Url(encryptedPart);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(encrypted),
  );
  return new TextDecoder().decode(decrypted);
}

async function importSecretKey(
  keyVersion: number,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  const material = readKeyMaterial(keyVersion);
  if (!material) {
    throw new Error(
      `Missing ${keyEnvNames(keyVersion).join(" or ")} for secret encryption.`,
    );
  }
  const bytes = parseKeyMaterial(material);
  return await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(bytes),
    "AES-GCM",
    false,
    usages,
  );
}

function parseKeyMaterial(raw: string): Uint8Array {
  const material = raw.replace(/^base64:/, "").trim();
  if (/^[0-9a-f]{64}$/i.test(material)) {
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      bytes[i] = Number.parseInt(material.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }

  const bytes = fromBase64Url(material);
  if (bytes.byteLength !== 32) {
    throw new Error(
      "WABA token encryption key must decode to exactly 32 bytes.",
    );
  }
  return bytes;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}
