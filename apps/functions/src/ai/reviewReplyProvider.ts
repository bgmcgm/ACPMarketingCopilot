import type { ClientCategory, ReviewAiMeta, StarRating } from "@mcopilot/shared-types";

export interface ReviewReplyInput {
  client: { name: string; category: ClientCategory };
  review: {
    reviewerDisplayName: string;
    starRating: StarRating;
    comment: string | null;
  };
}

export interface ReviewReplyDraft {
  meta: ReviewAiMeta;
  draftText?: string;
}

/** Austauschbare KI-Abstraktion. Implementierungen werfen nicht: Fehler werden als `failed`-Record gemeldet. */
export interface ReviewReplyProvider {
  draftReply(input: ReviewReplyInput): Promise<ReviewReplyDraft>;
}

export function buildReviewReplyInput(
  client: { name: string; category: ClientCategory },
  review: { reviewerDisplayName: string; starRating: StarRating; comment: string | null },
): ReviewReplyInput {
  return {
    client: { name: client.name.slice(0, 200), category: client.category },
    review: {
      reviewerDisplayName: review.reviewerDisplayName.slice(0, 200),
      starRating: review.starRating,
      comment: review.comment?.slice(0, 2000) ?? null,
    },
  };
}
