import type {
  AuditCategory,
  AuditScore,
  FindingStatus,
  Severity,
  TechnicalFinding,
} from "@mcopilot/shared-types";
import { z } from "zod";

export const ScoringConfigSchema = z.object({
  version: z.string(),
  categoryWeights: z.object({
    seo: z.number().min(0),
    tracking: z.number().min(0),
    consent: z.number().min(0),
    content: z.number().min(0),
    conversion: z.number().min(0),
    // Optional für ältere Override-Konfigurationen: ohne Angabe fließt GEO nicht in den Gesamtscore ein.
    geo: z.number().min(0).default(0),
  }),
  severityWeights: z.object({
    critical: z.number().min(0),
    high: z.number().min(0),
    medium: z.number().min(0),
    low: z.number().min(0),
    info: z.number().min(0),
  }),
  statusCredit: z.object({
    passed: z.number().min(0).max(1),
    warning: z.number().min(0).max(1),
    failed: z.number().min(0).max(1),
  }),
});
export type ScoringConfig = z.infer<typeof ScoringConfigSchema>;

export const defaultScoringConfig: ScoringConfig = {
  version: "1.1.0",
  categoryWeights: { seo: 20, tracking: 20, consent: 15, content: 15, conversion: 15, geo: 15 },
  severityWeights: { critical: 10, high: 6, medium: 3, low: 1, info: 0 },
  statusCredit: { passed: 1, warning: 0.5, failed: 0 },
};

/** Lädt eine Override-Konfiguration (JSON) und validiert sie; Fehler werden nicht verschluckt. */
export function parseScoringConfig(json: string | undefined): ScoringConfig {
  if (!json) return defaultScoringConfig;
  return ScoringConfigSchema.parse(JSON.parse(json));
}

const round = (n: number): number => Math.round(n);

export function computeScore(
  findings: readonly TechnicalFinding[],
  modules: readonly AuditCategory[],
  config: ScoringConfig = defaultScoringConfig,
): AuditScore {
  const categories: Partial<Record<AuditCategory, number | null>> = {};

  for (const category of modules) {
    let earned = 0;
    let total = 0;
    for (const f of findings) {
      if (f.category !== category || f.status === "not_applicable") continue;
      const weight = config.severityWeights[f.severity as Severity];
      total += weight;
      earned += weight * config.statusCredit[f.status as Exclude<FindingStatus, "not_applicable">];
    }
    categories[category] = total === 0 ? null : round((100 * earned) / total);
  }

  // Gewichte nur über Kategorien mit Score, auf 1 renormalisiert.
  const scored = modules.filter((c) => categories[c] != null);
  const weightSum = scored.reduce((s, c) => s + config.categoryWeights[c], 0);
  const weightsApplied: Partial<Record<AuditCategory, number>> = {};
  let overall: number | null = null;
  if (weightSum > 0) {
    overall = 0;
    for (const c of scored) {
      const w = config.categoryWeights[c] / weightSum;
      weightsApplied[c] = w;
      overall += w * (categories[c] as number);
    }
    overall = round(overall);
  }

  return { overall, categories, weightsApplied, configVersion: config.version };
}
