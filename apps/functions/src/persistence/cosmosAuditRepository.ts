import { CosmosClient, type Container } from "@azure/cosmos";
import { DefaultAzureCredential } from "@azure/identity";
import type { AuditDocument, AuditSummaryRow } from "../domain/auditDocument.js";
import type { AuditRepository } from "./ports.js";

export interface CosmosOptions {
  endpoint: string;
  database: string;
  container: string;
}

/** Zugriff per Managed Identity (Data-Plane-RBAC), keine Keys. */
export class CosmosAuditRepository implements AuditRepository {
  private readonly container: Container;

  constructor(opts: CosmosOptions, client?: CosmosClient) {
    const c =
      client ??
      new CosmosClient({ endpoint: opts.endpoint, aadCredentials: new DefaultAzureCredential() });
    this.container = c.database(opts.database).container(opts.container);
  }

  async create(doc: AuditDocument): Promise<void> {
    await this.container.items.create(doc);
  }

  async get(ownerId: string, id: string): Promise<AuditDocument | null> {
    const { resource } = await this.container.item(id, ownerId).read<AuditDocument>();
    return resource && resource.type === "audit" ? resource : null;
  }

  async replace(doc: AuditDocument): Promise<void> {
    await this.container.item(doc.id, doc.ownerId).replace(doc);
  }

  async claim(doc: AuditDocument): Promise<AuditDocument | null> {
    try {
      const { resource } = await this.container
        .item(doc.id, doc.ownerId)
        .replace<AuditDocument>(doc, {
          accessCondition: { type: "IfMatch", condition: doc._etag ?? "" },
        });
      return resource ?? null;
    } catch (err) {
      // 412: Dokument wurde zwischenzeitlich geändert → anderer Worker war schneller.
      if ((err as { code?: number }).code === 412) return null;
      throw err;
    }
  }

  async list(ownerId: string, limit: number, continuationToken?: string) {
    const iterator = this.container.items.query<AuditSummaryRow>(
      {
        query:
          "SELECT c.id, c.input.url AS url, c.status, c.createdAt, " +
          "(IS_DEFINED(c.score) ? c.score.overall : null) AS overallScore " +
          "FROM c WHERE c.ownerId = @ownerId AND c.type = 'audit' ORDER BY c.createdAt DESC",
        parameters: [{ name: "@ownerId", value: ownerId }],
      },
      {
        partitionKey: ownerId,
        maxItemCount: limit,
        ...(continuationToken ? { continuationToken } : {}),
      },
    );
    const page = await iterator.fetchNext();
    const rows = (page.resources ?? []).map((r) => ({
      ...r,
      overallScore: r.overallScore ?? null,
    }));
    return {
      items: rows,
      ...(page.hasMoreResults && page.continuationToken
        ? { continuationToken: page.continuationToken }
        : {}),
    };
  }

  async delete(ownerId: string, id: string): Promise<boolean> {
    try {
      await this.container.item(id, ownerId).delete();
      return true;
    } catch (err) {
      if ((err as { code?: number }).code === 404) return false;
      throw err;
    }
  }

  countActiveSince(ownerId: string, sinceIso: string): Promise<number> {
    return this.count(
      "SELECT VALUE COUNT(1) FROM c WHERE c.ownerId = @o AND c.type = 'audit' " +
        "AND c.status IN ('queued', 'running') AND c.createdAt >= @s",
      ownerId,
      sinceIso,
    );
  }

  countCreatedSince(ownerId: string, sinceIso: string): Promise<number> {
    return this.count(
      "SELECT VALUE COUNT(1) FROM c WHERE c.ownerId = @o AND c.type = 'audit' AND c.createdAt >= @s",
      ownerId,
      sinceIso,
    );
  }

  async ping(): Promise<void> {
    await this.container.read();
  }

  private async count(query: string, ownerId: string, sinceIso: string): Promise<number> {
    const { resources } = await this.container.items
      .query<number>(
        {
          query,
          parameters: [
            { name: "@o", value: ownerId },
            { name: "@s", value: sinceIso },
          ],
        },
        { partitionKey: ownerId },
      )
      .fetchAll();
    return resources[0] ?? 0;
  }
}
