import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { AiAssessmentSchema, type AiAssessmentRecord } from "@mcopilot/shared-types";
import { AiOutputSchema } from "./outputSchema.js";
import type { Logger } from "../http/handlers.js";
import { buildSystemPrompt, buildUserMessage, PROMPT_VERSION } from "./prompt.js";
import type { AiAssessmentInput, AiProvider } from "./provider.js";

/** Schmale Sicht auf den SDK-Client (für Tests austauschbar). */
export type MessagesClient = Pick<Anthropic, "messages">;

export interface ClaudeProviderOptions {
  model: string;
  timeoutMs: number;
  maxOutputTokens: number;
  outputLanguage: string;
  /** Anzahl Versuche bei ungültiger Struktur (Netzwerk-/429-/5xx-Retries übernimmt das SDK). */
  maxAttempts?: number;
  now?: () => Date;
}

type FailureCode = "REFUSED" | "TRUNCATED" | "INVALID_OUTPUT" | "PROVIDER_ERROR";

const FAILURE_MESSAGES: Record<FailureCode, string> = {
  REFUSED: "Die KI hat die Bewertung abgelehnt.",
  TRUNCATED: "Die KI-Antwort war unvollständig.",
  INVALID_OUTPUT: "Die KI-Antwort entsprach nicht dem erwarteten Format.",
  PROVIDER_ERROR: "Die KI-Bewertung ist derzeit nicht verfügbar.",
};

/**
 * Claude-Anbindung mit strukturierter JSON-Ausgabe (output_config.format + Zod-Schema).
 * Es wird bewusst kein erzwungener tool_choice verwendet (auf aktuellen Modellen nicht unterstützt).
 */
export class ClaudeProvider implements AiProvider {
  private readonly maxAttempts: number;
  private readonly now: () => Date;

  constructor(
    private readonly client: MessagesClient,
    private readonly opts: ClaudeProviderOptions,
    private readonly logger: Logger,
  ) {
    this.maxAttempts = opts.maxAttempts ?? 2;
    this.now = opts.now ?? (() => new Date());
  }

  async assess(input: AiAssessmentInput): Promise<AiAssessmentRecord> {
    const base = {
      provider: "anthropic" as const,
      model: this.opts.model,
      promptVersion: PROMPT_VERSION,
      source: "ai" as const,
    };
    const fail = (code: FailureCode): AiAssessmentRecord => ({
      ...base,
      status: "failed",
      error: { code, message: FAILURE_MESSAGES[code] },
    });

    let usage = { inputTokens: 0, outputTokens: 0 };
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      let response;
      try {
        response = await this.client.messages.parse(
          {
            model: this.opts.model,
            max_tokens: this.opts.maxOutputTokens,
            system: buildSystemPrompt(this.opts.outputLanguage),
            messages: [{ role: "user", content: buildUserMessage(input) }],
            output_config: { format: zodOutputFormat(AiOutputSchema) },
          },
          { timeout: this.opts.timeoutMs, maxRetries: 1 },
        );
      } catch (err) {
        // Keine Details an den Client; Typ/Status ins Log.
        this.logger.error("Claude-Aufruf fehlgeschlagen", {
          status: (err as { status?: number }).status,
          name: err instanceof Error ? err.name : "unknown",
        });
        return fail("PROVIDER_ERROR");
      }

      usage = {
        inputTokens: usage.inputTokens + response.usage.input_tokens,
        outputTokens: usage.outputTokens + response.usage.output_tokens,
      };

      if (response.stop_reason === "refusal") {
        this.logger.warn("Claude lehnte ab", { category: response.stop_details?.category ?? null });
        return { ...fail("REFUSED"), usage };
      }
      if (response.stop_reason === "max_tokens") {
        this.logger.warn("Claude-Antwort abgeschnitten", { attempt });
        return { ...fail("TRUNCATED"), usage };
      }

      // Strikte Validierung (Längen/Grenzen) unabhängig von der Schema-Unterstützung des Modells.
      const validated = AiAssessmentSchema.safeParse(response.parsed_output);
      if (validated.success) {
        return {
          ...base,
          status: "completed",
          generatedAt: this.now().toISOString(),
          usage,
          result: validated.data,
        };
      }
      this.logger.warn("Ungültige Claude-Struktur", {
        attempt,
        issues: validated.error.issues.length,
      });
    }
    return { ...fail("INVALID_OUTPUT"), usage };
  }
}

/** AI_ENABLED=false: keine Bewertung, kein erfundenes Ergebnis. */
export class DisabledAiProvider implements AiProvider {
  constructor(private readonly model: string = "n/a") {}
  async assess(): Promise<AiAssessmentRecord> {
    return {
      status: "skipped",
      provider: "anthropic",
      model: this.model,
      promptVersion: PROMPT_VERSION,
      source: "ai",
    };
  }
}
