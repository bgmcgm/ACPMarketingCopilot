import type { AuditCategory, AuditErrorCode, AuditQueueMessage } from "@mcopilot/shared-types";
import { analyzeHtml } from "../analyzer/htmlAnalyzer.js";
import type { AuditDocument } from "../domain/auditDocument.js";
import { FetchError, type PageFetcher } from "../fetcher/safeFetcher.js";
import type { Logger } from "../http/handlers.js";
import type { AuditRepository } from "../persistence/ports.js";
import { evaluateRuleset } from "../rules/engine.js";
import type { Ruleset } from "../rules/types.js";
import { computeScore, type ScoringConfig } from "../scoring/scoring.js";
import { toPageRecord } from "./pageRecord.js";

export interface AuditPipelineDeps {
  repo: AuditRepository;
  fetcher: PageFetcher;
  ruleset: Ruleset;
  scoring: ScoringConfig;
  logger: Logger;
  /** Entspricht host.json maxDequeueCount. */
  maxAttempts?: number;
  now?: () => Date;
}

const TERMINAL = new Set(["completed", "failed"]);

/**
 * Orchestriert Audit-Flow Schritte 6–12.
 * - Deterministische Fehler (Fetch blockiert, kein HTML, Analysefehler) beenden die Nachricht ohne Retry.
 * - Transiente Fehler (z. B. Cosmos nicht erreichbar) werden geworfen → Queue-Retry → Poison Queue.
 */
export class AuditPipeline {
  private readonly maxAttempts: number;
  private readonly now: () => Date;

  constructor(private readonly d: AuditPipelineDeps) {
    this.maxAttempts = d.maxAttempts ?? 3;
    this.now = d.now ?? (() => new Date());
  }

  async process(msg: AuditQueueMessage): Promise<void> {
    const log = (message: string, data: Record<string, unknown> = {}): void =>
      this.d.logger.info(message, { auditId: msg.auditId, ...data });

    const doc = await this.d.repo.get(msg.ownerId, msg.auditId);
    if (!doc) {
      this.d.logger.warn("Audit nicht gefunden (gelöscht?) – Nachricht verworfen", {
        auditId: msg.auditId,
      });
      return;
    }
    if (TERMINAL.has(doc.status)) {
      log("Audit bereits abgeschlossen – Nachricht verworfen (Idempotenz)", { status: doc.status });
      return;
    }
    if (doc.attempts >= this.maxAttempts) {
      await this.fail(doc, "INTERNAL_ERROR", "Verarbeitung wiederholt fehlgeschlagen.");
      return;
    }

    const running: AuditDocument = {
      ...doc,
      status: "running",
      startedAt: doc.startedAt ?? this.now().toISOString(),
      attempts: doc.attempts + 1,
    };
    await this.d.repo.replace(running);
    log("Audit gestartet", { attempt: running.attempts, url: running.input.normalizedUrl });

    // Schritt 6: Website abrufen
    let fetched;
    try {
      fetched = await this.d.fetcher.fetch(running.input.normalizedUrl);
    } catch (err) {
      if (err instanceof FetchError) {
        this.d.logger.warn("Abruf fehlgeschlagen", { auditId: msg.auditId, code: err.code });
        await this.fail(running, err.code, err.message);
        return;
      }
      throw err; // unerwartet → Retry
    }

    // Schritte 7–10: Analyse, Regeln, Score
    let result: Pick<AuditDocument, "page" | "findings" | "score">;
    try {
      const snapshot = analyzeHtml({
        html: fetched.html,
        url: running.input.normalizedUrl,
        finalUrl: fetched.finalUrl,
        statusCode: fetched.statusCode,
      });
      const modules: AuditCategory[] = running.input.modules;
      const findings = evaluateRuleset(snapshot, this.d.ruleset, modules);
      result = {
        page: toPageRecord(snapshot),
        findings,
        score: computeScore(findings, modules, this.d.scoring),
      };
    } catch (err) {
      this.d.logger.error("Analyse fehlgeschlagen", {
        auditId: msg.auditId,
        error: err instanceof Error ? err.message : String(err),
      });
      await this.fail(running, "ANALYSIS_FAILED", "Die Seite konnte nicht analysiert werden.");
      return;
    }

    // Schritt 12: Ergebnis speichern
    const completed: AuditDocument = {
      ...running,
      status: "completed",
      completedAt: this.now().toISOString(),
      fetch: {
        finalUrl: fetched.finalUrl,
        redirectChain: fetched.redirectChain,
        statusCode: fetched.statusCode,
        contentType: fetched.contentType,
        bytes: fetched.bytes,
        durationMs: fetched.durationMs,
        fetchedAt: fetched.fetchedAt,
      },
      ...result,
    };
    await this.d.repo.replace(completed);
    log("Audit abgeschlossen", {
      overallScore: completed.score?.overall ?? null,
      findings: completed.findings?.length ?? 0,
    });
  }

  /** Für die Poison Queue: ein nie abgeschlossenes Audit darf nicht ewig "queued/running" bleiben. */
  async markPoisoned(msg: AuditQueueMessage): Promise<void> {
    const doc = await this.d.repo.get(msg.ownerId, msg.auditId);
    if (!doc || TERMINAL.has(doc.status)) return;
    await this.fail(doc, "INTERNAL_ERROR", "Verarbeitung wiederholt fehlgeschlagen.");
  }

  private async fail(doc: AuditDocument, code: AuditErrorCode, message: string): Promise<void> {
    await this.d.repo.replace({
      ...doc,
      status: "failed",
      completedAt: this.now().toISOString(),
      error: { code, message },
    });
  }
}
