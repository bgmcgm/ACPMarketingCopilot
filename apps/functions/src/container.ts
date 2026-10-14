import { loadConfig, type AppConfig } from "./config/config.js";
import { CosmosAuditRepository } from "./persistence/cosmosAuditRepository.js";
import { StorageJobQueue } from "./persistence/storageJobQueue.js";
import { defaultRuleset } from "./rules/index.js";
import { AuditService } from "./services/auditService.js";
import { Handlers, type Logger } from "./http/handlers.js";

export const APP_VERSION = process.env["APP_VERSION"] ?? "0.1.0";

export interface Container {
  config: AppConfig;
  handlers: Handlers;
}

let cached: Container | undefined;

/** Composition Root. Wird lazy beim ersten Request aufgebaut; Konfigurationsfehler schlagen sichtbar fehl. */
export function getContainer(logger: Logger): Container {
  if (cached) return cached;
  const config = loadConfig(process.env);
  const repo = new CosmosAuditRepository(config.cosmos);
  const queue = new StorageJobQueue(config.queue);
  const service = new AuditService({
    repo,
    queue,
    ruleset: defaultRuleset,
    scoring: config.scoring,
    urlPolicy: {
      allowedPorts: config.fetch.allowedPorts,
      domainAllowlist: config.fetch.domainAllowlist,
      maxLength: 2048,
    },
    auditTtlSeconds: config.auditTtlSeconds,
    quotas: config.quotas,
  });
  cached = {
    config,
    handlers: new Handlers({
      service,
      repo,
      queue,
      allowedRole: config.allowedRole,
      version: APP_VERSION,
      logger,
    }),
  };
  return cached;
}
