import * as cheerio from "cheerio";
import type {
  FormInfo,
  HeadingInfo,
  ImageInfo,
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
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed: unknown = JSON.parse($(el).html() ?? "");
      collectJsonLdTypes(parsed, jsonLdTypes);
    } catch {
      // ungültiges JSON-LD wird ignoriert
    }
  });

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
