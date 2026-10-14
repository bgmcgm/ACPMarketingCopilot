import { z } from "zod";
import type { AiAssessmentRecord } from "./ai.js";
import {
  AUDIT_CATEGORIES,
  AuditCategorySchema,
  type AuditCategory,
  type AuditErrorCode,
  type AuditScore,
  type AuditStatus,
  type Severity,
  type TechnicalFinding,
} from "./audit.js";

export const CreateAuditRequestSchema = z.object({
  url: z.string().trim().min(1).max(2048),
  modules: z
    .array(AuditCategorySchema)
    .min(1)
    .transform((m) => [...new Set(m)])
    .default([...AUDIT_CATEGORIES]),
});
export type CreateAuditRequest = z.infer<typeof CreateAuditRequestSchema>;

export const ListAuditsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  continuationToken: z.string().max(4096).optional(),
});
export type ListAuditsQuery = z.infer<typeof ListAuditsQuerySchema>;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(z.unknown()).optional(),
    correlationId: z.string().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const AuditQueueMessageSchema = z.object({
  schemaVersion: z.literal(1),
  auditId: z.string().uuid(),
  ownerId: z.string().min(1),
});
export type AuditQueueMessage = z.infer<typeof AuditQueueMessageSchema>;

// ---- Response-DTOs ----------------------------------------------------------

export interface CreateAuditResponse {
  id: string;
  status: AuditStatus;
}

export interface AuditSummaryDto {
  id: string;
  url: string;
  status: AuditStatus;
  createdAt: string;
  overallScore: number | null;
}

export interface ListAuditsResponse {
  items: AuditSummaryDto[];
  continuationToken?: string;
}

export interface AuditStatusDto {
  id: string;
  status: AuditStatus;
  url: string;
  modules: AuditCategory[];
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: { code: AuditErrorCode; message: string };
}

export interface AuditReportDto {
  audit: {
    id: string;
    url: string;
    finalUrl: string | null;
    status: AuditStatus;
    createdAt: string;
    completedAt: string | null;
    rulesetVersion: string;
  };
  score: AuditScore | null;
  /** Deterministisch aus den Findings abgeleitet (failed + critical/high). */
  criticalIssues: TechnicalFinding[];
  technical: { findings: TechnicalFinding[] };
  ai: AiAssessmentRecord | null;
  /** Aus der KI-Bewertung übernommen; leer, wenn keine KI-Bewertung vorliegt. */
  recommendedActions: NonNullable<AiAssessmentRecord["result"]>["priorities"];
}

export interface RulesetDto {
  id: string;
  version: string;
  rules: {
    ruleId: string;
    category: AuditCategory;
    severity: Severity;
    title: string;
    description: string;
  }[];
  scoring: {
    configVersion: string;
    categoryWeights: Record<AuditCategory, number>;
    severityWeights: Record<Severity, number>;
  };
}
