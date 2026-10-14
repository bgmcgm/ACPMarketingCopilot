import type { AuditQueueMessage } from "@mcopilot/shared-types";
import type { AuditDocument, AuditSummaryRow } from "../domain/auditDocument.js";

export interface AuditRepository {
  create(doc: AuditDocument): Promise<void>;
  get(ownerId: string, id: string): Promise<AuditDocument | null>;
  /** Ersetzt das Dokument. Wirft, wenn es nicht (mehr) existiert. */
  replace(doc: AuditDocument): Promise<void>;
  /**
   * Ersetzt das Dokument nur, wenn es seit dem Lesen unverändert ist (optimistische Sperre über _etag).
   * Verhindert, dass zwei Worker dieselbe Nachricht gleichzeitig verarbeiten.
   * @returns das gespeicherte Dokument (mit neuem _etag) oder null bei Konflikt.
   */
  claim(doc: AuditDocument): Promise<AuditDocument | null>;
  list(
    ownerId: string,
    limit: number,
    continuationToken?: string,
  ): Promise<{ items: AuditSummaryRow[]; continuationToken?: string }>;
  /** @returns true, wenn ein Dokument gelöscht wurde. */
  delete(ownerId: string, id: string): Promise<boolean>;
  countActiveSince(ownerId: string, sinceIso: string): Promise<number>;
  countCreatedSince(ownerId: string, sinceIso: string): Promise<number>;
  ping(): Promise<void>;
}

export interface JobQueue {
  enqueue(message: AuditQueueMessage): Promise<void>;
  ping(): Promise<void>;
}
