import { assert } from "../lib/assert.js";
import { err, ok, type Result } from "../lib/result.js";
import type { AnalyzeImage, AnalyzeRequest, VisionError } from "./types.js";

/** Preview model — pin via OPENROUTER_MODEL once Google ships a GA id. */
export const DEFAULT_VISION_MODEL = "google/gemini-3-flash-preview";

const DEFAULT_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_ERROR_BODY_CHARS = 2_000;

export interface OpenRouterConfig {
  apiKey: string;
  model: string;
  apiUrl?: string;
  timeoutMs?: number;
}

interface OpenRouterResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type: string; text?: string }>;
    };
  }>;
}

export function openrouterAnalyzer(config: OpenRouterConfig): AnalyzeImage {
  assert(config.apiKey.length > 0, "openrouterAnalyzer requires an apiKey");
  assert(config.model.length > 0, "openrouterAnalyzer requires a model");
  const apiUrl = config.apiUrl ?? DEFAULT_API_URL;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  assert(
    timeoutMs > 0 && timeoutMs <= MAX_TIMEOUT_MS,
    `timeoutMs must be in (0, ${MAX_TIMEOUT_MS}]`,
  );

  return async function analyze(request: AnalyzeRequest): Promise<Result<string, VisionError>> {
    const startedAt = Date.now();
    let response: Response;
    let bodyText: string;

    try {
      response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.apiKey}`,
        },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          model: config.model,
          max_tokens: request.maxTokens,
          messages: [
            { role: "system", content: request.system },
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: {
                    url: `data:${request.image.mediaType};base64,${request.image.buffer.toString("base64")}`,
                  },
                },
                { type: "text", text: request.prompt },
              ],
            },
          ],
          ...(request.jsonSchema
            ? {
                response_format: {
                  type: "json_schema",
                  json_schema: {
                    name: "receipt_extraction",
                    strict: true,
                    schema: request.jsonSchema,
                  },
                },
              }
            : {}),
        }),
      });
      bodyText = await response.text();
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        return err({ kind: "timeout", elapsedMs: Date.now() - startedAt, retryable: true });
      }
      return err({
        kind: "network",
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
      });
    }

    if (!response.ok) {
      return err({
        kind: "http",
        status: response.status,
        body: bodyText.slice(0, MAX_ERROR_BODY_CHARS),
        retryable: response.status === 429 || response.status >= 500,
      });
    }

    let data: OpenRouterResponse;
    try {
      data = JSON.parse(bodyText) as OpenRouterResponse;
    } catch {
      return err({
        kind: "network",
        message: `OpenRouter returned non-JSON body: ${bodyText.slice(0, MAX_ERROR_BODY_CHARS)}`,
        retryable: true,
      });
    }

    const content = data.choices?.[0]?.message?.content;
    const text =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content
              .filter((part) => part.type === "text" && typeof part.text === "string")
              .map((part) => part.text)
              .join("\n")
          : "";

    if (text.trim().length === 0) {
      return err({ kind: "empty_response", retryable: true });
    }

    return ok(text);
  };
}
