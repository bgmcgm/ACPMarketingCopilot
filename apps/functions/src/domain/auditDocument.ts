import type {
  AiAssessmentRecord,
  AuditCategory,
  AuditErrorCode,
  AuditScore,
  AuditStatus,
  PageSnapshot,
  TechnicalFinding,
} from "@mcopilot/shared-types";

/** Cosmos-Dokument eines Audits (Partition Key: ownerId). */
export interface AuditDocument {
  id: string;
  ownerId: string;
  type: "audit";
  schemaVersion: 1;
  status: AuditStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  attempts: number;
  ttl: number;
  input: {
    url: string;
    normalizedUrl: string;
    modules: AuditCategory[];
    rulesetId: string;
    rulesetVersion: string;
  };
  fetch?: {
    finalUrl: string;
    redirectChain: string[];
    statusCode: number;
    contentType: string;
    bytes: number;
    durationMs: number;
    fetchedAt: string;
  };
  /** Gekappter, öffentlicher Seiteninhalt (siehe Architektur, Abschnitt 5). */
  page?: Pick<
    PageSnapshot,
    "title" | "metaDescription" | "canonical" | "lang" | "headings" | "wordCount"
  > & {
    visibleTextExcerpt: string;
  };
  findings?: TechnicalFinding[];
  score?: AuditScore;
  ai?: AiAssessmentRecord;
  error?: { code: AuditErrorCode; message: string };
}

export interface AuditSummaryRow {
  id: string;
  url: string;
  status: AuditStatus;
  createdAt: string;
  overallScore: number | null;
}
