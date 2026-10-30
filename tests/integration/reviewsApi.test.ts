import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Handlers } from "../../apps/functions/src/http/handlers.js";
import { InMemoryAuditRepository } from "../../apps/functions/src/dev/inMemoryAuditRepository.js";
import { InMemoryClientRepository } from "../../apps/functions/src/dev/inMemoryClientRepository.js";
import { InMemoryReviewRepository } from "../../apps/functions/src/dev/inMemoryReviewRepository.js";
import { ClientService } from "../../apps/functions/src/services/clientService.js";
import { ReviewService } from "../../apps/functions/src/services/reviewService.js";
import {
  FakeGoogleClient,
  FakeReviewReplyProvider,
  stubGoogleTokenEndpoint,
} from "../services/helpers.js";
import { InMemoryQueue, request, silentLogger } from "./helpers.js";

afterEach(() => vi.unstubAllGlobals());

const OAUTH = { clientId: "c", clientSecret: "s", redirectUri: "https://x/api/google/callback" };

function buildHandlers(withReviewsModule: boolean) {
  const repo = new InMemoryAuditRepository();
  const queue = new InMemoryQueue();
  const clients = new InMemoryClientRepository();
  const reviews = new InMemoryReviewRepository();
  const google = new FakeGoogleClient();
  const ai = new FakeReviewReplyProvider();

  const clientService = withReviewsModule
    ? new ClientService({
        repo: clients,
        google,
        oauth: OAUTH,
        stateSecret: "state-secret",
        tokenEncryptionKey: randomBytes(32).toString("base64"),
      })
    : undefined;
  const reviewService = withReviewsModule
    ? new ReviewService({
        reviews,
        clients,
        google,
        ai,
        oauth: OAUTH,
        tokenEncryptionKey: randomBytes(32).toString("base64"),
      })
    : undefined;

  const handlers = new Handlers({
    service: { rulesets: () => [] } as never,
    repo,
    queue,
    allowedRole: null,
    version: "test",
    logger: silentLogger,
    ...(clientService ? { clientService } : {}),
    ...(reviewService ? { reviewService } : {}),
  });

  return { handlers, clients, reviews, google };
}

describe("Reviews-Modul HTTP-Endpoints", () => {
  it("returns 503 SERVICE_UNAVAILABLE when the module is not configured", async () => {
    const { handlers } = buildHandlers(false);
    const res = await handlers.listClients(request({ user: "u1" }));
    expect(res.status).toBe(503);
    expect((res.body as { error: { code: string } }).error.code).toBe("SERVICE_UNAVAILABLE");
  });

  it("requires authentication", async () => {
    const { handlers } = buildHandlers(true);
    const res = await handlers.listClients(request({ user: null }));
    expect(res.status).toBe(401);
  });

  it("creates and lists a client via the handler layer", async () => {
    const { handlers } = buildHandlers(true);
    const created = await handlers.createClient(
      request({ user: "u1", body: { name: "Café Sonnenschein", category: "handel" } }),
    );
    expect(created.status).toBe(201);

    const listed = await handlers.listClients(request({ user: "u1" }));
    expect(listed.status).toBe(200);
    expect((listed.body as { items: unknown[] }).items).toHaveLength(1);
  });

  it("rejects an invalid client body with VALIDATION_ERROR", async () => {
    const { handlers } = buildHandlers(true);
    const res = await handlers.createClient(request({ user: "u1", body: { name: "" } }));
    expect(res.status).toBe(400);
    expect((res.body as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR");
  });

  it("redirects on a successful Google OAuth callback instead of returning JSON", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    stubGoogleTokenEndpoint(fetchMock);

    const { handlers } = buildHandlers(true);
    const created = await handlers.createClient(
      request({ user: "u1", body: { name: "Café", category: "handel" } }),
    );
    const clientId = (created.body as { id: string }).id;

    const authRes = await handlers.googleAuthorize(request({ user: "u1", params: { clientId } }));
    const authorizeUrl = (authRes.body as { authorizeUrl: string }).authorizeUrl;
    const state = new URL(authorizeUrl).searchParams.get("state")!;

    const callbackRes = await handlers.googleCallback(
      request({ user: "u1", query: `code=auth-code&state=${encodeURIComponent(state)}` }),
    );
    expect(callbackRes.status).toBe(302);
    expect(callbackRes.headers?.["location"]).toBe("/copilot/clients");
  });

  it("returns 400 when the callback is missing code or state", async () => {
    const { handlers } = buildHandlers(true);
    const res = await handlers.googleCallback(request({ user: "u1", query: "" }));
    expect(res.status).toBe(400);
  });

  it("lists reviews scoped to the authenticated owner only", async () => {
    const { handlers, reviews } = buildHandlers(true);
    await reviews.create({
      id: "11111111-1111-4111-8111-111111111111",
      ownerId: "u1",
      clientId: "22222222-2222-4222-8222-222222222222",
      type: "review",
      schemaVersion: 1,
      provider: "google_business_profile",
      externalReviewId: "r1",
      reviewer: { displayName: "Maria" },
      starRating: 5,
      comment: "Super!",
      reviewCreatedAt: "2026-10-30T09:00:00Z",
      fetchedAt: "2026-10-30T09:00:00Z",
      reply: { status: "none" },
    });

    const asOwner = await handlers.listReviews(request({ user: "u1" }));
    expect((asOwner.body as { items: unknown[] }).items).toHaveLength(1);

    const asOther = await handlers.listReviews(request({ user: "u2" }));
    expect((asOther.body as { items: unknown[] }).items).toHaveLength(0);
  });
});
