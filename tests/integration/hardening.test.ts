import { describe, expect, it } from "vitest";
import type { AuditQueueMessage } from "@mcopilot/shared-types";
import { DisabledAiProvider } from "../../apps/functions/src/ai/claudeProvider.js";
import type { AiAssessmentInput, AiProvider } from "../../apps/functions/src/ai/provider.js";
import type { AuditDocument } from "../../apps/functions/src/domain/auditDocument.js";
import type { FetchResult, PageFetcher } from "../../apps/functions/src/fetcher/safeFetcher.js";
import type { Logger } from "../../apps/functions/src/http/handlers.js";
import { redactUrl } from "../../apps/functions/src/lib/redact.js";
import { defaultRuleset } from "../../apps/functions/src/rules/index.js";
import { defaultScoringConfig } from "../../apps/functions/src/scoring/scoring.js";
import { AuditPipeline } from "../../apps/functions/src/worker/auditPipeline.js";
import { InMemoryAuditRepository, makeHarness, request } from "./helpers.js";

const ID = "00000000-0000-4000-8000-000000000001";
const msg: AuditQueueMessage = { schemaVersion: 1, auditId: ID, ownerId: "user-1" };
const SECRET_URL = "https://example.com/landing?token=SECRET123&email=max@firma.de#frag";

const queued = (): AuditDocument => ({
  id: ID,
  ownerId: "user-1",
  type: "audit",
  schemaVersion: 1,
  status: "queued",
  createdAt: "2026-10-14T12:00:00Z",
  attempts: 0,
  ttl: 100,
  input: {
    url: SECRET_URL,
    normalizedUrl: SECRET_URL.split("#")[0] as string,
    modules: ["seo"],
    rulesetId: "default",
    rulesetVersion: "1.0.0",
  },
});

const page: FetchResult = {
  finalUrl: SECRET_URL,
  redirectChain: [],
  statusCode: 200,
  contentType: "text/html",
  html: "<html><head><title>Ein ausreichend langer Titel</title></head><body><h1>Hi</h1></body></html>",
  bytes: 90,
  durationMs: 1,
  fetchedAt: "2026-10-14T12:00:01Z",
};

const capturingLogger = (): Logger & { lines: string[] } => {
  const lines: string[] = [];
  const log = (level: string) => (m: string, d?: Record<string, unknown>) =>
    void lines.push(`${level} ${m} ${JSON.stringify(d ?? {})}`);
  return { lines, info: log("info"), warn: log("warn"), error: log("error") };
};

describe("redactUrl", () => {
  it("drops query and fragment, never returns the original on garbage", () => {
    expect(redactUrl(SECRET_URL)).toBe("https://example.com/landing");
    expect(redactUrl("not a url with ?token=abc")).toBe("[ungültige URL]");
  });
});

describe("pipeline logging (data minimization)", () => {
  it("does not log query strings or fragments of user-supplied URLs", async () => {
    const repo = new InMemoryAuditRepository();
    await repo.create(queued());
    const logger = capturingLogger();
    const fetcher: PageFetcher = { fetch: async () => page };
    const pipeline = new AuditPipeline({
      repo,
      fetcher,
      ai: new DisabledAiProvider(),
      ruleset: defaultRuleset,
      scoring: defaultScoringConfig,
      logger,
    });
    await pipeline.process(msg);
    const all = logger.lines.join("\n");
    expect(all).toContain("Audit gestartet");
    expect(all).not.toContain("SECRET123");
    expect(all).not.toContain("max@firma.de");
  });
});

describe("concurrent processing of the same message", () => {
  it("lets exactly one worker run the audit (optimistic lock) – one fetch, one AI call", async () => {
    const repo = new InMemoryAuditRepository();
    await repo.create(queued());
    let fetches = 0;
    let aiCalls = 0;
    const fetcher: PageFetcher = {
      fetch: async () => {
        fetches++;
        await new Promise((r) => setTimeout(r, 10));
        return page;
      },
    };
    const ai: AiProvider = {
      assess: async (_i: AiAssessmentInput) => {
        aiCalls++;
        return {
          status: "skipped",
          provider: "anthropic",
          model: "m",
          promptVersion: "1",
          source: "ai",
        };
      },
    };
    const mk = () =>
      new AuditPipeline({
        repo,
        fetcher,
        ai,
        ruleset: defaultRuleset,
        scoring: defaultScoringConfig,
        logger: capturingLogger(),
      });
    await Promise.all([mk().process(msg), mk().process(msg), mk().process(msg)]);
    expect(fetches).toBe(1);
    expect(aiCalls).toBe(1);
    const doc = (await repo.get("user-1", ID)) as AuditDocument;
    expect(doc.status).toBe("completed");
    expect(doc.attempts).toBe(1);
  });
});

describe("request size guard", () => {
  it("rejects oversized POST bodies by declared content-length without parsing them", async () => {
    const h = makeHarness();
    const req = request({ body: { url: "https://example.com" } });
    const big = {
      ...req,
      headers: {
        get: (n: string) => (n.toLowerCase() === "content-length" ? "5000000" : req.headers.get(n)),
      },
    };
    const res = await h.handlers.createAudit(big);
    expect(res.status).toBe(413);
    expect(h.repo.docs.size).toBe(0);
  });
});
