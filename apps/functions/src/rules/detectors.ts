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

export interface ThirdPartyTag {
  vendor: string;
  pattern: RegExp;
}

/** Tracker, die (anders als GTM) typischerweise erst nach Einwilligung geladen werden dürfen. */
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
  {
    vendor: "Google Analytics (direkt)",
    pattern: /googletagmanager\.com\/gtag\/js|google-analytics\.com\/(analytics|ga)\.js/,
  },
  { vendor: "HubSpot Tracking", pattern: /js\.hs-scripts\.com|js\.hs-analytics\.net/ },
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
