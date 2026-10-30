import { createHmac, timingSafeEqual } from "node:crypto";

export interface OAuthStatePayload {
  clientId: string;
  ownerId: string;
}

const DEFAULT_TTL_MS = 10 * 60 * 1000;

export class OAuthStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OAuthStateError";
  }
}

const hmac = (data: string, secret: string): string =>
  createHmac("sha256", secret).update(data).digest("base64url");

/** Signiertes `state` für den Google-OAuth-Redirect: base64url(payload+timestamp).hmac */
export function signState(
  payload: OAuthStatePayload,
  secret: string,
  now: () => Date = () => new Date(),
): string {
  const body = JSON.stringify({ ...payload, ts: now().getTime() });
  const encoded = Buffer.from(body, "utf8").toString("base64url");
  return `${encoded}.${hmac(encoded, secret)}`;
}

/** Wirft `OAuthStateError` bei ungültiger Signatur oder abgelaufenem State (CSRF-/Replay-Schutz). */
export function verifyState(
  state: string,
  secret: string,
  opts: { now?: () => Date; ttlMs?: number } = {},
): OAuthStatePayload {
  const now = opts.now ?? (() => new Date());
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const parts = state.split(".");
  if (parts.length !== 2) throw new OAuthStateError("Ungültiges state-Format.");
  const [encoded, signature] = parts as [string, string];

  const expected = hmac(encoded, secret);
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signature);
  if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
    throw new OAuthStateError("state-Signatur ungültig.");
  }

  let parsed: { clientId: unknown; ownerId: unknown; ts: unknown };
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new OAuthStateError("state konnte nicht gelesen werden.");
  }
  if (
    typeof parsed.clientId !== "string" ||
    typeof parsed.ownerId !== "string" ||
    typeof parsed.ts !== "number"
  ) {
    throw new OAuthStateError("state hat unerwartete Form.");
  }
  if (now().getTime() - parsed.ts > ttlMs) {
    throw new OAuthStateError("state ist abgelaufen.");
  }
  return { clientId: parsed.clientId, ownerId: parsed.ownerId };
}
