import type { AuditQueueMessage } from "@mcopilot/shared-types";
import type {
  AuditDocument,
  AuditSummaryRow,
} from "../../apps/functions/src/domain/auditDocument.js";
import { defaultUrlPolicy } from "../../apps/functions/src/fetcher/urlValidator.js";
import { Handlers, type ApiRequest, type Logger } from "../../apps/functions/src/http/handlers.js";
import type { AuditRepository, JobQueue } from "../../apps/functions/src/persistence/ports.js";
import { defaultRuleset } from "../../apps/functions/src/rules/index.js";
import { defaultScoringConfig } from "../../apps/functions/src/scoring/scoring.js";
import { AuditService } from "../../apps/functions/src/services/auditService.js";

/** In-Memory-Test-Doubles – nur im Test-Baum, nie im Produktionspfad. */
export class InMemoryAuditRepository implements AuditRepository {
  docs = new Map<string, AuditDocument>();
  failPing = false;
  private key = (o: string, id: string): string => `${o}/${id}`;

  async create(doc: AuditDocument): Promise<void> {
    this.docs.set(this.key(doc.ownerId, doc.id), structuredClone(doc));
  }
  async get(o: string, id: string): Promise<AuditDocument | null> {
    return structuredClone(this.docs.get(this.key(o, id)) ?? null);
  }
  async replace(doc: AuditDocument): Promise<void> {
    if (!this.docs.has(this.key(doc.ownerId, doc.id))) throw new Error("not found");
    this.docs.set(this.key(doc.ownerId, doc.id), structuredClone(doc));
  }
  async list(o: string, limit: number, token?: string) {
    const all = [...this.docs.values()]
      .filter((d) => d.ownerId === o)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const start = token ? Number(token) : 0;
    const items: AuditSummaryRow[] = all.slice(start, start + limit).map((d) => ({
      id: d.id,
      url: d.input.url,
      status: d.status,
      createdAt: d.createdAt,
      overallScore: d.score?.overall ?? null,
    }));
    const next = start + limit;
    return { items, ...(next < all.length ? { continuationToken: String(next) } : {}) };
  }
  async delete(o: string, id: string): Promise<boolean> {
    return this.docs.delete(this.key(o, id));
  }
  async countActiveSince(o: string, since: string): Promise<number> {
    return [...this.docs.values()].filter(
      (d) =>
        d.ownerId === o &&
        (d.status === "queued" || d.status === "running") &&
        d.createdAt >= since,
    ).length;
  }
  async countCreatedSince(o: string, since: string): Promise<number> {
    return [...this.docs.values()].filter((d) => d.ownerId === o && d.createdAt >= since).length;
  }
  async ping(): Promise<void> {
    if (this.failPing) throw new Error("down");
  }
}

export class InMemoryQueue implements JobQueue {
  messages: AuditQueueMessage[] = [];
  fail = false;
  async enqueue(m: AuditQueueMessage): Promise<void> {
    if (this.fail) throw new Error("queue down");
    this.messages.push(m);
  }
  async ping(): Promise<void> {
    if (this.fail) throw new Error("down");
  }
}

export const silentLogger: Logger & { errors: unknown[] } = {
  errors: [],
  info() {},
  warn() {},
  error(_m, d) {
    this.errors.push(d);
  },
};

export const principalHeader = (
  userId: string,
  roles: string[] = ["anonymous", "authenticated"],
): string =>
  Buffer.from(
    JSON.stringify({ identityProvider: "aad", userId, userDetails: "x", userRoles: roles }),
  ).toString("base64");

export interface Harness {
  handlers: Handlers;
  repo: InMemoryAuditRepository;
  queue: InMemoryQueue;
  service: AuditService;
  clock: { now: Date };
}

export function makeHarness(
  opts: { maxActive?: number; maxPerDay?: number; allowedRole?: string | null } = {},
): Harness {
  const repo = new InMemoryAuditRepository();
  const queue = new InMemoryQueue();
  const clock = { now: new Date("2026-10-14T12:00:00Z") };
  let n = 0;
  const service = new AuditService({
    repo,
    queue,
    ruleset: defaultRuleset,
    scoring: defaultScoringConfig,
    urlPolicy: defaultUrlPolicy,
    auditTtlSeconds: 90 * 86400,
    quotas: { maxActive: opts.maxActive ?? 3, maxPerDay: opts.maxPerDay ?? 50 },
    now: () => clock.now,
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  });
  const handlers = new Handlers({
    service,
    repo,
    queue,
    allowedRole: opts.allowedRole ?? null,
    version: "test",
    logger: silentLogger,
    newCorrelationId: () => "corr-1",
  });
  return { handlers, repo, queue, service, clock };
}

export const request = (
  init: {
    user?: string | null;
    roles?: string[];
    params?: Record<string, string>;
    query?: string;
    body?: unknown;
    rawBody?: string;
  } = {},
): ApiRequest => {
  const headers = new Map<string, string>();
  if (init.user !== null)
    headers.set("x-ms-client-principal", principalHeader(init.user ?? "user-1", init.roles));
  return {
    headers: { get: (n) => headers.get(n.toLowerCase()) ?? null },
    params: init.params ?? {},
    query: new URLSearchParams(init.query ?? ""),
    json: async () => {
      if (init.rawBody !== undefined) return JSON.parse(init.rawBody);
      return init.body;
    },
  };
};
