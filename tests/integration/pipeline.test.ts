import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AuditQueueMessage } from "@mcopilot/shared-types";
import type { AuditDocument } from "../../apps/functions/src/domain/auditDocument.js";
import {
  FetchError,
  type FetchResult,
  type PageFetcher,
} from "../../apps/functions/src/fetcher/safeFetcher.js";
import { defaultRuleset } from "../../apps/functions/src/rules/index.js";
import { defaultScoringConfig } from "../../apps/functions/src/scoring/scoring.js";
import type { AiAssessmentInput, AiProvider } from "../../apps/functions/src/ai/provider.js";
import { DisabledAiProvider } from "../../apps/functions/src/ai/claudeProvider.js";
import { AuditPipeline } from "../../apps/functions/src/worker/auditPipeline.js";
import { InMemoryAuditRepository, silentLogger } from "./helpers.js";

const fixture = (n: string): string =>
  readFileSync(new URL(`../fixtures/${n}`, import.meta.url), "utf8");

class FakeFetcher implements PageFetcher {
  calls: string[] = [];
  constructor(private readonly behavior: (url: string) => Promise<FetchResult>) {}
  fetch(url: string): Promise<FetchResult> {
    this.calls.push(url);
    return this.behavior(url);
  }
}

const okResult = (html: string): FetchResult => ({
  finalUrl: "https://example.com/final",
  redirectChain: ["https://example.com/", "https://example.com/final"],
  statusCode: 200,
  contentType: "text/html; charset=utf-8",
  html,
  bytes: html.length,
  durationMs: 12,
  fetchedAt: "2026-10-14T12:00:05Z",
});

const OWNER = "user-1";
const ID = "00000000-0000-4000-8000-000000000001";
const msg: AuditQueueMessage = { schemaVersion: 1, auditId: ID, ownerId: OWNER };

const queuedDoc = (over: Partial<AuditDocument> = {}): AuditDocument => ({
  id: ID,
  ownerId: OWNER,
  type: "audit",
  schemaVersion: 1,
  status: "queued",
  createdAt: "2026-10-14T12:00:00Z",
  attempts: 0,
  ttl: 100,
  input: {
    url: "https://example.com/",
    normalizedUrl: "https://example.com/",
    modules: ["seo", "tracking", "consent", "content", "conversion"],
    rulesetId: "default",
    rulesetVersion: "1.0.0",
  },
  ...over,
});

async function setup(
  fetcher: PageFetcher,
  doc: AuditDocument | null = queuedDoc(),
  maxAttempts = 3,
  ai: AiProvider = new DisabledAiProvider("test-model"),
) {
  const repo = new InMemoryAuditRepository();
  if (doc) await repo.create(doc);
  const pipeline = new AuditPipeline({
    repo,
    fetcher,
    ai,
    ruleset: defaultRuleset,
    scoring: defaultScoringConfig,
    logger: silentLogger,
    maxAttempts,
    now: () => new Date("2026-10-14T12:01:00Z"),
  });
  return { repo, pipeline };
}

const reload = async (repo: InMemoryAuditRepository): Promise<AuditDocument> =>
  (await repo.get(OWNER, ID)) as AuditDocument;

