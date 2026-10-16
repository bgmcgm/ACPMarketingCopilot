import type {
  AuditCategory,
  AuditErrorCode,
  AuditQueueMessage,
  PageSnapshot,
  SiteFile,
  SiteSignals,
} from "@mcopilot/shared-types";
import { analyzeHtml } from "../analyzer/htmlAnalyzer.js";
import { buildAiInput, type AiAssessmentInput, type AiProvider } from "../ai/provider.js";
import { PROMPT_VERSION } from "../ai/prompt.js";
import type { AuditDocument } from "../domain/auditDocument.js";
import { FetchError, type PageFetcher } from "../fetcher/safeFetcher.js";
import type { Logger } from "../http/handlers.js";
import type { AuditRepository } from "../persistence/ports.js";
import { evaluateRuleset } from "../rules/engine.js";
import type { Ruleset } from "../rules/types.js";
import { computeScore, type ScoringConfig } from "../scoring/scoring.js";
import { redactUrl } from "../lib/redact.js";
import { toPageRecord } from "./pageRecord.js";

export interface AuditPipelineDeps {
  repo: AuditRepository;
  fetcher: PageFetcher;
  ai: AiProvider;
  ruleset: Ruleset;
  scoring: ScoringConfig;
  logger: Logger;
  /** Entspricht host.json maxDequeueCount. */
  maxAttempts?: number;
  now?: () => Date;
}

const SITE_FILE_MAX_CHARS = 200_000;
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
    const claimed = await this.d.repo.claim(running);
    if (!claimed) {
      log("Audit wird bereits von einem anderen Worker verarbeitet – Nachricht verworfen");
      return;
    }
    log("Audit gestartet", {
      attempt: running.attempts,
      url: redactUrl(running.input.normalizedUrl),
    });

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
    let analysis: {
      record: Pick<AuditDocument, "page" | "findings" | "score">;
      aiInput: AiAssessmentInput;
    };
    const modules: AuditCategory[] = running.input.modules;
    // robots.txt/llms.txt nur abrufen, wenn das GEO-Modul gewählt ist (zwei zusätzliche, kleine Abrufe).
    const site = modules.includes("geo") ? await this.loadSiteSignals(fetched.finalUrl) : undefined;
    try {
      const snapshot: PageSnapshot = {
        ...analyzeHtml({
          html: fetched.html,
          url: running.input.normalizedUrl,
          finalUrl: fetched.finalUrl,
          statusCode: fetched.statusCode,
        }),
        ...(site ? { site } : {}),
      };
      const findings = evaluateRuleset(snapshot, this.d.ruleset, modules);
      analysis = {
        record: {
          page: toPageRecord(snapshot),
          findings,
          score: computeScore(findings, modules, this.d.scoring),
        },
        aiInput: buildAiInput(snapshot, running.input.normalizedUrl, findings, modules),
      };
    } catch (err) {
      this.d.logger.error("Analyse fehlgeschlagen", {
        auditId: msg.auditId,
        error: err instanceof Error ? err.message : String(err),
      });
      await this.fail(running, "ANALYSIS_FAILED", "Die Seite konnte nicht analysiert werden.");
      return;
    }

    // Schritte 9–11: KI-Bewertung. Ein KI-Fehler lässt das Audit nicht scheitern (technischer Report bleibt gültig).
    const ai = await this.assessSafely(analysis.aiInput, msg.auditId);

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
      ...analysis.record,
      ai,
    };
    await this.d.repo.replace(completed);
    log("Audit abgeschlossen", {
      overallScore: completed.score?.overall ?? null,
      findings: completed.findings?.length ?? 0,
    });
  }

  private async assessSafely(
    input: AiAssessmentInput,
    auditId: string,
  ): Promise<NonNullable<AuditDocument["ai"]>> {
    try {
      return await this.d.ai.assess(input);
    } catch (err) {
      // Provider sollen nicht werfen; falls doch, wird der Fehler wie ein Providerfehler behandelt.
      this.d.logger.error("KI-Provider hat unerwartet geworfen", {
        auditId,
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        status: "failed",
        provider: "anthropic",
        model: "unknown",
        promptVersion: PROMPT_VERSION,
        source: "ai",
        error: { code: "PROVIDER_ERROR", message: "Die KI-Bewertung ist derzeit nicht verfügbar." },
      };
    }
  }

  /**
   * Holt robots.txt und llms.txt vom Ursprung der (final aufgelösten) Seite. Wirft nie:
   * fehlende Dateien (404/410, keine Textdatei) gelten als "missing", alles andere als "unavailable".
   */
  private async loadSiteSignals(finalUrl: string): Promise<SiteSignals> {
    const origin = new URL(finalUrl).origin;
    const load = async (path: string, types: string[], maxBytes: number): Promise<SiteFile> => {
      try {
        const res = await this.d.fetcher.fetch(`${origin}${path}`, {
          allowedContentTypes: types,
          maxBytes,
        });
        return { status: "found", content: res.html.slice(0, SITE_FILE_MAX_CHARS) };
      } catch (err) {
        if (
          err instanceof FetchError &&
          (err.httpStatus === 404 ||
            err.httpStatus === 410 ||
            err.code === "UNSUPPORTED_CONTENT_TYPE")
        ) {
          return { status: "missing" };
        }
        this.d.logger.warn("Site-Datei nicht abrufbar", {
          path,
          code: err instanceof FetchError ? err.code : "UNKNOWN",
        });
        return { status: "unavailable" };
      }
    };
    const [robotsTxt, llmsTxt] = await Promise.all([
      load("/robots.txt", ["text/plain"], 512 * 1024),
      load("/llms.txt", ["text/plain", "text/markdown"], 256 * 1024),
    ]);
    return { robotsTxt, llmsTxt };
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
