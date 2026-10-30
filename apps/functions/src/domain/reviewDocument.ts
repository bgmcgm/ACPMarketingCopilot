import type { ReviewAiMeta, ReviewReplyStatus, StarRating } from "@mcopilot/shared-types";

/** Cosmos-Dokument einer Google-Bewertung samt Antwort-Workflow (Partition Key: ownerId). */
export interface ReviewDocument {
  id: string;
  ownerId: string;
  clientId: string;
  type: "review";
  /** Systemfeld von Cosmos (optimistische Sperre); nicht selbst setzen. */
  _etag?: string;
  schemaVersion: 1;
  provider: "google_business_profile";
  /** Google-Review-Resource-Name; Idempotenz-Schlüssel beim Sync. */
  externalReviewId: string;
  reviewer: { displayName: string };
  starRating: StarRating;
  comment: string | null;
  reviewCreatedAt: string;
  fetchedAt: string;
  reply: {
    status: ReviewReplyStatus;
    draftText?: string;
    editedText?: string;
    ai?: ReviewAiMeta;
    approvedAt?: string;
    postedAt?: string;
    /** Letzter fehlgeschlagener Post-Versuch; bleibt bei Fehler auf "drafted" für erneuten Versuch. */
    error?: { code: string; message: string };
  };
}

export interface ReviewSummaryRow {
  id: string;
  clientId: string;
  reviewer: { displayName: string };
  starRating: StarRating;
  comment: string | null;
  reviewCreatedAt: string;
  reply: ReviewDocument["reply"];
}
