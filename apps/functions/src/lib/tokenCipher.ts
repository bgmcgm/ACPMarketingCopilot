import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32;

export class TokenCipherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenCipherError";
  }
}

function keyFromBase64(keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== KEY_BYTES) {
    throw new TokenCipherError(
      `TOKEN_ENCRYPTION_KEY muss ${KEY_BYTES} Byte (Base64-kodiert) sein, war ${key.length}.`,
    );
  }
  return key;
}

/**
 * Verschlüsselt ein Geheimnis (z. B. OAuth-Refresh-Token) vor dem Schreiben nach Cosmos.
 * AES-256-GCM; Ausgabe = Base64(iv ‖ authTag ‖ ciphertext). Siehe ARCHITECTURE.md B7.
 */
export function encryptToken(plaintext: string, keyBase64: string): string {
  const key = keyFromBase64(keyBase64);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

/** Wirft `TokenCipherError` bei falschem Schlüssel oder manipuliertem/beschädigtem Wert. */
export function decryptToken(encoded: string, keyBase64: string): string {
  const key = keyFromBase64(keyBase64);
  const raw = Buffer.from(encoded, "base64");
  if (raw.length < IV_BYTES + AUTH_TAG_BYTES) {
    throw new TokenCipherError("Verschlüsselter Wert ist zu kurz.");
  }
  const iv = raw.subarray(0, IV_BYTES);
  const authTag = raw.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
  const ciphertext = raw.subarray(IV_BYTES + AUTH_TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new TokenCipherError(
      "Entschlüsselung fehlgeschlagen (falscher Schlüssel oder beschädigter Wert).",
    );
  }
}
