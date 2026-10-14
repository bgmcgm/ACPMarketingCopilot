export interface CurrentUser {
  userId: string;
  userDetails: string;
}

/** Liest den angemeldeten Benutzer aus dem SWA-Endpunkt /.auth/me. */
export async function fetchCurrentUser(): Promise<CurrentUser | null> {
  try {
    const res = await fetch("/.auth/me", { credentials: "same-origin" });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      clientPrincipal?: { userId?: string; userDetails?: string } | null;
    };
    const p = body.clientPrincipal;
    return p?.userId ? { userId: p.userId, userDetails: p.userDetails ?? "" } : null;
  } catch {
    return null;
  }
}
