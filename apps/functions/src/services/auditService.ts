import {
  CreateAuditRequestSchema,
  ListAuditsQuerySchema,
  type AuditReportDto,
  type AuditStatusDto,
  type CreateAuditResponse,
  type ListAuditsResponse,
  type RulesetDto,
} from "@mcopilot/shared-types";
import type { Principal } from "../auth/principal.js";
import type { AuditDocument } from "../domain/auditDocument.js";
import type { AuditRepository, JobQueue } from "../persistence/ports.js";
import type { Ruleset } from "../rules/types.js";
import type { ScoringConfig } from "../scoring/scoring.js";
import { UrlValidationError, validateUrl, type UrlPolicy } from "../fetcher/urlValidator.js";
import { ApiError, notFound } from "./errors.js";

export interface AuditServiceDeps {
  repo: AuditRepository;
  queue: JobQueue;
  ruleset: Ruleset;
  scoring: ScoringConfig;
  urlPolicy: UrlPolicy;
  auditTtlSeconds: number;
  quotas: { maxActive: number; maxPerDay: number };
  now?: () => Date;
  newId?: () => string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Audits, die länger als das als „aktiv“ gelten, blockieren die Quote nicht mehr (hängengebliebene Jobs). */
const ACTIVE_WINDOW_MS = 30 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export class AuditService {
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(private readonly d: AuditServiceDeps) {
    this.now = d.now ?? (() => new Date());
    this.newId = d.newId ?? (() => crypto.randomUUID());
  }

  async create(principal: Principal, body: unknown): Promise<CreateAuditResponse> {
    const req = CreateAuditRequestSchema.parse(body);

    let normalized: string;
    try {
      normalized = validateUrl(req.url, this.d.urlPolicy).toString();
    } catch (err) {
      if (err instanceof UrlValidationError)
        throw new ApiError(400, "URL_NOT_ALLOWED", err.message);
      throw err;
    }

    await this.enforceQuota(principal.userId);

    const now = this.now();
    const doc: AuditDocument = {
      id: this.newId(),
      ownerId: principal.userId,
      type: "audit",
      schemaVersion: 1,
      status: "queued",
      createdAt: now.toISOString(),
      attempts: 0,
      ttl: this.d.auditTtlSeconds,
      input: {
        url: req.url,
        normalizedUrl: normalized,
        modules: req.modules,
        rulesetId: this.d.ruleset.id,
        rulesetVersion: this.d.ruleset.version,
      },
    };

    await this.d.repo.create(doc);
    try {
      await this.d.queue.enqueue({ schemaVersion: 1, auditId: doc.id, ownerId: doc.ownerId });
    } catch (err) {
      // Kein verwaistes "queued"-Dokument zurücklassen.
      await this.d.repo.delete(doc.ownerId, doc.id).catch(() => undefined);
      throw err;
    }
    return { id: doc.id, status: doc.status };
  }

  async list(principal: Principal, query: unknown): Promise<ListAuditsResponse> {
    const q = ListAuditsQuerySchema.parse(query);
    const page = await this.d.repo.list(principal.userId, q.limit, q.continuationToken);
    return {
      items: page.items,
      ...(page.continuationToken ? { continuationToken: page.continuationToken } : {}),
    };
  }

  async getStatus(principal: Principal, auditId: string): Promise<AuditStatusDto> {
    const doc = await this.load(principal, auditId);
    return {
      id: doc.id,
      status: doc.status,
      url: doc.input.url,
      modules: doc.input.modules,
      createdAt: doc.createdAt,
      ...(doc.startedAt ? { startedAt: doc.startedAt } : {}),
      ...(doc.completedAt ? { completedAt: doc.completedAt } : {}),
      ...(doc.error ? { error: doc.error } : {}),
    };
  }

  async getReport(principal: Principal, auditId: string): Promise<AuditReportDto> {
    const doc = await this.load(principal, auditId);
    if (doc.status === "failed") {
      throw new ApiError(
        409,
        "AUDIT_FAILED",
        doc.error?.message ?? "Das Audit ist fehlgeschlagen.",
      );
    }
    if (doc.status !== "completed")
      throw new ApiError(409, "AUDIT_NOT_READY", "Das Audit ist noch nicht abgeschlossen.");

    const findings = doc.findings ?? [];
    return {
      audit: {
        id: doc.id,
        url: doc.input.url,
        finalUrl: doc.fetch?.finalUrl ?? null,
        status: doc.status,
        createdAt: doc.createdAt,
        completedAt: doc.completedAt ?? null,
        rulesetVersion: doc.input.rulesetVersion,
      },
      score: doc.score ?? null,
      criticalIssues: findings.filter(
        (f) => f.status === "failed" && (f.severity === "critical" || f.severity === "high"),
      ),
      technical: { findings },
      ai: doc.ai ?? null,
      recommendedActions: doc.ai?.result?.priorities ?? [],
    };
  }

  async delete(principal: Principal, auditId: string): Promise<void> {
    if (!UUID.test(auditId)) throw notFound();
    const deleted = await this.d.repo.delete(principal.userId, auditId);
    if (!deleted) throw notFound();
  }

  rulesets(): RulesetDto[] {
    const { ruleset, scoring } = this.d;
    return [
      {
        id: ruleset.id,
        version: ruleset.version,
        rules: ruleset.rules.map((r) => ({
          ruleId: r.id,
          category: r.category,
          severity: r.severity,
          title: r.title,
          description: r.description,
        })),
        scoring: {
          configVersion: scoring.version,
          categoryWeights: scoring.categoryWeights,
          severityWeights: scoring.severityWeights,
        },
      },
    ];
  }

  private async load(principal: Principal, auditId: string): Promise<AuditDocument> {
    if (!UUID.test(auditId)) throw notFound();
    // Fremde IDs treffen eine andere Partition → 404 (kein Existenz-Leak).
    const doc = await this.d.repo.get(principal.userId, auditId);
    if (!doc) throw notFound();
    return doc;
  }

  private async enforceQuota(ownerId: string): Promise<void> {
    const now = this.now().getTime();
    const [active, today] = await Promise.all([
      this.d.repo.countActiveSince(ownerId, new Date(now - ACTIVE_WINDOW_MS).toISOString()),
      this.d.repo.countCreatedSince(ownerId, new Date(now - DAY_MS).toISOString()),
    ]);
    if (active >= this.d.quotas.maxActive) {
      throw new ApiError(429, "QUOTA_EXCEEDED", "Zu viele laufende Audits. Bitte kurz warten.");
    }
    if (today >= this.d.quotas.maxPerDay) {
      throw new ApiError(429, "QUOTA_EXCEEDED", "Tageslimit für Audits erreicht.");
    }
  }
}
