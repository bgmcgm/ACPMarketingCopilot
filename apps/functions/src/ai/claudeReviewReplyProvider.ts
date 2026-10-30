import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { AiReviewReplySchema } from "@mcopilot/shared-types";
import { ReviewReplyOutputSchema } from "./reviewReplyOutputSchema.js";
import type { Logger } from "../http/handlers.js";
import {
  buildSystemPrompt,
  buildUserMessage,
  REVIEW_REPLY_PROMPT_VERSION,
} from "./reviewReplyPrompt.js";
import type {
  ReviewReplyDraft,
  ReviewReplyInput,
  ReviewReplyProvider,
} from "./reviewReplyProvider.js";

/** Schmale Sicht auf den SDK-Client (für Tests austauschbar). */
export type MessagesClient = Pick<Anthropic, "messages">;

export interface ClaudeReviewReplyProviderOptions {
  model: string;
  timeoutMs: number;
  maxOutputTokens: number;
  outputLanguage: string;
  maxAttempts?: number;
  now?: () => Date;
}

type FailureCode = "REFUSED" | "TRUNCATED" | "INVALID_OUTPUT" | "PROVIDER_ERROR";

const FAILURE_MESSAGES: Record<FailureCode, string> = {
  REFUSED: "Die KI hat den Antwortentwurf abgelehnt.",
  TRUNCATED: "Die KI-Antwort war unvollständig.",
  INVALID_OUTPUT: "Die KI-Antwort entsprach nicht dem erwarteten Format.",
  PROVIDER_ERROR: "Der Antwortentwurf ist derzeit nicht verfügbar.",
};

/** Claude-Anbindung für Review-Antwortentwürfe; gleiches Muster wie ai/claudeProvider.ts. */
export class ClaudeReviewReplyProvider implements ReviewReplyProvider {
  private readonly maxAttempts: number;
  private readonly now: () => Date;

  constructor(
    private readonly client: MessagesClient,
    private readonly opts: ClaudeReviewReplyProviderOptions,
    private readonly logger: Logger,
  ) {
    this.maxAttempts = opts.maxAttempts ?? 2;
    this.now = opts.now ?? (() => new Date());
  }

  async draftReply(input: ReviewReplyInput): Promise<ReviewReplyDraft> {
    const base = {
      model: this.opts.model,
      promptVersion: REVIEW_REPLY_PROMPT_VERSION,
    };
    const fail = (code: FailureCode): ReviewReplyDraft => ({
      meta: { ...base, status: "failed", error: { code, message: FAILURE_MESSAGES[code] } },
    });

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      let response;
      try {
        response = await this.client.messages.parse(
          {
            model: this.opts.model,
            max_tokens: this.opts.maxOutputTokens,
            system: buildSystemPrompt(this.opts.outputLanguage),
            messages: [{ role: "user", content: buildUserMessage(input) }],
            output_config: { format: zodOutputFormat(ReviewReplyOutputSchema) },
          },
          { timeout: this.opts.timeoutMs, maxRetries: 1 },
        );
      } catch (err) {
        this.logger.error("Claude-Aufruf (Review-Antwort) fehlgeschlagen", {
          status: (err as { status?: number }).status,
          name: err instanceof Error ? err.name : "unknown",
        });
        return fail("PROVIDER_ERROR");
      }

      if (response.stop_reason === "refusal") {
        this.logger.warn("Claude lehnte Review-Antwort ab", {
          category: response.stop_details?.category ?? null,
        });
        return fail("REFUSED");
      }
      if (response.stop_reason === "max_tokens") {
        this.logger.warn("Claude-Antwort (Review) abgeschnitten", { attempt });
        return fail("TRUNCATED");
      }

      const validated = AiReviewReplySchema.safeParse(response.parsed_output);
      if (validated.success) {
        return {
          meta: { ...base, status: "completed", generatedAt: this.now().toISOString() },
          draftText: validated.data.replyText,
        };
      }
      this.logger.warn("Ungültige Claude-Struktur (Review-Antwort)", {
        attempt,
        issues: validated.error.issues.length,
      });
    }
    return fail("INVALID_OUTPUT");
  }
}

/** Kein Konto verbunden oder KI deaktiviert: kein erfundener Entwurf. */
export class DisabledReviewReplyProvider implements ReviewReplyProvider {
  constructor(private readonly model: string = "n/a") {}
  async draftReply(): Promise<ReviewReplyDraft> {
    return {
      meta: {
        status: "failed",
        model: this.model,
        promptVersion: REVIEW_REPLY_PROMPT_VERSION,
        error: { code: "DISABLED", message: "KI-Antwortentwürfe sind deaktiviert." },
      },
    };
  }
}
