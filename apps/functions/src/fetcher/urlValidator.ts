import { isIP } from "node:net";
import { isBlockedIp } from "./ipGuard.js";

export interface UrlPolicy {
  allowedPorts: readonly number[];
  /** Leer = keine Einschränkung. Einträge erlauben die Domain und ihre Subdomains. */
  domainAllowlist: readonly string[];
  maxLength: number;
}

export const defaultUrlPolicy: UrlPolicy = {
  allowedPorts: [80, 443],
  domainAllowlist: [],
  maxLength: 2048,
};

export type UrlRejection =
  | "INVALID_URL"
  | "SCHEME_NOT_ALLOWED"
  | "CREDENTIALS_NOT_ALLOWED"
  | "PORT_NOT_ALLOWED"
  | "HOST_NOT_ALLOWED"
  | "IP_NOT_ALLOWED"
  | "DOMAIN_NOT_ALLOWLISTED";

export class UrlValidationError extends Error {
  constructor(
    readonly reason: UrlRejection,
    message: string,
  ) {
    super(message);
    this.name = "UrlValidationError";
  }
}

const BLOCKED_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".localdomain",
  ".lan",
  ".home.arpa",
];

/** Hostname ohne Brackets/Trailing-Dot, kleingeschrieben. */
export function normalizeHostname(hostname: string): string {
  return hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
}

/**
 * Syntaktische und statische Prüfung. DNS-Auflösung wird separat (beim Verbindungsaufbau) geprüft.
 * Gibt die normalisierte URL (ohne Fragment) zurück.
 */
export function validateUrl(raw: string, policy: UrlPolicy = defaultUrlPolicy): URL {
  if (raw.length === 0 || raw.length > policy.maxLength) {
    throw new UrlValidationError("INVALID_URL", "URL fehlt oder ist zu lang.");
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new UrlValidationError("INVALID_URL", "URL ist ungültig.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UrlValidationError("SCHEME_NOT_ALLOWED", "Nur http und https sind erlaubt.");
  }
  if (url.username !== "" || url.password !== "") {
    throw new UrlValidationError(
      "CREDENTIALS_NOT_ALLOWED",
      "Zugangsdaten in der URL sind nicht erlaubt.",
    );
  }
  const port = url.port === "" ? (url.protocol === "https:" ? 443 : 80) : Number(url.port);
  if (!policy.allowedPorts.includes(port)) {
    throw new UrlValidationError("PORT_NOT_ALLOWED", "Dieser Port ist nicht erlaubt.");
  }

  const host = normalizeHostname(url.hostname);
  if (host.length === 0) throw new UrlValidationError("INVALID_URL", "Hostname fehlt.");

  if (isIP(host) !== 0) {
    if (isBlockedIp(host))
      throw new UrlValidationError("IP_NOT_ALLOWED", "Diese IP-Adresse ist nicht erlaubt.");
  } else {
    if (
      host === "localhost" ||
      BLOCKED_SUFFIXES.some((s) => host.endsWith(s)) ||
      !host.includes(".")
    ) {
      throw new UrlValidationError("HOST_NOT_ALLOWED", "Dieser Hostname ist nicht erlaubt.");
    }
  }

  if (policy.domainAllowlist.length > 0) {
    const allowed = policy.domainAllowlist.some((d) => {
      const domain = normalizeHostname(d);
      return host === domain || host.endsWith(`.${domain}`);
    });
    if (!allowed)
      throw new UrlValidationError("DOMAIN_NOT_ALLOWLISTED", "Domain ist nicht freigegeben.");
  }

  url.hash = "";
  return url;
}
