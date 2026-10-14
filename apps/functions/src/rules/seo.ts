import type { Rule } from "./types.js";

export const seoRules: Rule[] = [
  {
    id: "SEO_TITLE",
    category: "seo",
    severity: "high",
    title: "Title-Tag",
    description: "Seite hat einen Title mit sinnvoller Länge (10–60 Zeichen).",
    evaluate: (p) => {
      const length = p.title?.length ?? 0;
      if (!p.title) {
        return { status: "failed", evidence: { title: null }, message: "Kein Title-Tag gefunden." };
      }
      const ok = length >= 10 && length <= 60;
      return {
        status: ok ? "passed" : "warning",
        evidence: { title: p.title, length },
        message: ok
          ? "Title vorhanden."
          : `Title vorhanden, aber mit ${length} Zeichen außerhalb des Richtwerts (10–60).`,
      };
    },
  },
  {
    id: "SEO_META_DESCRIPTION",
    category: "seo",
    severity: "medium",
    title: "Meta Description",
    description: "Seite hat eine Meta Description mit sinnvoller Länge (50–160 Zeichen).",
    evaluate: (p) => {
      if (!p.metaDescription) {
        return {
          status: "failed",
          evidence: { metaDescription: null },
          message: "Keine Meta Description gefunden.",
        };
      }
      const length = p.metaDescription.length;
      const ok = length >= 50 && length <= 160;
      return {
        status: ok ? "passed" : "warning",
        evidence: { metaDescription: p.metaDescription, length },
        message: ok
          ? "Meta Description vorhanden."
          : `Meta Description vorhanden, aber mit ${length} Zeichen außerhalb des Richtwerts (50–160).`,
      };
    },
  },
  {
    id: "SEO_CANONICAL",
    category: "seo",
    severity: "medium",
    title: "Canonical-Link",
    description: "Seite definiert eine Canonical-URL.",
    evaluate: (p) =>
      p.canonical
        ? {
            status: "passed",
            evidence: { canonical: p.canonical },
            message: "Canonical vorhanden.",
          }
        : {
            status: "failed",
            evidence: { canonical: null },
            message: "Kein Canonical-Link gefunden.",
          },
  },
  {
    id: "SEO_H1_COUNT",
    category: "seo",
    severity: "high",
    title: "Genau eine H1",
    description: "Seite hat genau eine H1-Überschrift.",
    evaluate: (p) => {
      const count = p.headings.filter((h) => h.level === 1).length;
      if (count === 1)
        return { status: "passed", evidence: { h1Count: 1 }, message: "Genau eine H1 vorhanden." };
      if (count === 0)
        return { status: "failed", evidence: { h1Count: 0 }, message: "Keine H1 gefunden." };
      return {
        status: "warning",
        evidence: { h1Count: count },
        message: `${count} H1-Überschriften gefunden (empfohlen: 1).`,
      };
    },
  },
  {
    id: "SEO_IMG_ALT",
    category: "seo",
    severity: "medium",
    title: "Alt-Texte bei Bildern",
    description: "Bilder haben ein alt-Attribut (leeres alt für dekorative Bilder ist zulässig).",
    evaluate: (p) => {
      if (p.images.length === 0) {
        return {
          status: "not_applicable",
          evidence: { imageCount: 0 },
          message: "Keine Bilder gefunden.",
        };
      }
      const missing = p.images.filter((i) => i.alt === null);
      const evidence = {
        imageCount: p.images.length,
        imagesWithoutAlt: missing.length,
        examples: missing.slice(0, 5).map((i) => i.src ?? "(ohne src)"),
      };
      if (missing.length === 0)
        return { status: "passed", evidence, message: "Alle Bilder haben ein alt-Attribut." };
      const ratio = missing.length / p.images.length;
      return {
        status: ratio > 0.25 ? "failed" : "warning",
        evidence,
        message: `${missing.length} von ${p.images.length} Bildern ohne alt-Attribut.`,
      };
    },
  },
  {
    id: "SEO_LANG",
    category: "seo",
    severity: "low",
    title: "Sprachangabe",
    description: "Das html-Element hat ein lang-Attribut.",
    evaluate: (p) =>
      p.lang
        ? { status: "passed", evidence: { lang: p.lang }, message: "lang-Attribut vorhanden." }
        : {
            status: "failed",
            evidence: { lang: null },
            message: "Kein lang-Attribut am html-Element.",
          },
  },
  {
    id: "SEO_VIEWPORT",
    category: "seo",
    severity: "medium",
    title: "Viewport Meta-Tag",
    description: "Seite ist per Viewport-Tag für mobile Geräte konfiguriert.",
    evaluate: (p) =>
      p.viewport
        ? {
            status: "passed",
            evidence: { viewport: p.viewport },
            message: "Viewport-Tag vorhanden.",
          }
        : {
            status: "failed",
            evidence: { viewport: null },
            message: "Kein Viewport-Meta-Tag gefunden.",
          },
  },
  {
    id: "SEO_ROBOTS_NOINDEX",
    category: "seo",
    severity: "critical",
    title: "Indexierbarkeit",
    description: "Seite ist nicht per meta robots auf noindex gesetzt.",
    evaluate: (p) => {
      const noindex = /(^|[\s,])noindex([\s,]|$)/i.test(p.metaRobots ?? "");
      return noindex
        ? {
            status: "failed",
            evidence: { metaRobots: p.metaRobots },
            message: "Seite ist auf noindex gesetzt.",
          }
        : {
            status: "passed",
            evidence: { metaRobots: p.metaRobots },
            message: "Kein noindex im Meta-Robots-Tag.",
          };
    },
  },
  {
    id: "SEO_OPEN_GRAPH",
    category: "seo",
    severity: "low",
    title: "Open-Graph-Tags",
    description: "og:title, og:description und og:image sind gesetzt.",
    evaluate: (p) => {
      const missing = ["og:title", "og:description", "og:image"].filter((k) => !p.openGraph[k]);
      return missing.length === 0
        ? {
            status: "passed",
            evidence: { missing: [] },
            message: "Open-Graph-Basis-Tags vorhanden.",
          }
        : {
            status: "warning",
            evidence: { missing },
            message: `Fehlende Open-Graph-Tags: ${missing.join(", ")}.`,
          };
    },
  },
];
