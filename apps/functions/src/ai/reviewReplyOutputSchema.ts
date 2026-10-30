import { z } from "zod/v4";

/**
 * Schema für die strukturierte Claude-Ausgabe (Zod v4, vom SDK-Helper verlangt).
 * Muss strukturell identisch zu AiReviewReplySchema aus shared-types bleiben (siehe Test),
 * gleiches Prinzip wie ai/outputSchema.ts ↔ AiAssessmentSchema.
 */
export const ReviewReplyOutputSchema = z.object({
  replyText: z.string(),
  tone: z.enum(["dankbar", "entschuldigend", "sachlich"]),
  confidence: z.enum(["high", "medium", "low"]),
  notes: z.string().optional(),
});
