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
  AI_ENABLED: z.enum(["true", "false"]).default("true"),
  AI_MODEL: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_TIMEOUT_MS: int(60_000, 1000),
  AI_MAX_OUTPUT_TOKENS: int(4096, 256),
  AI_OUTPUT_LANGUAGE: z.string().min(1).default("Deutsch"),

  // Reviews-Modul (Inkrement R1) — optional; fehlen diese Werte, bleibt das Modul deaktiviert
  // (503 statt Startabbruch, siehe container.ts), analog zu AI_ENABLED=false.
  COSMOS_CLIENTS_CONTAINER: z.string().min(1).default("clients"),
  COSMOS_REVIEWS_CONTAINER: z.string().min(1).default("reviews"),
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().optional(),
  GOOGLE_OAUTH_STATE_SECRET: z.string().optional(),
  TOKEN_ENCRYPTION_KEY: z.string().optional(),
  REVIEW_AI_MODEL: z.string().optional(),
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
  ai:
    | { enabled: false }
    | {
        enabled: true;
        model: string;
        apiKey: string;
        timeoutMs: number;
        maxOutputTokens: number;
        outputLanguage: string;
      };
  reviews:
    | { enabled: false }
    | {
        enabled: true;
        clientsContainer: string;
        reviewsContainer: string;
        oauth: { clientId: string; clientSecret: string; redirectUri: string };
        stateSecret: string;
        tokenEncryptionKey: string;
        aiModel: string;
      };
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
  // Reviews-Modul: aktiviert, sobald alle Google-/Verschlüsselungswerte gesetzt sind; sonst
  // bleibt es deaktiviert (Handler antworten 503), kein Startabbruch — bewusst anders als AI_ENABLED,
  // das ein explizites Flag ist, weil dieses Modul rein optional und noch ungetestet ist (siehe known-gaps.md).
  const reviewsConfigured = Boolean(
    e.GOOGLE_OAUTH_CLIENT_ID?.trim() &&
    e.GOOGLE_OAUTH_CLIENT_SECRET?.trim() &&
    e.GOOGLE_OAUTH_REDIRECT_URI?.trim() &&
    e.GOOGLE_OAUTH_STATE_SECRET?.trim() &&
    e.TOKEN_ENCRYPTION_KEY?.trim(),
  );
  const reviewsAiModel = e.REVIEW_AI_MODEL?.trim() || e.AI_MODEL?.trim();
  if (reviewsConfigured && !reviewsAiModel) {
    throw new Error(
      "Ungültige Konfiguration: REVIEW_AI_MODEL oder AI_MODEL ist erforderlich, wenn das Reviews-Modul konfiguriert ist",
    );
  }

  const aiEnabled = e.AI_ENABLED === "true";
  if (aiEnabled && (!e.AI_MODEL?.trim() || !e.ANTHROPIC_API_KEY?.trim())) {
    throw new Error(
      "Ungültige Konfiguration: AI_MODEL und ANTHROPIC_API_KEY sind erforderlich, solange AI_ENABLED nicht 'false' ist",
    );
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
    ai: aiEnabled
      ? {
          enabled: true,
          model: (e.AI_MODEL as string).trim(),
          apiKey: (e.ANTHROPIC_API_KEY as string).trim(),
          timeoutMs: e.AI_TIMEOUT_MS,
          maxOutputTokens: e.AI_MAX_OUTPUT_TOKENS,
          outputLanguage: e.AI_OUTPUT_LANGUAGE,
        }
      : { enabled: false },
    reviews: reviewsConfigured
      ? {
          enabled: true,
          clientsContainer: e.COSMOS_CLIENTS_CONTAINER,
          reviewsContainer: e.COSMOS_REVIEWS_CONTAINER,
          oauth: {
            clientId: (e.GOOGLE_OAUTH_CLIENT_ID as string).trim(),
            clientSecret: (e.GOOGLE_OAUTH_CLIENT_SECRET as string).trim(),
            redirectUri: (e.GOOGLE_OAUTH_REDIRECT_URI as string).trim(),
          },
          stateSecret: (e.GOOGLE_OAUTH_STATE_SECRET as string).trim(),
          tokenEncryptionKey: (e.TOKEN_ENCRYPTION_KEY as string).trim(),
          aiModel: reviewsAiModel as string,
        }
      : { enabled: false },
  };
}
