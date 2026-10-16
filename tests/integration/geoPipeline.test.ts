import { describe, expect, it } from "vitest";
import type { AuditQueueMessage } from "@mcopilot/shared-types";
import { DisabledAiProvider } from "../../apps/functions/src/ai/claudeProvider.js";
import type { AuditDocument } from "../../apps/functions/src/domain/auditDocument.js";
import {
  FetchError,
  type FetchOptions,
  type FetchResult,
  type PageFetcher,
} from "../../apps/functions/src/fetcher/safeFetcher.js";
import { defaultRuleset } from "../../apps/functions/src/rules/index.js";
import { defaultScoringConfig } from "../../apps/functions/src/scoring/scoring.js";
import { AuditPipeline } from "../../apps/functions/src/worker/auditPipeline.js";
import { InMemoryAuditRepository, silentLogger } from "./helpers.js";

const ID = "00000000-0000-4000-8000-000000000001";
const msg: AuditQueueMessage = { schemaVersion: 1, auditId: ID, ownerId: "user-1" };
const HTML = `<html lang="de"><head><title>Ein ausreichend langer Titel</title></head><body><h1>x</h1><p>${"wort ".repeat(300)}</p></body></html>`;

const result = (body: string, contentType: string, url: string): FetchResult => ({
  finalUrl: url,
  redirectChain: [url],
  statusCode: 200,
  contentType,
  html: body,
  bytes: body.length,
  durationMs: 1,
  fetchedAt: "2026-10-16T12:00:00Z",
});

type Behavior = (url: string, options?: FetchOptions) => FetchResult | FetchError;
function fetcherWith(
  behavior: Behavior,
): PageFetcher & { calls: { url: string; options?: FetchOptions }[] } {
  const calls: { url: string; options?: FetchOptions }[] = [];
  return {
    calls,
    async fetch(url, options) {
      calls.push(options ? { url, options } : { url });
      const r = behavior(url, options);
      if (r instanceof FetchError) throw r;
      return r;
    },
  };
}
const notFound = (): FetchError => new FetchError("FETCH_FAILED", "404", { httpStatus: 404 });

const doc = (modules: AuditDocument["input"]["modules"]): AuditDocument => ({
  id: ID,
  ownerId: "user-1",
  type: "audit",
  schemaVersion: 1,
  status: "queued",
  createdAt: "2026-10-16T12:00:00Z",
  attempts: 0,
  ttl: 100,
  input: {
    url: "https://www.example.com/seite",
    normalizedUrl: "https://www.example.com/seite",
    modules,
    rulesetId: "default",
    rulesetVersion: "1.1.0",
  },
});

async function run(modules: AuditDocument["input"]["modules"], behavior: Behavior) {
  const repo = new InMemoryAuditRepository();
  await repo.create(doc(modules));
  const fetcher = fetcherWith(behavior);
  await new AuditPipeline({
    repo,
    fetcher,
    ai: new DisabledAiProvider(),
    ruleset: defaultRuleset,
    scoring: defaultScoringConfig,
    logger: silentLogger,
  }).process(msg);
  const saved = (await repo.get("user-1", ID)) as AuditDocument;
  return { saved, fetcher, finding: (id: string) => saved.findings?.find((f) => f.ruleId === id) };
}

const main = "https://www.example.com/seite";

