import { describe, expect, it } from "vitest";
import type { AuditDocument } from "../../apps/functions/src/domain/auditDocument.js";
import { makeHarness, request, silentLogger } from "./helpers.js";

const URL_OK = "https://example.com/landing";
const create = (
  h: ReturnType<typeof makeHarness>,
  user = "user-1",
  body: unknown = { url: URL_OK },
) => h.handlers.createAudit(request({ user, body }));

describe("POST /audits", () => {
  it("creates a queued audit, enqueues a job and returns 202 + Location", async () => {
    const h = makeHarness();
    const res = await create(h);
    expect(res.status).toBe(202);
    const body = res.body as { id: string; status: string };
    expect(body.status).toBe("queued");
    expect(res.headers?.["location"]).toBe(`/api/audits/${body.id}`);
    expect(h.queue.messages).toEqual([{ schemaVersion: 1, auditId: body.id, ownerId: "user-1" }]);
    const doc = await h.repo.get("user-1", body.id);
    expect(doc?.input.modules).toHaveLength(5); // Default: alle Module
    expect(doc?.input.rulesetVersion).toBe("1.0.0");
    expect(doc?.ttl).toBe(90 * 86400);
  });

  it("deduplicates modules and honors selection", async () => {
    const h = makeHarness();
    const res = await create(h, "user-1", { url: URL_OK, modules: ["seo", "seo", "tracking"] });
    const doc = await h.repo.get("user-1", (res.body as { id: string }).id);
    expect(doc?.input.modules).toEqual(["seo", "tracking"]);
  });

  it.each([
    [{}, "VALIDATION_ERROR"],
    [{ url: "" }, "VALIDATION_ERROR"],
    [{ url: URL_OK, modules: [] }, "VALIDATION_ERROR"],
    [{ url: URL_OK, modules: ["nope"] }, "VALIDATION_ERROR"],
    [{ url: "http://127.0.0.1/" }, "URL_NOT_ALLOWED"],
    [{ url: "file:///etc/passwd" }, "URL_NOT_ALLOWED"],
    [{ url: "http://169.254.169.254/" }, "URL_NOT_ALLOWED"],
    [{ url: "not a url" }, "URL_NOT_ALLOWED"],
  ])("rejects %j with 400 %s and creates nothing", async (body, code) => {
    const h = makeHarness();
    const res = await create(h, "user-1", body);
    expect(res.status).toBe(400);
    expect((res.body as { error: { code: string } }).error.code).toBe(code);
    expect(h.repo.docs.size).toBe(0);
    expect(h.queue.messages).toHaveLength(0);
  });

  it("rejects invalid JSON", async () => {
    const h = makeHarness();
    const res = await h.handlers.createAudit(request({ rawBody: "{oops" }));
    expect(res.status).toBe(400);
  });

  it("enforces the active-audit quota (429) per user", async () => {
    const h = makeHarness({ maxActive: 2 });
    expect((await create(h)).status).toBe(202);
    expect((await create(h)).status).toBe(202);
    const blocked = await create(h);
    expect(blocked.status).toBe(429);
    expect((await create(h, "user-2")).status).toBe(202); // andere Nutzer unberührt
  });

  it("ignores stale active audits older than 30 minutes", async () => {
    const h = makeHarness({ maxActive: 1 });
    await create(h);
    h.clock.now = new Date("2026-10-14T12:45:00Z");
    expect((await create(h)).status).toBe(202);
  });

  it("enforces the daily quota", async () => {
    const h = makeHarness({ maxActive: 100, maxPerDay: 2 });
    await create(h);
    await create(h);
    expect((await create(h)).status).toBe(429);
    h.clock.now = new Date("2026-10-15T12:01:00Z");
    expect((await create(h)).status).toBe(202);
  });

  it("rolls back the document when enqueueing fails", async () => {
    const h = makeHarness();
    h.queue.fail = true;
    const res = await create(h);
    expect(res.status).toBe(500);
    expect(h.repo.docs.size).toBe(0);
  });
});

describe("auth", () => {
  it("returns 401 without principal and for non-authenticated principals", async () => {
    const h = makeHarness();
    expect((await h.handlers.listAudits(request({ user: null }))).status).toBe(401);
    expect((await h.handlers.listAudits(request({ roles: ["anonymous"] }))).status).toBe(401);
  });
  it("returns 403 when the required role is missing", async () => {
    const h = makeHarness({ allowedRole: "marketing" });
    expect((await h.handlers.listAudits(request({}))).status).toBe(403);
    expect(
      (await h.handlers.listAudits(request({ roles: ["authenticated", "marketing"] }))).status,
    ).toBe(200);
  });
});

