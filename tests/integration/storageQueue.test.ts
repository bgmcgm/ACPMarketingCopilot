import { spawn, type ChildProcess } from "node:child_process";
import { createServer, connect } from "node:net";
import { join } from "node:path";
import { QueueClient } from "@azure/storage-queue";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuditQueueMessageSchema } from "@mcopilot/shared-types";
import { StorageJobQueue } from "../../apps/functions/src/persistence/storageJobQueue.js";

// Öffentlich dokumentierter, fester Entwicklungs-Schlüssel des Azurite-Emulators (kein Secret).
const AZURITE_KEY =
  "Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==";

let azurite: ChildProcess;
let client: QueueClient;
const freePort = (): Promise<number> =>
  new Promise((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
const waitForPort = async (port: number): Promise<void> => {
  for (let i = 0; i < 100; i++) {
    const ok = await new Promise<boolean>((r) => {
      const c = connect(port, "127.0.0.1", () => (c.destroy(), r(true)));
      c.on("error", () => r(false));
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Azurite nicht gestartet");
};

beforeAll(async () => {
  const port = await freePort();
  azurite = spawn(
    join(process.cwd(), "node_modules/.bin/azurite-queue"),
    ["--queuePort", String(port), "--inMemoryPersistence", "--silent", "--skipApiVersionCheck"],
    { stdio: "ignore" },
  );
  await waitForPort(port);
  const conn = `DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=${AZURITE_KEY};QueueEndpoint=http://127.0.0.1:${port}/devstoreaccount1;`;
  client = new QueueClient(conn, "audit-jobs");
  await client.createIfNotExists();
}, 30_000);

afterAll(() => {
  azurite?.kill();
});

describe("StorageJobQueue (gegen Azurite)", () => {
  const msg = {
    schemaVersion: 1 as const,
    auditId: "00000000-0000-4000-8000-000000000001",
    ownerId: "user-1",
  };

  it("sends a base64-encoded JSON message in the format the Functions queue trigger expects", async () => {
    const queue = new StorageJobQueue({ accountName: "x", queueName: "audit-jobs" }, client);
    await queue.enqueue(msg);
    const received = await client.receiveMessages({ numberOfMessages: 1 });
    const raw = received.receivedMessageItems[0]!.messageText;
    expect(raw).toBe(Buffer.from(JSON.stringify(msg)).toString("base64"));
    const decoded = AuditQueueMessageSchema.parse(
      JSON.parse(Buffer.from(raw, "base64").toString("utf8")),
    );
    expect(decoded).toEqual(msg);
    await client.deleteMessage(
      received.receivedMessageItems[0]!.messageId,
      received.receivedMessageItems[0]!.popReceipt,
    );
  });

  it("carries no URL or page content – only ids", async () => {
    const queue = new StorageJobQueue({ accountName: "x", queueName: "audit-jobs" }, client);
    await queue.enqueue(msg);
    const [m] = (await client.receiveMessages({ numberOfMessages: 1 })).receivedMessageItems;
    const body = Buffer.from(m!.messageText, "base64").toString("utf8");
    expect(Object.keys(JSON.parse(body)).sort()).toEqual(["auditId", "ownerId", "schemaVersion"]);
    await client.deleteMessage(m!.messageId, m!.popReceipt);
  });

  it("refuses invalid messages without sending anything", async () => {
    const queue = new StorageJobQueue({ accountName: "x", queueName: "audit-jobs" }, client);
    await expect(queue.enqueue({ ...msg, auditId: "nope" })).rejects.toThrow();
    const peek = await client.peekMessages({ numberOfMessages: 5 });
    expect(peek.peekedMessageItems).toHaveLength(0);
  });

  it("ping succeeds for an existing queue and fails for a missing one", async () => {
    await expect(
      new StorageJobQueue({ accountName: "x", queueName: "audit-jobs" }, client).ping(),
    ).resolves.toBeUndefined();
    const missing = new QueueClient(
      client.url.replace("audit-jobs", "does-not-exist"),
      (client as unknown as { credential: never }).credential,
    );
    await expect(
      new StorageJobQueue({ accountName: "x", queueName: "does-not-exist" }, missing).ping(),
    ).rejects.toThrow();
  });
});
