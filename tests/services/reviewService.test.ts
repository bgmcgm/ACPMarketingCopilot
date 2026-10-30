import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Principal } from "../../apps/functions/src/auth/principal.js";
import { InMemoryClientRepository } from "../../apps/functions/src/dev/inMemoryClientRepository.js";
import { InMemoryReviewRepository } from "../../apps/functions/src/dev/inMemoryReviewRepository.js";
import { ReviewService } from "../../apps/functions/src/services/reviewService.js";
import { ApiError } from "../../apps/functions/src/services/errors.js";
import type { ClientDocument } from "../../apps/functions/src/domain/clientDocument.js";
import { encryptToken } from "../../apps/functions/src/lib/tokenCipher.js";
import { FakeGoogleClient, FakeReviewReplyProvider, stubGoogleTokenEndpoint } from "./helpers.js";

const owner: Principal = { userId: "owner-1", identityProvider: "aad", roles: ["authenticated"] };
const tokenEncryptionKey = randomBytes(32).toString("base64");
const LOCATION = "accounts/1/locations/2";

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  stubGoogleTokenEndpoint(fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

async function harness(opts: { connected?: boolean } = { connected: true }) {
  const clients = new InMemoryClientRepository();
  const reviews = new InMemoryReviewRepository();
  const google = new FakeGoogleClient();
  const ai = new FakeReviewReplyProvider();
  let n = 0;
  const service = new ReviewService({
    reviews,
    clients,
    google,
    ai,
    oauth: { clientId: "c", clientSecret: "s", redirectUri: "https://x/api/google/callback" },
    tokenEncryptionKey,
    now: () => new Date("2026-10-30T12:00:00Z"),
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  });

  const client: ClientDocument = {
    id: "11111111-1111-4111-8111-111111111111",
    ownerId: owner.userId,
    type: "client",
    schemaVersion: 1,
    name: "Café Sonnenschein",
    category: "handel",
    createdAt: "2026-10-01T00:00:00Z",
    ...(opts.connected
      ? {
          googleAccount: {
            status: "connected" as const,
            locationName: LOCATION,
            displayName: "Café Sonnenschein",
            connectedAt: "2026-10-01T00:00:00Z",
            encryptedRefreshToken: encryptToken("refresh-token-1", tokenEncryptionKey),
          },
        }
      : {}),
  };
  await clients.create(client);

  return { service, clients, reviews, google, ai, client };
}

describe("ReviewService.sync", () => {
  it("fails when the client has no connected Google account", async () => {
    const { service, client } = await harness({ connected: false });
    await expect(service.sync(owner, client.id)).rejects.toThrow(ApiError);
  });

  it("fetches new reviews, creates documents and drafts AI replies", async () => {
    const { service, google, reviews, client } = await harness();
    google.reviewsByLocation[LOCATION] = [
      {
        externalReviewId: `${LOCATION}/reviews/r1`,
        reviewer: { displayName: "Maria" },
        starRating: 5,
        comment: "Toller Kaffee!",
        createTime: "2026-10-30T09:00:00Z",
      },
    ];

    const result = await service.sync(owner, client.id);
    expect(result).toEqual({ newReviews: 1, draftedReplies: 1, failedDrafts: 0 });

    const { items } = await reviews.list(owner.userId, { clientId: client.id }, 20);
    expect(items).toHaveLength(1);
    expect(items[0]!.reply).toMatchObject({ status: "drafted", draftText: "Danke, Maria!" });
  });

  it("is idempotent: syncing twice does not duplicate reviews", async () => {
    const { service, google, reviews, client } = await harness();
    google.reviewsByLocation[LOCATION] = [
      {
        externalReviewId: `${LOCATION}/reviews/r1`,
        reviewer: { displayName: "Maria" },
        starRating: 5,
        comment: "Toller Kaffee!",
        createTime: "2026-10-30T09:00:00Z",
      },
    ];
    await service.sync(owner, client.id);
    const second = await service.sync(owner, client.id);
    expect(second.newReviews).toBe(0);
    const { items } = await reviews.list(owner.userId, { clientId: client.id }, 20);
    expect(items).toHaveLength(1);
  });

  it("leaves a review undrafted on AI failure and retries it on the next sync", async () => {
    const { service, google, ai, reviews, client } = await harness();
    google.reviewsByLocation[LOCATION] = [
      {
        externalReviewId: `${LOCATION}/reviews/r1`,
        reviewer: { displayName: "Maria" },
        starRating: 2,
        comment: "Ging so.",
        createTime: "2026-10-30T09:00:00Z",
      },
    ];
    ai.shouldFail = true;
    const first = await service.sync(owner, client.id);
    expect(first).toEqual({ newReviews: 1, draftedReplies: 0, failedDrafts: 1 });
    const { items: afterFirst } = await reviews.list(owner.userId, { clientId: client.id }, 20);
    expect(afterFirst[0]!.reply.status).toBe("none");

    ai.shouldFail = false;
    const second = await service.sync(owner, client.id);
    expect(second).toEqual({ newReviews: 0, draftedReplies: 1, failedDrafts: 0 });
    const { items: afterSecond } = await reviews.list(owner.userId, { clientId: client.id }, 20);
    expect(afterSecond[0]!.reply.status).toBe("drafted");
  });
});

describe("ReviewService approval workflow", () => {
  it("approves a drafted review, posts it, and marks it posted", async () => {
    const { service, google, reviews, client } = await harness();
    google.reviewsByLocation[LOCATION] = [
      {
        externalReviewId: `${LOCATION}/reviews/r1`,
        reviewer: { displayName: "Maria" },
        starRating: 5,
        comment: "Toller Kaffee!",
        createTime: "2026-10-30T09:00:00Z",
      },
    ];
    await service.sync(owner, client.id);
    const { items } = await reviews.list(owner.userId, { clientId: client.id }, 20);
    const reviewId = items[0]!.id;

    const approved = await service.approve(owner, reviewId);
    expect(approved.reply.status).toBe("posted");
    expect(google.repliedTo).toEqual([
      { reviewName: `${LOCATION}/reviews/r1`, comment: "Danke, Maria!" },
    ]);
  });

  it("uses the edited text over the AI draft when approving", async () => {
    const { service, google, reviews, client } = await harness();
    google.reviewsByLocation[LOCATION] = [
      {
        externalReviewId: `${LOCATION}/reviews/r1`,
        reviewer: { displayName: "Maria" },
        starRating: 5,
        comment: "Toller Kaffee!",
        createTime: "2026-10-30T09:00:00Z",
      },
    ];
    await service.sync(owner, client.id);
    const { items } = await reviews.list(owner.userId, { clientId: client.id }, 20);
    const reviewId = items[0]!.id;

    await service.updateDraft(owner, reviewId, { editedText: "Danke dir sehr, Maria!" });
    await service.approve(owner, reviewId);
    expect(google.repliedTo).toEqual([
      { reviewName: `${LOCATION}/reviews/r1`, comment: "Danke dir sehr, Maria!" },
    ]);
  });

  it("promotes a review without a draft to 'drafted' once a human writes a reply", async () => {
    const { service, reviews, client } = await harness();
    // Review ohne KI-Entwurf (z. B. nach fehlgeschlagenem Sync) manuell anlegen:
    await reviews.create({
      id: "22222222-2222-4222-8222-222222222222",
      ownerId: owner.userId,
      clientId: client.id,
      type: "review",
      schemaVersion: 1,
      provider: "google_business_profile",
      externalReviewId: `${LOCATION}/reviews/r2`,
      reviewer: { displayName: "Tom" },
      starRating: 1,
      comment: "Schlecht.",
      reviewCreatedAt: "2026-10-30T09:00:00Z",
      fetchedAt: "2026-10-30T09:00:00Z",
      reply: { status: "none" },
    });
    const updated = await service.updateDraft(owner, "22222222-2222-4222-8222-222222222222", {
      editedText: "Es tut uns leid, das zu hören.",
    });
    expect(updated.reply.status).toBe("drafted");
  });

  it("rejects a review, leaving it without a connector call", async () => {
    const { service, google, reviews, client } = await harness();
    google.reviewsByLocation[LOCATION] = [
      {
        externalReviewId: `${LOCATION}/reviews/r1`,
        reviewer: { displayName: "Maria" },
        starRating: 5,
        comment: "Toller Kaffee!",
        createTime: "2026-10-30T09:00:00Z",
      },
    ];
    await service.sync(owner, client.id);
    const { items } = await reviews.list(owner.userId, { clientId: client.id }, 20);
    const rejected = await service.reject(owner, items[0]!.id);
    expect(rejected.reply.status).toBe("rejected");
    expect(google.repliedTo).toEqual([]);
  });

  it("keeps the review drafted and records the error when posting to Google fails", async () => {
    const { service, google, reviews, client } = await harness();
    google.reviewsByLocation[LOCATION] = [
      {
        externalReviewId: `${LOCATION}/reviews/r1`,
        reviewer: { displayName: "Maria" },
        starRating: 5,
        comment: "Toller Kaffee!",
        createTime: "2026-10-30T09:00:00Z",
      },
    ];
    await service.sync(owner, client.id);
    const { items } = await reviews.list(owner.userId, { clientId: client.id }, 20);
    const reviewId = items[0]!.id;

    google.replyShouldFail = true;
    const err = await service.approve(owner, reviewId).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("POST_FAILED");

    const stored = await reviews.get(owner.userId, reviewId);
    expect(stored!.reply.status).toBe("drafted");
    expect(stored!.reply.error).toMatchObject({ code: "POST_FAILED" });

    // Erneuter Versuch nach Behebung des Problems funktioniert (kein verlorener Freigabe-Klick).
    google.replyShouldFail = false;
    const retried = await service.approve(owner, reviewId);
    expect(retried.reply.status).toBe("posted");
  });

  describe("approval gate (B8): the connector is only ever called from approve(), and only when drafted", () => {
    it("never calls the connector for a review with no draft", async () => {
      const { service, google, reviews, client } = await harness();
      await reviews.create({
        id: "33333333-3333-4333-8333-333333333333",
        ownerId: owner.userId,
        clientId: client.id,
        type: "review",
        schemaVersion: 1,
        provider: "google_business_profile",
        externalReviewId: `${LOCATION}/reviews/r3`,
        reviewer: { displayName: "Tom" },
        starRating: 3,
        comment: null,
        reviewCreatedAt: "2026-10-30T09:00:00Z",
        fetchedAt: "2026-10-30T09:00:00Z",
        reply: { status: "none" },
      });
      const err = await service
        .approve(owner, "33333333-3333-4333-8333-333333333333")
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe("NOT_DRAFTED");
      expect(google.repliedTo).toEqual([]);
    });

    it("never calls the connector again for an already-posted review", async () => {
      const { service, google, reviews, client } = await harness();
      google.reviewsByLocation[LOCATION] = [
        {
          externalReviewId: `${LOCATION}/reviews/r1`,
          reviewer: { displayName: "Maria" },
          starRating: 5,
          comment: "Toller Kaffee!",
          createTime: "2026-10-30T09:00:00Z",
        },
      ];
      await service.sync(owner, client.id);
      const { items } = await reviews.list(owner.userId, { clientId: client.id }, 20);
      const reviewId = items[0]!.id;
      await service.approve(owner, reviewId);
      google.repliedTo.length = 0;

      const err = await service.approve(owner, reviewId).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe("NOT_DRAFTED");
      expect(google.repliedTo).toEqual([]);
    });

    it("rejecting a posted review is blocked", async () => {
      const { service, google, reviews, client } = await harness();
      google.reviewsByLocation[LOCATION] = [
        {
          externalReviewId: `${LOCATION}/reviews/r1`,
          reviewer: { displayName: "Maria" },
          starRating: 5,
          comment: "Toller Kaffee!",
          createTime: "2026-10-30T09:00:00Z",
        },
      ];
      await service.sync(owner, client.id);
      const { items } = await reviews.list(owner.userId, { clientId: client.id }, 20);
      await service.approve(owner, items[0]!.id);

      const err = await service.reject(owner, items[0]!.id).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe("REVIEW_FINALIZED");
    });
  });
});
