import type {
  AuditReportDto,
  AuditStatusDto,
  AuditCategory,
  CreateAuditResponse,
  ListAuditsResponse,
} from "@mcopilot/shared-types";

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly correlationId?: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export const loginUrl = (): string =>
  `/.auth/login/aad?post_login_redirect_uri=${encodeURIComponent(window.location.pathname)}`;

let onUnauthorized: () => void = () => window.location.assign(loginUrl());
/** Für Tests austauschbar. */
export const setUnauthorizedHandler = (fn: () => void): void => {
  onUnauthorized = fn;
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
    });
  } catch {
    throw new ApiClientError(0, "NETWORK_ERROR", "Der Server ist nicht erreichbar.");
  }

  if (res.status === 401) {
    onUnauthorized();
    throw new ApiClientError(401, "UNAUTHENTICATED", "Anmeldung erforderlich.");
  }
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Nicht-JSON-Antwort (z. B. Proxy-Fehlerseite)
  }
  if (!res.ok) {
    const err = (
      body as { error?: { code?: string; message?: string; correlationId?: string } } | null
    )?.error;
    throw new ApiClientError(
      res.status,
      err?.code ?? "HTTP_ERROR",
      err?.message ?? `Anfrage fehlgeschlagen (HTTP ${res.status}).`,
      err?.correlationId,
    );
  }
  return body as T;
}

export const api = {
  createAudit: (url: string, modules: AuditCategory[]) =>
    request<CreateAuditResponse>("/audits", {
      method: "POST",
      body: JSON.stringify({ url, modules }),
    }),
  listAudits: (limit = 20, continuationToken?: string) => {
    const q = new URLSearchParams({ limit: String(limit) });
    if (continuationToken) q.set("continuationToken", continuationToken);
    return request<ListAuditsResponse>(`/audits?${q.toString()}`);
  },
  getAudit: (id: string) => request<AuditStatusDto>(`/audits/${encodeURIComponent(id)}`),
  getReport: (id: string) => request<AuditReportDto>(`/audits/${encodeURIComponent(id)}/report`),
  deleteAudit: (id: string) =>
    request<void>(`/audits/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
