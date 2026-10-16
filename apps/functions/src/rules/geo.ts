import type { PageSnapshot } from "@mcopilot/shared-types";
import { isAllowed, parseRobots } from "./robots.js";
import type { Rule, RuleOutcome } from "./types.js";

/**
 * GEO (Generative Engine Optimization): Technische Voraussetzungen, damit KI-Suchen und -Assistenten
 * eine Seite finden, verstehen und zitieren können. Gemessen wird nur, was sich im initialen HTML und in
 * robots.txt/llms.txt prüfen lässt – NICHT, ob die Seite in KI-Antworten tatsächlich genannt wird.
 *
 * Stand der Crawler-Liste: Oktober 2026 – Tokens regelmäßig gegen die Herstellerdokumentation prüfen.
 */
export type BotPurpose = "search" | "user" | "training";
export interface AiBot {
  token: string;
  vendor: string;
  purpose: BotPurpose;
}

export const AI_BOTS: readonly AiBot[] = [
  { token: "OAI-SearchBot", vendor: "OpenAI", purpose: "search" },
  { token: "ChatGPT-User", vendor: "OpenAI", purpose: "user" },
  { token: "GPTBot", vendor: "OpenAI", purpose: "training" },
  { token: "Claude-SearchBot", vendor: "Anthropic", purpose: "search" },
  { token: "Claude-User", vendor: "Anthropic", purpose: "user" },
  { token: "ClaudeBot", vendor: "Anthropic", purpose: "training" },
  { token: "anthropic-ai", vendor: "Anthropic", purpose: "training" },
  { token: "PerplexityBot", vendor: "Perplexity", purpose: "search" },
  { token: "Perplexity-User", vendor: "Perplexity", purpose: "user" },
  { token: "Google-Extended", vendor: "Google", purpose: "training" },
  { token: "Applebot-Extended", vendor: "Apple", purpose: "training" },
  { token: "CCBot", vendor: "Common Crawl", purpose: "training" },
  { token: "Bytespider", vendor: "ByteDance", purpose: "training" },
  { token: "Meta-ExternalAgent", vendor: "Meta", purpose: "training" },
];

const pathOf = (page: PageSnapshot): string => {
  try {
    const u = new URL(page.finalUrl);
    return `${u.pathname}${u.search}`;
  } catch {
    return "/";
  }
};

const NOT_CHECKED: RuleOutcome = {
  status: "not_applicable",
  evidence: { checked: false },
  message: "robots.txt wurde nicht geprüft.",
};
const UNAVAILABLE = (file: string): RuleOutcome => ({
  status: "not_applicable",
  evidence: { fileStatus: "unavailable" },
  message: `${file} war nicht abrufbar (Fehler oder gesperrt) – keine Aussage möglich.`,
});

const shortType = (t: string): string => t.slice(t.lastIndexOf("/") + 1);
const RICH_TYPES = new Set([
  "Organization",
  "Corporation",
  "LocalBusiness",
  "NGO",
  "Person",
  "Article",
  "NewsArticle",
  "BlogPosting",
  "Product",
  "Service",
  "SoftwareApplication",
  "FAQPage",
  "HowTo",
  "Event",
  "Course",
  "Recipe",
  "VideoObject",
  "Review",
  "JobPosting",
  "Offer",
  "Brand",
  "Question",
]);

