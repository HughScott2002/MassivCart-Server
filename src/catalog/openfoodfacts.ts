import { err, ok, type Result } from "../lib/result.js";
import { assert } from "../lib/assert.js";
import { isValidGtin, normalizeGtin } from "./gtin.js";
import type { CatalogError, CatalogProduct, ImageCandidate, LookupByGtin } from "./types.js";

const DEFAULT_BASE_URL = "https://world.openfoodfacts.org";
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_BODY_CHARS = 500;

/** Open Food Facts photos are contributor-uploaded under CC BY-SA 3.0. */
const OFF_IMAGE_LICENSE = "CC-BY-SA-3.0";
const OFF_ATTRIBUTION = "Open Food Facts contributors";

/** Only the fields we consume — keeps the response small and the contract explicit. */
const FIELDS = "code,product_name,brands,quantity,image_url,image_front_url";

export interface OpenFoodFactsConfig {
  /**
   * Open Food Facts requires a descriptive User-Agent with contact details and
   * will throttle anonymous clients. No default — the caller must identify itself.
   */
  userAgent: string;
  baseUrl?: string;
  timeoutMs?: number;
}

interface OffPayload {
  status?: number;
  product?: {
    code?: string;
    product_name?: string;
    brands?: string;
    quantity?: string;
    image_url?: string;
    image_front_url?: string;
  };
}

/**
 * Parse an Open Food Facts `quantity` string into a magnitude and unit.
 * The field is free text entered by contributors — "2 kg", "500g", "1 L".
 * Anything that does not cleanly split is left null rather than guessed at.
 */
export function parseQuantity(quantity: string | undefined): {
  sizeValue: number | null;
  sizeUnit: string | null;
} {
  if (!quantity) return { sizeValue: null, sizeUnit: null };

  const match = /^\s*([\d.,]+)\s*([a-zA-Z]+)\s*$/.exec(quantity);
  if (!match) return { sizeValue: null, sizeUnit: null };

  const rawValue = match[1];
  const rawUnit = match[2];
  assert(rawValue !== undefined && rawUnit !== undefined, "regex groups present on match");

  const value = Number(rawValue.replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) return { sizeValue: null, sizeUnit: null };

  return { sizeValue: value, sizeUnit: rawUnit.toLowerCase() };
}

/** First brand only — OFF stores a comma-separated list, most specific first. */
function parseBrand(brands: string | undefined): string | null {
  if (!brands) return null;
  const first = brands.split(",")[0]?.trim();
  return first ? first : null;
}

function toImageCandidates(product: NonNullable<OffPayload["product"]>): ImageCandidate[] {
  // Prefer the front-of-package shot; it is what a product card shows.
  const url = product.image_front_url ?? product.image_url;
  if (!url) return [];

  return [
    {
      source: "openfoodfacts",
      sourceUrl: url,
      license: OFF_IMAGE_LICENSE,
      attribution: OFF_ATTRIBUTION,
      // Exact GTIN match: this image is on the record for this precise package.
      matchConfidence: 1,
    },
  ];
}

/**
 * The one `LookupByGtin` implementation for Open Food Facts.
 *
 * Queries the global catalog deliberately — no country filter. Jamaican brands
 * export heavily, so their GTINs are frequently recorded under UK, US or Canadian
 * entries. Filtering by country would undercount real, usable coverage.
 */
export function openFoodFactsLookup(config: OpenFoodFactsConfig): LookupByGtin {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  assert(config.userAgent.length > 0, "openfoodfacts requires an identifying user agent");

  return async (gtin: string): Promise<Result<CatalogProduct | null, CatalogError>> => {
    if (!isValidGtin(gtin)) return err({ kind: "invalid_gtin", gtin, retryable: false });

    const normalized = normalizeGtin(gtin);
    const url = `${baseUrl}/api/v2/product/${normalized}?fields=${FIELDS}`;
    const startedAt = performance.now();

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { "User-Agent": config.userAgent, Accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      const elapsedMs = Math.round(performance.now() - startedAt);
      if (cause instanceof Error && cause.name === "TimeoutError") {
        return err({ kind: "timeout", elapsedMs, retryable: true });
      }
      const message = cause instanceof Error ? cause.message : String(cause);
      return err({ kind: "network", message: message.slice(0, MAX_BODY_CHARS), retryable: true });
    }

    // A GTIN absent from the catalog is an answer, not a failure.
    if (response.status === 404) return ok(null);

    if (response.status === 429) return err({ kind: "rate_limited", retryable: true });

    if (!response.ok) {
      const body = (await response.text().catch(() => "")).slice(0, MAX_BODY_CHARS);
      return err({
        kind: "http",
        status: response.status,
        body,
        // 5xx is transient; a 4xx we did not special-case is our own bug.
        retryable: response.status >= 500,
      });
    }

    const raw = await response.text();
    let payload: OffPayload;
    try {
      payload = JSON.parse(raw) as OffPayload;
    } catch {
      return err({ kind: "malformed_json", raw: raw.slice(0, MAX_BODY_CHARS), retryable: false });
    }

    // OFF answers 200 with status 0 for an unknown barcode.
    if (payload.status !== 1 || !payload.product) return ok(null);

    const product = payload.product;
    const { sizeValue, sizeUnit } = parseQuantity(product.quantity);

    return ok({
      gtin: normalized,
      name: product.product_name?.trim() || null,
      brand: parseBrand(product.brands),
      sizeValue,
      sizeUnit,
      images: toImageCandidates(product),
    });
  };
}
