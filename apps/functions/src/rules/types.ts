import type {
  AuditCategory,
  EvidenceValue,
  FindingStatus,
  PageSnapshot,
  Severity,
} from "@mcopilot/shared-types";

export interface RuleOutcome {
  status: FindingStatus;
  evidence: Record<string, EvidenceValue>;
  message: string;
}

/** Eine Regel ist eine reine Funktion auf dem PageSnapshot. */
export interface Rule {
  id: string;
  category: AuditCategory;
  /** Severity, mit der ein Fehlschlag gewichtet wird. */
  severity: Severity;
  title: string;
  description: string;
  evaluate(page: PageSnapshot): RuleOutcome;
}

export interface Ruleset {
  id: string;
  version: string;
  rules: readonly Rule[];
}
