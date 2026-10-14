import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url).pathname;
const read = (p: string): string => readFileSync(join(root, p), "utf8");
const TENANT = "11111111-2222-3333-4444-555555555555";

const run = (file: string, tenant?: string) =>
  spawnSync(
    "node",
    [join(root, "scripts/prepare-swa-config.mjs"), file, ...(tenant ? [tenant] : [])],
    {
      encoding: "utf8",
    },
  );

const tempConfig = (content = read("apps/web/public/staticwebapp.config.json")): string => {
  const f = join(mkdtempSync(join(tmpdir(), "swa-")), "staticwebapp.config.json");
  writeFileSync(f, content);
  return f;
};

describe("prepare-swa-config", () => {
  it("replaces the tenant placeholder and keeps valid JSON", () => {
    const f = tempConfig();
    expect(run(f, TENANT).status).toBe(0);
    const out = readFileSync(f, "utf8");
    expect(out).not.toContain("__TENANT_ID__");
    const json = JSON.parse(out);
    expect(
      json.auth.identityProviders.customOpenIdConnectProviders.aad.registration
        .openIdConnectConfiguration.wellKnownOpenIdConfiguration,
    ).toBe(`https://login.microsoftonline.com/${TENANT}/v2.0/.well-known/openid-configuration`);
  });

  it.each([
    "",
    "not-a-guid",
    "11111111-2222-3333-4444-55555555555",
    `${TENANT}/../x`,
    '"; rm -rf /',
  ])("rejects invalid tenant id %j", (tenant) => {
    const f = tempConfig();
    const before = readFileSync(f, "utf8");
    expect(run(f, tenant || undefined).status).toBe(1);
    expect(readFileSync(f, "utf8")).toBe(before);
  });

  it("fails if the placeholder is missing (unexpected config)", () => {
    expect(run(tempConfig('{"routes":[]}'), TENANT).status).toBe(1);
  });
});

describe("staticwebapp.config.json (Sicherheitsgrundlagen)", () => {
  const cfg = JSON.parse(read("apps/web/public/staticwebapp.config.json"));

  it("requires authentication for the api and the app, except the anonymous health check", () => {
    const routes: { route: string; allowedRoles?: string[] }[] = cfg.routes;
    expect(routes.find((r) => r.route === "/api/health")?.allowedRoles).toEqual(["anonymous"]);
    expect(routes.find((r) => r.route === "/api/*")?.allowedRoles).toEqual(["authenticated"]);
    expect(routes.find((r) => r.route === "/*")?.allowedRoles).toEqual(["authenticated"]);
    // health muss vor dem Wildcard stehen (erste passende Route gewinnt)
    expect(routes.findIndex((r) => r.route === "/api/health")).toBeLessThan(
      routes.findIndex((r) => r.route === "/api/*"),
    );
  });

  it("keeps the secret out of the config and sets hardening headers", () => {
    const text = JSON.stringify(cfg);
    expect(text).toContain("AAD_CLIENT_SECRET"); // nur der Name der App-Einstellung
    expect(cfg.globalHeaders["Content-Security-Policy"]).toMatch(/frame-ancestors 'none'/);
    expect(cfg.globalHeaders["X-Content-Type-Options"]).toBe("nosniff");
  });
});

describe("workflows", () => {
  const deploy = read(".github/workflows/deploy.yml");

  it("uses OIDC (no stored Azure credentials)", () => {
    expect(deploy).toMatch(/uses: azure\/login@v2/);
    expect(deploy).toMatch(/id-token: write/);
    expect(deploy).not.toMatch(/creds:|client-secret:|AZURE_CREDENTIALS/);
  });

  it("runs the deploy job inside the GitHub environment (approval gate for prod)", () => {
    expect(deploy).toMatch(/environment: \$\{\{ inputs\.environment \}\}/);
    expect(read(".github/workflows/deploy-prod.yml")).toMatch(/environment: prod/);
    expect(read(".github/workflows/deploy-prod.yml")).not.toMatch(/branches:/); // nie automatisch auf Branch-Push
  });

  it("deploys dev automatically from main only", () => {
    const dev = read(".github/workflows/deploy-dev.yml");
    expect(dev).toMatch(/branches: \[main\]/);
    expect(dev).toMatch(/environment: dev/);
  });

  it("never echoes secrets and masks the deployment token", () => {
    expect(deploy).toMatch(/::add-mask::/);
    expect(deploy).not.toMatch(/echo .*\$\{?AAD_CLIENT_SECRET/); // nur der Name im Fehlertext ist ok, nie der Wert
  });
});
