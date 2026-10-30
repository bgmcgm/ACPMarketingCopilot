import { loadConfig, type AppConfig } from "./config/config.js";
import { CosmosAuditRepository } from "./persistence/cosmosAuditRepository.js";
import { CosmosClientRepository } from "./persistence/cosmosClientRepository.js";
import { CosmosReviewRepository } from "./persistence/cosmosReviewRepository.js";
import { StorageJobQueue } from "./persistence/storageJobQueue.js";
import { defaultRuleset } from "./rules/index.js";
import { AuditService } from "./services/auditService.js";
import { ClientService } from "./services/clientService.js";
import { ReviewService } from "./services/reviewService.js";
import { Handlers, type Logger } from "./http/handlers.js";
import { SafeFetcher } from "./fetcher/safeFetcher.js";
import { AuditPipeline } from "./worker/auditPipeline.js";
import Anthropic from "@anthropic-ai/sdk";
import { ClaudeProvider, DisabledAiProvider } from "./ai/claudeProvider.js";
import {
  ClaudeReviewReplyProvider,
  DisabledReviewReplyProvider,
} from "./ai/claudeReviewReplyProvider.js";
import { HttpGoogleBusinessProfileClient } from "./connectors/googleBusinessProfile/httpClient.js";

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

  let clientService: ClientService | undefined;
  let reviewService: ReviewService | undefined;
  if (config.reviews.enabled) {
    const google = new HttpGoogleBusinessProfileClient();
    const clientsRepo = new CosmosClientRepository({
      ...config.cosmos,
      container: config.reviews.clientsContainer,
    });
    const reviewsRepo = new CosmosReviewRepository({
      ...config.cosmos,
      container: config.reviews.reviewsContainer,
    });
    const reviewAi = config.ai.enabled
      ? new ClaudeReviewReplyProvider(
          new Anthropic({ apiKey: config.ai.apiKey }),
          {
            model: config.reviews.aiModel,
            timeoutMs: config.ai.timeoutMs,
            maxOutputTokens: config.ai.maxOutputTokens,
            outputLanguage: config.ai.outputLanguage,
          },
          logger,
        )
      : new DisabledReviewReplyProvider();
    clientService = new ClientService({
      repo: clientsRepo,
      google,
      oauth: config.reviews.oauth,
      stateSecret: config.reviews.stateSecret,
      tokenEncryptionKey: config.reviews.tokenEncryptionKey,
    });
    reviewService = new ReviewService({
      reviews: reviewsRepo,
      clients: clientsRepo,
      google,
      ai: reviewAi,
      oauth: config.reviews.oauth,
      tokenEncryptionKey: config.reviews.tokenEncryptionKey,
    });
  }

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
      ...(clientService ? { clientService } : {}),
      ...(reviewService ? { reviewService } : {}),
    }),
  };
  return cached;
}
