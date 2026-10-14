import { loadConfig, type AppConfig } from "./config/config.js";
import { CosmosAuditRepository } from "./persistence/cosmosAuditRepository.js";
import { StorageJobQueue } from "./persistence/storageJobQueue.js";
import { defaultRuleset } from "./rules/index.js";
import { AuditService } from "./services/auditService.js";
import { Handlers, type Logger } from "./http/handlers.js";
import { SafeFetcher } from "./fetcher/safeFetcher.js";
import { AuditPipeline } from "./worker/auditPipeline.js";
import Anthropic from "@anthropic-ai/sdk";
import { ClaudeProvider, DisabledAiProvider } from "./ai/claudeProvider.js";

export const APP_VERSION = process.env["APP_VERSION"] ?? "0.1.0";

export interface Container {
  config: AppConfig;
  handlers: Handlers;
  pipeline: AuditPipeline;
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
  const fetcher = new SafeFetcher({
    ...config.fetch,
    maxLength: 2048,
    userAgent: "MarketingCopilotAuditor/1.0 (+internal)",
  });
  const ai = config.ai.enabled
    ? new ClaudeProvider(
        new Anthropic({ apiKey: config.ai.apiKey }),
        {
          model: config.ai.model,
          timeoutMs: config.ai.timeoutMs,
          maxOutputTokens: config.ai.maxOutputTokens,
          outputLanguage: config.ai.outputLanguage,
        },
        logger,
      )
    : new DisabledAiProvider();
  const pipeline = new AuditPipeline({
    repo,
    fetcher,
    ai,
    ruleset: defaultRuleset,
    scoring: config.scoring,
    logger,
  });
  cached = {
    config,
    pipeline,
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
