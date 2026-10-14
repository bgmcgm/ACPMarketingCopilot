import { describe, expect, it } from "vitest";
import type { TechnicalFinding } from "@mcopilot/shared-types";
import { compareFindings, findingTone, scoreBand } from "../../apps/web/src/lib/severity";

const f = (
  status: TechnicalFinding["status"],
  severity: TechnicalFinding["severity"],
): TechnicalFinding => ({
  ruleId: "X",
  category: "seo",
  status,
  severity,
  evidence: {},
  message: "m",
  source: "measured",
});

describe("findingTone (Critical=rot, Warning=gelb/orange, Passed=grün)", () => {
  it.each([
    ["failed", "critical", "critical"],
    ["failed", "high", "critical"],
    ["failed", "medium", "warning"],
    ["failed", "low", "warning"],
    ["warning", "high", "warning"],
    ["warning", "medium", "warning"],
    ["passed", "critical", "passed"],
    ["passed", "info", "passed"],
    ["failed", "info", "neutral"],
    ["warning", "info", "neutral"],
    ["not_applicable", "high", "neutral"],
  ] as const)("%s/%s → %s", (status, severity, tone) => {
    expect(findingTone(f(status, severity))).toBe(tone);
  });

  it("sorts critical before warning before neutral before passed", () => {
    const sorted = [
      f("passed", "low"),
      f("failed", "info"),
      f("warning", "medium"),
      f("failed", "critical"),
    ].sort(compareFindings);
    expect(sorted.map(findingTone)).toEqual(["critical", "warning", "neutral", "passed"]);
  });
});

describe("scoreBand", () => {
  it("bands scores", () => {
    expect([100, 80, 79, 60, 59, 0].map(scoreBand)).toEqual([
      "good",
      "good",
      "fair",
      "fair",
      "poor",
      "poor",
    ]);
  });
});
