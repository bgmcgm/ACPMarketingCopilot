import { describe, expect, it } from "vitest";
import { AUDIT_CATEGORIES, type TechnicalFinding } from "@mcopilot/shared-types";
import { analyzeHtml } from "../../apps/functions/src/analyzer/htmlAnalyzer.js";
import { defaultRuleset, evaluateRuleset } from "../../apps/functions/src/rules/index.js";
import { computeScore } from "../../apps/functions/src/scoring/scoring.js";

const run = (head: string): Map<string, TechnicalFinding> => {
  const page = analyzeHtml({
    html: `<html lang="de"><head><title>Titel der Seite hier</title>${head}</head><body><h1>x</h1></body></html>`,
    url: "https://example.com/",
    finalUrl: "https://example.com/",
    statusCode: 200,
  });
  return new Map(evaluateRuleset(page, defaultRuleset, AUDIT_CATEGORIES).map((f) => [f.ruleId, f]));
};
const trackingScore = (head: string): number | null => {
  const page = analyzeHtml({
    html: `<html><head>${head}</head><body></body></html>`,
    url: "https://example.com/",
    finalUrl: "https://example.com/",
    statusCode: 200,
  });
  return (
    computeScore(evaluateRuleset(page, defaultRuleset, ["tracking"]), ["tracking"]).categories
      .tracking ?? null
  );
};

const SAMPLES: [string, string][] = [
  [
    "Google Analytics 4",
    '<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123DEF4"></script>',
  ],
  ["Matomo", "<script>var _paq=window._paq=window._paq||[];_paq.push(['trackPageView']);</script>"],
  ["Matomo", '<script src="https://stats.example.com/matomo.js"></script>'],
  ["Piwik PRO", '<script src="https://example.containers.piwik.pro/abc.js"></script>'],
  ["Adobe Analytics", '<script src="https://assets.adobedtm.com/abc/launch-1.min.js"></script>'],
  ["etracker", '<script src="https://code.etracker.com/code/e.js"></script>'],
  ["econda", '<script src="/js/emos3.js"></script>'],
  ["Mixpanel", '<script src="https://cdn.mxpnl.com/libs/mixpanel-2-latest.min.js"></script>'],
  ["Amplitude", '<script src="https://cdn.amplitude.com/libs/amplitude-8.min.js"></script>'],
  [
    "Segment",
    '<script src="https://cdn.segment.com/analytics.js/v1/KEY/analytics.min.js"></script>',
  ],
  ["Heap", '<script src="https://cdn.heapanalytics.com/js/heap-123.js"></script>'],
  ["PostHog", '<script src="https://eu.i.posthog.com/static/array.js"></script>'],
  [
    "Plausible",
    '<script defer data-domain="example.com" src="https://plausible.io/js/script.js"></script>',
  ],
  ["Fathom", '<script src="https://cdn.usefathom.com/script.js" data-site="X"></script>'],
  [
    "Simple Analytics",
    '<script async src="https://scripts.simpleanalyticscdn.com/latest.js"></script>',
  ],
  [
    "Cloudflare Web Analytics",
    '<script defer src="https://static.cloudflareinsights.com/beacon.min.js"></script>',
  ],
  ["Vercel Analytics", '<script defer src="/_vercel/insights/script.js"></script>'],
  ["Umami", '<script defer src="https://cloud.umami.is/script.js" data-website-id="x"></script>'],
  ["HubSpot Tracking", '<script src="//js.hs-scripts.com/123.js"></script>'],
];

describe("TRACKING_ANALYTICS_PRESENT erkennt gängige Analytics-Dienste, nicht nur Google", () => {
  it.each(SAMPLES)("%s", (vendor, snippet) => {
    const f = run(snippet).get("TRACKING_ANALYTICS_PRESENT")!;
    expect(f.status, JSON.stringify(f)).toBe("passed");
    expect((f.evidence["vendors"] as string[]).join(",")).toContain(vendor);
  });
});

