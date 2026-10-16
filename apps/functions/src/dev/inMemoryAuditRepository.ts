import type { AuditDocument, AuditSummaryRow } from "../domain/auditDocument.js";
import type { AuditRepository } from "../persistence/ports.js";

/**
 * In-Memory-Repository für Tests und den lokalen Demo-Modus (npm run demo).
 * Gehört NICHT zum Produktionspfad: wird von index.ts/container.ts nicht importiert und nicht ins Deploy-Paket aufgenommen.
 */
export class InMemoryAuditRepository implements AuditRepository {
  docs = new Map<string, AuditDocument>();
  failPing = false;
  private key = (o: string, id: string): string => `${o}/${id}`;
  private version = 0;
  private stamp(doc: AuditDocument): AuditDocument {
    return { ...structuredClone(doc), _etag: `v${++this.version}` };
  }

  async create(doc: AuditDocument): Promise<void> {
    this.docs.set(this.key(doc.ownerId, doc.id), this.stamp(doc));
  }
  async claim(doc: AuditDocument): Promise<AuditDocument | null> {
    const current = this.docs.get(this.key(doc.ownerId, doc.id));
    if (!current || current._etag !== doc._etag) return null;
    const next = this.stamp(doc);
    this.docs.set(this.key(doc.ownerId, doc.id), next);
    return structuredClone(next);
  }
  async get(o: string, id: string): Promise<AuditDocument | null> {
    return structuredClone(this.docs.get(this.key(o, id)) ?? null);
  }
  async replace(doc: AuditDocument): Promise<void> {
    if (!this.docs.has(this.key(doc.ownerId, doc.id))) throw new Error("not found");
    this.docs.set(this.key(doc.ownerId, doc.id), this.stamp(doc));
  }
  async list(o: string, limit: number, token?: string) {
    const all = [...this.docs.values()]
      .filter((d) => d.ownerId === o)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const start = token ? Number(token) : 0;
    const items: AuditSummaryRow[] = all.slice(start, start + limit).map((d) => ({
      id: d.id,
      url: d.input.url,
      status: d.status,
      createdAt: d.createdAt,
      overallScore: d.score?.overall ?? null,
    }));
    const next = start + limit;
    return { items, ...(next < all.length ? { continuationToken: String(next) } : {}) };
  }
  async delete(o: string, id: string): Promise<boolean> {
    return this.docs.delete(this.key(o, id));
  }
  async countActiveSince(o: string, since: string): Promise<number> {
    return [...this.docs.values()].filter(
      (d) =>
        d.ownerId === o &&
        (d.status === "queued" || d.status === "running") &&
        d.createdAt >= since,
    ).length;
  }
  async countCreatedSince(o: string, since: string): Promise<number> {
    return [...this.docs.values()].filter((d) => d.ownerId === o && d.createdAt >= since).length;
  }
  async ping(): Promise<void> {
    if (this.failPing) throw new Error("down");
  }
}