describe("GEO-Modul in der Pipeline: robots.txt und llms.txt", () => {
  it("ruft nur bei gewähltem GEO-Modul zusätzlich robots.txt und llms.txt vom Ursprung ab", async () => {
    const withGeo = await run(["seo", "geo"], (u) =>
      u === main
        ? result(HTML, "text/html", u)
        : u.endsWith("/robots.txt")
          ? result("User-agent: *\nAllow: /", "text/plain", u)
          : notFound(),
    );
    expect(withGeo.fetcher.calls.map((c) => c.url).sort()).toEqual(
      [main, "https://www.example.com/llms.txt", "https://www.example.com/robots.txt"].sort(),
    );
    const robotsCall = withGeo.fetcher.calls.find((c) => c.url.endsWith("/robots.txt"));
    expect(robotsCall?.options?.allowedContentTypes).toEqual(["text/plain"]);
    expect(robotsCall?.options?.maxBytes).toBeLessThanOrEqual(512 * 1024);

    const withoutGeo = await run(["seo"], (u) => result(HTML, "text/html", u));
    expect(withoutGeo.fetcher.calls.map((c) => c.url)).toEqual([main]);
  });

  it("wertet robots.txt aus: gesperrte KI-Crawler werden als Befund gespeichert", async () => {
    const { finding, saved } = await run(["geo"], (u) =>
      u === main
        ? result(HTML, "text/html", u)
        : u.endsWith("/robots.txt")
          ? result(
              "User-agent: PerplexityBot\nDisallow: /\n\nUser-agent: GPTBot\nDisallow: /",
              "text/plain",
              u,
            )
          : notFound(),
    );
    expect(saved.status).toBe("completed");
    expect(finding("GEO_AI_CRAWLER_ACCESS")).toMatchObject({ status: "warning" });
    expect(finding("GEO_AI_CRAWLER_ACCESS")?.evidence["blockedAnswerBots"]).toEqual([
      "PerplexityBot",
    ]);
    expect(finding("GEO_TRAINING_CRAWLER_POLICY")?.evidence["blockedTrainingBots"]).toEqual([
      "GPTBot",
    ]);
    expect(finding("GEO_LLMS_TXT")?.status).toBe("warning"); // 404 = fehlt
    expect(saved.score?.categories.geo).toBeTypeOf("number");
  });

  it("404 und unerwarteter Dateityp bedeuten 'fehlt'; Netzwerkfehler 'nicht abrufbar' – nie ein Audit-Fehler", async () => {
    const missing = await run(["geo"], (u) =>
      u === main
        ? result(HTML, "text/html", u)
        : new FetchError("UNSUPPORTED_CONTENT_TYPE", "html statt text"),
    );
    expect(missing.saved.status).toBe("completed");
    expect(missing.finding("GEO_ROBOTS_TXT")?.evidence["fileStatus"]).toBe("missing");
    expect(missing.finding("GEO_AI_CRAWLER_ACCESS")?.status).toBe("passed");

    const down = await run(["geo"], (u) =>
      u === main
        ? result(HTML, "text/html", u)
        : new FetchError("FETCH_TIMEOUT", "Zeitüberschreitung"),
    );
    expect(down.saved.status).toBe("completed");
    expect(down.finding("GEO_AI_CRAWLER_ACCESS")?.status).toBe("not_applicable");
    const blocked = await run(["geo"], (u) =>
      u === main
        ? result(HTML, "text/html", u)
        : new FetchError("FETCH_FAILED", "403", { httpStatus: 403 }),
    );
    expect(blocked.finding("GEO_AI_CRAWLER_ACCESS")?.status).toBe("not_applicable");
  });

  it("nutzt den Ursprung der final aufgelösten URL (nach Weiterleitung)", async () => {
    const { fetcher } = await run(["geo"], (u) =>
      u === main
        ? {
            ...result(HTML, "text/html", "https://neu.example.org/start"),
            finalUrl: "https://neu.example.org/start",
          }
        : notFound(),
    );
    expect(fetcher.calls.map((c) => c.url)).toContain("https://neu.example.org/robots.txt");
    expect(fetcher.calls.map((c) => c.url)).not.toContain("https://www.example.com/robots.txt");
  });

  it("Inhalt der robots.txt landet nicht im gespeicherten Dokument (nur Befunde)", async () => {
    const { saved } = await run(["geo"], (u) =>
      u === main
        ? result(HTML, "text/html", u)
        : u.endsWith("/robots.txt")
          ? result("User-agent: *\nDisallow: /geheim-intern", "text/plain", u)
          : notFound(),
    );
    expect(JSON.stringify(saved)).not.toContain("geheim-intern");
  });
});
