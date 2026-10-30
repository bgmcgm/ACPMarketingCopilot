import type { AuditQueueMessage, ReviewReplyStatus } from "@mcopilot/shared-types";
import type { AuditDocument, AuditSummaryRow } from "../domain/auditDocument.js";
import type { ClientDocument } from "../domain/clientDocument.js";
import type { ReviewDocument, ReviewSummaryRow } from "../domain/reviewDocument.js";

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

export interface ClientRepository {
  create(doc: ClientDocument): Promise<void>;
  get(ownerId: string, id: string): Promise<ClientDocument | null>;
  /** Optimistische Sperre über _etag; verhindert verlorene Updates bei gleichzeitigem OAuth-Callback. */
  claim(doc: ClientDocument): Promise<ClientDocument | null>;
  /** Clients einer Agentur sind erfahrungsgemäß wenige Dutzend; keine Paginierung im MVP. */
  list(ownerId: string): Promise<ClientDocument[]>;
  ping(): Promise<void>;
}

export interface ReviewListFilter {
  clientId?: string;
  status?: ReviewReplyStatus;
}

export interface ReviewRepository {
  create(doc: ReviewDocument): Promise<void>;
  get(ownerId: string, id: string): Promise<ReviewDocument | null>;
  /** Idempotenz beim Sync: bereits bekannte Google-Reviews nicht erneut anlegen. */
  getByExternalId(
    ownerId: string,
    clientId: string,
    externalReviewId: string,
  ): Promise<ReviewDocument | null>;
  /** Optimistische Sperre über _etag; verhindert doppeltes Posten bei gleichzeitiger Freigabe. */
  claim(doc: ReviewDocument): Promise<ReviewDocument | null>;
  list(
    ownerId: string,
    filter: ReviewListFilter,
    limit: number,
    continuationToken?: string,
  ): Promise<{ items: ReviewSummaryRow[]; continuationToken?: string }>;
  ping(): Promise<void>;
}
