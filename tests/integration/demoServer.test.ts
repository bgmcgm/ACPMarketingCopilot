import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuditReportDto, AuditStatusDto } from "@mcopilot/shared-types";
import { createDemoServer } from "../../apps/functions/src/dev/demoServer.js";
import type { FetchResult, PageFetcher } from "../../apps/functions/src/fetcher/safeFetcher.js";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../fixtures/good.html", import.meta.url), "utf8");
const fetcher: PageFetcher = {
  fetch: async (url): Promise<FetchResult> => ({
    finalUrl: url,
    redirectChain: [url],
    statusCode: 200,
    contentType: "text/html",
    html,
    bytes: html.length,
    durationMs: 1,
    fetchedAt: new Date().toISOString(),
  }),
};

let server: http.Server;
let base = "";
const webRoot = mkdtempSync(join(tmpdir(), "demo-web-"));
const quietLogger = { info() {}, warn() {}, error() {} };

beforeAll(async () => {
  writeFileSync(join(webRoot, "index.html"), "<html>SPA</html>");
  mkdirSync(join(webRoot, "assets"));
  writeFileSync(join(webRoot, "assets", "app.js"), "console.log(1)");
  server = createDemoServer({ fetcher, webRoot, logger: quietLogger });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => void server.close());

const api = async <T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> => {
  const res = await fetch(base + path, init);
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : undefined) as T };
};
const post = (url: string) =>
  api<{ id: string; status: string; error?: { code: string } }>("/api/audits", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
const waitDone = async (id: string): Promise<AuditStatusDto> => {
  for (let i = 0; i < 50; i++) {
    const { body } = await api<AuditStatusDto>(`/api/audits/${id}`);
    if (body.status === "completed" || body.status === "failed") return body;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error("Audit wurde nicht fertig");
};

describe("Demo-Server (gesamter Anwendungsstapel in einem Prozess)", () => {
  it("runs a full audit: create → queue → worker → report", async () => {
    const created = await post("https://example.com/landing");
    expect(created.status).toBe(202);
    const status = await waitDone(created.body.id);
    expect(status.status).toBe("completed");

    const report = (await api<AuditReportDto>(`/api/audits/${created.body.id}/report`)).body;
    expect(report.technical.findings.length).toBeGreaterThan(20);
    expect(report.score?.overall).toBeGreaterThan(60);
    expect(report.ai?.status).toBe("skipped"); // ohne Schlüssel keine KI, kein erfundenes Ergebnis
    expect(report.audit.finalUrl).toBe("https://example.com/landing");
  });

  it("lists, deletes and 404s like the real API", async () => {
    const { body } = await post("https://example.com/");
    await waitDone(body.id);
    const list = await api<{ items: { id: string }[] }>("/api/audits");
    expect(list.body.items.some((i) => i.id === body.id)).toBe(true);
    expect((await api(`/api/audits/${body.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await api(`/api/audits/${body.id}`)).status).toBe(404);
    expect((await api("/api/nope")).status).toBe(404);
  });

  it("applies the real URL validation (SSRF protection) in demo mode too", async () => {
    for (const url of ["http://127.0.0.1/", "file:///etc/passwd", "http://169.254.169.254/"]) {
      const r = await post(url);
      expect(r.status, url).toBe(400);
    }
  });

  it("exposes health, rulesets and the demo user", async () => {
    expect((await api<{ status: string }>("/api/health")).body.status).toBe("ok");
    expect((await api<{ rulesets: unknown[] }>("/api/rulesets")).body.rulesets).toHaveLength(1);
    const me = await api<{ clientPrincipal: { userId: string } }>("/.auth/me");
    expect(me.body.clientPrincipal.userId).toBe("demo-user");
  });

  it("serves the SPA and assets, with fallback to index.html – never files outside the web root", async () => {
    const get = (path: string): Promise<{ status: number; text: string }> =>
      new Promise((resolve, reject) => {
        // Roher Request, damit "../" nicht vom Client normalisiert wird.
        const req = http.request(
          { host: "127.0.0.1", port: new URL(base).port, path, method: "GET" },
          (res) => {
            let text = "";
            res.on("data", (c) => (text += c));
            res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
          },
        );
        req.on("error", reject);
        req.end();
      });
    expect((await get("/assets/app.js")).text).toContain("console.log");
    expect((await get("/audits/abc")).text).toContain("SPA");
    for (const evil of [
      "/../../../etc/passwd",
      "/..%2f..%2f..%2fetc%2fpasswd",
      "/%2e%2e/%2e%2e/etc/passwd",
    ]) {
      const r = await get(evil);
      expect(r.text, evil).not.toContain("root:");
    }
  });
});

describe("Demo-Server mit Passwortschutz (Betrieb für mehrere Personen)", () => {
  let secured: http.Server;
  let sbase = "";
  const PASSWORD = "ein-langes-geheimes-passwort";
  const auth = (user: string, pw = PASSWORD): Record<string, string> => ({
    authorization: `Basic ${Buffer.from(`${user}:${pw}`).toString("base64")}`,
  });

  beforeAll(async () => {
    secured = createDemoServer({ fetcher, webRoot, logger: quietLogger, password: PASSWORD });
    await new Promise<void>((r) => secured.listen(0, "127.0.0.1", r));
    sbase = `http://127.0.0.1:${(secured.address() as AddressInfo).port}`;
  });
  afterAll(() => void secured.close());

  const call = async (path: string, headers: Record<string, string>, init: RequestInit = {}) => {
    const res = await fetch(sbase + path, {
      ...init,
      headers: { ...headers, ...(init.headers as Record<string, string>) },
    });
    return { status: res.status, text: await res.text(), headers: res.headers };
  };

  it("verlangt Anmeldung für alles – ohne Browser-Anmeldefenster (kein WWW-Authenticate)", async () => {
    for (const path of ["/", "/api/audits", "/api/health", "/.auth/me", "/assets/app.js"]) {
      const r = await call(path, {});
      expect(r.status, path).toBe(401);
      expect(r.headers.get("www-authenticate")).toBeNull();
    }
  });

  it("weist falsche Passwörter und fehlerhafte Header ab", async () => {
    expect((await call("/api/audits", auth("anna", "falsch"))).status).toBe(401);
    expect((await call("/api/audits", auth("anna", ""))).status).toBe(401);
    expect((await call("/api/audits", { authorization: "Basic !!!" })).status).toBe(401);
    expect((await call("/api/audits", { authorization: "Bearer abc" })).status).toBe(401);
    expect((await call("/api/audits", auth("", PASSWORD))).status).toBe(401); // leerer Benutzername
  });

  it("trennt Benutzer: jede Person sieht nur eigene Audits", async () => {
    const created = await call(
      "/api/audits",
      { ...auth("anna"), "content-type": "application/json" },
      {
        method: "POST",
        body: JSON.stringify({ url: "https://example.com/" }),
      },
    );
    expect(created.status).toBe(202);
    const id = (JSON.parse(created.text) as { id: string }).id;

    expect((await call(`/api/audits/${id}`, auth("anna"))).status).toBe(200);
    expect((await call(`/api/audits/${id}`, auth("bernd"))).status).toBe(404);
    const bernd = JSON.parse((await call("/api/audits", auth("bernd"))).text) as {
      items: unknown[];
    };
    expect(bernd.items).toHaveLength(0);
    expect(
      JSON.parse((await call("/.auth/me", auth("Anna"))).text).clientPrincipal.userDetails,
    ).toBe("anna");
  });

  it("ignoriert einen mitgeschickten x-ms-client-principal-Header (keine Identitätsübernahme)", async () => {
    const forged = Buffer.from(
      JSON.stringify({ userId: "user:anna", userRoles: ["authenticated"] }),
    ).toString("base64");
    const created = await call(
      "/api/audits",
      { ...auth("anna"), "content-type": "application/json" },
      {
        method: "POST",
        body: JSON.stringify({ url: "https://example.com/" }),
      },
    );
    const id = (JSON.parse(created.text) as { id: string }).id;
    const r = await call(`/api/audits/${id}`, {
      ...auth("bernd"),
      "x-ms-client-principal": forged,
    });
    expect(r.status).toBe(404);
  });

  it("bereinigt Benutzernamen (keine Sonderzeichen, begrenzte Länge)", async () => {
    const { sanitizeUserName } = await import("../../apps/functions/src/dev/demoServer.js");
    expect(sanitizeUserName("Max.Muster@Firma.DE")).toBe("max.muster@firma.de");
    expect(sanitizeUserName('a/../b"<script>')).toBe("a..bscript");
    expect(sanitizeUserName("x".repeat(100))).toHaveLength(40);
  });
});

describe("Anmeldeseite und Sitzung (Pilotbetrieb)", () => {
  const PASSWORD = "ein-langes-geheimes-passwort";
  let srv: http.Server;
  let url = "";
  let clock = 1_000_000;

  beforeAll(async () => {
    srv = createDemoServer({
      fetcher,
      webRoot,
      logger: quietLogger,
      password: PASSWORD,
      now: () => clock,
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  });
  afterAll(() => void srv.close());

  const raw = (path: string, init: RequestInit = {}) =>
    fetch(url + path, { redirect: "manual", ...init });
  const login = (name: string, password: string) =>
    raw("/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ name, password }).toString(),
    });
  const cookieOf = (res: Response): string =>
    (res.headers.get("set-cookie") ?? "").split(";")[0] as string;

  it("leitet Browser-Aufrufe ohne Anmeldung zur Anmeldeseite um", async () => {
    for (const path of ["/", "/audits/abc", "/.auth/login/aad?post_login_redirect_uri=%2F"]) {
      const r = await raw(path, { headers: { accept: "text/html,application/xhtml+xml" } });
      expect(r.status, path).toBe(303);
      expect(r.headers.get("location")).toBe("/login");
    }
    // API-Aufrufe bekommen weiter 401 (kein Redirect auf HTML)
    expect((await raw("/api/audits", { headers: { accept: "text/html" } })).status).toBe(401);
  });

  it("zeigt die Anmeldeseite mit Formular und Schutz-Headern", async () => {
    const r = await raw("/login");
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain('name="name"');
    expect(html).toContain('type="password"');
    expect(r.headers.get("x-frame-options")).toBe("DENY");
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  it("meldet mit richtigem Passwort an: Cookie ist HttpOnly + SameSite=Strict, danach Zugriff", async () => {
    const r = await login("Anna", PASSWORD);
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/");
    const setCookie = r.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Strict/);
    expect(setCookie).not.toMatch(/Secure/); // reines HTTP intern
    expect(setCookie).not.toContain(PASSWORD);

    const me = await raw("/.auth/me", { headers: { cookie: cookieOf(r) } });
    expect(me.status).toBe(200);
    expect(
      ((await me.json()) as { clientPrincipal: { userDetails: string } }).clientPrincipal
        .userDetails,
    ).toBe("anna");
    const page = await raw("/", { headers: { cookie: cookieOf(r), accept: "text/html" } });
    expect(await page.text()).toContain("SPA");
    // Bereits angemeldet: Anmeldeseite leitet zur Startseite
    expect(
      (await raw("/login", { headers: { cookie: cookieOf(r) } })).headers.get("location"),
    ).toBe("/");
  });

  it("setzt Secure, wenn ein HTTPS-Proxy davor sitzt", async () => {
    const r = await raw("/login", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-forwarded-proto": "https",
      },
      body: new URLSearchParams({ name: "anna", password: PASSWORD }).toString(),
    });
    expect(r.headers.get("set-cookie")).toMatch(/Secure/);
  });

  it("weist falsche Zugangsdaten ab, ohne Cookie und ohne Passwort-Hinweis", async () => {
    for (const [n, p] of [
      ["anna", "falsch"],
      ["", PASSWORD],
      ["anna", ""],
    ] as const) {
      const r = await login(n, p);
      expect(r.status).toBe(401);
      expect(r.headers.get("set-cookie")).toBeNull();
      expect(await r.text()).toContain("Name oder Passwort falsch.");
    }
  });

  it("lehnt manipulierte und fremd signierte Cookies ab", async () => {
    const good = cookieOf(await login("anna", PASSWORD));
    const [name, token] = good.split("=") as [string, string];
    const [payload, sig] = token.split(".") as [string, string];
    const evilPayload = Buffer.from(JSON.stringify({ u: "bernd", exp: clock + 1e9 })).toString(
      "base64url",
    );
    for (const forged of [
      `${evilPayload}.${sig}`,
      `${payload}.${sig.slice(0, -2)}xx`,
      "abc",
      `${payload}`,
      "",
    ]) {
      const r = await raw("/.auth/me", { headers: { cookie: `${name}=${forged}` } });
      expect(r.status, forged).toBe(401);
    }
  });

  it("lässt Sitzungen nach 12 Stunden ablaufen", async () => {
    const cookie = cookieOf(await login("anna", PASSWORD));
    expect((await raw("/.auth/me", { headers: { cookie } })).status).toBe(200);
    clock += 12 * 60 * 60 * 1000 + 1;
    expect((await raw("/.auth/me", { headers: { cookie } })).status).toBe(401);
  });

  it("meldet ab und löscht das Cookie", async () => {
    const r = await raw("/.auth/logout");
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/login");
    expect(r.headers.get("set-cookie")).toMatch(/Max-Age=0/);
  });

  it("bremst Passwort-Raten: nach 10 Fehlversuchen 429, nach Ablauf des Fensters wieder möglich", async () => {
    clock += 10 * 60_000; // sauberer Start des Zeitfensters
    for (let i = 0; i < 10; i++) expect((await login("x", "falsch")).status).toBe(401);
    expect((await login("x", "falsch")).status).toBe(429);
    expect((await login("anna", PASSWORD)).status).toBe(429); // auch das richtige Passwort wird während der Sperre abgewiesen
    clock += 5 * 60_000 + 1;
    expect((await login("anna", PASSWORD)).status).toBe(303);
  });

  it("HTML in Namen wird nirgends ausgeführt (Name wird bereinigt)", async () => {
    const r = await login("<img src=x onerror=alert(1)>", PASSWORD);
    expect(r.status).toBe(303);
    const me = await raw("/.auth/me", { headers: { cookie: cookieOf(r) } });
    const name = ((await me.json()) as { clientPrincipal: { userDetails: string } }).clientPrincipal
      .userDetails;
    expect(name).not.toMatch(/[<>"' =]/);
  });
});
