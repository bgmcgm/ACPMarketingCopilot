import { z } from "zod";
import { parseScoringConfig, type ScoringConfig } from "../scoring/scoring.js";

const csv = (v: string | undefined): string[] =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const int = (def: number, min = 1): z.ZodType<number, z.ZodTypeDef, unknown> =>
  z.preprocess((v) => (v === undefined || v === "" ? def : Number(v)), z.number().int().min(min));

const EnvSchema = z.object({
  COSMOS_ENDPOINT: z.string().url(),
  COSMOS_DATABASE: z.string().min(1).default("marketingcopilot"),
  COSMOS_CONTAINER: z.string().min(1).default("audits"),
  STORAGE_QUEUE_ACCOUNT_NAME: z.string().min(1),
  AUDIT_QUEUE_NAME: z.string().min(1).default("audit-jobs"),
  FETCH_TIMEOUT_MS: int(10_000, 100),
  FETCH_MAX_BYTES: int(2_097_152, 1024),
  FETCH_MAX_REDIRECTS: int(5, 0),
  FETCH_ALLOWED_PORTS: z.string().optional(),
  DOMAIN_ALLOWLIST: z.string().optional(),
  SCORING_CONFIG_JSON: z.string().optional(),
  AUDIT_TTL_DAYS: int(90),
  MAX_ACTIVE_AUDITS_PER_USER: int(3),
  MAX_AUDITS_PER_USER_PER_DAY: int(50),
  ALLOWED_ROLE: z.string().optional(),
});

export interface AppConfig {
  cosmos: { endpoint: string; database: string; container: string };
  queue: { accountName: string; queueName: string };
  fetch: {
    timeoutMs: number;
    maxBytes: number;
    maxRedirects: number;
    allowedPorts: number[];
    domainAllowlist: string[];
  };
  scoring: ScoringConfig;
  auditTtlSeconds: number;
  quotas: { maxActive: number; maxPerDay: number };
  allowedRole: string | null;
}

/** Validiert die Umgebung beim Start; fehlende Pflichtwerte lassen den Start fehlschlagen. */
export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Ungültige Konfiguration: ${problems.join("; ")}`);
  }
  const e = parsed.data;
  const ports = csv(e.FETCH_ALLOWED_PORTS).map(Number);
  if (ports.some((p) => !Number.isInteger(p) || p < 1 || p > 65535)) {
    throw new Error("Ungültige Konfiguration: FETCH_ALLOWED_PORTS");
  }
  return {
    cosmos: {
      endpoint: e.COSMOS_ENDPOINT,
      database: e.COSMOS_DATABASE,
      container: e.COSMOS_CONTAINER,
    },
    queue: { accountName: e.STORAGE_QUEUE_ACCOUNT_NAME, queueName: e.AUDIT_QUEUE_NAME },
    fetch: {
      timeoutMs: e.FETCH_TIMEOUT_MS,
      maxBytes: e.FETCH_MAX_BYTES,
      maxRedirects: e.FETCH_MAX_REDIRECTS,
      allowedPorts: ports.length > 0 ? ports : [80, 443],
      domainAllowlist: csv(e.DOMAIN_ALLOWLIST),
    },
    scoring: parseScoringConfig(e.SCORING_CONFIG_JSON),
    auditTtlSeconds: e.AUDIT_TTL_DAYS * 86_400,
    quotas: { maxActive: e.MAX_ACTIVE_AUDITS_PER_USER, maxPerDay: e.MAX_AUDITS_PER_USER_PER_DAY },
    allowedRole: e.ALLOWED_ROLE?.trim() ? e.ALLOWED_ROLE.trim() : null,
  };
}
