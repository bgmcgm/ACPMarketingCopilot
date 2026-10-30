import type { ReviewDocument, ReviewSummaryRow } from "../domain/reviewDocument.js";
import type { ReviewListFilter, ReviewRepository } from "../persistence/ports.js";

/**
 * In-Memory-Repository für Tests (und potenziell den lokalen Demo-Modus).
 * Gehört NICHT zum Produktionspfad: wird von index.ts/container.ts nicht importiert.
 */
export class InMemoryReviewRepository implements ReviewRepository {
  docs = new Map<string, ReviewDocument>();
  failPing = false;
  private key = (o: string, id: string): string => `${o}/${id}`;
  private version = 0;
  private stamp(doc: ReviewDocument): ReviewDocument {
    return { ...structuredClone(doc), _etag: `v${++this.version}` };
  }

  async create(doc: ReviewDocument): Promise<void> {
    this.docs.set(this.key(doc.ownerId, doc.id), this.stamp(doc));
  }
  async get(o: string, id: string): Promise<ReviewDocument | null> {
    return structuredClone(this.docs.get(this.key(o, id)) ?? null);
  }
  async getByExternalId(
    o: string,
    clientId: string,
    externalReviewId: string,
  ): Promise<ReviewDocument | null> {
    const found = [...this.docs.values()].find(
      (d) => d.ownerId === o && d.clientId === clientId && d.externalReviewId === externalReviewId,
    );
    return structuredClone(found ?? null);
  }
  async claim(doc: ReviewDocument): Promise<ReviewDocument | null> {
    const current = this.docs.get(this.key(doc.ownerId, doc.id));
    if (!current || current._etag !== doc._etag) return null;
    const next = this.stamp(doc);
    this.docs.set(this.key(doc.ownerId, doc.id), next);
    return structuredClone(next);
  }
  async list(
    o: string,
    filter: ReviewListFilter,
    limit: number,
    continuationToken?: string,
  ): Promise<{ items: ReviewSummaryRow[]; continuationToken?: string }> {
    const all = [...this.docs.values()]
      .filter((d) => d.ownerId === o)
      .filter((d) => !filter.clientId || d.clientId === filter.clientId)
      .filter((d) => !filter.status || d.reply.status === filter.status)
      .sort((a, b) => b.reviewCreatedAt.localeCompare(a.reviewCreatedAt));
    const start = continuationToken ? Number(continuationToken) : 0;
    const items: ReviewSummaryRow[] = all.slice(start, start + limit).map((d) => ({
      id: d.id,
      clientId: d.clientId,
      reviewer: d.reviewer,
      starRating: d.starRating,
      comment: d.comment,
      reviewCreatedAt: d.reviewCreatedAt,
      reply: d.reply,
    }));
    const next = start + limit;
    return { items, ...(next < all.length ? { continuationToken: String(next) } : {}) };
  }
  async ping(): Promise<void> {
    if (this.failPing) throw new Error("down");
  }
}
