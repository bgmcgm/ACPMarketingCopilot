/**
 * Lokaler Demo-Modus (npm run demo). NICHT Teil des Produktionspfads.
 *
 * Betreibt die echte Anwendungslogik (SafeFetcher, Analyzer, Rules Engine, Scoring, AuditService,
 * Handlers, AuditPipeline) in einem einzigen Prozess. Ersetzt nur die Azure-Infrastruktur:
 * Cosmos DB → Arbeitsspeicher, Storage Queue → In-Process-Queue, Login → fester Demo-Benutzer.
 * Die KI-Bewertung läuft nur, wenn AI_MODEL und ANTHROPIC_API_KEY gesetzt sind; sonst ist sie "skipped".
 */
import Anthropic from "@anthropic-ai/sdk";
import { timingSafeEqual } from "node:crypto";
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
import {
  LoginRateLimiter,
  loginPage,
  parseCookie,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  SessionSigner,
} from "./loginSession.js";

export const DEMO_USER = { userId: "demo-user", userDetails: "demo@lokal" };

const principalFor = (user: { userId: string; userDetails: string }): string =>
  Buffer.from(
    JSON.stringify({
      identityProvider: "demo",
      userId: user.userId,
      userDetails: user.userDetails,
      userRoles: ["anonymous", "authenticated"],
    }),
  ).toString("base64");

/** Benutzername aus Basic-Auth: nur harmlose Zeichen, begrenzte Länge. */
export const sanitizeUserName = (raw: string): string =>
  raw
    .toLowerCase()
    .replace(/[^a-z0-9._@-]/g, "")
    .slice(0, 40);

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
  /**
   * Gemeinsames Passwort (HTTP Basic Auth) für den Betrieb auf einem Server für mehrere Personen.
   * Der Benutzername wird zur Benutzer-ID (jede Person sieht nur ihre eigenen Audits).
   * Ohne Passwort gibt es keine Anmeldung (nur für localhost).
   * Anmeldung per Anmeldeseite (/login) und Sitzungs-Cookie; HTTP Basic funktioniert weiter für Skripte.
   */
  password?: string;
  /** Uhr (Millisekunden) – nur für Tests. */
  now?: () => number;
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
const readBody = (req: http.IncomingMessage, limit = MAX_BODY): Promise<string> =>
  new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) return void req.destroy(new Error("body too large"));
      chunks.push(c);
    });
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });

const safeEqual = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** @returns den Benutzer oder null, wenn die Anmeldung fehlt/falsch ist. */
function authenticate(
  header: string | undefined,
  password: string,
): { userId: string; userDetails: string } | null {
  const m = /^Basic\s+(.+)$/i.exec(header ?? "");
  if (!m) return null;
  const decoded = Buffer.from(m[1] as string, "base64").toString("utf8");
  const idx = decoded.indexOf(":");
  if (idx < 0) return null;
  const name = sanitizeUserName(decoded.slice(0, idx));
  if (!name || !safeEqual(decoded.slice(idx + 1), password)) return null;
  return { userId: `user:${name}`, userDetails: name };
}

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
  const signer = new SessionSigner(undefined, opts.now);
  const limiter = new LoginRateLimiter(10, 5 * 60_000, opts.now);

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

      let user = DEMO_USER;
      if (opts.password) {
        const secure = req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
        const cookie = (value: string, maxAgeS: number): string =>
          `${SESSION_COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeS}${secure}`;
        const page = (status: number, message?: string): void =>
          void res
            .writeHead(status, {
              "content-type": "text/html; charset=utf-8",
              "cache-control": "no-store",
              "x-frame-options": "DENY",
              "content-security-policy":
                "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
            })
            .end(loginPage(message));
        const sessionName = signer.verify(parseCookie(req.headers.cookie, SESSION_COOKIE));
        const authed = sessionName
          ? { userId: `user:${sessionName}`, userDetails: sessionName }
          : authenticate(req.headers.authorization, opts.password);

        if (url.pathname === "/.auth/logout") {
          res.writeHead(303, { location: "/login", "set-cookie": cookie("", 0) }).end();
          return;
        }
        if (url.pathname === "/login") {
          if (method === "POST") {
            const ip = req.socket.remoteAddress ?? "unbekannt";
            if (limiter.blocked(ip))
              return page(
                429,
                "Zu viele Fehlversuche. Bitte in ein paar Minuten erneut versuchen.",
              );
            const form = new URLSearchParams(await readBody(req, 10_000).catch(() => ""));
            const name = sanitizeUserName(form.get("name") ?? "");
            const given = form.get("password") ?? "";
            if (name && safeEqual(given, opts.password)) {
              limiter.reset(ip);
              res
                .writeHead(303, {
                  location: "/",
                  "set-cookie": cookie(signer.issue(name), SESSION_TTL_MS / 1000),
                })
                .end();
              return;
            }
            limiter.fail(ip);
            return page(401, "Name oder Passwort falsch.");
          }
          if (method === "GET" && authed) return void res.writeHead(303, { location: "/" }).end();
          if (method === "GET") return page(200);
          return void res.writeHead(405).end();
        }
        if (!authed) {
          const wantsHtml = (req.headers.accept ?? "").includes("text/html");
          if (method === "GET" && wantsHtml && !url.pathname.startsWith("/api/")) {
            res.writeHead(303, { location: "/login" }).end();
          } else {
            res
              .writeHead(401, { "content-type": "text/plain; charset=utf-8" })
              .end("Anmeldung erforderlich.");
          }
          return;
        }
        user = authed;
      }

      if (url.pathname === "/.auth/me") {
        res.writeHead(200, { "content-type": "application/json" }).end(
          JSON.stringify({
            clientPrincipal: { userId: user.userId, userDetails: user.userDetails },
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
          // Der Benutzer wird serverseitig gesetzt; ein mitgeschickter Header wird ignoriert.
          headers: {
            get: (name) =>
              name.toLowerCase() === "x-ms-client-principal"
                ? principalFor(user)
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
  const host = process.env["DEMO_HOST"]?.trim() || "127.0.0.1";
  const password = process.env["DEMO_PASSWORD"]?.trim() || undefined;
  const loopback = ["127.0.0.1", "localhost", "::1"].includes(host);
  if (!loopback && (!password || password.length < 12)) {
    console.error(
      "Abbruch: Für DEMO_HOST außerhalb von localhost ist DEMO_PASSWORD (mindestens 12 Zeichen) Pflicht.\n" +
        "Ohne Anmeldung darf der Demo-Modus nicht im Netzwerk erreichbar sein.",
    );
    process.exit(1);
  }
  const server = createDemoServer({
    ai: aiFromEnv(consoleLogger),
    webRoot: existsSync(webRoot) ? webRoot : null,
    ...(password ? { password } : {}),
  });
  server.listen(port, host, () => {
    console.log(
      `\nMarketing Copilot – Demo-Modus\n  Adresse: http://${host === "0.0.0.0" ? "<server-name>" : host}:${port}\n` +
        `  ${password ? "Anmeldeseite: Name frei wählbar + gemeinsames Passwort (im Netz nur über HTTPS betreiben!)" : "Kein Login (nur lokal)"}\n` +
        "  Daten nur im Arbeitsspeicher, Strg+C beendet\n",
    );
  });
}
