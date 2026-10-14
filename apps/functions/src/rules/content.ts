import type { Rule } from "./types.js";

const GENERIC_LINK_TEXT =
  /^(hier|hier klicken|mehr|mehr erfahren|weiterlesen|click here|here|read more|more|learn more)$/i;

export const contentRules: Rule[] = [
  {
    id: "CONTENT_WORD_COUNT",
    category: "content",
    severity: "medium",
    title: "Textumfang",
    description: "Seite enthält ausreichend sichtbaren Text (≥ 150 Wörter; ≥ 300 ideal).",
    evaluate: (p) => {
      if (p.wordCount < 150) {
        return {
          status: "failed",
          evidence: { wordCount: p.wordCount },
          message: `Nur ${p.wordCount} Wörter sichtbarer Text im initialen HTML.`,
        };
      }
      return p.wordCount < 300
        ? {
            status: "warning",
            evidence: { wordCount: p.wordCount },
            message: `${p.wordCount} Wörter – eher kurz.`,
          }
        : {
            status: "passed",
            evidence: { wordCount: p.wordCount },
            message: `${p.wordCount} Wörter sichtbarer Text.`,
          };
    },
  },
  {
    id: "CONTENT_SUBHEADINGS",
    category: "content",
    severity: "low",
    title: "Zwischenüberschriften",
    description: "Inhalt ist durch H2-Überschriften gegliedert.",
    evaluate: (p) => {
      const h2 = p.headings.filter((h) => h.level === 2).length;
      return h2 > 0
        ? { status: "passed", evidence: { h2Count: h2 }, message: `${h2} H2-Überschriften.` }
        : {
            status: "failed",
            evidence: { h2Count: 0 },
            message: "Keine H2-Überschriften; Inhalt ist nicht gegliedert.",
          };
    },
  },
  {
    id: "CONTENT_HEADING_HIERARCHY",
    category: "content",
    severity: "low",
    title: "Überschriften-Hierarchie",
    description: "Überschriftenebenen werden nicht übersprungen (z. B. H1 → H3).",
    evaluate: (p) => {
      const skips: string[] = [];
      let prev = 0;
      for (const h of p.headings) {
        if (prev > 0 && h.level > prev + 1) skips.push(`H${prev}→H${h.level}`);
        prev = h.level;
      }
      return skips.length === 0
        ? {
            status: "passed",
            evidence: { skips: [] },
            message: "Keine übersprungenen Überschriftenebenen.",
          }
        : {
            status: "warning",
            evidence: { skips: skips.slice(0, 10) },
            message: `Übersprungene Ebenen: ${skips.slice(0, 5).join(", ")}.`,
          };
    },
  },
  {
    id: "CONTENT_GENERIC_LINK_TEXT",
    category: "content",
    severity: "low",
    title: "Aussagekräftige Linktexte",
    description: "Links verwenden keine generischen Texte wie „hier“ oder „mehr“.",
    evaluate: (p) => {
      const generic = p.links.filter((l) => GENERIC_LINK_TEXT.test(l.text));
      return generic.length === 0
        ? {
            status: "passed",
            evidence: { genericLinks: 0 },
            message: "Keine generischen Linktexte.",
          }
        : {
            status: "warning",
            evidence: {
              genericLinks: generic.length,
              examples: [...new Set(generic.map((l) => l.text))].slice(0, 5),
            },
            message: `${generic.length} Links mit generischem Linktext.`,
          };
    },
  },
];
