import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decryptToken,
  encryptToken,
  TokenCipherError,
} from "../../apps/functions/src/lib/tokenCipher.js";

const key = () => randomBytes(32).toString("base64");

describe("tokenCipher", () => {
  it("round-trips a plaintext token", () => {
    const k = key();
    const encrypted = encryptToken("1//0g-refresh-token-value", k);
    expect(encrypted).not.toContain("1//0g-refresh-token-value");
    expect(decryptToken(encrypted, k)).toBe("1//0g-refresh-token-value");
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const k = key();
    expect(encryptToken("same-token", k)).not.toBe(encryptToken("same-token", k));
  });

  it("fails to decrypt with the wrong key", () => {
    const encrypted = encryptToken("secret", key());
    expect(() => decryptToken(encrypted, key())).toThrow(TokenCipherError);
  });

  it("fails to decrypt a tampered value", () => {
    const encrypted = encryptToken("secret", key());
    const raw = Buffer.from(encrypted, "base64");
    raw[raw.length - 1] = (raw[raw.length - 1]! ^ 0xff) & 0xff;
    expect(() => decryptToken(raw.toString("base64"), key())).toThrow(TokenCipherError);
  });

  it("rejects keys that are not 32 bytes", () => {
    expect(() => encryptToken("secret", Buffer.from("too-short").toString("base64"))).toThrow(
      TokenCipherError,
    );
  });

  it("rejects a too-short encoded value on decrypt", () => {
    expect(() => decryptToken(Buffer.from("x").toString("base64"), key())).toThrow(
      TokenCipherError,
    );
  });
});
