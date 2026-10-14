import { spawn } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url).pathname;
const servers: http.Server[] = [];
afterEach(() => servers.splice(0).forEach((s) => s.close()));

const serve = async (handler: http.RequestListener): Promise<string> => {
  const s = http.createServer(handler);
  servers.push(s);
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
};

const secureHeaders = {
  "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
};

/** Korrekt konfigurierte SWA: health anonym, alles andere 302 → Login. */
const goodSwa: http.RequestListener = (req, res) => {
  if (req.url === "/api/health") {
    res
      .writeHead(200, { ...secureHeaders, "content-type": "application/json" })
      .end('{"status":"ok","version":"t"}');
  } else {
    res.writeHead(302, { ...secureHeaders, location: "/.auth/login/aad" }).end();
  }
};

const run = (args: string[]): Promise<{ code: number; out: string }> =>
  new Promise((resolve) => {
    const p = spawn("node", [join(root, "scripts/smoke-test.mjs"), ...args], {
      encoding: "utf8",
    } as never);
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => resolve({ code: code ?? -1, out }));
  });

describe("smoke-test.mjs", () => {
  it("passes for a correctly locked-down deployment", async () => {
    const swa = await serve(goodSwa);
    const fn = await serve((_req, res) => void res.writeHead(401).end());
    const r = await run(["--swa", swa, "--func", fn]);
    expect(r.out).toContain("Alle Prüfungen bestanden");
    expect(r.code).toBe(0);
  });

  it("fails loudly when the function app accepts a forged principal header", async () => {
    const swa = await serve(goodSwa);
    const fn = await serve((req, res) => {
      res.writeHead(req.headers["x-ms-client-principal"] ? 200 : 401).end("[]");
    });
    const r = await run(["--swa", swa, "--func", fn]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/FAIL\s+Function App direkt: gefälschter Principal/);
  });

  it("fails when the SWA exposes the api without login or lacks security headers", async () => {
    const open = await serve(
      (_req, res) =>
        void res.writeHead(200, { "content-type": "application/json" }).end('{"status":"ok"}'),
    );
    const r = await run(["--swa", open]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/FAIL\s+SWA: \/api\/audits ohne Anmeldung/);
    expect(r.out).toMatch(/FAIL\s+SWA: Sicherheits-Header/);
  });

  it("requires --swa", async () => {
    expect((await run([])).code).toBe(2);
  });
});
