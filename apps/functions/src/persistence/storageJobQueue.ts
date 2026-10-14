import { DefaultAzureCredential } from "@azure/identity";
import { QueueClient } from "@azure/storage-queue";
import { AuditQueueMessageSchema, type AuditQueueMessage } from "@mcopilot/shared-types";
import type { JobQueue } from "./ports.js";

export interface StorageQueueOptions {
  accountName: string;
  queueName: string;
}

/**
 * Sendet Base64-kodierte JSON-Nachrichten (Standard-Encoding des Functions-Queue-Triggers).
 * [ANNAHME] host.json bleibt bei messageEncoding = "base64".
 */
export class StorageJobQueue implements JobQueue {
  private readonly client: QueueClient;

  constructor(opts: StorageQueueOptions, client?: QueueClient) {
    this.client =
      client ??
      new QueueClient(
        `https://${opts.accountName}.queue.core.windows.net/${opts.queueName}`,
        new DefaultAzureCredential(),
      );
  }

  async enqueue(message: AuditQueueMessage): Promise<void> {
    const valid = AuditQueueMessageSchema.parse(message);
    await this.client.sendMessage(Buffer.from(JSON.stringify(valid), "utf8").toString("base64"));
  }

  async ping(): Promise<void> {
    await this.client.getProperties();
  }
}
