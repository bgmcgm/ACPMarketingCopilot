import { describe, expect, it } from "vitest";
import { AuthError, parsePrincipal } from "../../apps/functions/src/auth/principal.js";
import { loadConfig } from "../../apps/functions/src/config/config.js";
import { principalHeader } from "./helpers.js";

const base = {
  COSMOS_ENDPOINT: "https://c.documents.azure.com:443/",
  STORAGE_QUEUE_ACCOUNT_NAME: "stacct",
  AI_MODEL: "model-x",
  ANTHROPIC_API_KEY: "key",
};

describe("parsePrincipal", () => {
  it("parses a valid SWA principal", () => {
    expect(parsePrincipal(principalHeader("u1"))).toMatchObject({
      userId: "u1",
      identityProvider: "aad",
    });
  });
  it.each([
    undefined,
    null,
    "",
    "!!!notbase64json",
    Buffer.from("[]").toString("base64"),
    Buffer.from("null").toString("base64"),
  ])("rejects %s", (h) => {
    expect(() => parsePrincipal(h as string | null | undefined)).toThrow(AuthError);
  });
  it("rejects principals without userId or authenticated role", () => {
    expect(() => parsePrincipal(principalHeader("", ["authenticated"]))).toThrow(AuthError);
    expect(() => parsePrincipal(principalHeader("u1", ["anonymous"]))).toThrow(AuthError);
  });
});

describe("loadConfig", () => {
  it("applies defaults", () => {
    const c = loadConfig(base);
    expect(c.cosmos).toEqual({
      endpoint: base.COSMOS_ENDPOINT,
      database: "marketingcopilot",
      container: "audits",
    });
    expect(c.queue.queueName).toBe("audit-jobs");
    expect(c.fetch).toMatchObject({
      timeoutMs: 10000,
      maxBytes: 2097152,
      maxRedirects: 5,
      allowedPorts: [80, 443],
      domainAllowlist: [],
    });
    expect(c.auditTtlSeconds).toBe(90 * 86400);
    expect(c.quotas).toEqual({ maxActive: 3, maxPerDay: 50 });
    expect(c.allowedRole).toBeNull();
    expect(c.scoring.categoryWeights.seo).toBe(20);
    expect(c.scoring.categoryWeights.geo).toBe(15);
  });
  it("configures the AI provider and keeps the key out of defaults", () => {
    const c = loadConfig(base);
    expect(c.ai).toEqual({
      enabled: true,
      model: "model-x",
      apiKey: "key",
      timeoutMs: 60000,
      maxOutputTokens: 4096,
      outputLanguage: "Deutsch",
    });
  });
  it("requires model and key unless AI is disabled", () => {
    const noModel: Record<string, string | undefined> = { ...base, AI_MODEL: undefined };
    const noKey: Record<string, string | undefined> = { ...base, ANTHROPIC_API_KEY: undefined };
    expect(() => loadConfig(noModel)).toThrow(/AI_MODEL/);
    expect(() => loadConfig(noKey)).toThrow(/ANTHROPIC_API_KEY/);
    expect(
      loadConfig({ ...noModel, ANTHROPIC_API_KEY: undefined, AI_ENABLED: "false" }).ai,
    ).toEqual({
      enabled: false,
    });
    expect(() => loadConfig({ ...base, AI_ENABLED: "maybe" })).toThrow(/AI_ENABLED/);
  });
  it("fails fast on missing or invalid values", () => {
    expect(() => loadConfig({})).toThrow(/COSMOS_ENDPOINT/);
    expect(() => loadConfig({ ...base, FETCH_TIMEOUT_MS: "abc" })).toThrow(/FETCH_TIMEOUT_MS/);
    expect(() => loadConfig({ ...base, FETCH_ALLOWED_PORTS: "80,99999" })).toThrow(
      /FETCH_ALLOWED_PORTS/,
    );
    expect(() => loadConfig({ ...base, SCORING_CONFIG_JSON: "{}" })).toThrow();
  });
  it("parses lists and overrides", () => {
    const c = loadConfig({
      ...base,
      DOMAIN_ALLOWLIST: " example.com, foo.org ",
      FETCH_ALLOWED_PORTS: "443",
      ALLOWED_ROLE: " marketing ",
      MAX_ACTIVE_AUDITS_PER_USER: "1",
    });
    expect(c.fetch.domainAllowlist).toEqual(["example.com", "foo.org"]);
    expect(c.fetch.allowedPorts).toEqual([443]);
    expect(c.allowedRole).toBe("marketing");
    expect(c.quotas.maxActive).toBe(1);
  });
});
