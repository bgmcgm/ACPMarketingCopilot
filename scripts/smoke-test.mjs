#!/usr/bin/env node
// Post-Deploy-Prüfung der Sicherheitsannahmen (docs/runbook.md, Abschnitt 6).
// Aufruf: node scripts/smoke-test.mjs --swa https://<swa-host> [--func https://<func-host>]
// Exit-Code 1, sobald eine Prüfung fehlschlägt. Es werden keine Zugangsdaten benötigt.
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { swa: { type: "string" }, func: { type: "string" } } });
if (!values.swa) {
  console.error("Aufruf: smoke-test.mjs --swa https://<host> [--func https://<host>]");
  process.exit(2);
}
const swa = values.swa.replace(/\/$/, "");
const fn = values.func?.replace(/\/$/, "");

// Gefälschter SWA-Principal: Wenn die Function App direkt erreichbar ist, darf dieser Header NIE ausreichen.
const forged = Buffer.from(
  JSON.stringify({
    identityProvider: "aad",
    userId: "smoke-test-attacker",
    userDetails: "x",
    userRoles: ["anonymous", "authenticated"],
  }),
).toString("base64");

const get = (url, headers = {}) =>
  fetch(url, { redirect: "manual", headers, signal: AbortSignal.timeout(20_000) });
const results = [];
const check = async (name, fnCheck) => {
  try {
    const detail = await fnCheck();
    results.push({ name, ok: true, detail });
  } catch (err) {
    results.push({ name, ok: false, detail: err instanceof Error ? err.message : String(err) });
  }
};
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const isDenied = (res) => [301, 302, 303, 307, 308, 401, 403, 404].includes(res.status);

await check("SWA: /api/health anonym erreichbar und gesund", async () => {
  const res = await get(`${swa}/api/health`);
  const body = await res.json().catch(() => ({}));
  expect(
    res.status === 200 && body.status === "ok",
    `HTTP ${res.status}, Body ${JSON.stringify(body)}`,
  );
  return `HTTP 200, Version ${body.version}`;
});

await check("SWA: /api/audits ohne Anmeldung abgewiesen", async () => {
  const res = await get(`${swa}/api/audits`);
  expect(isDenied(res), `HTTP ${res.status} – API ohne Login erreichbar!`);
  return `HTTP ${res.status}`;
});

await check("SWA: gefälschter Principal-Header wird von der SWA nicht akzeptiert", async () => {
  const res = await get(`${swa}/api/audits`, { "x-ms-client-principal": forged });
  expect(isDenied(res), `HTTP ${res.status} – Header-Fälschung über die SWA möglich!`);
  return `HTTP ${res.status}`;
});

await check("SWA: Startseite ohne Anmeldung nicht ausgeliefert", async () => {
  const res = await get(`${swa}/`);
  expect(isDenied(res), `HTTP ${res.status}`);
  return `HTTP ${res.status}`;
});

await check("SWA: Sicherheits-Header vorhanden", async () => {
  const res = await get(`${swa}/api/health`);
  const csp = res.headers.get("content-security-policy") ?? "";
  expect(
    /frame-ancestors 'none'/.test(csp),
    "Content-Security-Policy fehlt oder ohne frame-ancestors",
  );
  expect(res.headers.get("x-content-type-options") === "nosniff", "X-Content-Type-Options fehlt");
  return "CSP, nosniff";
});

if (fn) {
  await check(
    "Function App direkt: gefälschter Principal darf NICHT funktionieren (kritisch)",
    async () => {
      const res = await get(`${fn}/api/audits`, { "x-ms-client-principal": forged });
      expect(
        res.status !== 200,
        "HTTP 200 – Function App direkt erreichbar, Header fälschbar! Zugriff auf die SWA beschränken.",
      );
      return `HTTP ${res.status}`;
    },
  );
  await check("Function App direkt: ohne Header abgewiesen", async () => {
    const res = await get(`${fn}/api/audits`);
    expect([401, 403, 404].includes(res.status), `HTTP ${res.status}`);
    return `HTTP ${res.status}`;
  });
}

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}  –  ${r.detail}`);
}
console.log(
  failed === 0 ? "\nAlle Prüfungen bestanden." : `\n${failed} Prüfung(en) fehlgeschlagen.`,
);
process.exit(failed === 0 ? 0 : 1);
