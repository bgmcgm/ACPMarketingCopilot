import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  GoogleOAuthError,
  refreshAccessToken,
  type GoogleOAuthConfig,
} from "../../apps/functions/src/connectors/googleBusinessProfile/oauth.js";

const config: GoogleOAuthConfig = {
  clientId: "client-123",
  clientSecret: "secret-xyz",
  redirectUri: "https://marketing-copilot.example/api/google/callback",
};

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("buildAuthorizeUrl", () => {
  it("includes the business.manage scope, offline access and the given state", () => {
    const url = new URL(buildAuthorizeUrl(config, "state-abc"));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(url.searchParams.get("scope")).toContain("business.manage");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("state-abc");
  });
});

describe("exchangeCodeForTokens", () => {
  it("posts the authorization code and returns the tokens", async () => {
    fetchMock.mockResolvedValue(
      json(200, { access_token: "at-1", refresh_token: "rt-1", expires_in: 3600 }),
    );
    const tokens = await exchangeCodeForTokens(config, "auth-code");
    expect(tokens).toEqual({ accessToken: "at-1", refreshToken: "rt-1", expiresInSec: 3600 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://oauth2.googleapis.com/token");
    const body = new URLSearchParams(init.body as string);
    expect(body.get("code")).toBe("auth-code");
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("client_secret")).toBe("secret-xyz");
  });

  it("omits refreshToken when Google doesn't return one", async () => {
    fetchMock.mockResolvedValue(json(200, { access_token: "at-1", expires_in: 3600 }));
    const tokens = await exchangeCodeForTokens(config, "auth-code");
    expect(tokens.refreshToken).toBeUndefined();
  });

  it("wraps failures in GoogleOAuthError without leaking details", async () => {
    fetchMock.mockResolvedValue(
      json(400, { error: "invalid_grant", error_description: "Bad code sk-secret" }),
    );
    const err = await exchangeCodeForTokens(config, "bad-code").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GoogleOAuthError);
    expect((err as GoogleOAuthError).code).toBe("TOKEN_EXCHANGE_FAILED");
  });
});

describe("refreshAccessToken", () => {
  it("posts the refresh token and returns a fresh access token", async () => {
    fetchMock.mockResolvedValue(json(200, { access_token: "at-2", expires_in: 1800 }));
    const result = await refreshAccessToken(config, "rt-1");
    expect(result).toEqual({ accessToken: "at-2", expiresInSec: 1800 });
    const [, init] = fetchMock.mock.calls[0]!;
    const body = new URLSearchParams(init.body as string);
    expect(body.get("refresh_token")).toBe("rt-1");
    expect(body.get("grant_type")).toBe("refresh_token");
  });

  it("wraps failures in GoogleOAuthError", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const err = await refreshAccessToken(config, "rt-1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GoogleOAuthError);
    expect((err as GoogleOAuthError).code).toBe("TOKEN_REFRESH_FAILED");
  });
});
