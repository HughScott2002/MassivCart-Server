import type { Result } from "../lib/result.js";

export type SupportedMediaType =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/gif";

export interface ReceiptImageUpload {
  buffer: Buffer;
  filename: string;
  mediaType: SupportedMediaType;
}

export interface AnalyzeRequest {
  system: string;
  prompt: string;
  image: {
    buffer: Buffer;
    mediaType: SupportedMediaType;
  };
  maxTokens: number;
  /** JSON Schema for provider-enforced structured output, when supported. */
  jsonSchema?: Record<string, unknown>;
}

/**
 * The only thing a backing model must do: look at an image, return raw text.
 * Everything receipt-specific (prompt, parsing, validation) lives outside providers.
 * Expected failures come back as Err — an analyzer never throws for operational errors.
 */
export type AnalyzeImage = (request: AnalyzeRequest) => Promise<Result<string, VisionError>>;

/**
 * Every way a vision extraction is expected to fail. `retryable` is the input
 * to retry/tier-escalation policy: provider-side trouble is retryable, a model
 * that answered with garbage is not.
 */
export type VisionError =
  | { kind: "timeout"; elapsedMs: number; retryable: true }
  | { kind: "network"; message: string; retryable: true }
  | { kind: "http"; status: number; body: string; retryable: boolean }
  | { kind: "empty_response"; retryable: true }
  | { kind: "malformed_json"; raw: string; retryable: false }
  | { kind: "schema"; issues: string[]; retryable: false }
  | { kind: "unrecognized_image"; retryable: false };

export type VisionLog = (message: string, context?: Record<string, unknown>) => void;
