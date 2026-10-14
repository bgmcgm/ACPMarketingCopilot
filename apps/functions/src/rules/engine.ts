import type { AuditCategory, TechnicalFinding } from "@mcopilot/shared-types";
import type { Ruleset } from "./types.js";

/**
 * Deterministische Auswertung. Eine Regel, die wirft, wird als nicht anwendbar
 * mit Fehlerhinweis protokolliert – sie darf den Audit nicht abbrechen.
 */
export function evaluateRuleset(
  page: Parameters<Ruleset["rules"][number]["evaluate"]>[0],
  ruleset: Ruleset,
  modules: readonly AuditCategory[],
): TechnicalFinding[] {
  return ruleset.rules
    .filter((r) => modules.includes(r.category))
    .map((rule): TechnicalFinding => {
      try {
        const outcome = rule.evaluate(page);
        return {
          ruleId: rule.id,
          category: rule.category,
          status: outcome.status,
          severity: rule.severity,
          evidence: outcome.evidence,
          message: outcome.message,
          source: "measured",
        };
      } catch {
        return {
          ruleId: rule.id,
          category: rule.category,
          status: "not_applicable",
          severity: "info",
          evidence: { error: "RULE_EVALUATION_FAILED" },
          message: "Regel konnte nicht ausgewertet werden.",
          source: "measured",
        };
      }
    });
}
