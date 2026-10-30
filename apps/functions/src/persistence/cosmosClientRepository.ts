import { CosmosClient, type Container } from "@azure/cosmos";
import { DefaultAzureCredential } from "@azure/identity";
import type { ClientDocument } from "../domain/clientDocument.js";
import type { ClientRepository } from "./ports.js";
import type { CosmosOptions } from "./cosmosAuditRepository.js";

/** Zugriff per Managed Identity (Data-Plane-RBAC), keine Keys. Gleiches Muster wie CosmosAuditRepository. */
export class CosmosClientRepository implements ClientRepository {
  private readonly container: Container;

  constructor(opts: CosmosOptions, client?: CosmosClient) {
    const c =
      client ??
      new CosmosClient({ endpoint: opts.endpoint, aadCredentials: new DefaultAzureCredential() });
    this.container = c.database(opts.database).container(opts.container);
  }

  async create(doc: ClientDocument): Promise<void> {
    await this.container.items.create(doc);
  }

  async get(ownerId: string, id: string): Promise<ClientDocument | null> {
    const { resource } = await this.container.item(id, ownerId).read<ClientDocument>();
    return resource && resource.type === "client" ? resource : null;
  }

  async claim(doc: ClientDocument): Promise<ClientDocument | null> {
    try {
      const { resource } = await this.container
        .item(doc.id, doc.ownerId)
        .replace<ClientDocument>(doc, {
          accessCondition: { type: "IfMatch", condition: doc._etag ?? "" },
        });
      return resource ?? null;
    } catch (err) {
      if ((err as { code?: number }).code === 412) return null;
      throw err;
    }
  }

  async list(ownerId: string): Promise<ClientDocument[]> {
    const { resources } = await this.container.items
      .query<ClientDocument>(
        {
          query:
            "SELECT * FROM c WHERE c.ownerId = @ownerId AND c.type = 'client' ORDER BY c.createdAt DESC",
          parameters: [{ name: "@ownerId", value: ownerId }],
        },
        { partitionKey: ownerId },
      )
      .fetchAll();
    return resources;
  }

  async ping(): Promise<void> {
    await this.container.read();
  }
}
