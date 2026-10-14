import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from "@azure/functions";
import { getContainer } from "../container.js";
import type { ApiRequest, ApiResponse, Handlers, Logger } from "./handlers.js";

const loggerFor = (ctx: InvocationContext): Logger => ({
  info: (m, d) => ctx.log(m, d ?? {}),
  warn: (m, d) => ctx.warn(m, d ?? {}),
  error: (m, d) => ctx.error(m, d ?? {}),
});

const toApiRequest = (req: HttpRequest): ApiRequest => ({
  headers: req.headers,
  params: req.params,
  query: req.query,
  json: () => req.json(),
});

const toInit = (res: ApiResponse): HttpResponseInit => ({
  status: res.status,
  ...(res.headers ? { headers: res.headers } : {}),
  ...(res.body !== undefined ? { jsonBody: res.body } : {}),
});

type Route = {
  name: string;
  methods: ("GET" | "POST" | "DELETE")[];
  route: string;
  handler: (h: Handlers) => (req: ApiRequest) => Promise<ApiResponse>;
};

const routes: Route[] = [
  { name: "createAudit", methods: ["POST"], route: "audits", handler: (h) => h.createAudit },
  { name: "listAudits", methods: ["GET"], route: "audits", handler: (h) => h.listAudits },
  { name: "getAudit", methods: ["GET"], route: "audits/{auditId}", handler: (h) => h.getAudit },
  {
    name: "getReport",
    methods: ["GET"],
    route: "audits/{auditId}/report",
    handler: (h) => h.getReport,
  },
  {
    name: "deleteAudit",
    methods: ["DELETE"],
    route: "audits/{auditId}",
    handler: (h) => h.deleteAudit,
  },
  { name: "listRulesets", methods: ["GET"], route: "rulesets", handler: (h) => h.listRulesets },
  { name: "health", methods: ["GET"], route: "health", handler: (h) => h.health },
];

export function registerHttpFunctions(): void {
  for (const r of routes) {
    app.http(r.name, {
      methods: r.methods,
      route: r.route,
      // Das Gate (SWA) liegt davor; die Funktion prüft den Principal selbst (siehe auth/principal.ts).
      authLevel: "anonymous",
      handler: async (req, ctx) => {
        const logger = loggerFor(ctx);
        try {
          const { handlers } = getContainer(logger);
          return toInit(await r.handler(handlers)(toApiRequest(req)));
        } catch (err) {
          logger.error("Initialisierung fehlgeschlagen", {
            error: err instanceof Error ? err.message : String(err),
          });
          return {
            status: 503,
            jsonBody: {
              error: { code: "SERVICE_UNAVAILABLE", message: "Dienst nicht verfügbar." },
            },
          };
        }
      },
    });
  }
}
