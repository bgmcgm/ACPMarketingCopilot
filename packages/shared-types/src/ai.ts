import { z } from "zod";

/** KI-Bewertung. Bewusst ohne "critical" und ohne Felder für Findings/Scores. */
export const AiAssessmentSchema = z.object({
  executiveSummary: z.string().min(1).max(3000),
  marketingFindings: z
    .array(
      z.object({
        category: z.enum(["seo", "tracking", "consent", "content", "conversion", "messaging"]),
        severity: z.enum(["high", "medium", "low"]),
        finding: z.string().min(1).max(1000),
        recommendation: z.string().min(1).max(1000),
        confidence: z.enum(["high", "medium", "low"]),
      }),
    )
    .max(20),
  priorities: z
    .array(
      z.object({
        priority: z.number().int().min(1).max(20),
        action: z.string().min(1).max(500),
        ownerType: z.enum(["marketing", "content", "web_dev", "legal_privacy", "analytics"]),
      }),
    )
    .max(10),
  limitations: z.array(z.string().max(500)).max(10),
});
export type AiAssessment = z.infer<typeof AiAssessmentSchema>;

export const AiAssessmentRecordSchema = z.object({
  status: z.enum(["completed", "failed", "skipped"]),
  provider: z.literal("anthropic"),
  model: z.string(),
  promptVersion: z.string(),
  generatedAt: z.string().optional(),
  usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }).optional(),
  result: AiAssessmentSchema.optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
  source: z.literal("ai"),
});
export type AiAssessmentRecord = z.infer<typeof AiAssessmentRecordSchema>;