describe("GET /audits, /audits/{id}, report", () => {
  it("lists only own audits, newest first, with paging", async () => {
    const h = makeHarness();
    for (let i = 0; i < 3; i++) {
      h.clock.now = new Date(Date.UTC(2026, 9, 14, 12, i));
      await create(h);
    }
    await create(h, "user-2");
    const page1 = (await h.handlers.listAudits(request({ query: "limit=2" }))).body as {
      items: { createdAt: string }[];
      continuationToken?: string;
    };
    expect(page1.items).toHaveLength(2);
    expect(page1.items[0]!.createdAt > page1.items[1]!.createdAt).toBe(true);
    expect(page1.continuationToken).toBeDefined();
    const page2 = (
      await h.handlers.listAudits(
        request({ query: `limit=2&continuationToken=${page1.continuationToken}` }),
      )
    ).body as {
      items: unknown[];
      continuationToken?: string;
    };
    expect(page2.items).toHaveLength(1);
    expect(page2.continuationToken).toBeUndefined();
  });

  it("validates list query", async () => {
    const h = makeHarness();
    expect((await h.handlers.listAudits(request({ query: "limit=500" }))).status).toBe(400);
  });

  it("returns status and hides other users' audits with 404", async () => {
    const h = makeHarness();
    const id = ((await create(h)).body as { id: string }).id;
    const own = await h.handlers.getAudit(request({ params: { auditId: id } }));
    expect(own.status).toBe(200);
    expect(own.body).toMatchObject({ id, status: "queued", url: URL_OK });
    expect(
      (await h.handlers.getAudit(request({ user: "user-2", params: { auditId: id } }))).status,
    ).toBe(404);
    expect((await h.handlers.getAudit(request({ params: { auditId: "../../etc" } }))).status).toBe(
      404,
    );
  });

  it("report is 409 until completed", async () => {
    const h = makeHarness();
    const id = ((await create(h)).body as { id: string }).id;
    const res = await h.handlers.getReport(request({ params: { auditId: id } }));
    expect(res.status).toBe(409);
    expect((res.body as { error: { code: string } }).error.code).toBe("AUDIT_NOT_READY");
  });

  it("report of a failed audit is 409 AUDIT_FAILED", async () => {
    const h = makeHarness();
    const id = ((await create(h)).body as { id: string }).id;
    const doc = (await h.repo.get("user-1", id)) as AuditDocument;
    await h.repo.replace({
      ...doc,
      status: "failed",
      error: { code: "TARGET_BLOCKED", message: "Das Ziel ist nicht erlaubt." },
    });
    const res = await h.handlers.getReport(request({ params: { auditId: id } }));
    expect(res.status).toBe(409);
    expect((res.body as { error: { code: string } }).error.code).toBe("AUDIT_FAILED");
  });

  it("builds the report and derives critical issues deterministically from findings", async () => {
    const h = makeHarness();
    const id = ((await create(h)).body as { id: string }).id;
    const doc = (await h.repo.get("user-1", id)) as AuditDocument;
    const finding = (
      ruleId: string,
      status: "passed" | "failed",
      severity: "critical" | "high" | "medium",
    ) => ({
      ruleId,
      category: "seo" as const,
      status,
      severity,
      evidence: {},
      message: "m",
      source: "measured" as const,
    });
    await h.repo.replace({
      ...doc,
      status: "completed",
      completedAt: "2026-10-14T12:01:00Z",
      findings: [
        finding("A", "failed", "critical"),
        finding("B", "failed", "medium"),
        finding("C", "passed", "high"),
        finding("D", "failed", "high"),
      ],
      score: {
        overall: 40,
        categories: { seo: 40 },
        weightsApplied: { seo: 1 },
        configVersion: "1.0.0",
      },
      ai: {
        status: "completed",
        provider: "anthropic",
        model: "m",
        promptVersion: "1",
        source: "ai",
        result: {
          executiveSummary: "s",
          marketingFindings: [],
          priorities: [{ priority: 1, action: "Do x", ownerType: "marketing" }],
          limitations: [],
        },
      },
    });
    const res = await h.handlers.getReport(request({ params: { auditId: id } }));
    expect(res.status).toBe(200);
    const body = res.body as {
      criticalIssues: { ruleId: string }[];
      technical: { findings: unknown[] };
      recommendedActions: unknown[];
      score: { overall: number };
    };
    expect(body.criticalIssues.map((f) => f.ruleId)).toEqual(["A", "D"]);
    expect(body.technical.findings).toHaveLength(4);
    expect(body.recommendedActions).toHaveLength(1);
    expect(body.score.overall).toBe(40);
  });
});

describe("DELETE /audits/{id}", () => {
  it("deletes own audit (204) and returns 404 afterwards or for other users", async () => {
    const h = makeHarness();
    const id = ((await create(h)).body as { id: string }).id;
    expect(
      (await h.handlers.deleteAudit(request({ user: "user-2", params: { auditId: id } }))).status,
    ).toBe(404);
    expect((await h.handlers.deleteAudit(request({ params: { auditId: id } }))).status).toBe(204);
    expect((await h.handlers.deleteAudit(request({ params: { auditId: id } }))).status).toBe(404);
  });
});

describe("GET /rulesets and /health", () => {
  it("lists the rule catalog and scoring weights", async () => {
    const h = makeHarness();
    const res = await h.handlers.listRulesets(request({}));
    const rs = (
      res.body as {
        rulesets: { rules: unknown[]; scoring: { categoryWeights: { seo: number } } }[];
      }
    ).rulesets;
    expect(rs[0]!.rules.length).toBeGreaterThan(20);
    expect(rs[0]!.scoring.categoryWeights.seo).toBe(25);
  });
  it("health is anonymous for liveness, authenticated for deep checks", async () => {
    const h = makeHarness();
    expect((await h.handlers.health(request({ user: null }))).status).toBe(200);
    expect((await h.handlers.health(request({ user: null, query: "deep=true" }))).status).toBe(401);
    const ok = await h.handlers.health(request({ query: "deep=true" }));
    expect(ok.body).toMatchObject({ status: "ok", checks: { cosmos: "ok", queue: "ok" } });
    h.repo.failPing = true;
    const bad = await h.handlers.health(request({ query: "deep=true" }));
    expect(bad.status).toBe(503);
    expect(bad.body).toMatchObject({ checks: { cosmos: "failed", queue: "ok" } });
  });
});

describe("error hygiene", () => {
  it("never leaks internals on 500 and always sets a correlation id", async () => {
    const h = makeHarness();
    h.queue.fail = true;
    silentLogger.errors.length = 0;
    const res = await create(h);
    expect(JSON.stringify(res.body)).not.toContain("queue down");
    expect(res.body).toMatchObject({ error: { code: "INTERNAL_ERROR", correlationId: "corr-1" } });
    expect(silentLogger.errors).toHaveLength(1);
  });
});
