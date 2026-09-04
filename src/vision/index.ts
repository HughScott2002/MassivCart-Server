/**
 * Vision: image → validated ReceiptData. Self-contained — imports nothing from
 * the app except lib/result and lib/assert. The app wires config/env/logging
 * at its composition point (src/api/receipt.ts). See README.md in this folder.
 */
export { extractReceipt, MAX_IMAGE_BYTES } from "./extract.js";
export { DEFAULT_VISION_MODEL, openrouterAnalyzer, type OpenRouterConfig } from "./openrouter.js";
export {
  MAX_ITEMS,
  normalizeMediaType,
  parseReceiptResponse,
  type ReceiptData,
  type ReceiptItem,
} from "./receipt.js";
export type {
  AnalyzeImage,
  AnalyzeRequest,
  ReceiptImageUpload,
  SupportedMediaType,
  VisionError,
  VisionLog,
} from "./types.js";
