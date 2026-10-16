import { describe, expect, it } from "vitest";
import type { PageSnapshot, SiteFile, TechnicalFinding } from "@mcopilot/shared-types";
import { analyzeHtml } from "../../apps/functions/src/analyzer/htmlAnalyzer.js";
import { defaultRuleset, evaluateRuleset } from "../../apps/functions/src/rules/index.js";
import { AI_BOTS } from "../../apps/functions/src/rules/geo.js";
import { computeScore } from "../../apps/functions/src/scoring/scoring.js";

const missing: SiteFile = { status: "missing" };
const found = (content: string): SiteFile => ({ status: "found", content });

function snapshot(
  html: string,
  site?: { robots?: SiteFile; llms?: SiteFile },
  finalUrl = "https://example.com/seite",
): PageSnapshot {
  const page = analyzeHtml({ html, url: finalUrl, finalUrl, statusCode: 200 });
  return site
    ? { ...page, site: { robotsTxt: site.robots ?? missing, llmsTxt: site.llms ?? missing } }
    : page;
}
const geo = (page: PageSnapshot): Map<string, TechnicalFinding> =>
  new Map(evaluateRuleset(page, defaultRuleset, ["geo"]).map((f) => [f.ruleId, f]));
const body = (inner: string, head = ""): string =>
  `<html lang="de"><head><title>Titel der Seite</title>${head}</head><body>${inner}</body></html>`;
const words = (n: number): string => Array.from({ length: n }, () => "wort").join(" ");

describe("GEO_AI_CRAWLER_ACCESS", () => {
  const rule = (robots: SiteFile) =>
    geo(snapshot(body(words(300)), { robots })).get("GEO_AI_CRAWLER_ACCESS")!;

  it("keine robots.txt oder offene robots.txt: bestanden", () => {
    expect(rule(missing).status).toBe("passed");
    expect(rule(found("User-agent: *\nAllow: /")).status).toBe("passed");
    expect(rule(found("User-agent: *\nDisallow: /admin")).status).toBe("passed");
  });

  it("alle Such-/Antwort-Crawler gesperrt: Fehler (hoch)", () => {
    const f = rule(found("User-agent: *\nDisallow: /"));
    expect(f).toMatchObject({ status: "failed", severity: "high" });
    expect(f.evidence["blockedAnswerBots"]).toContain("OAI-SearchBot");
    expect(f.evidence["blockedAnswerBots"]).toContain("PerplexityBot");
  });

  it("nur einzelne gesperrt: Warnung; Trainings-Crawler allein lösen keine Warnung aus", () => {
    expect(rule(found("User-agent: PerplexityBot\nDisallow: /")).status).toBe("warning");
    expect(
      rule(found("User-agent: GPTBot\nUser-agent: ClaudeBot\nUser-agent: CCBot\nDisallow: /"))
        .status,
    ).toBe("passed");
  });

  it("Sperre gilt pro Pfad der geprüften Seite", () => {
    const txt = "User-agent: OAI-SearchBot\nUser-agent: ChatGPT-User\nDisallow: /seite";
    const f = geo(snapshot(body(words(300)), { robots: found(txt) })).get("GEO_AI_CRAWLER_ACCESS")!;
    expect(f.status).toBe("warning");
    const home = geo(
      snapshot(body(words(300)), { robots: found(txt) }, "https://example.com/"),
    ).get("GEO_AI_CRAWLER_ACCESS")!;
    expect(home.status).toBe("passed");
  });

  it("nicht abrufbare robots.txt oder fehlende Prüfung: nicht anwendbar, nie Fehler", () => {
    expect(rule({ status: "unavailable" }).status).toBe("not_applicable");
    expect(geo(snapshot(body("x"))).get("GEO_AI_CRAWLER_ACCESS")?.status).toBe("not_applicable");
  });

  it("deckt die wichtigsten Crawler ab und trennt Training von Suche/Antwort", () => {
    const tokens = AI_BOTS.map((b) => b.token);
    for (const t of [
      "GPTBot",
      "OAI-SearchBot",
      "ChatGPT-User",
      "ClaudeBot",
      "Claude-SearchBot",
      "PerplexityBot",
      "Google-Extended",
      "CCBot",
    ]) {
      expect(tokens).toContain(t);
    }
    expect(AI_BOTS.find((b) => b.token === "GPTBot")?.purpose).toBe("training");
    expect(AI_BOTS.find((b) => b.token === "OAI-SearchBot")?.purpose).toBe("search");
  });
});

