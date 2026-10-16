/**
 * Lokaler Demo-Modus (npm run demo). NICHT Teil des Produktionspfads.
 *
 * Betreibt die echte Anwendungslogik (SafeFetcher, Analyzer, Rules Engine, Scoring, AuditService,
 * Handlers, AuditPipeline) in einem einzigen Prozess. Ersetzt nur die Azure-Infrastruktur:
 * Cosmos DB → Arbeitsspeicher, Storage Queue → In-Process-Queue, Login → fester Demo-Benutzer.
 * Die KI-Bewertung läuft nur, wenn AI_MODEL und ANTHROPIC_API_KEY gesetzt sind; sonst ist sie "skipped".
 */
import Anthropic from "@anthropic-ai/sdk";
import { existsSync, readFileSync, statSync } from "node:fs";
import http from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { AuditQueueMessage } from "@mcopilot/shared-types";
import { ClaudeProvider, DisabledAiProvider } from "../ai/claudeProvider.js";
import type { AiProvider } from "../ai/provider.js";
import { defaultUrlPolicy } from "../fetcher/urlValidator.js";
import { SafeFetcher, type PageFetcher } from "../fetcher/safeFetcher.js";
import { Handlers, type ApiRequest, type ApiResponse, type Logger } from "../http/handlers.js";
import type { JobQueue } from "../persistence/ports.js";
import { defaultRuleset } from "../rules/index.js";
import { defaultScoringConfig } from "../scoring/scoring.js";
import { AuditService } from "../services/auditService.js";
import { AuditPipeline } from "../worker/auditPipeline.js";
import { InMemoryAuditRepository } from "./inMemoryAuditRepository.js";

export const DEMO_USER = { userId: "demo-user", userDetails: "demo@lokal" };

const DEMO_PRINCIPAL = Buffer.from(
  JSON.stringify({
    identityProvider: "demo",
    userId: DEMO_USER.userId,
    userDetails: DEMO_USER.userDetails,
    userRoles: ["anonymous", "authenticated"],
  }),
).toString("base64");

/** Führt Jobs im selben Prozess aus und wiederholt sie wie die echte Queue (maxDequeueCount = 3). */
class InProcessQueue implements JobQueue {
  constructor(
    private readonly handle: (m: AuditQueueMessage) => Promise<void>,
    private readonly onPoison: (m: AuditQueueMessage) => Promise<void>,
    private readonly logger: Logger,
  ) {}
  async enqueue(message: AuditQueueMessage): Promise<void> {
    setImmediate(() => void this.run(message));
  }
  async ping(): Promise<void> {}
  private async run(message: AuditQueueMessage): Promise<void> {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await this.handle(message);
        return;
      } catch (err) {
        this.logger.warn("Verarbeitung fehlgeschlagen, Wiederholung", {
          attempt,
          error: String(err),
        });
      }
    }
    await this.onPoison(message).catch(() => undefined);
  }
}

export interface DemoOptions {
  fetcher?: PageFetcher;
  ai?: AiProvider;
  /** Verzeichnis mit dem gebauten Frontend (apps/web/dist); null = nur API. */
  webRoot?: string | null;
  logger?: Logger;
}

const consoleLogger: Logger = {
  info: (m, d) => console.log(`[info] ${m}`, d ?? ""),
  warn: (m, d) => console.warn(`[warn] ${m}`, d ?? ""),
  error: (m, d) => console.error(`[error] ${m}`, d ?? ""),
};

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".map": "application/json",
};

type Route = {
  method: string;
  pattern: RegExp;
  keys: string[];
  run: (h: Handlers) => (r: ApiRequest) => Promise<ApiResponse>;
};
const route = (method: string, path: string, run: Route["run"]): Route => {
  const keys: string[] = [];
  const pattern = new RegExp(
    `^${path.replace(/\{(\w+)\}/g, (_m, k: string) => (keys.push(k), "([^/]+)"))}$`,
  );
  return { method, pattern, keys, run };
};
const ROUTES: Route[] = [
  route("POST", "/api/audits", (h) => h.createAudit),
  route("GET", "/api/audits", (h) => h.listAudits),
  route("GET", "/api/audits/{auditId}", (h) => h.getAudit),
  route("GET", "/api/audits/{auditId}/report", (h) => h.getReport),
  route("DELETE", "/api/audits/{auditId}", (h) => h.deleteAudit),
  route("GET", "/api/rulesets", (h) => h.listRulesets),
  route("GET", "/api/health", (h) => h.health),
];

const MAX_BODY = 1_000_000;
const readBody = (req: http.IncomingMessage): Promise<string> =>
  new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) return void req.destroy(new Error("body too large"));
      chunks.push(c);
    });
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });

