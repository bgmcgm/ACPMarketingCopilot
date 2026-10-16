import { z } from "zod";

export const AUDIT_CATEGORIES = [
  "seo",
  "tracking",
  "consent",
  "content",
  "conversion",
  "geo",
] as const;
export const AuditCategorySchema = z.enum(AUDIT_CATEGORIES);
export type AuditCategory = z.infer<typeof AuditCategorySchema>;

export const SeveritySchema = z.enum(["critical", "high", "medium", "low", "info"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const FindingStatusSchema = z.enum(["passed", "failed", "warning", "not_applicable"]);
export type FindingStatus = z.infer<typeof FindingStatusSchema>;

export const EvidenceValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.string()),
]);
export type EvidenceValue = z.infer<typeof EvidenceValueSchema>;

/** Deterministisch gemessenes Finding – ausschließlich von der Rules Engine erzeugt. */
export const TechnicalFindingSchema = z.object({
  ruleId: z.string().min(1),
  category: AuditCategorySchema,
  status: FindingStatusSchema,
  severity: SeveritySchema,
  evidence: z.record(EvidenceValueSchema),
  message: z.string(),
  source: z.literal("measured"),
});
export type TechnicalFinding = z.infer<typeof TechnicalFindingSchema>;

export const AuditScoreSchema = z.object({
  overall: z.number().min(0).max(100).nullable(),
  categories: z.record(AuditCategorySchema, z.number().min(0).max(100).nullable()),
  weightsApplied: z.record(AuditCategorySchema, z.number().min(0).max(1)),
  configVersion: z.string(),
});
export type AuditScore = z.infer<typeof AuditScoreSchema>;

export const AuditStatusSchema = z.enum(["queued", "running", "completed", "failed"]);
export type AuditStatus = z.infer<typeof AuditStatusSchema>;

export const AUDIT_ERROR_CODES = [
  "TARGET_BLOCKED",
  "FETCH_FAILED",
  "FETCH_TIMEOUT",
  "RESPONSE_TOO_LARGE",
  "TOO_MANY_REDIRECTS",
  "UNSUPPORTED_CONTENT_TYPE",
  "ANALYSIS_FAILED",
  "INTERNAL_ERROR",
] as const;
export const AuditErrorCodeSchema = z.enum(AUDIT_ERROR_CODES);
export type AuditErrorCode = z.infer<typeof AuditErrorCodeSchema>;
