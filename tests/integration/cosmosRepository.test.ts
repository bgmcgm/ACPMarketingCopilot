import type { CosmosClient } from "@azure/cosmos";
import { describe, expect, it } from "vitest";
import type { AuditDocument } from "../../apps/functions/src/domain/auditDocument.js";
import { CosmosAuditRepository } from "../../apps/functions/src/persistence/cosmosAuditRepository.js";

/** Aufzeichnender Stub der Cosmos-Client-Oberfläche (der echte Emulator ist hier nicht startbar). */
function stub(behavior: {
  read?: () => unknown;
  replace?: () => unknown;
  delete?: () => unknown;
  query?: (q: { query: string; parameters: { name: string; value: unknown }[] }) => unknown;
}) {
  const calls: { op: string; args: unknown[] }[] = [];
  const container = {
    read: async () => (calls.push({ op: "container.read", args: [] }), {}),
    items: {
      create: async (doc: unknown) => (
        calls.push({ op: "create", args: [doc] }),
        { resource: doc }
      ),
      query: (q: never, opts: unknown) => {
        calls.push({ op: "query", args: [q, opts] });
        const result = behavior.query?.(q) as {
          resources: unknown[];
          hasMoreResults?: boolean;
          continuationToken?: string;
        };
        return { fetchNext: async () => result, fetchAll: async () => result };
      },
    },
    item: (id: string, pk: string) => ({
      read: async () => (
        calls.push({ op: "read", args: [id, pk] }),
        behavior.read?.() ?? { resource: undefined }
      ),
      replace: async (doc: unknown, opts: unknown) => {
        calls.push({ op: "replace", args: [id, pk, doc, opts] });
        const r = behavior.replace?.();
        if (r instanceof Error) throw r;
        return r ?? { resource: doc };
      },
      delete: async () => {
        calls.push({ op: "delete", args: [id, pk] });
        const r = behavior.delete?.();
        if (r instanceof Error) throw r;
        return {};
      },
    }),
  };
  const client = { database: () => ({ container: () => container }) } as unknown as CosmosClient;
  return {
    repo: new CosmosAuditRepository(
      { endpoint: "https://x", database: "d", container: "c" },
      client,
    ),
    calls,
  };
}

const doc = (over: Partial<AuditDocument> = {}): AuditDocument => ({
  id: "a1",
  ownerId: "u1",
  type: "audit",
  schemaVersion: 1,
  status: "queued",
  createdAt: "2026-10-14T12:00:00Z",
  attempts: 0,
  ttl: 10,
  _etag: '"etag-1"',
  input: {
    url: "u",
    normalizedUrl: "u",
    modules: ["seo"],
    rulesetId: "default",
    rulesetVersion: "1",
  },
  ...over,
});
const httpError = (code: number): Error => Object.assign(new Error(`http ${code}`), { code });

describe("CosmosAuditRepository", () => {
  it("get: reads with partition key = ownerId; unknown ids and foreign document types yield null", async () => {
    const found = stub({ read: () => ({ resource: doc() }) });
    expect(await found.repo.get("u1", "a1")).toMatchObject({ id: "a1" });
    expect(found.calls[0]).toEqual({ op: "read", args: ["a1", "u1"] });
    expect(await stub({}).repo.get("u1", "nope")).toBeNull();
    expect(
      await stub({ read: () => ({ resource: { ...doc(), type: "other" } }) }).repo.get("u1", "a1"),
    ).toBeNull();
  });

  it("claim: uses If-Match with the document's _etag and returns the stored document", async () => {
    const { repo, calls } = stub({
      replace: () => ({ resource: { ...doc(), _etag: '"etag-2"' } }),
    });
    const res = await repo.claim(doc());
    expect(res?._etag).toBe('"etag-2"');
    expect(calls[0]!.args[3]).toEqual({
      accessCondition: { type: "IfMatch", condition: '"etag-1"' },
    });
  });

  it("claim: 412 means another worker won (null); other errors propagate", async () => {
    expect(await stub({ replace: () => httpError(412) }).repo.claim(doc())).toBeNull();
    await expect(stub({ replace: () => httpError(500) }).repo.claim(doc())).rejects.toThrow(
      "http 500",
    );
    await expect(stub({ replace: () => httpError(404) }).repo.claim(doc())).rejects.toThrow(); // gelöscht → Retry/Verwerfen im Worker
  });

  it("delete: true when deleted, false on 404, throws otherwise", async () => {
    expect(await stub({}).repo.delete("u1", "a1")).toBe(true);
    expect(await stub({ delete: () => httpError(404) }).repo.delete("u1", "a1")).toBe(false);
    await expect(stub({ delete: () => httpError(503) }).repo.delete("u1", "a1")).rejects.toThrow();
  });

  it("list: single-partition query, parameterized owner, paging token only when more results exist", async () => {
    const rows = [
      { id: "a1", url: "u", status: "completed", createdAt: "t", overallScore: undefined },
    ];
    const more = stub({
      query: () => ({ resources: rows, hasMoreResults: true, continuationToken: "tok" }),
    });
    const page = await more.repo.list("u1", 5, "prev");
    expect(page.items[0]!.overallScore).toBeNull();
    expect(page.continuationToken).toBe("tok");
    const [q, opts] = more.calls[0]!.args as [
      { query: string; parameters: unknown[] },
      Record<string, unknown>,
    ];
    expect(q.query).toContain("c.ownerId = @ownerId");
    expect(q.query).toContain("ORDER BY c.createdAt DESC");
    expect(q.query).not.toContain("u1"); // keine String-Konkatenation
    expect(q.parameters).toEqual([{ name: "@ownerId", value: "u1" }]);
    expect(opts).toEqual({ partitionKey: "u1", maxItemCount: 5, continuationToken: "prev" });

    const last = stub({
      query: () => ({ resources: rows, hasMoreResults: false, continuationToken: "stale" }),
    });
    expect((await last.repo.list("u1", 5)).continuationToken).toBeUndefined();
    expect(
      (last.calls[0]!.args[1] as Record<string, unknown>)["continuationToken"],
    ).toBeUndefined();
  });

  it("counts: parameterized and scoped to the owner's partition", async () => {
    const { repo, calls } = stub({ query: () => ({ resources: [3] }) });
    expect(await repo.countActiveSince("u1", "2026-10-14T00:00:00Z")).toBe(3);
    expect(await repo.countCreatedSince("u1", "2026-10-14T00:00:00Z")).toBe(3);
    for (const c of calls) {
      expect((c.args[1] as { partitionKey: string }).partitionKey).toBe("u1");
      expect((c.args[0] as { query: string }).query).not.toContain("u1");
    }
  });
});