export const geoRules: Rule[] = [
  {
    id: "GEO_AI_CRAWLER_ACCESS",
    category: "geo",
    severity: "high",
    title: "Zugriff für KI-Such- und Antwort-Crawler",
    description:
      "robots.txt sperrt die Crawler, die Seiten für KI-Antworten abrufen (OpenAI, Anthropic, Perplexity), nicht aus.",
    evaluate: (p) => {
      const site = p.site?.robotsTxt;
      if (!site) return NOT_CHECKED;
      if (site.status === "unavailable") return UNAVAILABLE("robots.txt");
      if (site.status === "missing" || !site.content) {
        return {
          status: "passed",
          evidence: { robotsTxt: "missing", blockedAnswerBots: [] },
          message: "Keine robots.txt – KI-Crawler sind nicht ausgeschlossen.",
        };
      }
      const robots = parseRobots(site.content);
      const path = pathOf(p);
      const answer = AI_BOTS.filter((b) => b.purpose !== "training");
      const blocked = answer.filter((b) => !isAllowed(robots, b.token, path)).map((b) => b.token);
      const evidence = {
        blockedAnswerBots: blocked,
        checkedAnswerBots: answer.map((b) => b.token),
        path,
      };
      if (blocked.length === 0) {
        return {
          status: "passed",
          evidence,
          message: "KI-Such- und Antwort-Crawler sind in robots.txt nicht ausgeschlossen.",
        };
      }
      return {
        status: blocked.length === answer.length ? "failed" : "warning",
        evidence,
        message:
          blocked.length === answer.length
            ? "robots.txt sperrt alle geprüften KI-Such- und Antwort-Crawler aus – die Seite kann nicht als Quelle in KI-Antworten genutzt werden."
            : `robots.txt sperrt einzelne KI-Such-/Antwort-Crawler aus: ${blocked.join(", ")}.`,
      };
    },
  },
  {
    id: "GEO_TRAINING_CRAWLER_POLICY",
    category: "geo",
    severity: "info",
    title: "Trainings-Crawler (Richtlinie)",
    description:
      "Welche Crawler für KI-Training in robots.txt ausgeschlossen sind (informativ, bewusste Entscheidung).",
    evaluate: (p) => {
      const site = p.site?.robotsTxt;
      if (!site) return NOT_CHECKED;
      if (site.status === "unavailable") return UNAVAILABLE("robots.txt");
      const robots = site.content ? parseRobots(site.content) : { groups: [], sitemaps: [] };
      const path = pathOf(p);
      const blocked = AI_BOTS.filter(
        (b) => b.purpose === "training" && !isAllowed(robots, b.token, path),
      ).map((b) => b.token);
      return {
        status: "passed",
        evidence: { blockedTrainingBots: blocked },
        message:
          blocked.length > 0
            ? `Für KI-Training ausgeschlossen: ${blocked.join(", ")}. Das ist eine Richtlinienentscheidung und kein Fehler.`
            : "Keine Trainings-Crawler ausgeschlossen.",
      };
    },
  },
  {
    id: "GEO_ROBOTS_TXT",
    category: "geo",
    severity: "info",
    title: "robots.txt",
    description: "robots.txt ist vorhanden und verweist auf eine Sitemap (informativ).",
    evaluate: (p) => {
      const site = p.site?.robotsTxt;
      if (!site) return NOT_CHECKED;
      if (site.status === "unavailable") return UNAVAILABLE("robots.txt");
      if (site.status === "missing" || !site.content) {
        return {
          status: "warning",
          evidence: { fileStatus: "missing" },
          message: "Keine robots.txt gefunden.",
        };
      }
      const { sitemaps } = parseRobots(site.content);
      return sitemaps.length > 0
        ? {
            status: "passed",
            evidence: { fileStatus: "found", sitemaps: sitemaps.slice(0, 5) },
            message: `robots.txt vorhanden, ${sitemaps.length} Sitemap-Verweis(e).`,
          }
        : {
            status: "warning",
            evidence: { fileStatus: "found", sitemaps: [] },
            message: "robots.txt vorhanden, aber ohne Sitemap-Verweis.",
          };
    },
  },
  {
    id: "GEO_LLMS_TXT",
    category: "geo",
    severity: "info",
    title: "llms.txt",
    description:
      "Eine llms.txt (Übersicht der wichtigsten Inhalte für Sprachmodelle) ist vorhanden. Optionale, noch nicht von allen Anbietern ausgewertete Konvention (informativ).",
    evaluate: (p) => {
      const site = p.site?.llmsTxt;
      if (!site) return NOT_CHECKED;
      if (site.status === "unavailable") return UNAVAILABLE("llms.txt");
      return site.status === "found"
        ? { status: "passed", evidence: { fileStatus: "found" }, message: "llms.txt vorhanden." }
        : {
            status: "warning",
            evidence: { fileStatus: "missing" },
            message:
              "Keine llms.txt (optionale Konvention, ohne bestätigte Wirkung bei großen Anbietern).",
          };
    },
  },
  {
    id: "GEO_SNIPPET_CONTROLS",
    category: "geo",
    severity: "medium",
    title: "Snippet-Freigabe",
    description:
      "Die Seite verbietet keine Textauszüge (nosnippet, max-snippet:0, data-nosnippet), die KI-Antworten zitieren könnten.",
    evaluate: (p) => {
      const robots = p.metaRobots ?? "";
      const nosnippet =
        /(^|[\s,])nosnippet([\s,]|$)/i.test(robots) || /max-snippet\s*:\s*0\b/i.test(robots);
      const parts = p.contentSignals.nosnippetElements;
      if (nosnippet) {
        return {
          status: "failed",
          evidence: { metaRobots: robots, nosnippetElements: parts },
          message:
            "Meta-Robots verbietet Textauszüge (nosnippet/max-snippet:0) – Inhalte können nicht zitiert oder zusammengefasst werden.",
        };
      }
      if (parts > 0) {
        return {
          status: "warning",
          evidence: { nosnippetElements: parts },
          message: `${parts} Bereich(e) mit data-nosnippet sind von Auszügen ausgenommen.`,
        };
      }
      return {
        status: "passed",
        evidence: { metaRobots: p.metaRobots, nosnippetElements: 0 },
        message: "Keine Snippet-Beschränkungen gefunden.",
      };
    },
  },
  {
    id: "GEO_STRUCTURED_DATA",
    category: "geo",
    severity: "medium",
    title: "Strukturierte Daten (JSON-LD)",
    description:
      "Die Seite beschreibt ihre Inhalte per JSON-LD mit aussagekräftigen Typen (Organization, Article, Product, FAQPage …).",
    evaluate: (p) => {
      const types = p.jsonLd.types.map(shortType);
      if (types.length === 0) {
        return {
          status: "failed",
          evidence: { types: [] },
          message: "Keine strukturierten Daten (JSON-LD) gefunden.",
        };
      }
      const rich = types.filter((t) => RICH_TYPES.has(t));
      return rich.length > 0
        ? {
            status: "passed",
            evidence: { types },
            message: `Strukturierte Daten vorhanden: ${[...new Set(types)].slice(0, 8).join(", ")}.`,
          }
        : {
            status: "warning",
            evidence: { types },
            message: `Nur allgemeine Typen (${[...new Set(types)].slice(0, 6).join(", ")}) – inhaltsbezogene Typen wie Organization, Article, Product oder FAQPage fehlen.`,
          };
    },
  },
  {
    id: "GEO_ENTITY_SIGNALS",
    category: "geo",
    severity: "medium",
    title: "Marken-/Organisationssignale",
    description:
      "Organisation oder Person ist per JSON-LD beschrieben und mit externen Profilen (sameAs) verknüpft.",
    evaluate: (p) => {
      const { hasOrganization, sameAsCount } = p.jsonLd;
      if (hasOrganization && sameAsCount >= 2) {
        return {
          status: "passed",
          evidence: { hasOrganization, sameAsCount },
          message: `Organisation/Person beschrieben, ${sameAsCount} sameAs-Verweise.`,
        };
      }
      if (hasOrganization) {
        return {
          status: "warning",
          evidence: { hasOrganization, sameAsCount },
          message:
            "Organisation/Person beschrieben, aber (fast) ohne sameAs-Verweise auf offizielle Profile.",
        };
      }
      return {
        status: "warning",
        evidence: { hasOrganization: false, sameAsCount: 0 },
        message:
          "Keine Organisation/Person per JSON-LD beschrieben (auf Unterseiten oft unkritisch, auf der Startseite empfohlen).",
      };
    },
  },
  {
    id: "GEO_AUTHOR_DATE",
    category: "geo",
    severity: "low",
    title: "Autor und Aktualität",
    description: "Autor und Veröffentlichungs-/Änderungsdatum sind maschinenlesbar angegeben.",
    evaluate: (p) => {
      const author = p.jsonLd.hasAuthor || p.contentSignals.hasAuthorMeta;
      const date =
        p.jsonLd.hasDatePublished ||
        p.jsonLd.hasDateModified ||
        p.contentSignals.timeElements > 0 ||
        p.contentSignals.hasPublishedMeta ||
        p.contentSignals.hasModifiedMeta;
      const evidence = { hasAuthor: author, hasDate: date };
      if (author && date)
        return {
          status: "passed",
          evidence,
          message: "Autor und Datum maschinenlesbar angegeben.",
        };
      if (author || date) {
        return {
          status: "warning",
          evidence,
          message: author
            ? "Autor angegeben, aber kein maschinenlesbares Datum."
            : "Datum angegeben, aber kein Autor.",
        };
      }
      return {
        status: "warning",
        evidence,
        message:
          "Weder Autor noch Datum maschinenlesbar angegeben (bei Landingpages oft unkritisch, bei Ratgeberinhalten wichtig).",
      };
    },
  },
  {
    id: "GEO_ANSWER_STRUCTURE",
    category: "geo",
    severity: "medium",
    title: "Antwortfähige Struktur",
    description:
      "Inhalte sind so aufgebaut, dass sich Antworten leicht extrahieren lassen (Fragen als Überschriften, Listen, Tabellen, FAQ).",
    evaluate: (p) => {
      const c = p.contentSignals;
      const signals = {
        questionHeadings: c.questionHeadings >= 2,
        lists: c.lists >= 1,
        tables: c.tables >= 1,
        faq: p.jsonLd.hasFaq || c.detailsElements >= 2,
      };
      const present = Object.entries(signals)
        .filter(([, v]) => v)
        .map(([k]) => k);
      const evidence = {
        questionHeadings: c.questionHeadings,
        lists: c.lists,
        tables: c.tables,
        detailsElements: c.detailsElements,
        hasFaqMarkup: p.jsonLd.hasFaq,
        present,
      };
      if (present.length >= 2)
        return {
          status: "passed",
          evidence,
          message: `Antwortfähige Struktur erkennbar (${present.join(", ")}).`,
        };
      if (present.length === 1)
        return {
          status: "warning",
          evidence,
          message: `Nur ein Strukturmerkmal erkennbar (${present[0]}). Fragen als Überschriften, Listen, Tabellen oder FAQ erleichtern KI-Antworten.`,
        };
      return {
        status: "failed",
        evidence,
        message:
          "Keine antwortfähige Struktur erkennbar (keine Fragen-Überschriften, Listen mit mehreren Punkten, Tabellen oder FAQ).",
      };
    },
  },
  {
    id: "GEO_SERVER_RENDERED_CONTENT",
    category: "geo",
    severity: "high",
    title: "Inhalt im initialen HTML",
    description:
      "Der Haupttext steht im HTML-Dokument und wird nicht erst per JavaScript erzeugt (viele KI-Crawler führen kein JavaScript aus).",
    evaluate: (p) => {
      const words = p.wordCount;
      const scripts = p.scripts.length;
      const evidence = { wordCount: words, scriptCount: scripts };
      if (words < 80 && scripts >= 3) {
        return {
          status: "failed",
          evidence,
          message: `Nur ${words} Wörter im initialen HTML bei ${scripts} Skripten – der Inhalt wird vermutlich erst per JavaScript erzeugt und ist für KI-Crawler ohne JavaScript unsichtbar.`,
        };
      }
      if (words < 150 && scripts >= 5) {
        return {
          status: "warning",
          evidence,
          message: `Nur ${words} Wörter im initialen HTML bei ${scripts} Skripten – möglicherweise wird Inhalt nachgeladen.`,
        };
      }
      return {
        status: "passed",
        evidence,
        message: `${words} Wörter im initialen HTML vorhanden.`,
      };
    },
  },
];
