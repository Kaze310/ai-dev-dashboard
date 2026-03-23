import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const ENVELOPE_VERSION = "v1";

function getEncryptionSecret() {
  const secret = process.env.API_KEY_ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error("Missing required environment variable: API_KEY_ENCRYPTION_SECRET");
  }

  return secret;
}

function getKey() {
  return createHash("sha256").update(getEncryptionSecret()).digest();
}

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
