import type { AuditReportDto, AuditStatusDto, TechnicalFinding } from "@mcopilot/shared-types";

export const finding = (
  over: Partial<TechnicalFinding> & Pick<TechnicalFinding, "ruleId">,
): TechnicalFinding => ({
  category: "seo",
  status: "failed",
  severity: "medium",
  evidence: {},
  message: "Befund",
  source: "measured",
  ...over,
});

export const FINDINGS: TechnicalFinding[] = [
  finding({
    ruleId: "SEO_META_DESCRIPTION",
    message: "Keine Meta Description gefunden.",
    severity: "medium",
    evidence: { metaDescription: null },
  }),
  finding({
    ruleId: "SEO_ROBOTS_NOINDEX",
    message: "Seite ist auf noindex gesetzt.",
    severity: "critical",
  }),
  finding({ ruleId: "SEO_TITLE", status: "passed", severity: "high", message: "Title vorhanden." }),
  finding({
    ruleId: "CONSENT_CMP_DETECTED",
    category: "consent",
    status: "passed",
    severity: "high",
    message: "CMP erkannt: OneTrust.",
  }),
];

export const report = (over: Partial<AuditReportDto> = {}): AuditReportDto => ({
  audit: {
    id: "a1",
    url: "https://example.com/",
    finalUrl: "https://example.com/final",
    status: "completed",
    createdAt: "2026-10-14T12:00:00Z",
    completedAt: "2026-10-14T12:01:00Z",
    rulesetVersion: "1.0.0",
  },
  score: {
    overall: 72,
    categories: { seo: 60, tracking: 90, consent: 65, content: 82, conversion: null },
    weightsApplied: {},
    configVersion: "1.0.0",
  },
  criticalIssues: FINDINGS.filter((f) => f.severity === "critical"),
  technical: { findings: FINDINGS },
  ai: {
    status: "completed",
    provider: "anthropic",
    model: "m",
    promptVersion: "1",
    source: "ai",
    result: {
      executiveSummary: "Die Value Proposition ist verständlich, der CTA kommt zu spät.",
      marketingFindings: [
        {
          category: "conversion",
          severity: "medium",
          finding: "CTA erscheint erst am Seitenende.",
          recommendation: "CTA im oberen Drittel platzieren.",
          confidence: "medium",
        },
      ],
      priorities: [
        { priority: 2, action: "Meta Description ergänzen", ownerType: "content" },
        { priority: 1, action: "CTA nach oben verschieben", ownerType: "marketing" },
      ],
      limitations: ["Nur statisches HTML ausgewertet."],
    },
  },
  recommendedActions: [
    { priority: 2, action: "Meta Description ergänzen", ownerType: "content" },
    { priority: 1, action: "CTA nach oben verschieben", ownerType: "marketing" },
  ],
  ...over,
});

export const status = (over: Partial<AuditStatusDto> = {}): AuditStatusDto => ({
  id: "a1",
  status: "queued",
  url: "https://example.com/",
  modules: ["seo"],
  createdAt: "2026-10-14T12:00:00Z",
  ...over,
});

export const jsonResponse = (statusCode: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status: statusCode });
