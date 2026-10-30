import { z } from "zod";

// ---- Domain -----------------------------------------------------------------

export const CLIENT_CATEGORIES = ["handel", "kmu", "other"] as const;
export type ClientCategory = (typeof CLIENT_CATEGORIES)[number];

export const REVIEW_REPLY_STATUSES = ["none", "drafted", "posted", "rejected"] as const;
export type ReviewReplyStatus = (typeof REVIEW_REPLY_STATUSES)[number];

export type StarRating = 1 | 2 | 3 | 4 | 5;

export interface GoogleAccountSummary {
  status: "connected" | "error";
  locationName: string;
  displayName: string;
  connectedAt: string;
  lastSyncAt?: string;
}

export interface ReviewAiMeta {
  status: "completed" | "failed";
  model: string;
  promptVersion: string;
  generatedAt?: string;
  error?: { code: string; message: string };
}

export interface ReviewReply {
  status: ReviewReplyStatus;
  draftText?: string;
  editedText?: string;
  ai?: ReviewAiMeta;
  approvedAt?: string;
  postedAt?: string;
  error?: { code: string; message: string };
}

// ---- AI output (Claude) ------------------------------------------------------

/** Strukturierte Claude-Ausgabe für einen Antwortentwurf. Nur Text, keine Aktionen. */
export const AiReviewReplySchema = z.object({
  replyText: z.string().min(1).max(1200),
  tone: z.enum(["dankbar", "entschuldigend", "sachlich"]),
  confidence: z.enum(["high", "medium", "low"]),
  notes: z.string().max(500).optional(),
});
export type AiReviewReply = z.infer<typeof AiReviewReplySchema>;

// ---- Request-DTOs -------------------------------------------------------------

export const CreateClientRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  category: z.enum(CLIENT_CATEGORIES),
});
export type CreateClientRequest = z.infer<typeof CreateClientRequestSchema>;

export const UpdateReviewReplyRequestSchema = z.object({
  editedText: z.string().trim().min(1).max(1200),
});
export type UpdateReviewReplyRequest = z.infer<typeof UpdateReviewReplyRequestSchema>;

export const ListReviewsQuerySchema = z.object({
  clientId: z.string().uuid().optional(),
  status: z.enum(REVIEW_REPLY_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  continuationToken: z.string().max(4096).optional(),
});
export type ListReviewsQuery = z.infer<typeof ListReviewsQuerySchema>;

export const GoogleOAuthCallbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});
export type GoogleOAuthCallbackQuery = z.infer<typeof GoogleOAuthCallbackQuerySchema>;

export const SelectGoogleLocationRequestSchema = z.object({
  locationName: z.string().trim().min(1).max(200),
});
export type SelectGoogleLocationRequest = z.infer<typeof SelectGoogleLocationRequestSchema>;

// ---- Response-DTOs ------------------------------------------------------------

export interface ClientDto {
  id: string;
  name: string;
  category: ClientCategory;
  createdAt: string;
  googleAccount?: GoogleAccountSummary;
  /** Gesetzt, wenn der OAuth-Callback abgeschlossen ist, aber noch kein Standort gewählt wurde. */
  pendingGoogleLocations?: GoogleLocationOption[];
}

export interface ListClientsResponse {
  items: ClientDto[];
}

export interface ReviewDto {
  id: string;
  clientId: string;
  provider: "google_business_profile";
  reviewer: { displayName: string };
  starRating: StarRating;
  comment: string | null;
  reviewCreatedAt: string;
  reply: ReviewReply;
}

export interface ListReviewsResponse {
  items: ReviewDto[];
  continuationToken?: string;
}

export interface SyncReviewsResponse {
  newReviews: number;
  draftedReplies: number;
  failedDrafts: number;
}

export interface GoogleAuthorizeResponse {
  authorizeUrl: string;
}

export interface GoogleLocationOption {
  locationName: string;
  displayName: string;
}

/** Zwischenschritt nach dem OAuth-Callback, falls der Kunde mehr als einen Standort hat. */
export interface GoogleCallbackResponse {
  clientId: string;
  locations: GoogleLocationOption[];
}
