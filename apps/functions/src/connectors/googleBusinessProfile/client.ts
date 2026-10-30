import type { StarRating } from "@mcopilot/shared-types";

export interface GoogleAccount {
  /** Resource-Name, z. B. "accounts/123". */
  accountName: string;
  displayName: string;
}

export interface GoogleLocation {
  /** Resource-Name, z. B. "accounts/123/locations/456". */
  locationName: string;
  displayName: string;
}

export interface GoogleReview {
  /** Resource-Name der Review, z. B. "accounts/123/locations/456/reviews/789". Idempotenz-Schlüssel. */
  externalReviewId: string;
  reviewer: { displayName: string };
  starRating: StarRating;
  comment: string | null;
  createTime: string;
}

export class GoogleApiError extends Error {
  constructor(
    readonly code: "AUTH_EXPIRED" | "NOT_FOUND" | "RATE_LIMITED" | "PROVIDER_ERROR",
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "GoogleApiError";
  }
}

/**
 * Austauschbare Sicht auf die Google-Business-Profile-API. Einzige Implementierung mit echtem
 * Netzwerkzugriff: `httpClient.ts`. Tests laufen ausschließlich gegen ein Test-Double
 * (siehe `tests/connectors/googleBusinessProfile.test.ts`), analog zu `ai/provider.ts`.
 */
export interface GoogleBusinessProfileClient {
  listAccounts(accessToken: string): Promise<GoogleAccount[]>;
  listLocations(accessToken: string, accountName: string): Promise<GoogleLocation[]>;
  listReviews(accessToken: string, locationName: string): Promise<GoogleReview[]>;
  replyToReview(accessToken: string, reviewName: string, comment: string): Promise<void>;
}
