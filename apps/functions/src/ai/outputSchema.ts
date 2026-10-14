import { z } from "zod/v4";

/**
 * Schema für die strukturierte Claude-Ausgabe (Zod v4, vom SDK-Helper verlangt).
 * Bewusst ohne Längen-/Bereichsgrenzen: Die strikte Validierung erfolgt anschließend
 * mit AiAssessmentSchema aus shared-types – Claude kann dort weder Findings noch Scores setzen.
 * Beide Schemas müssen strukturell identisch bleiben (siehe Test).
 */
export const AiOutputSchema = z.object({
  executiveSummary: z.string(),
  marketingFindings: z.array(
    z.object({
      category: z.enum(["seo", "tracking", "consent", "content", "conversion", "messaging"]),
      severity: z.enum(["high", "medium", "low"]),
      finding: z.string(),
      recommendation: z.string(),
      confidence: z.enum(["high", "medium", "low"]),
    }),
  ),
  priorities: z.array(
    z.object({
      priority: z.number().int(),
      action: z.string(),
      ownerType: z.enum(["marketing", "content", "web_dev", "legal_privacy", "analytics"]),
    }),
  ),
  limitations: z.array(z.string()),
});
