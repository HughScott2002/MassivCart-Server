import { assert } from "../lib/assert.js";
import type { Result } from "../lib/result.js";
import {
  RECEIPT_JSON_SCHEMA,
  RECEIPT_STRUCTURING_SYSTEM_PROMPT,
  RECEIPT_USER_PROMPT,
} from "./prompt.js";
import { MAX_ITEMS, parseReceiptResponse, type ReceiptData } from "./receipt.js";
import type {
  AnalyzeImage,
  ReceiptImageUpload,
  VisionError,
  VisionLog,
} from "./types.js";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_OUTPUT_TOKENS = 4_096; // long receipts overflow 2048 and truncate mid-JSON
const MAX_ANALYZE_ATTEMPTS = 2;
const MAX_LOGGED_RAW_CHARS = 4_000;

/**
 * Image → validated ReceiptData, via an injected model call.
 * Retries retryable provider failures once (bounded); model garbage
 * (malformed JSON, schema violations, failed classification) is returned
 * as Err for the caller to map — nothing operational is thrown.
 */
export async function extractReceipt(
  upload: ReceiptImageUpload,
  analyze: AnalyzeImage,
  log?: VisionLog,
): Promise<Result<ReceiptData, VisionError>> {
  assert(upload.buffer.length > 0, "upload buffer must not be empty");
  assert(upload.buffer.length <= MAX_IMAGE_BYTES, "upload buffer exceeds MAX_IMAGE_BYTES");

  const request = {
    system: RECEIPT_STRUCTURING_SYSTEM_PROMPT,
    prompt: RECEIPT_USER_PROMPT,
    image: { buffer: upload.buffer, mediaType: upload.mediaType },
    maxTokens: MAX_OUTPUT_TOKENS,
    jsonSchema: RECEIPT_JSON_SCHEMA,
  };

  let analyzed = await analyze(request);
  for (
    let attempt = 2;
    attempt <= MAX_ANALYZE_ATTEMPTS && !analyzed.ok && analyzed.error.retryable;
    attempt++
  ) {
    log?.("Vision analyze retrying", {
      filename: upload.filename,
      attempt,
      errorKind: analyzed.error.kind,
    });
    analyzed = await analyze(request);
  }

  if (!analyzed.ok) {
    return analyzed;
  }

  log?.("Vision raw response received", {
    filename: upload.filename,
    rawText: analyzed.value.slice(0, MAX_LOGGED_RAW_CHARS),
  });

  const parsed = parseReceiptResponse(analyzed.value);
  if (!parsed.ok) {
    return parsed;
  }

  const receipt = parsed.value;
  assert(receipt.items.length <= MAX_ITEMS, "parsed items must be bounded by MAX_ITEMS");
  assert(
    receipt.items.every((item) => Number.isFinite(item.price)),
    "parsed item prices must be finite",
  );
  assert(
    receipt.imageType !== undefined && receipt.imageType !== "unknown",
    "parsed imageType must be classified",
  );

  log?.("Vision parsed response", {
    filename: upload.filename,
    imageType: receipt.imageType,
    itemCount: receipt.items.length,
    store: receipt.store ?? null,
    total: receipt.total ?? null,
  });

  return parsed;
}
