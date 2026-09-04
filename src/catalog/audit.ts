import { assert } from "../lib/assert.js";
import type { CatalogError, CatalogLog, LookupByGtin } from "./types.js";
import { isValidGtin } from "./gtin.js";

const DEFAULT_DELAY_MS = 1_000;
const DEFAULT_MAX_RETRIES = 3;

export interface CoverageRow {
  gtin: string;
  /** The catalog holds a record for this GTIN. */
  found: boolean;
  /** The record carries at least one usable image candidate. */
  hasImage: boolean;
  brand: string | null;
  name: string | null;
  license: string | null;
  /** Set only when the lookup could not be completed — distinct from a clean miss. */
  error: CatalogError | null;
}

export interface CoverageReport {
  requested: number;
  /** Rejected locally on check digit; never reached the network. */
  invalidGtins: number;
  found: number;
  withImage: number;
  /** Lookups that errored out. These are unknowns, not misses. */
  failed: number;
  /**
   * withImage / (requested - failed). Failed lookups are excluded rather than
   * counted as misses — a throttled request is not evidence of absent coverage.
   */
  coveragePct: number;
  rows: CoverageRow[];
}

export interface AuditOptions {
  /** Pause between requests. Open Food Facts throttles bursts aggressively. */
  delayMs?: number;
  maxRetries?: number;
  log?: CatalogLog;
  /** Injected so tests do not spend real seconds sleeping. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Measure how much of a GTIN list a catalog can actually cover with images.
 *
 * Deliberately serial. The point is a trustworthy coverage number, and the
 * fastest way to corrupt one is to get rate-limited halfway through and record
 * throttling as absence.
 */
export async function auditCoverage(
  gtins: readonly string[],
  lookup: LookupByGtin,
  options: AuditOptions = {},
): Promise<CoverageReport> {
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const sleep = options.sleep ?? defaultSleep;
  const log = options.log;

  assert(maxRetries >= 0, "maxRetries is not negative");
  assert(delayMs >= 0, "delayMs is not negative");

  const rows: CoverageRow[] = [];

  for (const [index, gtin] of gtins.entries()) {
    if (index > 0 && delayMs > 0) await sleep(delayMs);

    if (!isValidGtin(gtin)) {
      rows.push({
        gtin,
        found: false,
        hasImage: false,
        brand: null,
        name: null,
        license: null,
        error: { kind: "invalid_gtin", gtin, retryable: false },
      });
      log?.("gtin rejected on check digit", { gtin });
      continue;
    }

    let lastError: CatalogError | null = null;
    let settled = false;

    for (let attempt = 0; attempt <= maxRetries && !settled; attempt++) {
      const result = await lookup(gtin);

      if (result.ok) {
        const product = result.value;
        const image = product?.images[0] ?? null;
        rows.push({
          gtin,
          found: product !== null,
          hasImage: image !== null,
          brand: product?.brand ?? null,
          name: product?.name ?? null,
          license: image?.license ?? null,
          error: null,
        });
        lastError = null;
        settled = true;
        break;
      }

      lastError = result.error;
      if (!result.error.retryable || attempt === maxRetries) break;

      // Exponential backoff on top of the base delay.
      const backoffMs = delayMs * 2 ** attempt;
      log?.("lookup failed, retrying", { gtin, kind: result.error.kind, backoffMs });
      await sleep(backoffMs);
    }

    if (!settled) {
      assert(lastError !== null, "an unsettled lookup recorded an error");
      rows.push({
        gtin,
        found: false,
        hasImage: false,
        brand: null,
        name: null,
        license: null,
        error: lastError,
      });
      log?.("lookup abandoned", { gtin, kind: lastError.kind });
    }
  }

  const failed = rows.filter((row) => row.error !== null).length;
  const found = rows.filter((row) => row.found).length;
  const withImage = rows.filter((row) => row.hasImage).length;
  const measurable = rows.length - failed;

  return {
    requested: rows.length,
    invalidGtins: rows.filter((row) => row.error?.kind === "invalid_gtin").length,
    found,
    withImage,
    failed,
    coveragePct: measurable > 0 ? Math.round((withImage / measurable) * 1000) / 10 : 0,
    rows,
  };
}
