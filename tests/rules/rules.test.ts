import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AUDIT_CATEGORIES, type PageSnapshot, type TechnicalFinding } from "@mcopilot/shared-types";
import { analyzeHtml } from "../../apps/functions/src/analyzer/htmlAnalyzer.js";
import { defaultRuleset, evaluateRuleset } from "../../apps/functions/src/rules/index.js";

const load = (name: string): PageSnapshot =>
  analyzeHtml({
    html: readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"),
    url: "https://example.com/",
    finalUrl: "https://example.com/",
    statusCode: 200,
  });

const run = (page: PageSnapshot): Map<string, TechnicalFinding> =>
  new Map(evaluateRuleset(page, defaultRuleset, AUDIT_CATEGORIES).map((f) => [f.ruleId, f]));

describe("analyzer", () => {
  it("does not capture form values", () => {
    const json = JSON.stringify(load("good.html"));
    expect(json).not.toContain("secret@example.com");
  });
  it("ignores empty alt vs missing alt", () => {
    const p = load("good.html");
    expect(p.images.map((i) => i.alt)).toEqual(["Dashboard", ""]);
  });
});

describe("rules – good page", () => {
  const f = run(load("good.html"));
  it.each([
    "SEO_TITLE",
    "SEO_META_DESCRIPTION",
    "SEO_CANONICAL",
    "SEO_H1_COUNT",
    "SEO_IMG_ALT",
    "SEO_LANG",
    "SEO_VIEWPORT",
    "SEO_ROBOTS_NOINDEX",
    "SEO_OPEN_GRAPH",
    "TRACKING_GTM",
    "TRACKING_GA4",
    "TRACKING_HUBSPOT",
    "CONSENT_CMP_DETECTED",
    "CONSENT_PRIVACY_LINK",
    "CONSENT_IMPRINT_LINK",
    "CONSENT_FORM_CHECKBOX",
    "CONTENT_WORD_COUNT",
    "CONVERSION_CTA_PRESENT",
    "CONVERSION_FORM_PRESENT",
    "CONVERSION_DIRECT_CONTACT",
  ])("%s passes", (id) => {
    expect(f.get(id)?.status, JSON.stringify(f.get(id))).toBe("passed");
  });
  it("detects ids as evidence", () => {
    expect(f.get("TRACKING_GTM")?.evidence["containerIds"]).toEqual(["GTM-ABC123"]);
    expect(f.get("TRACKING_GA4")?.evidence["measurementIds"]).toEqual(["G-TEST123456"]);
  });
  it("hubspot tracking is treated as ungated, others gated by CMP pattern", () => {
    expect(f.get("CONSENT_TRACKING_BEFORE_CONSENT")?.status).toBe("warning");
    expect(f.get("CONSENT_TRACKING_BEFORE_CONSENT")?.evidence["ungatedVendors"]).toEqual([
      "HubSpot Tracking",
    ]);
  });
});

describe("rules – bad page", () => {
  const f = run(load("bad.html"));
  it("flags missing seo basics", () => {
    for (const id of [
      "SEO_TITLE",
      "SEO_META_DESCRIPTION",
      "SEO_CANONICAL",
      "SEO_LANG",
      "SEO_VIEWPORT",
    ])
      expect(f.get(id)?.status).toBe("failed");
    expect(f.get("SEO_META_DESCRIPTION")).toMatchObject({
      evidence: { metaDescription: null },
      message: "Keine Meta Description gefunden.",
      severity: "medium",
      source: "measured",
    });
  });
  it("flags noindex as critical failure", () => {
    expect(f.get("SEO_ROBOTS_NOINDEX")).toMatchObject({ status: "failed", severity: "critical" });
  });
  it("counts h1 and images without alt", () => {
    expect(f.get("SEO_H1_COUNT")).toMatchObject({ status: "warning", evidence: { h1Count: 2 } });
    expect(f.get("SEO_IMG_ALT")?.status).toBe("failed");
  });
  it("detects legacy UA and ungated trackers without CMP", () => {
    expect(f.get("TRACKING_LEGACY_UA")?.status).toBe("warning");
    expect(f.get("CONSENT_TRACKING_BEFORE_CONSENT")?.status).toBe("failed");
    expect(f.get("CONSENT_CMP_DETECTED")?.status).toBe("failed");
  });
  it("flags form without consent checkbox and generic links", () => {
    expect(f.get("CONSENT_FORM_CHECKBOX")?.status).toBe("warning");
    expect(f.get("CONTENT_GENERIC_LINK_TEXT")?.status).toBe("warning");
    expect(f.get("CONTENT_HEADING_HIERARCHY")?.status).toBe("warning");
  });
});

describe("engine", () => {
  it("only evaluates selected modules", () => {
    const out = evaluateRuleset(load("good.html"), defaultRuleset, ["seo"]);
    expect(new Set(out.map((x) => x.category))).toEqual(new Set(["seo"]));
  });
  it("survives a throwing rule", () => {
    const out = evaluateRuleset(
      load("good.html"),
      {
        id: "t",
        version: "1",
        rules: [
          {
            id: "BOOM",
            category: "seo",
            severity: "high",
            title: "",
            description: "",
            evaluate: () => {
              throw new Error("x");
            },
          },
        ],
      },
      ["seo"],
    );
    expect(out[0]).toMatchObject({ ruleId: "BOOM", status: "not_applicable" });
  });
  it("rule ids are unique", () => {
    const ids = defaultRuleset.rules.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
