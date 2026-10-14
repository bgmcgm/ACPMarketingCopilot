import type { Rule } from "./types.js";

const CTA_PATTERN =
  /jetzt|kostenlos|anfragen|anfrage|kontakt|demo|termin|download|herunterladen|testen|starten|buchen|kaufen|bestellen|angebot|beratung|registrier|anmeld|abonnier|get started|sign up|contact|book|request|try|buy|subscribe|free/i;

export const conversionRules: Rule[] = [
  {
    id: "CONVERSION_CTA_PRESENT",
    category: "conversion",
    severity: "high",
    title: "Call-to-Action",
    description:
      "Seite enthält mindestens einen erkennbaren CTA (Button/Link mit Handlungsaufforderung).",
    evaluate: (p) => {
      const labels = [...p.buttons.map((b) => b.text), ...p.links.map((l) => l.text)].filter(
        (t) => t.length > 0 && t.length <= 60 && CTA_PATTERN.test(t),
      );
      const unique = [...new Set(labels)];
      return unique.length > 0
        ? {
            status: "passed",
            evidence: { ctaCount: labels.length, examples: unique.slice(0, 5) },
            message: `${labels.length} CTA-Kandidaten erkannt.`,
          }
        : {
            status: "failed",
            evidence: { ctaCount: 0, examples: [] },
            message: "Kein erkennbarer CTA gefunden.",
          };
    },
  },
  {
    id: "CONVERSION_FORM_PRESENT",
    category: "conversion",
    severity: "medium",
    title: "Formular",
    description: "Seite enthält ein Kontakt-/Conversion-Formular (ohne Suchformulare).",
    evaluate: (p) =>
      p.forms.length > 0
        ? {
            status: "passed",
            evidence: { formCount: p.forms.length },
            message: `${p.forms.length} Formular(e) erkannt.`,
          }
        : {
            status: "failed",
            evidence: { formCount: 0 },
            message: "Kein Formular im initialen HTML erkannt (ggf. per JavaScript nachgeladen).",
          },
  },
  {
    id: "CONVERSION_FORM_LENGTH",
    category: "conversion",
    severity: "low",
    title: "Formularlänge",
    description: "Formulare haben höchstens 7 Felder.",
    evaluate: (p) => {
      if (p.forms.length === 0)
        return {
          status: "not_applicable",
          evidence: { maxFields: 0 },
          message: "Keine Formulare vorhanden.",
        };
      const max = Math.max(...p.forms.map((f) => f.fields.length));
      return max <= 7
        ? {
            status: "passed",
            evidence: { maxFields: max },
            message: `Längstes Formular hat ${max} Felder.`,
          }
        : {
            status: "warning",
            evidence: { maxFields: max },
            message: `Längstes Formular hat ${max} Felder (empfohlen: ≤ 7).`,
          };
    },
  },
  {
    id: "CONVERSION_DIRECT_CONTACT",
    category: "conversion",
    severity: "low",
    title: "Direkter Kontaktweg",
    description: "Telefon- oder E-Mail-Link vorhanden.",
    evaluate: (p) => {
      const tel = p.links.some((l) => l.href.toLowerCase().startsWith("tel:"));
      const mail = p.links.some((l) => l.href.toLowerCase().startsWith("mailto:"));
      return tel || mail
        ? { status: "passed", evidence: { tel, mail }, message: "Direkter Kontaktweg vorhanden." }
        : {
            status: "warning",
            evidence: { tel, mail },
            message: "Kein tel:- oder mailto:-Link gefunden.",
          };
    },
  },
];
