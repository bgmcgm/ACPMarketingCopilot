import { ZodError } from "zod";
import {
  AuthError,
  CLIENT_PRINCIPAL_HEADER,
  parsePrincipal,
  type Principal,
} from "../auth/principal.js";
import type { AuditRepository, JobQueue } from "../persistence/ports.js";
import { ApiError } from "../services/errors.js";
import type { AuditService } from "../services/auditService.js";

/** Minimale, runtime-unabhängige Sicht auf Request/Response (Azure-Adapter in functions.ts). */
export interface ApiRequest {
  headers: { get(name: string): string | null };
  params: Record<string, string | undefined>;
  query: URLSearchParams;
  json(): Promise<unknown>;
}

export interface ApiResponse {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface Logger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

export interface HandlerDeps {
  service: AuditService;
  repo: AuditRepository;
  queue: JobQueue;
  allowedRole: string | null;
  version: string;
  logger: Logger;
  newCorrelationId?: () => string;
}

const MAX_BODY_BYTES = 10_000;

type Handler = (req: ApiRequest, principal: Principal) => Promise<ApiResponse>;

export class Handlers {
  constructor(private readonly d: HandlerDeps) {}

  createAudit = this.secured(async (req, p) => {
    // Eingaben sind winzig (URL + Modulliste); große Bodies werden gar nicht erst gelesen.
    const declared = Number(req.headers.get("content-length") ?? 0);
    if (declared > MAX_BODY_BYTES) throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Anfrage zu groß.");
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new ApiError(400, "VALIDATION_ERROR", "Ungültiger JSON-Body.");
    }
    const result = await this.d.service.create(p, body);
    return { status: 202, headers: { location: `/api/audits/${result.id}` }, body: result };
  });

  listAudits = this.secured(async (req, p) => ({
    status: 200,
    body: await this.d.service.list(p, Object.fromEntries(req.query)),
  }));

  getAudit = this.secured(async (req, p) => ({
    status: 200,
    body: await this.d.service.getStatus(p, req.params["auditId"] ?? ""),
  }));

  getReport = this.secured(async (req, p) => ({
    status: 200,
    body: await this.d.service.getReport(p, req.params["auditId"] ?? ""),
  }));

  deleteAudit = this.secured(async (req, p) => {
    await this.d.service.delete(p, req.params["auditId"] ?? "");
    return { status: 204 };
  });

  listRulesets = this.secured(async () => ({
    status: 200,
    body: { rulesets: this.d.service.rulesets() },
  }));

  /** Anonym: nur Liveness. `?deep=true` erfordert Anmeldung und prüft Abhängigkeiten. */
  health = async (req: ApiRequest): Promise<ApiResponse> => {
    if (req.query.get("deep") !== "true")
      return { status: 200, body: { status: "ok", version: this.d.version } };
    return this.run(req, async () => {
      parsePrincipal(req.headers.get(CLIENT_PRINCIPAL_HEADER), this.d.allowedRole);
      const check = async (fn: () => Promise<void>): Promise<"ok" | "failed"> =>
        fn().then(
          () => "ok" as const,
          () => "failed" as const,
        );
      const [cosmos, queue] = await Promise.all([
        check(() => this.d.repo.ping()),
        check(() => this.d.queue.ping()),
      ]);
      const ok = cosmos === "ok" && queue === "ok";
      return {
        status: ok ? 200 : 503,
        body: {
          status: ok ? "ok" : "degraded",
          version: this.d.version,
          checks: { cosmos, queue },
        },
      };
    });
  };

  private secured(handler: Handler): (req: ApiRequest) => Promise<ApiResponse> {
    return (req) =>
      this.run(req, () => {
        const principal = parsePrincipal(
          req.headers.get(CLIENT_PRINCIPAL_HEADER),
          this.d.allowedRole,
        );
        return handler(req, principal);
      });
  }

  private async run(_req: ApiRequest, fn: () => Promise<ApiResponse>): Promise<ApiResponse> {
    const correlationId = (this.d.newCorrelationId ?? (() => crypto.randomUUID()))();
    const fail = (
      status: number,
      code: string,
      message: string,
      details?: unknown[],
    ): ApiResponse => ({
      status,
      body: { error: { code, message, ...(details ? { details } : {}), correlationId } },
    });
    try {
      const res = await fn();
      return { ...res, headers: { ...res.headers, "x-correlation-id": correlationId } };
    } catch (err) {
      if (err instanceof AuthError)
        return fail(err.status, err.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN", err.message);
      if (err instanceof ZodError) {
        return fail(
          400,
          "VALIDATION_ERROR",
          "Ungültige Eingabe.",
          err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        );
      }
      if (err instanceof ApiError) return fail(err.status, err.code, err.message, err.details);
      // Keine Interna an den Client; Details nur ins Log.
      this.d.logger.error("Unbehandelter Fehler", {
        correlationId,
        error: err instanceof Error ? { name: err.name, message: err.message } : String(err),
      });
      return fail(500, "INTERNAL_ERROR", "Interner Fehler.");
    }
  }
}
