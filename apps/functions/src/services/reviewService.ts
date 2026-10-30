import {
  ListReviewsQuerySchema,
  UpdateReviewReplyRequestSchema,
  type ListReviewsResponse,
  type ReviewDto,
  type SyncReviewsResponse,
} from "@mcopilot/shared-types";
import type { Principal } from "../auth/principal.js";
import type { ClientDocument } from "../domain/clientDocument.js";
import type { ReviewDocument, ReviewSummaryRow } from "../domain/reviewDocument.js";
import type { ClientRepository, ReviewRepository } from "../persistence/ports.js";
import type { GoogleBusinessProfileClient } from "../connectors/googleBusinessProfile/client.js";
import {
  refreshAccessToken,
  type GoogleOAuthConfig,
} from "../connectors/googleBusinessProfile/oauth.js";
import { decryptToken } from "../lib/tokenCipher.js";
import { buildReviewReplyInput, type ReviewReplyProvider } from "../ai/reviewReplyProvider.js";
import { ApiError, clientNotFound, reviewNotFound } from "./errors.js";

export interface ReviewServiceDeps {
  reviews: ReviewRepository;
  clients: ClientRepository;
  google: GoogleBusinessProfileClient;
  ai: ReviewReplyProvider;
  oauth: GoogleOAuthConfig;
  tokenEncryptionKey: string;
  now?: () => Date;
  newId?: () => string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ReviewService {
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(private readonly d: ReviewServiceDeps) {
    this.now = d.now ?? (() => new Date());
    this.newId = d.newId ?? (() => crypto.randomUUID());
  }

  async sync(principal: Principal, clientId: string): Promise<SyncReviewsResponse> {
    const client = await this.loadClient(principal, clientId);
    if (!client.googleAccount) {
      throw new ApiError(
        400,
        "NOT_CONNECTED",
        "Für diesen Kunden ist kein Google-Konto verbunden.",
      );
    }

    const accessToken = await this.accessTokenFor(client);
    const googleReviews = await this.d.google.listReviews(
      accessToken,
      client.googleAccount.locationName,
    );

    let newReviews = 0;
    for (const gr of googleReviews) {
      const existing = await this.d.reviews.getByExternalId(
        principal.userId,
        clientId,
        gr.externalReviewId,
      );
      if (existing) continue;
      const doc: ReviewDocument = {
        id: this.newId(),
        ownerId: principal.userId,
        clientId,
        type: "review",
        schemaVersion: 1,
        provider: "google_business_profile",
        externalReviewId: gr.externalReviewId,
        reviewer: gr.reviewer,
        starRating: gr.starRating,
        comment: gr.comment,
        reviewCreatedAt: gr.createTime,
        fetchedAt: this.now().toISOString(),
        reply: { status: "none" },
      };
      await this.d.reviews.create(doc);
      newReviews++;
    }

    const updatedClient: ClientDocument = {
      ...client,
      googleAccount: { ...client.googleAccount, lastSyncAt: this.now().toISOString() },
    };
    await this.d.clients.claim(updatedClient).catch(() => undefined); // lastSyncAt ist informativ, kein harter Fehler

    // Entwürfe für alle undrafteten Reviews dieses Kunden erzeugen (auch von früheren, fehlgeschlagenen Syncs).
    const { items: undrafted } = await this.d.reviews.list(
      principal.userId,
      { clientId, status: "none" },
      50,
    );
    let draftedReplies = 0;
    let failedDrafts = 0;
    for (const row of undrafted) {
      const full = await this.d.reviews.get(principal.userId, row.id);
      if (!full || full.reply.status !== "none") continue;
      const draft = await this.d.ai.draftReply(
        buildReviewReplyInput(
          { name: client.name, category: client.category },
          {
            reviewerDisplayName: full.reviewer.displayName,
            starRating: full.starRating,
            comment: full.comment,
          },
        ),
      );
      const next: ReviewDocument = {
        ...full,
        reply: {
          ...full.reply,
          ai: draft.meta,
          ...(draft.draftText ? { status: "drafted" as const, draftText: draft.draftText } : {}),
        },
      };
      await this.d.reviews.claim(next);
      if (draft.draftText) draftedReplies++;
      else failedDrafts++;
    }

    return { newReviews, draftedReplies, failedDrafts };
  }

  async list(principal: Principal, query: unknown): Promise<ListReviewsResponse> {
    const q = ListReviewsQuerySchema.parse(query);
    const page = await this.d.reviews.list(
      principal.userId,
      {
        ...(q.clientId ? { clientId: q.clientId } : {}),
        ...(q.status ? { status: q.status } : {}),
      },
      q.limit,
      q.continuationToken,
    );
    return {
      items: page.items.map(toDto),
      ...(page.continuationToken ? { continuationToken: page.continuationToken } : {}),
    };
  }

  async updateDraft(principal: Principal, reviewId: string, body: unknown): Promise<ReviewDto> {
    const req = UpdateReviewReplyRequestSchema.parse(body);
    const review = await this.loadReview(principal, reviewId);
    if (review.reply.status === "posted" || review.reply.status === "rejected") {
      throw new ApiError(409, "REVIEW_FINALIZED", "Diese Bewertung ist bereits abgeschlossen.");
    }
    const next: ReviewDocument = {
      ...review,
      reply: {
        ...review.reply,
        editedText: req.editedText,
        status: review.reply.status === "none" ? "drafted" : review.reply.status,
      },
    };
    const saved = await this.d.reviews.claim(next);
    if (!saved) throw new ApiError(409, "CONFLICT", "Bewertung wurde zwischenzeitlich geändert.");
    return toDto(summarize(saved));
  }

  async approve(principal: Principal, reviewId: string): Promise<ReviewDto> {
    const review = await this.loadReview(principal, reviewId);
    if (review.reply.status !== "drafted") {
      throw new ApiError(409, "NOT_DRAFTED", "Diese Bewertung hat keinen freigebbaren Entwurf.");
    }
    const text = review.reply.editedText ?? review.reply.draftText;
    if (!text) throw new ApiError(409, "NOT_DRAFTED", "Kein Antworttext vorhanden.");

    const client = await this.loadClient(principal, review.clientId);
    if (!client.googleAccount) {
      throw new ApiError(
        400,
        "NOT_CONNECTED",
        "Für diesen Kunden ist kein Google-Konto verbunden.",
      );
    }

    try {
      const accessToken = await this.accessTokenFor(client);
      await this.d.google.replyToReview(accessToken, review.externalReviewId, text);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unbekannter Fehler.";
      await this.d.reviews
        .claim({ ...review, reply: { ...review.reply, error: { code: "POST_FAILED", message } } })
        .catch(() => undefined);
      throw new ApiError(
        502,
        "POST_FAILED",
        "Die Antwort konnte nicht bei Google veröffentlicht werden.",
      );
    }

    const next: ReviewDocument = {
      ...review,
      reply: { ...review.reply, status: "posted", postedAt: this.now().toISOString() },
    };
    delete next.reply.error;
    const saved = await this.d.reviews.claim(next);
    if (!saved) throw new ApiError(409, "CONFLICT", "Bewertung wurde zwischenzeitlich geändert.");
    return toDto(summarize(saved));
  }

  async reject(principal: Principal, reviewId: string): Promise<ReviewDto> {
    const review = await this.loadReview(principal, reviewId);
    if (review.reply.status === "posted") {
      throw new ApiError(409, "REVIEW_FINALIZED", "Diese Bewertung wurde bereits beantwortet.");
    }
    const saved = await this.d.reviews.claim({
      ...review,
      reply: { ...review.reply, status: "rejected" },
    });
    if (!saved) throw new ApiError(409, "CONFLICT", "Bewertung wurde zwischenzeitlich geändert.");
    return toDto(summarize(saved));
  }

  private async accessTokenFor(client: ClientDocument): Promise<string> {
    if (!client.googleAccount) {
      throw new ApiError(
        400,
        "NOT_CONNECTED",
        "Für diesen Kunden ist kein Google-Konto verbunden.",
      );
    }
    const refreshToken = decryptToken(
      client.googleAccount.encryptedRefreshToken,
      this.d.tokenEncryptionKey,
    );
    const { accessToken } = await refreshAccessToken(this.d.oauth, refreshToken);
    return accessToken;
  }

  private async loadClient(principal: Principal, clientId: string): Promise<ClientDocument> {
    if (!UUID.test(clientId)) throw clientNotFound();
    const doc = await this.d.clients.get(principal.userId, clientId);
    if (!doc) throw clientNotFound();
    return doc;
  }

  private async loadReview(principal: Principal, reviewId: string): Promise<ReviewDocument> {
    if (!UUID.test(reviewId)) throw reviewNotFound();
    const doc = await this.d.reviews.get(principal.userId, reviewId);
    if (!doc) throw reviewNotFound();
    return doc;
  }
}

function summarize(doc: ReviewDocument): ReviewSummaryRow {
  return {
    id: doc.id,
    clientId: doc.clientId,
    reviewer: doc.reviewer,
    starRating: doc.starRating,
    comment: doc.comment,
    reviewCreatedAt: doc.reviewCreatedAt,
    reply: doc.reply,
  };
}

function toDto(row: ReviewSummaryRow): ReviewDto {
  return {
    id: row.id,
    clientId: row.clientId,
    provider: "google_business_profile",
    reviewer: row.reviewer,
    starRating: row.starRating,
    comment: row.comment,
    reviewCreatedAt: row.reviewCreatedAt,
    reply: row.reply,
  };
}
