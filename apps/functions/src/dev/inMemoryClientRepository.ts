import type { ClientDocument } from "../domain/clientDocument.js";
import type { ClientRepository } from "../persistence/ports.js";

/**
 * In-Memory-Repository für Tests (und potenziell den lokalen Demo-Modus).
 * Gehört NICHT zum Produktionspfad: wird von index.ts/container.ts nicht importiert.
 */
export class InMemoryClientRepository implements ClientRepository {
  docs = new Map<string, ClientDocument>();
  failPing = false;
  private key = (o: string, id: string): string => `${o}/${id}`;
  private version = 0;
  private stamp(doc: ClientDocument): ClientDocument {
    return { ...structuredClone(doc), _etag: `v${++this.version}` };
  }

  async create(doc: ClientDocument): Promise<void> {
    this.docs.set(this.key(doc.ownerId, doc.id), this.stamp(doc));
  }
  async get(o: string, id: string): Promise<ClientDocument | null> {
    return structuredClone(this.docs.get(this.key(o, id)) ?? null);
  }
  async claim(doc: ClientDocument): Promise<ClientDocument | null> {
    const current = this.docs.get(this.key(doc.ownerId, doc.id));
    if (!current || current._etag !== doc._etag) return null;
    const next = this.stamp(doc);
    this.docs.set(this.key(doc.ownerId, doc.id), next);
    return structuredClone(next);
  }
  async list(o: string): Promise<ClientDocument[]> {
    return structuredClone(
      [...this.docs.values()]
        .filter((d) => d.ownerId === o)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  }
  async ping(): Promise<void> {
    if (this.failPing) throw new Error("down");
  }
}
