export interface Principal {
  userId: string;
  identityProvider: string;
  roles: string[];
}

export class AuthError extends Error {
  constructor(
    readonly status: 401 | 403,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export const CLIENT_PRINCIPAL_HEADER = "x-ms-client-principal";

/**
 * Liest den von Azure Static Web Apps gesetzten Header (Base64-JSON).
 * Das Gate liegt vor der API; diese Prüfung ist die zweite Verteidigungslinie.
 */
export function parsePrincipal(
  header: string | null | undefined,
  requiredRole: string | null = null,
): Principal {
  if (!header) throw new AuthError(401, "Nicht angemeldet.");
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    throw new AuthError(401, "Ungültige Anmeldeinformationen.");
  }
  const obj = (raw ?? {}) as Record<string, unknown>;
  const userId = typeof obj["userId"] === "string" ? obj["userId"] : "";
  const roles = Array.isArray(obj["userRoles"])
    ? obj["userRoles"].filter((r): r is string => typeof r === "string")
    : [];
  if (!userId || !roles.includes("authenticated")) throw new AuthError(401, "Nicht angemeldet.");
  if (requiredRole && !roles.includes(requiredRole))
    throw new AuthError(403, "Keine Berechtigung.");
  return {
    userId,
    identityProvider:
      typeof obj["identityProvider"] === "string" ? obj["identityProvider"] : "unknown",
    roles,
  };
}
