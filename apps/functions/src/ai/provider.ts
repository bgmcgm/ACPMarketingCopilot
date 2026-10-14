import type {
  AiAssessmentRecord,
  AuditCategory,
  PageSnapshot,
  TechnicalFinding,
} from "@mcopilot/shared-types";

/** Ausschließlich die Informationen, die für die Marketing-Bewertung nötig sind. */
export interface AiAssessmentInput {
  page: {
    url: string;
    title: string | null;
    metaDescription: string | null;
    lang: string | null;
    headings: { level: number; text: string }[];
    visibleTextExcerpt: string;
  };
  technicalFindings: Pick<
    TechnicalFinding,
    "ruleId" | "category" | "status" | "severity" | "message" | "evidence"
  >[];
  modules: AuditCategory[];
}

/** Austauschbare KI-Abstraktion. Implementierungen werfen nicht: Fehler werden als `failed`-Record gemeldet. */
export interface AiProvider {
  assess(input: AiAssessmentInput): Promise<AiAssessmentRecord>;
}

const MAX_HEADINGS = 40;
const MAX_EXCERPT_CHARS = 4000;
const MAX_EVIDENCE_STRING = 300;

const trimEvidence = (evidence: TechnicalFinding["evidence"]): TechnicalFinding["evidence"] =>
  Object.fromEntries(
    Object.entries(evidence).map(([k, v]) => [
      k,
      typeof v === "string"
        ? v.slice(0, MAX_EVIDENCE_STRING)
        : Array.isArray(v)
          ? v.slice(0, 10).map((s) => s.slice(0, MAX_EVIDENCE_STRING))
          : v,
    ]),
  );

/** Reduziert Snapshot und Findings auf das, was Claude sehen darf (keine Skripte, Links, Formulardaten). */
export function buildAiInput(
  page: Pick<PageSnapshot, "title" | "metaDescription" | "lang" | "headings" | "visibleText">,
  url: string,
  findings: readonly TechnicalFinding[],
  modules: readonly AuditCategory[],
): AiAssessmentInput {
  return {
    page: {
      url,
      title: page.title,
      metaDescription: page.metaDescription,
      lang: page.lang,
      headings: page.headings
        .slice(0, MAX_HEADINGS)
        .map((h) => ({ level: h.level, text: h.text.slice(0, 200) })),
      visibleTextExcerpt: page.visibleText.slice(0, MAX_EXCERPT_CHARS),
    },
    technicalFindings: findings.map((f) => ({
      ruleId: f.ruleId,
      category: f.category,
      status: f.status,
      severity: f.severity,
      message: f.message,
      evidence: trimEvidence(f.evidence),
    })),
    modules: [...modules],
  };
}