describe("GEO_TRAINING_CRAWLER_POLICY, GEO_ROBOTS_TXT, GEO_LLMS_TXT (nur Hinweise)", () => {
  it("melden Sperren als Richtlinie, nicht als Fehler, und haben keinen Einfluss auf den Score", () => {
    const m = geo(
      snapshot(body(words(300)), {
        robots: found("User-agent: GPTBot\nDisallow: /\nSitemap: https://example.com/s.xml"),
        llms: found("# Titel"),
      }),
    );
    expect(m.get("GEO_TRAINING_CRAWLER_POLICY")).toMatchObject({
      status: "passed",
      severity: "info",
    });
    expect(m.get("GEO_TRAINING_CRAWLER_POLICY")?.evidence["blockedTrainingBots"]).toEqual([
      "GPTBot",
    ]);
    expect(m.get("GEO_ROBOTS_TXT")).toMatchObject({ status: "passed", severity: "info" });
    expect(m.get("GEO_LLMS_TXT")).toMatchObject({ status: "passed", severity: "info" });
  });
  it("fehlende Dateien sind nur Hinweise", () => {
    const m = geo(snapshot(body("x"), {}));
    expect(m.get("GEO_ROBOTS_TXT")?.status).toBe("warning");
    expect(m.get("GEO_LLMS_TXT")?.status).toBe("warning");
    expect(m.get("GEO_LLMS_TXT")?.message).toMatch(/ohne bestätigte Wirkung/);
  });
});

describe("GEO_SNIPPET_CONTROLS", () => {
  const f = (head: string, inner = words(300)) =>
    geo(snapshot(body(inner, head))).get("GEO_SNIPPET_CONTROLS")!;
  it("nosnippet und max-snippet:0 sind Fehler; data-nosnippet eine Warnung; sonst bestanden", () => {
    expect(f('<meta name="robots" content="nosnippet">').status).toBe("failed");
    expect(f('<meta name="robots" content="index, max-snippet:0">').status).toBe("failed");
    expect(f('<meta name="robots" content="index, max-snippet:50">').status).toBe("passed");
    expect(f("", "<p data-nosnippet>geheim</p>").status).toBe("warning");
    expect(f('<meta name="robots" content="index,follow">').status).toBe("passed");
  });
});

describe("GEO_STRUCTURED_DATA und GEO_ENTITY_SIGNALS", () => {
  const ld = (obj: unknown) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
  const m = (head: string) => geo(snapshot(body(words(300), head)));

  it("ohne JSON-LD: Fehler; nur allgemeine Typen: Warnung; inhaltsbezogene Typen: bestanden", () => {
    expect(m("").get("GEO_STRUCTURED_DATA")?.status).toBe("failed");
    expect(m(ld({ "@type": "WebSite", name: "x" })).get("GEO_STRUCTURED_DATA")?.status).toBe(
      "warning",
    );
    expect(m(ld({ "@type": "Article", headline: "x" })).get("GEO_STRUCTURED_DATA")?.status).toBe(
      "passed",
    );
    expect(
      m(ld({ "@type": "https://schema.org/Product", name: "x" })).get("GEO_STRUCTURED_DATA")
        ?.status,
    ).toBe("passed");
    expect(
      m(
        ld({
          "@context": "https://schema.org",
          "@graph": [{ "@type": "Organization", name: "A" }, { "@type": "WebSite" }],
        }),
      ).get("GEO_STRUCTURED_DATA")?.status,
    ).toBe("passed");
  });

  it("Organisation mit sameAs-Profilen: bestanden; ohne: Warnung", () => {
    const withSameAs = ld({
      "@type": "Organization",
      name: "A",
      sameAs: ["https://www.linkedin.com/company/a", "https://www.wikidata.org/wiki/Q1"],
    });
    expect(m(withSameAs).get("GEO_ENTITY_SIGNALS")?.status).toBe("passed");
    expect(m(ld({ "@type": "Organization", name: "A" })).get("GEO_ENTITY_SIGNALS")?.status).toBe(
      "warning",
    );
    expect(m("").get("GEO_ENTITY_SIGNALS")?.status).toBe("warning");
  });

  it("ungültiges JSON-LD bringt nichts durcheinander", () => {
    expect(
      m('<script type="application/ld+json">{kaputt</script>').get("GEO_STRUCTURED_DATA")?.status,
    ).toBe("failed");
  });
});

describe("GEO_AUTHOR_DATE", () => {
  const f = (head: string, inner = words(300)) =>
    geo(snapshot(body(inner, head))).get("GEO_AUTHOR_DATE")!;
  it("Autor und Datum aus Meta-Tags, time-Element oder JSON-LD", () => {
    expect(
      f(
        '<meta name="author" content="Anna"><meta property="article:published_time" content="2026-01-01">',
      ).status,
    ).toBe("passed");
    expect(
      f("", '<a rel="author" href="/anna">Anna</a><time datetime="2026-01-01">1. Januar</time>')
        .status,
    ).toBe("passed");
    expect(
      f(
        `<script type="application/ld+json">${JSON.stringify({ "@type": "Article", author: { "@type": "Person", name: "A" }, datePublished: "2026-01-01" })}</script>`,
      ).status,
    ).toBe("passed");
  });
  it("nur eines von beiden oder keines: Warnung (niedrig)", () => {
    expect(f('<meta name="author" content="Anna">').status).toBe("warning");
    expect(f("", '<time datetime="2026-01-01">x</time>').status).toBe("warning");
    expect(f("")).toMatchObject({ status: "warning", severity: "low" });
  });
});

