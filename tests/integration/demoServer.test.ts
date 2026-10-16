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
