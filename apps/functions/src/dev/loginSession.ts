/**
 * Anmeldung für den Pilotbetrieb (Demo-Modus mit DEMO_PASSWORD): signiertes Sitzungs-Cookie,
 * Anmeldeseite und Schutz gegen Passwort-Raten. NICHT Teil des Produktionspfads (dort: Entra ID).
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "mc_session";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export class SessionSigner {
  constructor(
    private readonly secret: Buffer = randomBytes(32),
    private readonly now: () => number = Date.now,
  ) {}

  issue(userName: string): string {
    const payload = Buffer.from(
      JSON.stringify({ u: userName, exp: this.now() + SESSION_TTL_MS }),
    ).toString("base64url");
    return `${payload}.${this.sign(payload)}`;
  }

  /** @returns den Benutzernamen oder null (fehlt, manipuliert, abgelaufen). */
  verify(token: string | undefined): string | null {
    if (!token) return null;
    const dot = token.indexOf(".");
    if (dot < 1) return null;
    const payload = token.slice(0, dot);
    const given = Buffer.from(token.slice(dot + 1));
    const expected = Buffer.from(this.sign(payload));
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    try {
      const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
        u?: unknown;
        exp?: unknown;
      };
      if (
        typeof data.u !== "string" ||
        !data.u ||
        typeof data.exp !== "number" ||
        data.exp <= this.now()
      )
        return null;
      return data.u;
    } catch {
      return null;
    }
  }

  private sign(payload: string): string {
    return createHmac("sha256", this.secret).update(payload).digest("base64url");
  }
}

export function parseCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0 && part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return undefined;
}

/** Sperrt eine Adresse nach zu vielen Fehlversuchen kurzzeitig (Schutz gegen Passwort-Raten). */
export class LoginRateLimiter {
  private readonly failures = new Map<string, { count: number; since: number }>();
  constructor(
    private readonly max = 10,
    private readonly windowMs = 5 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  blocked(key: string): boolean {
    const f = this.failures.get(key);
    if (!f) return false;
    if (this.now() - f.since >= this.windowMs) {
      this.failures.delete(key);
      return false;
    }
    return f.count >= this.max;
  }
  fail(key: string): void {
    const f = this.failures.get(key);
    if (!f || this.now() - f.since >= this.windowMs)
      this.failures.set(key, { count: 1, since: this.now() });
    else f.count++;
  }
  reset(key: string): void {
    this.failures.delete(key);
  }
}

const esc = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );

export function loginPage(message?: string): string {
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Anmelden – Marketing Copilot</title>
<style>
body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f8fafc;color:#0f172a;display:flex;min-height:100vh;align-items:center;justify-content:center}
form{background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:28px;width:min(360px,90vw)}
h1{font-size:20px;margin:0 0 4px}p{margin:0 0 18px;font-size:14px;color:#475569}
label{display:block;font-size:14px;font-weight:600;margin:12px 0 4px}
input{box-sizing:border-box;width:100%;padding:9px 10px;border:1px solid #cbd5e1;border-radius:4px;font-size:15px}
button{margin-top:20px;width:100%;padding:10px;background:#0f172a;color:#fff;border:0;border-radius:4px;font-size:15px;font-weight:600;cursor:pointer}
.err{background:#fef2f2;color:#991b1b;padding:8px 10px;border-radius:4px;font-size:14px;margin-bottom:8px}
</style></head><body>
<form method="post" action="/login">
<h1>Marketing Copilot</h1><p>Bitte anmelden.</p>
${message ? `<div class="err" role="alert">${esc(message)}</div>` : ""}
<label for="name">Name</label><input id="name" name="name" autocomplete="username" autofocus required maxlength="60">
<label for="password">Passwort</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="200">
<button type="submit">Anmelden</button>
</form></body></html>`;
}