export function createDemoServer(opts: DemoOptions = {}): http.Server {
  const logger = opts.logger ?? consoleLogger;
  const repo = new InMemoryAuditRepository();
  const fetcher =
    opts.fetcher ??
    new SafeFetcher({
      ...defaultUrlPolicy,
      timeoutMs: 15_000,
      maxBytes: 2_097_152,
      maxRedirects: 5,
      userAgent: "MarketingCopilotAuditor/1.0 (+demo)",
    });
  const ai = opts.ai ?? new DisabledAiProvider();
  const pipeline = new AuditPipeline({
    repo,
    fetcher,
    ai,
    ruleset: defaultRuleset,
    scoring: defaultScoringConfig,
    logger,
  });
  const queue = new InProcessQueue(
    (m) => pipeline.process(m),
    (m) => pipeline.markPoisoned(m),
    logger,
  );
  const service = new AuditService({
    repo,
    queue,
    ruleset: defaultRuleset,
    scoring: defaultScoringConfig,
    urlPolicy: defaultUrlPolicy,
    auditTtlSeconds: 90 * 86_400,
    quotas: { maxActive: 3, maxPerDay: 200 },
  });
  const handlers = new Handlers({
    service,
    repo,
    queue,
    allowedRole: null,
    version: "demo",
    logger,
  });
  const webRoot = opts.webRoot ? resolve(opts.webRoot) : null;

  const serveStatic = (urlPath: string, res: http.ServerResponse): void => {
    if (!webRoot) return void res.writeHead(404).end("Frontend nicht gebaut (npm run build:web).");
    const requested = normalize(join(webRoot, decodeURIComponent(urlPath)));
    const inside = requested === webRoot || requested.startsWith(webRoot + sep);
    const file =
      inside && existsSync(requested) && statSync(requested).isFile()
        ? requested
        : join(webRoot, "index.html");
    if (!existsSync(file)) return void res.writeHead(404).end("Not found");
    res
      .writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" })
      .end(readFileSync(file));
  };

  return http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const method = req.method ?? "GET";

      if (url.pathname === "/.auth/me") {
        res
          .writeHead(200, { "content-type": "application/json" })
          .end(
            JSON.stringify({
              clientPrincipal: { userId: DEMO_USER.userId, userDetails: DEMO_USER.userDetails },
            }),
          );
        return;
      }
      if (!url.pathname.startsWith("/api/")) {
        if (method !== "GET") return void res.writeHead(405).end();
        return serveStatic(url.pathname, res);
      }

      for (const r of ROUTES) {
        const m = r.pattern.exec(url.pathname);
        if (!m || r.method !== method) continue;
        const text = method === "POST" ? await readBody(req).catch(() => "") : "";
        const apiReq: ApiRequest = {
          // Demo-Benutzer wird immer gesetzt (kein Login im Demo-Modus).
          headers: {
            get: (name) =>
              name.toLowerCase() === "x-ms-client-principal"
                ? DEMO_PRINCIPAL
                : ((req.headers[name.toLowerCase()] as string | undefined) ?? null),
          },
          params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1] ?? "")])),
          query: url.searchParams,
          json: async () => JSON.parse(text) as unknown,
        };
        const out = await r.run(handlers)(apiReq);
        res.writeHead(out.status, {
          ...(out.body !== undefined ? { "content-type": "application/json" } : {}),
          ...out.headers,
        });
        res.end(out.body !== undefined ? JSON.stringify(out.body) : undefined);
        return;
      }
      res
        .writeHead(404, { "content-type": "application/json" })
        .end('{"error":{"code":"NOT_FOUND","message":"Unbekannter Pfad."}}');
    })().catch((err: unknown) => {
      logger.error("Demo-Server-Fehler", { error: String(err) });
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
}

function aiFromEnv(logger: Logger): AiProvider {
  const model = process.env["AI_MODEL"]?.trim();
  const apiKey = process.env["ANTHROPIC_API_KEY"]?.trim();
  if (!model || !apiKey) {
    logger.info("KI-Bewertung aus (AI_MODEL und ANTHROPIC_API_KEY nicht gesetzt).");
    return new DisabledAiProvider();
  }
  logger.info(`KI-Bewertung an (Modell ${model}).`);
  return new ClaudeProvider(
    new Anthropic({ apiKey }),
    {
      model,
      timeoutMs: 60_000,
      maxOutputTokens: 4096,
      outputLanguage: process.env["AI_OUTPUT_LANGUAGE"] ?? "Deutsch",
    },
    logger,
  );
}

// Direkter Start: node dist/dev/demoServer.js
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env["DEMO_PORT"] ?? 7071);
  const webRoot = resolve(fileURLToPath(new URL("../../../web/dist", import.meta.url)));
  const server = createDemoServer({
    ai: aiFromEnv(consoleLogger),
    webRoot: existsSync(webRoot) ? webRoot : null,
  });
  // Nur lokal erreichbar.
  server.listen(port, "127.0.0.1", () => {
    console.log(
      `\nMarketing Copilot – Demo-Modus\n  Oberfläche: http://localhost:${port}\n  (Daten nur im Arbeitsspeicher, kein Login, Strg+C beendet)\n`,
    );
  });
}
