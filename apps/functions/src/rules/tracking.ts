import type { Rule } from "./types.js";
import {
  detectThirdPartyTags,
  findGa4Ids,
  findGtmIds,
  findLegacyUaIds,
  hasHubSpot,
} from "./detectors.js";

export const trackingRules: Rule[] = [
  {
    id: "TRACKING_GTM",
    category: "tracking",
    severity: "medium",
    title: "Google Tag Manager",
    description: "GTM-Container im initialen HTML erkannt.",
    evaluate: (p) => {
      const ids = findGtmIds(p);
      return ids.length > 0
        ? {
            status: "passed",
            evidence: { containerIds: ids },
            message: "Google Tag Manager erkannt.",
          }
        : {
            status: "failed",
            evidence: { containerIds: [] },
            message: "Kein Google Tag Manager im initialen HTML erkannt.",
          };
    },
  },
  {
    id: "TRACKING_GA4",
    category: "tracking",
    severity: "high",
    title: "Google Analytics 4",
    description: "GA4-Messung (gtag.js) im initialen HTML erkannt.",
    evaluate: (p) => {
      const ids = findGa4Ids(p);
      if (ids.length > 0)
        return { status: "passed", evidence: { measurementIds: ids }, message: "GA4 erkannt." };
      const gtm = findGtmIds(p);
      if (gtm.length > 0) {
        return {
          status: "warning",
          evidence: { measurementIds: [], gtmContainerIds: gtm },
          message:
            "GA4 nicht direkt erkannt; wird ggf. über Google Tag Manager geladen (nicht prüfbar).",
        };
      }
      return {
        status: "failed",
        evidence: { measurementIds: [] },
        message: "Kein GA4 im initialen HTML erkannt.",
      };
    },
  },
  {
    id: "TRACKING_LEGACY_UA",
    category: "tracking",
    severity: "low",
    title: "Veraltetes Universal Analytics",
    description: "Es wird kein veraltetes Universal Analytics (UA-) mehr eingebunden.",
    evaluate: (p) => {
      const ids = findLegacyUaIds(p);
      return ids.length === 0
        ? {
            status: "passed",
            evidence: { legacyIds: [] },
            message: "Kein Universal Analytics erkannt.",
          }
        : {
            status: "warning",
            evidence: { legacyIds: ids },
            message: "Veraltetes Universal Analytics erkannt (eingestellt).",
          };
    },
  },
  {
    id: "TRACKING_HUBSPOT",
    category: "tracking",
    severity: "info",
    title: "HubSpot-Script",
    description: "HubSpot-Tracking- oder Formular-Script erkannt (informativ).",
    evaluate: (p) =>
      hasHubSpot(p)
        ? { status: "passed", evidence: { detected: true }, message: "HubSpot-Script erkannt." }
        : {
            status: "warning",
            evidence: { detected: false },
            message: "Kein HubSpot-Script im initialen HTML erkannt.",
          },
  },
  {
    id: "TRACKING_THIRD_PARTY_TAGS",
    category: "tracking",
    severity: "info",
    title: "Weitere Tracking-Tags",
    description: "Weitere erkannte Tracking-/Marketing-Tags (informativ).",
    evaluate: (p) => {
      const vendors = detectThirdPartyTags(p).map((t) => t.vendor);
      return {
        status: "passed",
        evidence: { vendors },
        message:
          vendors.length > 0
            ? `Erkannte Tags: ${vendors.join(", ")}.`
            : "Keine weiteren Tracking-Tags erkannt.",
      };
    },
  },
];
