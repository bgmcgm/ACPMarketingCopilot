import { describe, expect, it } from "vitest";
import type { TechnicalFinding } from "@mcopilot/shared-types";
import {
  computeScore,
  defaultScoringConfig,
  parseScoringConfig,
} from "../../apps/functions/src/scoring/scoring.js";

const f = (
  category: TechnicalFinding["category"],
  status: TechnicalFinding["status"],
  severity: TechnicalFinding["severity"],
): TechnicalFinding => ({
  ruleId: "X",
  category,
  status,
  severity,
  evidence: {},
  message: "",
  source: "measured",
});

describe("scoring", () => {
  it("computes weighted category score", () => {
    const s = computeScore(
      [f("seo", "passed", "high"), f("seo", "failed", "high"), f("seo", "warning", "medium")],
      ["seo"],
    );
    // earned = 6 + 0 + 1.5 = 7.5 ; total = 15 → 50
    expect(s.categories.seo).toBe(50);
    expect(s.overall).toBe(50);
  });
  it("excludes not_applicable and gives null when nothing applies", () => {
    const s = computeScore([f("seo", "not_applicable", "high")], ["seo"]);
    expect(s.categories.seo).toBeNull();
    expect(s.overall).toBeNull();
  });
  it("renormalizes category weights over scored modules", () => {
    const s = computeScore(
      [f("seo", "passed", "high"), f("tracking", "failed", "high")],
      ["seo", "tracking", "consent"],
    );
    expect(s.weightsApplied.seo).toBeCloseTo(0.5);
    expect(s.weightsApplied.tracking).toBeCloseTo(0.5);
    expect(s.weightsApplied.consent).toBeUndefined();
    expect(s.overall).toBe(50);
  });
  it("info findings carry no weight", () => {
    expect(computeScore([f("seo", "failed", "info")], ["seo"]).categories.seo).toBeNull();
  });
  it("is deterministic and configurable", () => {
    const input = [f("seo", "passed", "low"), f("content", "failed", "low")];
    const a = computeScore(input, ["seo", "content"]);
    expect(computeScore(input, ["seo", "content"])).toEqual(a);
    const cfg = {
      ...defaultScoringConfig,
      categoryWeights: { ...defaultScoringConfig.categoryWeights, seo: 75, content: 25 },
    };
    expect(computeScore(input, ["seo", "content"], cfg).overall).toBe(75);
  });
  it("validates override config", () => {
    expect(parseScoringConfig(undefined)).toBe(defaultScoringConfig);
    expect(() => parseScoringConfig('{"version":"x"}')).toThrow();
    expect(parseScoringConfig(JSON.stringify(defaultScoringConfig))).toEqual(defaultScoringConfig);
  });
});
