import { z } from "zod";
import { AUDIT_CATEGORIES, AuditCategorySchema } from "./audit.js";

export const CreateAuditRequestSchema = z.object({
  url: z.string().trim().min(1).max(2048),
  modules: z
    .array(AuditCategorySchema)
    .min(1)
    .transform((m) => [...new Set(m)])
    .default([...AUDIT_CATEGORIES]),
});
export type CreateAuditRequest = z.infer<typeof CreateAuditRequestSchema>;

export const ListAuditsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  continuationToken: z.string().max(4096).optional(),
});
export type ListAuditsQuery = z.infer<typeof ListAuditsQuerySchema>;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(z.unknown()).optional(),
    correlationId: z.string().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const AuditQueueMessageSchema = z.object({
  schemaVersion: z.literal(1),
  auditId: z.string().uuid(),
  ownerId: z.string().min(1),
});
export type AuditQueueMessage = z.infer<typeof AuditQueueMessageSchema>;