describe("AuditPipeline – success", () => {
  it("fetches, analyzes, scores and stores a completed audit", async () => {
    const fetcher = new FakeFetcher(async () => okResult(fixture("good.html")));
    const { repo, pipeline } = await setup(fetcher);
    await pipeline.process(msg);

    const doc = await reload(repo);
    expect(fetcher.calls).toEqual(["https://example.com/"]);
    expect(doc.status).toBe("completed");
    expect(doc.attempts).toBe(1);
    expect(doc.startedAt).toBe("2026-10-14T12:01:00.000Z");
    expect(doc.completedAt).toBe("2026-10-14T12:01:00.000Z");
    expect(doc.fetch).toMatchObject({
      finalUrl: "https://example.com/final",
      statusCode: 200,
      bytes: expect.any(Number),
    });
    expect(doc.findings!.length).toBeGreaterThan(20);
    expect(doc.findings!.every((f) => f.source === "measured")).toBe(true);
    expect(doc.score!.overall).toBeGreaterThan(70);
    expect(doc.score!.configVersion).toBe("1.0.0");
    expect(doc.page).toMatchObject({
      title: "Marketing Automation Software | Beispiel GmbH",
      lang: "de",
    });
    expect(doc.ai).toMatchObject({ status: "skipped", source: "ai" });
    expect(doc.error).toBeUndefined();
  });

  it("stores no form values or personal data", async () => {
    const { repo, pipeline } = await setup(
      new FakeFetcher(async () => okResult(fixture("good.html"))),
    );
    await pipeline.process(msg);
    expect(JSON.stringify(await reload(repo))).not.toContain("secret@example.com");
  });

  it("only evaluates selected modules and scores only those", async () => {
    const doc = queuedDoc({ input: { ...queuedDoc().input, modules: ["seo"] } });
    const { repo, pipeline } = await setup(
      new FakeFetcher(async () => okResult(fixture("bad.html"))),
      doc,
    );
    await pipeline.process(msg);
    const out = await reload(repo);
    expect(new Set(out.findings!.map((f) => f.category))).toEqual(new Set(["seo"]));
    expect(Object.keys(out.score!.categories)).toEqual(["seo"]);
  });

  it("caps the stored text excerpt", async () => {
    const html = `<html><body><h1>T</h1><p>${"wort ".repeat(5000)}</p></body></html>`;
    const { repo, pipeline } = await setup(new FakeFetcher(async () => okResult(html)));
    await pipeline.process(msg);
    expect((await reload(repo)).page!.visibleTextExcerpt.length).toBeLessThanOrEqual(6000);
  });
});

describe("AuditPipeline – idempotency & lifecycle", () => {
  it.each(["completed", "failed"] as const)(
    "ignores already %s audits without fetching",
    async (status) => {
      const fetcher = new FakeFetcher(async () => okResult("<html></html>"));
      const { repo, pipeline } = await setup(fetcher, queuedDoc({ status }));
      await pipeline.process(msg);
      expect(fetcher.calls).toHaveLength(0);
      expect((await reload(repo)).status).toBe(status);
    },
  );

  it("drops messages for deleted audits", async () => {
    const fetcher = new FakeFetcher(async () => okResult("<html></html>"));
    const { pipeline } = await setup(fetcher, null);
    await expect(pipeline.process(msg)).resolves.toBeUndefined();
    expect(fetcher.calls).toHaveLength(0);
  });

  it("retry of a running audit increments attempts and keeps the original startedAt", async () => {
    const doc = queuedDoc({ status: "running", attempts: 1, startedAt: "2026-10-14T12:00:30Z" });
    const { repo, pipeline } = await setup(
      new FakeFetcher(async () => okResult(fixture("good.html"))),
      doc,
    );
    await pipeline.process(msg);
    const out = await reload(repo);
    expect(out.attempts).toBe(2);
    expect(out.startedAt).toBe("2026-10-14T12:00:30Z");
    expect(out.status).toBe("completed");
  });

  it("fails permanently once max attempts are exhausted", async () => {
    const fetcher = new FakeFetcher(async () => okResult("<html></html>"));
    const { repo, pipeline } = await setup(fetcher, queuedDoc({ status: "running", attempts: 3 }));
    await pipeline.process(msg);
    expect(fetcher.calls).toHaveLength(0);
    expect((await reload(repo)).error?.code).toBe("INTERNAL_ERROR");
  });

  it("markPoisoned fails open audits but leaves terminal ones alone", async () => {
    const a = await setup(
      new FakeFetcher(async () => okResult("")),
      queuedDoc({ status: "running" }),
    );
    await a.pipeline.markPoisoned(msg);
    expect((await reload(a.repo)).status).toBe("failed");
    const b = await setup(
      new FakeFetcher(async () => okResult("")),
      queuedDoc({ status: "completed" }),
    );
    await b.pipeline.markPoisoned(msg);
    expect((await reload(b.repo)).status).toBe("completed");
  });
});

