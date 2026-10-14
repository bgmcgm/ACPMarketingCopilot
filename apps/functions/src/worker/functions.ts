import { app, type InvocationContext } from "@azure/functions";
import { AuditQueueMessageSchema, type AuditQueueMessage } from "@mcopilot/shared-types";
import { getContainer } from "../container.js";
import type { Logger } from "../http/handlers.js";

const QUEUE_NAME = process.env["AUDIT_QUEUE_NAME"] ?? "audit-jobs";
/** Identitätsbasierte Verbindung: AzureWebJobsStorage__accountName. */
const CONNECTION = "AzureWebJobsStorage";

const loggerFor = (ctx: InvocationContext): Logger => ({
  info: (m, d) => ctx.log(m, d ?? {}),
  warn: (m, d) => ctx.warn(m, d ?? {}),
  error: (m, d) => ctx.error(m, d ?? {}),
});

function parseMessage(item: unknown, logger: Logger): AuditQueueMessage | null {
  const raw = typeof item === "string" ? safeJson(item) : item;
  const parsed = AuditQueueMessageSchema.safeParse(raw);
  if (!parsed.success) {
    // Eine fehlerhafte Nachricht kann nie erfolgreich werden → verwerfen statt endlos retryen.
    logger.error("Ungültige Queue-Nachricht verworfen");
    return null;
  }
  return parsed.data;
}

const safeJson = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

export function registerWorkerFunctions(): void {
  app.storageQueue("auditWorker", {
    queueName: QUEUE_NAME,
    connection: CONNECTION,
    handler: async (item, ctx) => {
      const logger = loggerFor(ctx);
      const msg = parseMessage(item, logger);
      if (!msg) return;
      // Fehler werden bewusst geworfen → Queue-Retry (maxDequeueCount) → Poison Queue.
      await getContainer(logger).pipeline.process(msg);
    },
  });

  app.storageQueue("auditWorkerPoison", {
    queueName: `${QUEUE_NAME}-poison`,
    connection: CONNECTION,
    handler: async (item, ctx) => {
      const logger = loggerFor(ctx);
      const msg = parseMessage(item, logger);
      if (!msg) return;
      logger.error("Audit in Poison Queue – wird als fehlgeschlagen markiert", {
        auditId: msg.auditId,
      });
      await getContainer(logger).pipeline.markPoisoned(msg);
    },
  });
}
