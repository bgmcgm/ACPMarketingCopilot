import * as cheerio from "cheerio";
import type {
  ContentSignals,
  FormInfo,
  HeadingInfo,
  ImageInfo,
  JsonLdSummary,
  LinkInfo,
  PageSnapshot,
  ScriptInfo,
} from "@mcopilot/shared-types";

export interface AnalyzeInput {
  html: string;
  url: string;
  finalUrl: string;
  statusCode: number;
}

const MAX_HEADINGS = 60;
const MAX_IMAGES = 500;
const MAX_LINKS = 1000;
const MAX_SCRIPTS = 200;
const MAX_INLINE_SCRIPT_CHARS = 5000;
const MAX_VISIBLE_TEXT_CHARS = 20000;
const MAX_TEXT_FIELD = 200;
const CONSENT_FIELD_PATTERN = /consent|datenschutz|privacy|einwillig|zustimm|agree|dsgvo|gdpr/i;
const IGNORED_INPUT_TYPES = new Set(["hidden", "submit", "button", "image", "reset"]);

const clean = (value: string | undefined | null, max = MAX_TEXT_FIELD): string =>
  (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

const orNull = (value: string | undefined | null): string | null => {
  const v = clean(value, 1000);
  return v.length > 0 ? v : null;
};

/** Reine Funktion: HTML → PageSnapshot. Erfasst keine Formularwerte. */
export function analyzeHtml(input: AnalyzeInput): PageSnapshot {
  const $ = cheerio.load(input.html);

  const headings: HeadingInfo[] = [];
  $("h1, h2, h3, h4, h5, h6").each((_, el) => {
    if (headings.length >= MAX_HEADINGS) return;
    const level = Number(el.tagName.slice(1)) as HeadingInfo["level"];
    headings.push({ level, text: clean($(el).text()) });
  });

  const images: ImageInfo[] = [];
  $("img").each((_, el) => {
    if (images.length >= MAX_IMAGES) return;
    const alt = $(el).attr("alt");
    images.push({ src: orNull($(el).attr("src")), alt: alt === undefined ? null : alt.trim() });
  });

  const links: LinkInfo[] = [];
  $("a[href]").each((_, el) => {
    if (links.length >= MAX_LINKS) return;
    links.push({
      href: clean($(el).attr("href"), 500),
      text: clean($(el).text()),
      rel: orNull($(el).attr("rel")),
    });
  });

  const scripts: ScriptInfo[] = [];
  $("script").each((_, el) => {
    if (scripts.length >= MAX_SCRIPTS) return;
    const $el = $(el);
    const src = orNull($el.attr("src"));
    scripts.push({
      src,
      type: orNull($el.attr("type")),
      inlineContent: src ? null : ($el.html()?.slice(0, MAX_INLINE_SCRIPT_CHARS) ?? null),
      attributes: Object.fromEntries(
        Object.entries(el.attribs ?? {}).map(([k, v]) => [k, clean(v, 200)]),
      ),
    });
  });

  const forms: FormInfo[] = [];
  $("form").each((_, el) => {
    const $form = $(el);
    const fieldEls = $form.find("input, select, textarea").toArray();
    const fields = fieldEls
      .map((f) => {
        const tag = f.tagName.toLowerCase();
        const type = tag === "input" ? ($(f).attr("type") ?? "text").toLowerCase() : tag;
        return { type, el: f };
      })
      .filter((f) => !IGNORED_INPUT_TYPES.has(f.type));
    const isSearch =
      $form.attr("role") === "search" ||
      (fields.length > 0 && fields.every((f) => f.type === "search"));
    if (isSearch) return;
    const hasConsentCheckbox = fields.some((f) => {
      if (f.type !== "checkbox") return false;
      const id = $(f.el).attr("id");
      const label = id ? $form.find(`label[for="${id}"]`).text() : "";
      const text = `${$(f.el).attr("name") ?? ""} ${id ?? ""} ${label} ${$(f.el).parent().text()}`;
      return CONSENT_FIELD_PATTERN.test(text);
    });
    forms.push({
      method: ($form.attr("method") ?? "get").toLowerCase(),
      action: orNull($form.attr("action")),
      fields: fields.map((f) => ({ type: f.type })),
      hasConsentCheckbox,
    });
  });

  const jsonLdTypes: string[] = [];
  const ldDocuments: unknown[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed: unknown = JSON.parse($(el).html() ?? "");
      ldDocuments.push(parsed);
      collectJsonLdTypes(parsed, jsonLdTypes);
    } catch {
      // ungültiges JSON-LD wird ignoriert
    }
  });
  const jsonLd = summarizeJsonLd(ldDocuments, jsonLdTypes);

  // Struktursignale im Hauptinhalt (ohne Navigation, Kopf-/Fußbereich, Seitenleisten)
  const root = $("main").first().length
    ? $("main").first()
    : $("article").first().length
      ? $("article").first()
      : $("body");
  const inContent = (el: Parameters<typeof $>[0]): boolean =>
    $(el).closest("nav, header, footer, aside").length === 0;
  const metaContent = (selector: string): boolean =>
    orNull($(selector).first().attr("content")) !== null;
  const contentSignals: ContentSignals = {
    questionHeadings: headings.filter((h) => h.level >= 2 && h.level <= 4 && /\?\s*$/.test(h.text))
      .length,
    lists: root
      .find("ul, ol")
      .toArray()
      .filter((el) => inContent(el) && $(el).children("li").length >= 3).length,
    tables: root.find("table").toArray().filter(inContent).length,
    detailsElements: $("details").length,
    nosnippetElements: $("[data-nosnippet]").length,
    hasAuthorMeta:
      metaContent('meta[name="author" i]') ||
      $('link[rel="author"], a[rel="author"], [itemprop="author"]').length > 0,
    timeElements: $("time[datetime]").length,
    hasPublishedMeta:
      metaContent('meta[property="article:published_time"]') ||
      metaContent('meta[name="date" i]') ||
      metaContent('meta[name="publish-date" i]') ||
      $('[itemprop="datePublished"]').length > 0,
    hasModifiedMeta:
      metaContent('meta[property="article:modified_time"]') ||
      metaContent('meta[property="og:updated_time"]') ||
      metaContent('meta[name="last-modified" i]') ||
      $('[itemprop="dateModified"]').length > 0,
  };

  const buttons: { text: string }[] = [];
  $(
    "button, input[type=submit], [role=button], a.btn, a.button, a[class*=cta], a[class*=btn]",
  ).each((_, el) => {
    const $el = $(el);
    const text = clean($el.is("input") ? $el.attr("value") : $el.text());
    if (text) buttons.push({ text });
  });

  const openGraph: Record<string, string> = {};
  $('meta[property^="og:"]').each((_, el) => {
    const prop = $(el).attr("property");
    const content = orNull($(el).attr("content"));
    if (prop && content) openGraph[prop] = content.slice(0, 300);
  });

  const head = {
    lang: orNull($("html").attr("lang")),
    title: orNull($("head title").first().text()),
    metaDescription: orNull($('meta[name="description" i]').attr("content")),
    metaRobots: orNull($('meta[name="robots" i]').attr("content")),
    canonical: orNull($('link[rel="canonical" i]').attr("href")),
    viewport: orNull($('meta[name="viewport" i]').attr("content")),
    hreflang: $('link[rel="alternate"][hreflang]')
      .toArray()
      .map((e) => e.attribs["hreflang"] ?? "")
      .filter(Boolean),
  };

  $("script, style, noscript, template, svg, head, [hidden]").remove();
  const visibleText = clean($("body").text(), 10_000_000);
  const wordCount = visibleText.length === 0 ? 0 : visibleText.split(" ").length;

  return {
    url: input.url,
    finalUrl: input.finalUrl,
    statusCode: input.statusCode,
    ...head,
    openGraph,
    headings,
    images,
    links,
    scripts,
    forms,
    jsonLdTypes,
    jsonLd,
    contentSignals,
    buttons,
    visibleText: visibleText.slice(0, MAX_VISIBLE_TEXT_CHARS),
    wordCount,
  };
}