describe("AuditPipeline – failures", () => {
  it.each([
    ["TARGET_BLOCKED", "Das Ziel ist nicht erlaubt."],
    ["UNSUPPORTED_CONTENT_TYPE", "Nur HTML-Seiten werden unterstützt."],
    ["FETCH_TIMEOUT", "Zeitüberschreitung beim Abruf."],
    ["RESPONSE_TOO_LARGE", "Die Antwort ist zu groß."],
  ] as const)(
    "marks the audit failed on %s without throwing (no queue retry)",
    async (code, message) => {
      const fetcher = new FakeFetcher(async () => {
        throw new FetchError(code, message);
      });
      const { repo, pipeline } = await setup(fetcher);
      await expect(pipeline.process(msg)).resolves.toBeUndefined();
      const doc = await reload(repo);
      expect(doc).toMatchObject({ status: "failed", error: { code, message } });
      expect(doc.findings).toBeUndefined();
    },
  );

  it("rethrows unexpected fetcher errors for queue retry, leaving the audit running", async () => {
    const fetcher = new FakeFetcher(async () => {
      throw new Error("boom");
    });
    const { repo, pipeline } = await setup(fetcher);
    await expect(pipeline.process(msg)).rejects.toThrow("boom");
    expect((await reload(repo)).status).toBe("running");
  });

  it("rethrows when the result cannot be persisted (transient)", async () => {
    const { repo, pipeline } = await setup(
      new FakeFetcher(async () => okResult(fixture("good.html"))),
    );
    const original = repo.replace.bind(repo);
    let calls = 0;
    repo.replace = async (d) => {
      if (++calls === 2) throw new Error("cosmos down");
      return original(d);
    };
    await expect(pipeline.process(msg)).rejects.toThrow("cosmos down");
    expect((await reload(repo)).status).toBe("running");
  });

  it("aborts without writing when the audit is deleted during processing", async () => {
    const { repo, pipeline } = await setup(
      new FakeFetcher(async () => {
        await repo.delete(OWNER, ID);
        return okResult(fixture("good.html"));
      }),
    );
    await expect(pipeline.process(msg)).rejects.toThrow(); // replace auf gelöschtes Dokument → Retry → danach "nicht gefunden"
    await expect(pipeline.process(msg)).resolves.toBeUndefined();
    expect(repo.docs.size).toBe(0);
  });
});

describe("AuditPipeline – AI integration", () => {
  const completedAi = {
    status: "completed" as const,
    provider: "anthropic" as const,
    model: "m",
    promptVersion: "1",
    source: "ai" as const,
    result: { executiveSummary: "s", marketingFindings: [], priorities: [], limitations: [] },
  };

  it("passes only page excerpt and findings to the AI and stores its result separately from findings", async () => {
    let received: AiAssessmentInput | undefined;
    const ai: AiProvider = {
      async assess(input) {
        received = input;
        return completedAi;
      },
    };
    const { repo, pipeline } = await setup(
      new FakeFetcher(async () => okResult(fixture("good.html"))),
      queuedDoc(),
      3,
      ai,
    );
    await pipeline.process(msg);
    const doc = await reload(repo);
    expect(doc.ai).toEqual(completedAi);
    expect(received!.technicalFindings).toHaveLength(doc.findings!.length);
    expect(received!.page.title).toBe("Marketing Automation Software | Beispiel GmbH");
    const sent = JSON.stringify(received);
    expect(sent).not.toContain("secret@example.com");
    expect(sent).not.toContain("<script");
    // KI-Ergebnis verändert weder Findings noch Score
    expect(doc.findings!.every((f) => f.source === "measured")).toBe(true);
  });

  it("completes the audit even if the AI provider fails or throws", async () => {
    const failing: AiProvider = {
      async assess() {
        return {
          ...completedAi,
          status: "failed",
          result: undefined,
          error: { code: "PROVIDER_ERROR", message: "x" },
        };
      },
    };
    const a = await setup(
      new FakeFetcher(async () => okResult(fixture("good.html"))),
      queuedDoc(),
      3,
      failing,
    );
    await a.pipeline.process(msg);
    expect((await reload(a.repo)).status).toBe("completed");
    expect((await reload(a.repo)).ai?.status).toBe("failed");

    const throwing: AiProvider = {
      async assess() {
        throw new Error("boom");
      },
    };
    const b = await setup(
      new FakeFetcher(async () => okResult(fixture("good.html"))),
      queuedDoc(),
      3,
      throwing,
    );
    await b.pipeline.process(msg);
    const doc = await reload(b.repo);
    expect(doc.status).toBe("completed");
    expect(doc.ai).toMatchObject({ status: "failed", error: { code: "PROVIDER_ERROR" } });
    expect(doc.score).toBeDefined();
  });

  it("does not call the AI when the fetch failed", async () => {
    let called = false;
    const ai: AiProvider = {
      async assess() {
        called = true;
        return completedAi;
      },
    };
    const { pipeline } = await setup(
      new FakeFetcher(async () => {
        throw new FetchError("TARGET_BLOCKED", "x");
      }),
      queuedDoc(),
      3,
      ai,
    );
    await pipeline.process(msg);
    expect(called).toBe(false);
  });
});
