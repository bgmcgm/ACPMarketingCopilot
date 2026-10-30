import { CosmosClient, type Container, type SqlParameter } from "@azure/cosmos";
import { DefaultAzureCredential } from "@azure/identity";
import type { ReviewDocument, ReviewSummaryRow } from "../domain/reviewDocument.js";
import type { ReviewListFilter, ReviewRepository } from "./ports.js";
import type { CosmosOptions } from "./cosmosAuditRepository.js";

/** Zugriff per Managed Identity (Data-Plane-RBAC), keine Keys. Gleiches Muster wie CosmosAuditRepository. */
export class CosmosReviewRepository implements ReviewRepository {
  private readonly container: Container;

  constructor(opts: CosmosOptions, client?: CosmosClient) {
    const c =
      client ??
      new CosmosClient({ endpoint: opts.endpoint, aadCredentials: new DefaultAzureCredential() });
    this.container = c.database(opts.database).container(opts.container);
  }

  async create(doc: ReviewDocument): Promise<void> {
    await this.container.items.create(doc);
  }

  async get(ownerId: string, id: string): Promise<ReviewDocument | null> {
    const { resource } = await this.container.item(id, ownerId).read<ReviewDocument>();
    return resource && resource.type === "review" ? resource : null;
  }

  async getByExternalId(
    ownerId: string,
    clientId: string,
    externalReviewId: string,
  ): Promise<ReviewDocument | null> {
    const { resources } = await this.container.items
      .query<ReviewDocument>(
        {
          query:
            "SELECT * FROM c WHERE c.ownerId = @ownerId AND c.type = 'review' " +
            "AND c.clientId = @clientId AND c.externalReviewId = @externalReviewId",
          parameters: [
            { name: "@ownerId", value: ownerId },
            { name: "@clientId", value: clientId },
            { name: "@externalReviewId", value: externalReviewId },
          ],
        },
        { partitionKey: ownerId },
      )
      .fetchAll();
    return resources[0] ?? null;
  }

  async claim(doc: ReviewDocument): Promise<ReviewDocument | null> {
    try {
      const { resource } = await this.container
        .item(doc.id, doc.ownerId)
        .replace<ReviewDocument>(doc, {
          accessCondition: { type: "IfMatch", condition: doc._etag ?? "" },
        });
      return resource ?? null;
    } catch (err) {
      if ((err as { code?: number }).code === 412) return null;
      throw err;
    }
  }

  async list(
    ownerId: string,
    filter: ReviewListFilter,
    limit: number,
    continuationToken?: string,
  ): Promise<{ items: ReviewSummaryRow[]; continuationToken?: string }> {
    const parameters: SqlParameter[] = [{ name: "@ownerId", value: ownerId }];
    let query =
      "SELECT c.id, c.clientId, c.reviewer, c.starRating, c.comment, c.reviewCreatedAt, c.reply " +
      "FROM c WHERE c.ownerId = @ownerId AND c.type = 'review'";
    if (filter.clientId) {
      query += " AND c.clientId = @clientId";
      parameters.push({ name: "@clientId", value: filter.clientId });
    }
    if (filter.status) {
      query += " AND c.reply.status = @status";
      parameters.push({ name: "@status", value: filter.status });
    }
    query += " ORDER BY c.reviewCreatedAt DESC";

    const iterator = this.container.items.query<ReviewSummaryRow>(
      { query, parameters },
      {
        partitionKey: ownerId,
        maxItemCount: limit,
        ...(continuationToken ? { continuationToken } : {}),
      },
    );
    const page = await iterator.fetchNext();
    return {
      items: page.resources ?? [],
      ...(page.hasMoreResults && page.continuationToken
        ? { continuationToken: page.continuationToken }
        : {}),
    };
  }

  async ping(): Promise<void> {
    await this.container.read();
  }
}
