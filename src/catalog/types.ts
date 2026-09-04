import type { Result } from "../lib/result.js";

/**
 * An image we are allowed to use, with the provenance needed to keep using it.
 *
 * Field-for-field this is a `product_images` row minus the two things only the
 * storage pipeline can know: `product_id` and `storage_path`. Persisting a
 * candidate is therefore an insert, not a translation.
 */
export interface ImageCandidate {
  /** Provenance tag, e.g. "openfoodfacts". Stored verbatim in product_images.source. */
  source: string;
  /** Where the bytes came from. Kept so a licence claim can be re-checked later. */
  sourceUrl: string;
  /** SPDX-ish identifier, e.g. "CC-BY-SA-3.0". Null when the source states none. */
  license: string | null;
  /** Human-readable credit line, required by CC BY-SA at the point of display. */
  attribution: string | null;
  /** 0–1. Exact-GTIN matches are 1; anything lower needs human review. */
  matchConfidence: number;
}

/**
 * A catalog's answer for one GTIN. The identity fields mirror the columns added
 * to `products` in the Phase 0.5 migration, so one lookup populates both the
 * product row and its image candidates.
 */
export interface CatalogProduct {
  gtin: string;
  name: string | null;
  brand: string | null;
  sizeValue: number | null;
  sizeUnit: string | null;
  images: ImageCandidate[];
}

/**
 * Every way a lookup is expected to fail. `retryable` drives backoff policy:
 * a rate limit or a 5xx is worth retrying, a malformed payload is not.
 *
 * Note what is NOT an error: a catalog that simply has no record for a GTIN
 * returns Ok(null). "Not found" is the answer coverage is measuring, so making
 * it an error would corrupt the number this whole exercise exists to produce.
 */
export type CatalogError =
  | { kind: "timeout"; elapsedMs: number; retryable: true }
  | { kind: "network"; message: string; retryable: true }
  | { kind: "rate_limited"; retryable: true }
  | { kind: "http"; status: number; body: string; retryable: boolean }
  | { kind: "malformed_json"; raw: string; retryable: false }
  | { kind: "invalid_gtin"; gtin: string; retryable: false };

/**
 * The only thing a backing catalog must do: given a GTIN, return what it knows.
 * Open Food Facts is one implementation; a manufacturer feed would be another.
 */
export type LookupByGtin = (
  gtin: string,
) => Promise<Result<CatalogProduct | null, CatalogError>>;

export type CatalogLog = (message: string, context?: Record<string, unknown>) => void;
