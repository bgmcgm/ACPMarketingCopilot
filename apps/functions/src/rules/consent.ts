import type { Rule } from "./types.js";
import { detectCmp, detectThirdPartyTags, findGtmIds } from "./detectors.js";

const PRIVACY = /datenschutz|privacy|privatsph|data[- ]protection/i;
const IMPRINT = /impressum|imprint|legal[- ]notice|anbieterkennzeichnung/i;

const hasLink = (links: { href: string; text: string }[], pattern: RegExp): boolean =>
  links.some((l) => pattern.test(l.text) || pattern.test(l.href));

export const consentRules: Rule[] = [
  {
    id: "CONSENT_CMP_DETECTED",
    category: "consent",
    severity: "high",
    title: "Consent-Management-Plattform",
    description:
      "Ein bekanntes CMP wurde im initialen HTML erkannt (Indikator, kein Rechtsurteil).",
    evaluate: (p) => {
      const cmps = detectCmp(p);
      if (cmps.length > 0)
        return {
          status: "passed",
          evidence: { cmps },
          message: `CMP erkannt: ${cmps.join(", ")}.`,
        };
      const trackers = detectThirdPartyTags(p).length + findGtmIds(p).length;
      if (trackers === 0) {
        return {
          status: "not_applicable",
          evidence: { cmps: [], trackerCount: 0 },
          message: "Kein CMP erkannt, aber auch kein Tracking erkannt.",
        };
      }
      return {
        status: "failed",
        evidence: { cmps: [], trackerCount: trackers },
        message: "Tracking erkannt, aber kein bekanntes CMP im initialen HTML.",
      };
    },
  },
  {
    id: "CONSENT_TRACKING_BEFORE_CONSENT",
    category: "consent",
    severity: "critical",
    title: "Tracker ohne erkennbare Einwilligungssperre",
    description:
      "Tracker (außer GTM) werden direkt im HTML geladen, ohne erkennbares CMP-Blocking-Muster (Indikator).",
    evaluate: (p) => {
      const tags = detectThirdPartyTags(p);
      if (tags.length === 0) {
        return {
          status: "not_applicable",
          evidence: { ungatedVendors: [] },
          message: "Keine direkt eingebundenen Tracker erkannt.",
        };
      }
      const ungated = tags.filter((t) => !t.gated).map((t) => t.vendor);
      if (ungated.length === 0) {
        return {
          status: "passed",
          evidence: { ungatedVendors: [] },
          message: "Erkannte Tracker sind per CMP-Muster zurückgehalten.",
        };
      }
      const hasCmp = detectCmp(p).length > 0;
      return {
        status: hasCmp ? "warning" : "failed",
        evidence: { ungatedVendors: ungated, cmpDetected: hasCmp },
        message: hasCmp
          ? `Direkt geladene Tracker ohne erkennbare Sperre: ${ungated.join(", ")} (Blocking per JS nicht prüfbar).`
          : `Direkt geladene Tracker ohne CMP: ${ungated.join(", ")}.`,
      };
    },
  },
  {
    id: "CONSENT_PRIVACY_LINK",
    category: "consent",
    severity: "medium",
    title: "Link zur Datenschutzerklärung",
    description: "Seite verlinkt eine Datenschutzerklärung.",
    evaluate: (p) =>
      hasLink(p.links, PRIVACY)
        ? {
            status: "passed",
            evidence: { found: true },
            message: "Link zur Datenschutzerklärung gefunden.",
          }
        : {
            status: "failed",
            evidence: { found: false },
            message: "Kein Link zur Datenschutzerklärung gefunden.",
          },
  },
  {
    id: "CONSENT_IMPRINT_LINK",
    category: "consent",
    severity: "low",
    title: "Link zum Impressum",
    description: "Seite verlinkt ein Impressum.",
    evaluate: (p) =>
      hasLink(p.links, IMPRINT)
        ? { status: "passed", evidence: { found: true }, message: "Impressum-Link gefunden." }
        : {
            status: "failed",
            evidence: { found: false },
            message: "Kein Impressum-Link gefunden.",
          },
  },
  {
    id: "CONSENT_FORM_CHECKBOX",
    category: "consent",
    severity: "medium",
    title: "Einwilligungs-Checkbox in Formularen",
    description:
      "Formulare mit E-Mail-/Telefonfeld enthalten eine Einwilligungs-/Datenschutz-Checkbox.",
    evaluate: (p) => {
      const personal = p.forms.filter((f) =>
        f.fields.some((x) => x.type === "email" || x.type === "tel"),
      );
      if (personal.length === 0) {
        return {
          status: "not_applicable",
          evidence: { formsWithPersonalFields: 0 },
          message: "Keine Formulare mit E-Mail-/Telefonfeld.",
        };
      }
      const without = personal.filter((f) => !f.hasConsentCheckbox).length;
      return without === 0
        ? {
            status: "passed",
            evidence: { formsWithPersonalFields: personal.length, withoutCheckbox: 0 },
            message:
              "Alle Formulare mit personenbezogenen Feldern haben eine Einwilligungs-Checkbox.",
          }
        : {
            status: "warning",
            evidence: { formsWithPersonalFields: personal.length, withoutCheckbox: without },
            message: `${without} von ${personal.length} Formularen ohne erkennbare Einwilligungs-Checkbox.`,
          };
    },
  },
];
