import {
  detectAnalytics,
  detectThirdPartyTags,
  findGa4Ids,
  findGtmIds,
  findLegacyUaIds,
  findTagManagers,
  hasHubSpot,
} from "./detectors.js";
import type { Rule } from "./types.js";

const LIMIT_NOTE =
  "Hinweis: Geprüft wird nur das initiale HTML; Tags, die später per JavaScript nachgeladen werden, sind nicht sichtbar.";

export const trackingRules: Rule[] = [
  {
    id: "TRACKING_ANALYTICS_PRESENT",
    category: "tracking",
    severity: "high",
    title: "Web-Analytics",
    description:
      "Ein aktiver Analytics-Dienst (GA4, Matomo, Adobe, etracker, Plausible u. a.) oder ein Tag Manager ist eingebunden.",
    evaluate: (p) => {
      const all = detectAnalytics(p);
      const active = all.filter((a) => a.active).map((a) => a.vendor);
      const managers = findTagManagers(p);
      if (active.length > 0) {
        return {
          status: "passed",
          evidence: { vendors: active, tagManagers: managers },
          message: `Analytics erkannt: ${active.join(", ")}.`,
        };
      }
      if (managers.length > 0) {
        return {
          status: "passed",
          evidence: { vendors: [], tagManagers: managers, viaTagManager: true },
          message: `Tag Manager erkannt (${managers.join(", ")}); Analytics vermutlich darüber konfiguriert (im HTML nicht prüfbar).`,
        };
      }
      if (all.some((a) => !a.active)) {
        return {
          status: "failed",
          evidence: { vendors: [], legacyOnly: true },
          message:
            "Nur Universal Analytics gefunden – dieser Dienst erhebt seit 2023 keine Daten mehr. Es findet vermutlich keine Messung statt.",
        };
      }
      return {
        status: "warning",
        evidence: { vendors: [], tagManagers: [] },
        message: `Kein Analytics-Dienst und kein Tag Manager im initialen HTML erkannt. ${LIMIT_NOTE}`,
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
            message: "Veraltetes Universal Analytics erkannt (eingestellt, kann entfernt werden).",
          };
    },
  },
  {
    id: "TRACKING_DUPLICATE_GA4",
    category: "tracking",
    severity: "low",
    title: "Mögliches Doppel-Tracking",
    description:
      "GA4 ist nicht gleichzeitig direkt im HTML und über einen Tag Manager (oder mehrfach) eingebunden.",
    evaluate: (p) => {
      const ga4 = findGa4Ids(p);
      const gtm = findGtmIds(p);
      if (ga4.length > 1) {
        return {
          status: "warning",
          evidence: { measurementIds: ga4 },
          message: `Mehrere GA4-Mess-IDs im HTML (${ga4.join(", ")}) – bitte prüfen, ob Seitenaufrufe doppelt gezählt werden.`,
        };
      }
      if (ga4.length === 1 && gtm.length > 0) {
        return {
          status: "warning",
          evidence: { measurementIds: ga4, gtmContainerIds: gtm },
          message:
            "GA4 ist direkt eingebunden und zusätzlich ein Google Tag Manager vorhanden – bitte prüfen, ob GA4 im Container ebenfalls feuert (Doppelzählung).",
        };
      }
      return {
        status: "passed",
        evidence: { measurementIds: ga4, gtmContainerIds: gtm },
        message: "Kein Hinweis auf doppelte GA4-Einbindung.",
      };
    },
  },
  {
    id: "TRACKING_TAG_MANAGER",
    category: "tracking",
    severity: "info",
    title: "Tag Manager",
    description:
      "Ein Tag Manager (Google Tag Manager, Adobe Launch, Tealium) ist eingebunden (informativ).",
    evaluate: (p) => {
      const managers = findTagManagers(p);
      const gtm = findGtmIds(p);
      return managers.length > 0
        ? {
            status: "passed",
            evidence: { tagManagers: managers, gtmContainerIds: gtm },
            message: `Tag Manager erkannt: ${managers.join(", ")}.`,
          }
        : {
            status: "warning",
            evidence: { tagManagers: [] },
            message: "Kein Tag Manager im initialen HTML erkannt.",
          };
    },
  },
  {
    id: "TRACKING_GTM",
    category: "tracking",
    severity: "info",
    title: "Google Tag Manager",
    description: "GTM-Container im initialen HTML erkannt (informativ).",
    evaluate: (p) => {
      const ids = findGtmIds(p);
      return ids.length > 0
        ? {
            status: "passed",
            evidence: { containerIds: ids },
            message: "Google Tag Manager erkannt.",
          }
        : {
            status: "warning",
            evidence: { containerIds: [] },
            message: "Kein Google Tag Manager im initialen HTML erkannt.",
          };
    },
  },
  {
    id: "TRACKING_GA4",
    category: "tracking",
    severity: "info",
    title: "Google Analytics 4",
    description: "GA4-Messung (gtag.js) im initialen HTML erkannt (informativ).",
    evaluate: (p) => {
      const ids = findGa4Ids(p);
      if (ids.length > 0) {
        return { status: "passed", evidence: { measurementIds: ids }, message: "GA4 erkannt." };
      }
      const gtm = findGtmIds(p);
      return {
        status: "warning",
        evidence: { measurementIds: [], gtmContainerIds: gtm },
        message:
          gtm.length > 0
            ? "GA4 nicht direkt erkannt; wird ggf. über Google Tag Manager geladen (nicht prüfbar)."
            : "Kein GA4 im initialen HTML erkannt (andere Analytics-Dienste sind möglich, siehe oben).",
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
    description:
      "Erkannte einwilligungsrelevante Tracking-/Marketing-Tags (Werbe-Pixel, Verhaltensanalyse, Analytics; informativ).",
    evaluate: (p) => {
      const vendors = detectThirdPartyTags(p).map((t) => t.vendor);
      return {
        status: "passed",
        evidence: { vendors },
        message:
          vendors.length > 0
            ? `Erkannte Tags: ${vendors.join(", ")}.`
            : "Keine einwilligungsrelevanten Tracking-Tags erkannt.",
      };
    },
  },
];
