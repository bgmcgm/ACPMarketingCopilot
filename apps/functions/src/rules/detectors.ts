import type { PageSnapshot, ScriptInfo } from "@mcopilot/shared-types";

const haystack = (s: ScriptInfo): string => `${s.src ?? ""}\n${s.inlineContent ?? ""}`;

const uniq = (values: string[]): string[] => [...new Set(values)];

export function findGtmIds(page: PageSnapshot): string[] {
  const ids = page.scripts.flatMap((s) => haystack(s).match(/GTM-[A-Z0-9]{4,}/g) ?? []);
  const hasLoader = page.scripts.some((s) => /googletagmanager\.com\/gtm\.js/.test(haystack(s)));
  return hasLoader || ids.length > 0 ? uniq(ids) : [];
}

export function findGa4Ids(page: PageSnapshot): string[] {
  return uniq(
    page.scripts.flatMap((s) => {
      const h = haystack(s);
      const fromLoader = /googletagmanager\.com\/gtag\/js\?id=(G-[A-Z0-9]+)/.exec(h);
      const fromConfig = [...h.matchAll(/gtag\(\s*['"]config['"]\s*,\s*['"](G-[A-Z0-9]+)['"]/g)];
      return [
        ...(fromLoader ? [fromLoader[1] as string] : []),
        ...fromConfig.map((m) => m[1] as string),
      ];
    }),
  );
}

export function findLegacyUaIds(page: PageSnapshot): string[] {
  return uniq(
    page.scripts.flatMap((s) => {
      const h = haystack(s);
      const ids = h.match(/UA-\d{4,}-\d+/g) ?? [];
      return ids.length === 0 && /google-analytics\.com\/(analytics|ga)\.js/.test(h)
        ? ["analytics.js"]
        : ids;
    }),
  );
}

export function hasHubSpot(page: PageSnapshot): boolean {
  return page.scripts.some((s) =>
    /js\.hs-scripts\.com|js\.hs-analytics\.net|js\.hsforms\.net|js\.hsleadflows\.net|hs-banner\.com/.test(
      haystack(s),
    ),
  );
}

export interface AnalyticsVendor {
  vendor: string;
  pattern: RegExp;
  /**
   * Muster, das den eigentlichen Lader erkennt (für die Einwilligungsprüfung). Inline-Aufrufe wie
   * gtag('config', …) laden selbst nichts und dürfen nicht als "ungesperrter Tracker" zählen.
   */
  loaderPattern?: RegExp;
  /** Setzt typischerweise Cookies/IDs und braucht daher in der Regel eine Einwilligung. */
  consentRelevant: boolean;
  /** false: Dienst erhebt keine Daten mehr (z. B. Universal Analytics, seit 2023 eingestellt). */
  active: boolean;
}

/** Web-/Produkt-Analytics-Dienste (ohne Tag Manager). Erkennung nur im initialen HTML. */
export const ANALYTICS_VENDORS: readonly AnalyticsVendor[] = [
  {
    vendor: "Google Analytics 4",
    pattern: /googletagmanager\.com\/gtag\/js\?id=G-|gtag\(\s*['"]config['"]\s*,\s*['"]G-/,
    loaderPattern: /googletagmanager\.com\/gtag\/js\?id=G-/,
    consentRelevant: true,
    active: true,
  },
  {
    vendor: "Google Analytics (Universal, eingestellt)",
    pattern: /google-analytics\.com\/(analytics|ga)\.js|UA-\d{4,}-\d+/,
    loaderPattern: /google-analytics\.com\/(analytics|ga)\.js/,
    consentRelevant: true,
    active: false,
  },
  {
    vendor: "Matomo",
    pattern: /matomo\.(js|php)|piwik\.(js|php)|_paq\.push/,
    consentRelevant: true,
    active: true,
  },
  { vendor: "Piwik PRO", pattern: /piwik\.pro|ppms\.(js|eu)/, consentRelevant: true, active: true },
  {
    vendor: "Adobe Analytics",
    pattern: /assets\.adobedtm\.com|omtrdc\.net|AppMeasurement\.js|s_code\.js/,
    consentRelevant: true,
    active: true,
  },
  {
    vendor: "etracker",
    pattern: /etracker\.(com|de)|_etrackerOnReady|et_pagename/,
    consentRelevant: true,
    active: true,
  },
  {
    vendor: "econda",
    pattern: /econda-monitor|emos3\.js|econda\.de/,
    consentRelevant: true,
    active: true,
  },
  {
    vendor: "Mixpanel",
    pattern: /cdn\.mxpnl\.com|mixpanel\.com\/(libs|track)|mixpanel\.init/,
    consentRelevant: true,
    active: true,
  },
  {
    vendor: "Amplitude",
    pattern: /cdn\.amplitude\.com|amplitude\.(getInstance|init)/,
    consentRelevant: true,
    active: true,
  },
  {
    vendor: "Segment",
    pattern: /cdn\.segment\.com\/analytics\.js|analytics\.load\(/,
    consentRelevant: true,
    active: true,
  },
  {
    vendor: "Heap",
    pattern: /heap-analytics|heapanalytics\.com|cdn\.heapanalytics/,
    consentRelevant: true,
    active: true,
  },
  {
    vendor: "PostHog",
    pattern: /posthog\.com\/static\/array|posthog\.init|app\.posthog\.com|i\.posthog\.com/,
    consentRelevant: true,
    active: true,
  },
  {
    vendor: "Yandex Metrica",
    pattern: /mc\.yandex\.(ru|com)\/metrika/,
    consentRelevant: true,
    active: true,
  },
  {
    vendor: "HubSpot Tracking",
    pattern: /js\.hs-scripts\.com|js\.hs-analytics\.net/,
    consentRelevant: true,
    active: true,
  },
  // Cookielose bzw. datensparsame Dienste: i. d. R. ohne Einwilligungsbanner nutzbar.
  {
    vendor: "Plausible",
    pattern: /plausible(\.[a-z]+)?\.js|plausible\.io\/js/,
    consentRelevant: false,
    active: true,
  },
  { vendor: "Fathom", pattern: /cdn\.usefathom\.com/, consentRelevant: false, active: true },
  {
    vendor: "Simple Analytics",
    pattern: /scripts\.simpleanalyticscdn\.com|simpleanalytics\.(com|io)/,
    consentRelevant: false,
    active: true,
  },
  {
    vendor: "Cloudflare Web Analytics",
    pattern: /static\.cloudflareinsights\.com\/beacon/,
    consentRelevant: false,
    active: true,
  },
  {
    vendor: "Vercel Analytics",
    pattern: /_vercel\/insights\/script\.js|va\.vercel-scripts\.com/,
    consentRelevant: false,
    active: true,
  },
  {
    vendor: "Umami",
    pattern: /umami(\.is)?\/script\.js|\/umami\.js|cloud\.umami\.is/,
    consentRelevant: false,
    active: true,
  },
];

export interface DetectedAnalytics {
  vendor: string;
  consentRelevant: boolean;
  active: boolean;
}

export function detectAnalytics(page: PageSnapshot): DetectedAnalytics[] {
  return ANALYTICS_VENDORS.filter((v) => page.scripts.some((s) => v.pattern.test(haystack(s)))).map(
    ({ vendor, consentRelevant, active }) => ({ vendor, consentRelevant, active }),
  );
}

const TAG_MANAGERS: readonly { vendor: string; pattern: RegExp }[] = [
  { vendor: "Google Tag Manager", pattern: /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]{4,}/ },
  { vendor: "Adobe Launch", pattern: /assets\.adobedtm\.com/ },
  { vendor: "Tealium", pattern: /tags\.tiqcdn\.com|tealium\.com\/utag|utag\.js/ },
];

export function findTagManagers(page: PageSnapshot): string[] {
  return TAG_MANAGERS.filter((t) => page.scripts.some((s) => t.pattern.test(haystack(s)))).map(
    (t) => t.vendor,
  );
}

export interface ThirdPartyTag {
  vendor: string;
  pattern: RegExp;
}

/**
 * Tracker, die (anders als Tag Manager) typischerweise erst nach Einwilligung geladen werden dürfen:
 * Werbe-/Verhaltens-Tags plus alle einwilligungsrelevanten Analytics-Dienste.
 */
export const THIRD_PARTY_TAGS: readonly ThirdPartyTag[] = [
  {
    vendor: "Meta Pixel",
    pattern: /connect\.facebook\.net\/[^"'\s]*fbevents\.js|fbq\(\s*['"]init/,
  },
  {
    vendor: "LinkedIn Insight",
    pattern: /snap\.licdn\.com\/li\.lms-analytics|_linkedin_partner_id/,
  },
  { vendor: "Hotjar", pattern: /static\.hotjar\.com|hotjar\.com\/c\/hotjar/ },
  { vendor: "Microsoft Clarity", pattern: /clarity\.ms\/tag/ },
  { vendor: "TikTok Pixel", pattern: /analytics\.tiktok\.com/ },
  {
    vendor: "Google Ads",
    pattern: /googleadservices\.com|googlesyndication\.com|gtag\(\s*['"]config['"]\s*,\s*['"]AW-/,
  },
  ...ANALYTICS_VENDORS.filter((v) => v.consentRelevant).map((v) => ({
    vendor: v.vendor,
    pattern: v.loaderPattern ?? v.pattern,
  })),
];

export interface DetectedTag {
  vendor: string;
  /** true, wenn das Skript offensichtlich durch ein CMP blockiert/zurückgehalten wird. */
  gated: boolean;
}

/** Hinweise, dass ein Skript erst nach Einwilligung aktiviert wird (CMP-Blocking-Muster). */
export function isConsentGated(s: ScriptInfo): boolean {
  const type = (s.type ?? "").toLowerCase();
  const attrs = s.attributes;
  return (
    type === "text/plain" ||
    "data-cookieconsent" in attrs ||
    "data-usercentrics" in attrs ||
    "data-category" in attrs ||
    "data-cmp-vendor" in attrs ||
    /optanon-category|cmplazyload/.test(attrs["class"] ?? "")
  );
}

export function detectThirdPartyTags(page: PageSnapshot): DetectedTag[] {
  const found = new Map<string, boolean>();
  for (const script of page.scripts) {
    for (const tag of THIRD_PARTY_TAGS) {
      if (tag.pattern.test(haystack(script))) {
        const gated = isConsentGated(script);
        found.set(tag.vendor, (found.get(tag.vendor) ?? true) && gated);
      }
    }
  }
  return [...found].map(([vendor, gated]) => ({ vendor, gated }));
}

export const CMP_VENDORS: readonly { vendor: string; pattern: RegExp }[] = [
  { vendor: "Cookiebot", pattern: /consent\.cookiebot\.com|cookiebot\.com\/uc\.js/ },
  { vendor: "OneTrust", pattern: /cdn\.cookielaw\.org|onetrust\.com|optanon/i },
  { vendor: "Usercentrics", pattern: /usercentrics\.eu|app\.usercentrics/ },
  { vendor: "Didomi", pattern: /sdk\.privacy-center\.org|didomi/ },
  { vendor: "Borlabs Cookie", pattern: /borlabs-cookie/ },
  { vendor: "CookieYes", pattern: /cdn-cookieyes\.com|cookieyes/ },
  { vendor: "consentmanager", pattern: /consentmanager\.net|delivery\.consentmanager/ },
  { vendor: "TrustArc", pattern: /trustarc\.com|truste\.com/ },
  { vendor: "iubenda", pattern: /iubenda\.com/ },
  { vendor: "Quantcast Choice", pattern: /quantcast\.mgr\.consensu\.org|quantcast\.com\/choice/ },
  { vendor: "Klaro", pattern: /klaro(\.min)?\.js/ },
];

export function detectCmp(page: PageSnapshot): string[] {
  return uniq(
    CMP_VENDORS.filter((c) => page.scripts.some((s) => c.pattern.test(haystack(s)))).map(
      (c) => c.vendor,
    ),
  );
}