function collectJsonLdTypes(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    node.forEach((n) => collectJsonLdTypes(n, out));
  } else if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const t = obj["@type"];
    if (typeof t === "string") out.push(t);
    else if (Array.isArray(t)) out.push(...t.filter((x): x is string => typeof x === "string"));
    if (obj["@graph"]) collectJsonLdTypes(obj["@graph"], out);
  }
}

const ENTITY_TYPE = /Organization|Corporation|LocalBusiness|NGO|Store|Brand|Person/;

/** Reduziert JSON-LD auf die für GEO relevanten Merkmale (Entität, sameAs, Autor, Daten, FAQ). */
function summarizeJsonLd(documents: unknown[], types: string[]): JsonLdSummary {
  const summary: JsonLdSummary = {
    types: [...new Set(types)],
    hasOrganization: false,
    sameAsCount: 0,
    hasAuthor: false,
    hasDatePublished: false,
    hasDateModified: false,
    hasFaq: types.includes("FAQPage") || types.includes("Question"),
  };
  let visited = 0;
  const walk = (node: unknown, depth: number): void => {
    if (depth > 6 || visited > 500) return;
    if (Array.isArray(node)) return node.forEach((n) => walk(n, depth + 1));
    if (!node || typeof node !== "object") return;
    visited++;
    const obj = node as Record<string, unknown>;
    const t = obj["@type"];
    const typeList =
      typeof t === "string"
        ? [t]
        : Array.isArray(t)
          ? t.filter((x): x is string => typeof x === "string")
          : [];
    if (typeList.some((x) => ENTITY_TYPE.test(x))) {
      summary.hasOrganization = true;
      const sameAs = obj["sameAs"];
      summary.sameAsCount +=
        typeof sameAs === "string"
          ? 1
          : Array.isArray(sameAs)
            ? sameAs.filter((x) => typeof x === "string").length
            : 0;
    }
    if (obj["author"]) summary.hasAuthor = true;
    if (obj["datePublished"]) summary.hasDatePublished = true;
    if (obj["dateModified"]) summary.hasDateModified = true;
    for (const value of Object.values(obj))
      if (value && typeof value === "object") walk(value, depth + 1);
  };
  documents.forEach((d) => walk(d, 0));
  return summary;
}
