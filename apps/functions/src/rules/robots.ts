/**
 * Minimaler robots.txt-Parser nach RFC 9309 (Gruppen, Allow/Disallow, * und $, längste Übereinstimmung gewinnt,
 * bei Gleichstand gilt Allow). Reine Funktionen, keine I/O.
 */
export interface RobotsRule {
  allow: boolean;
  pattern: string;
}
export interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
}
export interface ParsedRobots {
  groups: RobotsGroup[];
  sitemaps: string[];
}

export function parseRobots(text: string): ParsedRobots {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;

  for (const raw of text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .slice(0, 10_000)) {
    const line = (raw.split("#")[0] ?? "").trim();
    const idx = line.indexOf(":");
    if (idx < 1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (key === "allow" || key === "disallow") {
      lastWasAgent = false;
      current?.rules.push({ allow: key === "allow", pattern: value });
    } else if (key === "sitemap") {
      if (value) sitemaps.push(value);
    } else {
      // andere Direktiven (crawl-delay, host …) beenden die Gruppe nicht
    }
  }
  return { groups, sitemaps };
}

const patternToRegex = (pattern: string): RegExp => {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
};

/** Darf der Crawler mit dem Produkt-Token `userAgent` den Pfad (inkl. Query) abrufen? */
export function isAllowed(robots: ParsedRobots, userAgent: string, path: string): boolean {
  const token = userAgent.toLowerCase();
  const specific = robots.groups.filter((g) => g.agents.includes(token));
  const applicable =
    specific.length > 0 ? specific : robots.groups.filter((g) => g.agents.includes("*"));
  let best: { allow: boolean; length: number } | null = null;
  for (const rule of applicable.flatMap((g) => g.rules)) {
    if (rule.pattern === "") continue; // leeres Disallow = alles erlaubt, leeres Allow ohne Wirkung
    if (!patternToRegex(rule.pattern).test(path)) continue;
    const length = rule.pattern.length;
    if (!best || length > best.length || (length === best.length && rule.allow && !best.allow)) {
      best = { allow: rule.allow, length };
    }
  }
  return best ? best.allow : true;
}