describe("Bewertung bei fehlendem oder unklarem Tracking", () => {
  it("Tag Manager ohne direkten Dienst: bestanden, aber ausdrücklich als nicht prüfbar gekennzeichnet", () => {
    const f = run(
      '<script src="https://www.googletagmanager.com/gtm.js?id=GTM-ABCD123"></script>',
    ).get("TRACKING_ANALYTICS_PRESENT")!;
    expect(f.status).toBe("passed");
    expect(f.evidence["viaTagManager"]).toBe(true);
    expect(f.message).toMatch(/nicht prüfbar/);
  });

  it("nichts erkannt: Warnung (nicht Fehler) mit Hinweis auf nachgeladene Tags", () => {
    const f = run("").get("TRACKING_ANALYTICS_PRESENT")!;
    expect(f.status).toBe("warning");
    expect(f.message).toMatch(/nachgeladen/);
  });

  it("nur Universal Analytics: Fehler, denn es wird nichts mehr gemessen", () => {
    const m = run(
      '<script src="https://www.google-analytics.com/analytics.js"></script><script>ga("create","UA-1234567-1")</script>',
    );
    expect(m.get("TRACKING_ANALYTICS_PRESENT")).toMatchObject({
      status: "failed",
      evidence: { legacyOnly: true },
    });
    expect(m.get("TRACKING_LEGACY_UA")?.status).toBe("warning");
  });

  it("GA4 neben altem UA zählt als aktive Messung", () => {
    const m = run(
      '<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123DEF4"></script><script>ga("create","UA-1234567-1")</script>',
    );
    expect(m.get("TRACKING_ANALYTICS_PRESENT")?.status).toBe("passed");
  });

  it("GA4 und GTM zugleich: Hinweis auf mögliches Doppel-Tracking; mehrere GA4-IDs ebenfalls", () => {
    const both = run(
      '<script src="https://www.googletagmanager.com/gtm.js?id=GTM-ABCD123"></script><script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123DEF4"></script>',
    );
    expect(both.get("TRACKING_DUPLICATE_GA4")?.status).toBe("warning");
    const two = run(
      "<script>gtag('config','G-AAAA111111');gtag('config','G-BBBB222222');</script>",
    );
    expect(two.get("TRACKING_DUPLICATE_GA4")?.status).toBe("warning");
    expect(
      run(
        '<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123DEF4"></script>',
      ).get("TRACKING_DUPLICATE_GA4")?.status,
    ).toBe("passed");
  });

  it("GA4, GTM und HubSpot einzeln sind nur noch Hinweise ohne Einfluss auf den Score", () => {
    const m = run("");
    for (const id of [
      "TRACKING_GA4",
      "TRACKING_GTM",
      "TRACKING_HUBSPOT",
      "TRACKING_TAG_MANAGER",
      "TRACKING_THIRD_PARTY_TAGS",
    ]) {
      expect(m.get(id)?.severity, id).toBe("info");
    }
  });
});

describe("Score: Seiten mit anderem Analytics-Dienst werden nicht mehr abgestraft", () => {
  it("Matomo/Plausible-Seite erreicht dasselbe Tracking-Ergebnis wie eine GA4-Seite", () => {
    const ga4 = trackingScore(
      '<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123DEF4"></script>',
    );
    expect(trackingScore('<script src="https://stats.example.com/matomo.js"></script>')).toBe(ga4);
    expect(trackingScore('<script src="https://plausible.io/js/script.js"></script>')).toBe(ga4);
    expect(ga4).toBe(100);
  });
  it("keine Messung erkannt: deutlich schlechter als mit Messung, aber nicht 'komplett durchgefallen'", () => {
    expect(trackingScore("")).toBeLessThan(100);
    expect(trackingScore("")).toBeGreaterThan(30);
    expect(
      trackingScore('<script src="https://www.google-analytics.com/analytics.js"></script>'),
    ).toBeLessThan(trackingScore("")!);
  });
});

describe("Zusammenspiel mit Consent", () => {
  it("cookielose Dienste (Plausible, Fathom …) lösen keine Consent-Fehler aus", () => {
    const m = run('<script src="https://plausible.io/js/script.js"></script>');
    expect(m.get("CONSENT_CMP_DETECTED")?.status).toBe("not_applicable");
    expect(m.get("CONSENT_TRACKING_BEFORE_CONSENT")?.status).toBe("not_applicable");
  });
  it("einwilligungsrelevante Dienste (Matomo, Mixpanel …) ohne CMP werden bemängelt", () => {
    for (const snippet of [
      '<script src="https://stats.example.com/matomo.js"></script>',
      '<script src="https://cdn.mxpnl.com/libs/mixpanel-2-latest.min.js"></script>',
    ]) {
      const m = run(snippet);
      expect(m.get("CONSENT_CMP_DETECTED")?.status).toBe("failed");
      expect(m.get("CONSENT_TRACKING_BEFORE_CONSENT")?.status).toBe("failed");
    }
  });
  it("durch CMP-Muster zurückgehaltener Dienst gilt als gesperrt", () => {
    const m = run(
      '<script type="text/plain" data-category="statistics" src="https://stats.example.com/matomo.js"></script><script src="https://cdn.cookielaw.org/x.js"></script>',
    );
    expect(m.get("CONSENT_TRACKING_BEFORE_CONSENT")?.status).toBe("passed");
  });
  it("ein inline gtag('config') ohne eigenen Lader zählt nicht als ungesperrter Tracker", () => {
    const m = run(
      '<script async type="text/plain" data-category="x" src="https://www.googletagmanager.com/gtag/js?id=G-ABC123DEF4"></script><script>gtag("config","G-ABC123DEF4")</script>',
    );
    expect(m.get("CONSENT_TRACKING_BEFORE_CONSENT")?.status).toBe("passed");
  });
});
