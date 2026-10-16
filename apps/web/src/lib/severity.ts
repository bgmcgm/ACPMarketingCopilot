import type {
  AuditCategory,
  FindingStatus,
  Severity,
  TechnicalFinding,
} from "@mcopilot/shared-types";

export type Tone = "critical" | "warning" | "passed" | "neutral";

/** Abbildung laut Spezifikation: Critical = rot, Warning = gelb/orange, Passed = grün. */
export function findingTone(f: Pick<TechnicalFinding, "status" | "severity">): Tone {
  const status: FindingStatus = f.status;
  const severity: Severity = f.severity;
  if (status === "not_applicable") return "neutral";
  if (status === "passed") return "passed";
  if (severity === "info") return "neutral";
  if (status === "failed" && (severity === "critical" || severity === "high")) return "critical";
  return "warning";
}

export const TONE_LABEL: Record<Tone, string> = {
  critical: "Critical",
  warning: "Warning",
  passed: "Passed",
  neutral: "Info",
};

export const TONE_CLASSES: Record<Tone, { badge: string; dot: string }> = {
  critical: { badge: "bg-red-50 text-red-800 ring-red-200", dot: "bg-red-600" },
  warning: { badge: "bg-amber-50 text-amber-900 ring-amber-200", dot: "bg-amber-500" },
  passed: { badge: "bg-emerald-50 text-emerald-800 ring-emerald-200", dot: "bg-emerald-600" },
  neutral: { badge: "bg-slate-100 text-slate-700 ring-slate-200", dot: "bg-slate-400" },
};

const TONE_ORDER: Record<Tone, number> = { critical: 0, warning: 1, neutral: 2, passed: 3 };

export const compareFindings = (a: TechnicalFinding, b: TechnicalFinding): number =>
  TONE_ORDER[findingTone(a)] - TONE_ORDER[findingTone(b)];

export const CATEGORY_LABEL: Record<AuditCategory, string> = {
  seo: "SEO",
  tracking: "Tracking",
  consent: "Consent",
  content: "Content",
  conversion: "Conversion",
  geo: "GEO / KI-Sichtbarkeit",
};

/** Consent-Ergebnisse sind Indikatoren aus statischem HTML, kein Rechtsurteil. */
export const CATEGORY_NOTE: Partial<Record<AuditCategory, string>> = {
  consent: "Indikatoren aus dem initialen HTML – keine rechtliche Bewertung.",
  geo: "Technische Voraussetzungen für KI-Antworten – keine Messung, ob die Seite tatsächlich zitiert wird.",
};

export const CATEGORY_ORDER: AuditCategory[] = [
  "seo",
  "tracking",
  "consent",
  "content",
  "conversion",
  "geo",
];

export type ScoreBand = "good" | "fair" | "poor";
export const scoreBand = (score: number): ScoreBand =>
  score >= 80 ? "good" : score >= 60 ? "fair" : "poor";

export const SCORE_CLASSES: Record<ScoreBand, { text: string; bar: string }> = {
  good: { text: "text-emerald-700", bar: "bg-emerald-600" },
  fair: { text: "text-amber-700", bar: "bg-amber-500" },
  poor: { text: "text-red-700", bar: "bg-red-600" },
};

export const AI_SEVERITY_LABEL: Record<"high" | "medium" | "low", string> = {
  high: "Hoch",
  medium: "Mittel",
  low: "Niedrig",
};

export const OWNER_LABEL: Record<string, string> = {
  marketing: "Marketing",
  content: "Content",
  web_dev: "Web-Entwicklung",
  legal_privacy: "Legal / Datenschutz",
  analytics: "Analytics",
};

export const AUDIT_ERROR_TEXT: Record<string, string> = {
  TARGET_BLOCKED: "Diese URL darf aus Sicherheitsgründen nicht abgerufen werden.",
  FETCH_FAILED: "Die Seite konnte nicht abgerufen werden.",
  FETCH_TIMEOUT: "Die Seite hat zu lange für eine Antwort gebraucht.",
  RESPONSE_TOO_LARGE: "Die Seite ist zu groß für die Analyse.",
  TOO_MANY_REDIRECTS: "Die URL leitet zu oft weiter.",
  UNSUPPORTED_CONTENT_TYPE: "Unter dieser URL liegt keine HTML-Seite.",
  ANALYSIS_FAILED: "Die Seite konnte nicht analysiert werden.",
  INTERNAL_ERROR: "Bei der Verarbeitung ist ein interner Fehler aufgetreten.",
};
