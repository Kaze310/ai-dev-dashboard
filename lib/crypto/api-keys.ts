import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const ENVELOPE_VERSION = "v1";

/**
 * Reads the raw encryption secret from the environment.
 * Throws immediately if the variable is absent so misconfiguration
 * is caught at call time rather than silently producing a bad key.
 */
function getEncryptionSecret() {
  const secret = process.env.API_KEY_ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error("Missing required environment variable: API_KEY_ENCRYPTION_SECRET");
  }

  return secret;
}

/**
 * Derives the 32-byte AES-256 key by SHA-256 hashing the raw secret.
 * SHA-256 normalises any-length env var input to exactly 32 bytes,
 * which is the key size required by AES-256.
 */
function getKey() {
  return createHash("sha256").update(getEncryptionSecret()).digest();
}

/**
 * Encrypts a plaintext API key using AES-256-GCM.
 *
 * Returns a versioned envelope string:
 *   `v1:<iv_base64url>:<authTag_base64url>:<ciphertext_base64url>`
 *
 * A fresh 12-byte random IV is generated per call, so identical
 * plaintexts produce different ciphertexts (semantic security).
 * The 16-byte GCM auth tag authenticates the ciphertext — any
 * tampering causes decryption to throw rather than return corrupt data.
 */
export function encryptApiKey(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    ENVELOPE_VERSION,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

/**
 * Decrypts a ciphertext envelope produced by `encryptApiKey`.
 *
 * Throws if:
 * - the envelope format is invalid (wrong version or wrong segment count)
 * - the GCM auth tag verification fails (ciphertext was tampered with
 *   or the wrong key is in use, e.g. after a secret rotation)
 */
export function decryptApiKey(ciphertext: string): string {
  const parts = ciphertext.split(":");

  if (parts.length !== 4 || parts[0] !== ENVELOPE_VERSION) {
    throw new Error("Invalid encrypted API key format");
  }

  const [, ivEncoded, authTagEncoded, encryptedEncoded] = parts;
  const iv = Buffer.from(ivEncoded, "base64url");
  const authTag = Buffer.from(authTagEncoded, "base64url");
  const encrypted = Buffer.from(encryptedEncoded, "base64url");

  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}
