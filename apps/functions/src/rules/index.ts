import { consentRules } from "./consent.js";
import { geoRules } from "./geo.js";
import { contentRules } from "./content.js";
import { conversionRules } from "./conversion.js";
import { seoRules } from "./seo.js";
import { trackingRules } from "./tracking.js";
import type { Ruleset } from "./types.js";

export const defaultRuleset: Ruleset = {
  id: "default",
  version: "1.1.0",
  rules: [
    ...seoRules,
    ...trackingRules,
    ...consentRules,
    ...contentRules,
    ...conversionRules,
    ...geoRules,
  ],
};

export { evaluateRuleset } from "./engine.js";
export type { Rule, RuleOutcome, Ruleset } from "./types.js";
