import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Principal } from "../../apps/functions/src/auth/principal.js";
import { InMemoryClientRepository } from "../../apps/functions/src/dev/inMemoryClientRepository.js";
import { ClientService } from "../../apps/functions/src/services/clientService.js";
import { ApiError } from "../../apps/functions/src/services/errors.js";
import { signState } from "../../apps/functions/src/connectors/googleBusinessProfile/state.js";
import { decryptToken } from "../../apps/functions/src/lib/tokenCipher.js";
import { FakeGoogleClient, stubGoogleTokenEndpoint } from "./helpers.js";

const owner: Principal = { userId: "owner-1", identityProvider: "aad", roles: ["authenticated"] };
const tokenEncryptionKey = randomBytes(32).toString("base64");
const stateSecret = "state-secret";
const fixedNow = () => new Date("2026-10-30T12:00:00Z");
const sign = (payload: { clientId: string; ownerId: string }) =>
  signState(payload, stateSecret, fixedNow);

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  stubGoogleTokenEndpoint(fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function harness() {
  const repo = new InMemoryClientRepository();
  const google = new FakeGoogleClient();
  let n = 0;
  const service = new ClientService({
    repo,
    google,
    oauth: { clientId: "c", clientSecret: "s", redirectUri: "https://x/api/google/callback" },
    stateSecret,
    tokenEncryptionKey,
    now: fixedNow,
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  });
  return { repo, google, service };
}

describe("ClientService.create/list", () => {
  it("creates a client and lists only the owner's clients", async () => {
    const { service } = harness();
    const created = await service.create(owner, { name: "Café Sonnenschein", category: "handel" });
    expect(created).toMatchObject({ name: "Café Sonnenschein", category: "handel" });

    const other: Principal = {
      userId: "owner-2",
      identityProvider: "aad",
      roles: ["authenticated"],
    };
    await service.create(other, { name: "Fremder Kunde", category: "kmu" });

    const ownList = await service.list(owner);
    expect(ownList.items.map((c) => c.name)).toEqual(["Café Sonnenschein"]);
  });

  it("rejects invalid input", async () => {
    const { service } = harness();
    await expect(service.create(owner, { name: "", category: "handel" })).rejects.toThrow();
  });
});

describe("ClientService Google OAuth flow", () => {
  it("builds an authorize URL only for an owned client", async () => {
    const { service } = harness();
    const client = await service.create(owner, { name: "Café", category: "handel" });
    const res = await service.getAuthorizeUrl(owner, client.id);
    expect(res.authorizeUrl).toContain("accounts.google.com");

    const other: Principal = {
      userId: "owner-2",
      identityProvider: "aad",
      roles: ["authenticated"],
    };
    await expect(service.getAuthorizeUrl(other, client.id)).rejects.toThrow(ApiError);
  });

  it("handles the callback: exchanges the code, lists locations, stores an encrypted pending token", async () => {
    const { service, repo } = harness();
    const client = await service.create(owner, { name: "Café", category: "handel" });
    const state = sign({ clientId: client.id, ownerId: owner.userId });

    const res = await service.handleGoogleCallback(owner, { code: "auth-code", state });
    expect(res.locations).toEqual([
      { locationName: "accounts/1/locations/2", displayName: "Café Sonnenschein" },
    ]);

    const stored = repo.docs.get(`${owner.userId}/${client.id}`)!;
    expect(stored.pendingGoogleAuth).toBeDefined();
    expect(stored.pendingGoogleAuth!.encryptedRefreshToken).not.toContain("refresh-token-1");
    expect(decryptToken(stored.pendingGoogleAuth!.encryptedRefreshToken, tokenEncryptionKey)).toBe(
      "refresh-token-1",
    );
    expect(stored.googleAccount).toBeUndefined();
  });

  it("rejects a callback whose state belongs to a different user", async () => {
    const { service } = harness();
    const client = await service.create(owner, { name: "Café", category: "handel" });
    const state = sign({ clientId: client.id, ownerId: "someone-else" });
    await expect(service.handleGoogleCallback(owner, { code: "x", state })).rejects.toThrow(
      ApiError,
    );
  });

  it("rejects a callback with an invalid or expired state", async () => {
    const { service } = harness();
    await expect(
      service.handleGoogleCallback(owner, { code: "x", state: "garbage" }),
    ).rejects.toThrow(ApiError);
  });

  it("fails with NO_REFRESH_TOKEN when Google doesn't grant offline access", async () => {
    const { service } = harness();
    const client = await service.create(owner, { name: "Café", category: "handel" });
    const state = sign({ clientId: client.id, ownerId: owner.userId });
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "at", expires_in: 3600 }), { status: 200 }),
    );
    const err = await service
      .handleGoogleCallback(owner, { code: "x", state })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("NO_REFRESH_TOKEN");
  });

  it("selects a location, moving it from pending to connected", async () => {
    const { service } = harness();
    const client = await service.create(owner, { name: "Café", category: "handel" });
    const state = sign({ clientId: client.id, ownerId: owner.userId });
    await service.handleGoogleCallback(owner, { code: "auth-code", state });

    const connected = await service.selectGoogleLocation(owner, client.id, {
      locationName: "accounts/1/locations/2",
    });
    expect(connected.googleAccount).toMatchObject({
      status: "connected",
      locationName: "accounts/1/locations/2",
      displayName: "Café Sonnenschein",
    });
    expect(connected.pendingGoogleLocations).toBeUndefined();
  });

  it("rejects selecting an unlisted location", async () => {
    const { service } = harness();
    const client = await service.create(owner, { name: "Café", category: "handel" });
    const state = sign({ clientId: client.id, ownerId: owner.userId });
    await service.handleGoogleCallback(owner, { code: "auth-code", state });
    await expect(
      service.selectGoogleLocation(owner, client.id, { locationName: "accounts/9/locations/9" }),
    ).rejects.toThrow(ApiError);
  });

  it("rejects selecting a location when there is no pending auth", async () => {
    const { service } = harness();
    const client = await service.create(owner, { name: "Café", category: "handel" });
    await expect(
      service.selectGoogleLocation(owner, client.id, { locationName: "accounts/1/locations/2" }),
    ).rejects.toThrow(ApiError);
  });
});