describe("GEO_ANSWER_STRUCTURE", () => {
  const f = (inner: string, head = "") =>
    geo(snapshot(body(inner, head))).get("GEO_ANSWER_STRUCTURE")!;
  const qs = "<h2>Was kostet das?</h2><p>a</p><h2>Wie funktioniert es?</h2><p>b</p>";
  const list = "<main><ul><li>a</li><li>b</li><li>c</li></ul></main>";
  const table = "<table><tr><td>a</td></tr></table>";

  it("zählt Merkmale: 0 = Fehler, 1 = Warnung, ≥2 = bestanden", () => {
    expect(f(`<p>${words(300)}</p>`).status).toBe("failed");
    expect(f(`${qs}`).status).toBe("warning");
    expect(f(`${qs}${list}`).status).toBe("passed");
    expect(f(`<main><ul><li>a</li><li>b</li><li>c</li></ul>${table}</main>`).status).toBe("passed");
  });
  it("Listen in Navigation/Fußbereich und kurze Listen zählen nicht", () => {
    expect(
      f(
        "<nav><ul><li>a</li><li>b</li><li>c</li></ul></nav><footer><ul><li>a</li><li>b</li><li>c</li></ul></footer>",
      ).status,
    ).toBe("failed");
    expect(f("<ul><li>a</li><li>b</li></ul>").status).toBe("failed");
  });
  it("FAQ-Markup und <details> zählen als Struktur", () => {
    const faq = `<script type="application/ld+json">${JSON.stringify({ "@type": "FAQPage", mainEntity: [] })}</script>`;
    expect(f(list, faq).status).toBe("passed");
    expect(
      f(`<details><summary>a</summary>x</details><details><summary>b</summary>y</details>${list}`)
        .status,
    ).toBe("passed");
  });
  it("Überschriften zählen nur mit Fragezeichen", () => {
    expect(f("<h2>Unsere Leistungen</h2><h2>Über uns</h2>").evidence["questionHeadings"]).toBe(0);
  });
});

describe("GEO_SERVER_RENDERED_CONTENT", () => {
  const scripts = (n: number) =>
    Array.from({ length: n }, (_, i) => `<script src="/a${i}.js"></script>`).join("");
  const f = (inner: string, head = "") =>
    geo(snapshot(body(inner, head))).get("GEO_SERVER_RENDERED_CONTENT")!;
  it("leere App-Hülle mit vielen Skripten: Fehler", () => {
    expect(f('<div id="root"></div>', scripts(6)).status).toBe("failed");
  });
  it("wenig Text und viele Skripte: Warnung; normaler Text: bestanden", () => {
    expect(f(`<p>${words(120)}</p>`, scripts(6)).status).toBe("warning");
    expect(f(`<p>${words(300)}</p>`, scripts(12)).status).toBe("passed");
    expect(f(`<p>${words(20)}</p>`, scripts(1)).status).toBe("passed"); // kurze statische Seite
  });
});

describe("Score des GEO-Moduls", () => {
  it("gute Seite erreicht einen hohen, schlechte einen niedrigen GEO-Score", () => {
    const good = snapshot(
      body(
        `<h1>x</h1><h2>Was ist X?</h2><p>${words(300)}</p><h2>Wie nutze ich X?</h2><ul><li>a</li><li>b</li><li>c</li></ul>`,
        `<meta name="author" content="Anna"><time datetime="2026-01-01"></time>` +
          `<script type="application/ld+json">${JSON.stringify({ "@type": "Organization", name: "A", sameAs: ["https://a.example/1", "https://a.example/2"] })}</script>`,
      ),
      { robots: found("User-agent: *\nAllow: /"), llms: found("# x") },
    );
    const bad = snapshot(
      body(
        '<div id="root"></div>',
        '<meta name="robots" content="nosnippet">' +
          Array.from({ length: 6 }, (_, i) => `<script src="/a${i}.js"></script>`).join(""),
      ),
      { robots: found("User-agent: *\nDisallow: /") },
    );
    const score = (p: PageSnapshot) =>
      computeScore(evaluateRuleset(p, defaultRuleset, ["geo"]), ["geo"]).categories.geo ?? -1;
    expect(score(good)).toBeGreaterThanOrEqual(90);
    expect(score(bad)).toBeLessThanOrEqual(15);
  });
});
