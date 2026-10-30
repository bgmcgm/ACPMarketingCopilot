const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
/** [ANNAHME] Scope Stand Oktober 2026; vor Umsetzung gegen aktuelle Google-Doku prüfen. */
const SCOPE = "https://www.googleapis.com/auth/business.manage";

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface GoogleTokens {
  accessToken: string;
  /** Nur bei der ersten Autorisierung vorhanden (`access_type=offline&prompt=consent`). */
  refreshToken?: string;
  expiresInSec: number;
}

export class GoogleOAuthError extends Error {
  constructor(
    readonly code: "TOKEN_EXCHANGE_FAILED" | "TOKEN_REFRESH_FAILED",
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "GoogleOAuthError";
  }
}

export function buildAuthorizeUrl(config: GoogleOAuthConfig, state: string): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  error?: string;
  error_description?: string;
}

async function postForm(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  const json = (await res.json()) as TokenResponse;
  if (!res.ok || json.error) {
    throw new Error(json.error_description ?? json.error ?? `HTTP ${res.status}`);
  }
  return json;
}

export async function exchangeCodeForTokens(
  config: GoogleOAuthConfig,
  code: string,
): Promise<GoogleTokens> {
  try {
    const json = await postForm({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    });
    return {
      accessToken: json.access_token,
      ...(json.refresh_token ? { refreshToken: json.refresh_token } : {}),
      expiresInSec: json.expires_in,
    };
  } catch (err) {
    throw new GoogleOAuthError("TOKEN_EXCHANGE_FAILED", "Google-Token-Austausch fehlgeschlagen.", {
      cause: err,
    });
  }
}

export async function refreshAccessToken(
  config: GoogleOAuthConfig,
  refreshToken: string,
): Promise<{ accessToken: string; expiresInSec: number }> {
  try {
    const json = await postForm({
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
    });
    return { accessToken: json.access_token, expiresInSec: json.expires_in };
  } catch (err) {
    throw new GoogleOAuthError("TOKEN_REFRESH_FAILED", "Google-Token-Erneuerung fehlgeschlagen.", {
      cause: err,
    });
  }
}
