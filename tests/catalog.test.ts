import { test } from "node:test";
import assert from "node:assert/strict";
import { err, ok } from "../src/lib/result.js";
import {
  auditCoverage,
  isValidGtin,
  normalizeGtin,
  openFoodFactsLookup,
  parseQuantity,
  type CatalogProduct,
  type LookupByGtin,
} from "../src/catalog/index.js";

const noSleep = async (): Promise<void> => {};

// Real GTIN-13 with a valid check digit (Grace coconut milk).
const VALID_GTIN = "0055000000031";

function productWithImage(gtin: string): CatalogProduct {
  return {
    gtin,
    name: "Coconut Milk",
    brand: "Grace",
    sizeValue: 400,
    sizeUnit: "ml",
    images: [
      {
        source: "openfoodfacts",
        sourceUrl: "https://images.openfoodfacts.org/front.jpg",
        license: "CC-BY-SA-3.0",
        attribution: "Open Food Facts contributors",
        matchConfidence: 1,
      },
    ],
  };
}

// ── gtin ─────────────────────────────────────────────────────────────────────

test("isValidGtin: accepts valid GTIN-13 and GTIN-8 check digits", () => {
  assert.equal(isValidGtin(VALID_GTIN), true);
  assert.equal(isValidGtin("4006381333931"), true);
  assert.equal(isValidGtin("96385074"), true);
});

test("isValidGtin: rejects a transposed digit", () => {
  // Same digits as VALID_GTIN with two swapped — the failure mode of manual entry.
  assert.equal(isValidGtin("0055000000013"), false);
});

test("isValidGtin: rejects non-numeric and wrong-length input", () => {
  assert.equal(isValidGtin("00550000000ab"), false);
  assert.equal(isValidGtin("12345"), false);
  assert.equal(isValidGtin(""), false);
});

test("normalizeGtin: pads short UPCs to 13 digits", () => {
  assert.equal(normalizeGtin("96385074"), "0000096385074");
  assert.equal(normalizeGtin(VALID_GTIN), VALID_GTIN);
});

// ── quantity parsing ─────────────────────────────────────────────────────────

test("parseQuantity: splits magnitude and unit", () => {
  assert.deepEqual(parseQuantity("2 kg"), { sizeValue: 2, sizeUnit: "kg" });
  assert.deepEqual(parseQuantity("500g"), { sizeValue: 500, sizeUnit: "g" });
  assert.deepEqual(parseQuantity("1,5 L"), { sizeValue: 1.5, sizeUnit: "l" });
});

test("parseQuantity: leaves unparseable free text null rather than guessing", () => {
  assert.deepEqual(parseQuantity("family size"), { sizeValue: null, sizeUnit: null });
  assert.deepEqual(parseQuantity(undefined), { sizeValue: null, sizeUnit: null });
  assert.deepEqual(parseQuantity("6 x 250 ml"), { sizeValue: null, sizeUnit: null });
});

// ── openFoodFactsLookup ──────────────────────────────────────────────────────

function lookupWithFetch(handler: () => Promise<Response>): LookupByGtin {
  const original = globalThis.fetch;
  globalThis.fetch = handler as typeof globalThis.fetch;
  const lookup = openFoodFactsLookup({ userAgent: "test/1.0 (test@example.com)" });
  return async (gtin: string) => {
    try {
      return await lookup(gtin);
    } finally {
      globalThis.fetch = original;
    }
  };
}

test("openFoodFactsLookup: rejects a bad check digit before hitting the network", async () => {
  let called = false;
  const lookup = lookupWithFetch(async () => {
    called = true;
    return new Response("{}", { status: 200 });
  });

  const result = await lookup("0055000000013");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, "invalid_gtin");
  assert.equal(called, false, "no request is made for a structurally invalid GTIN");
});

test("openFoodFactsLookup: status 0 is a clean miss, not an error", async () => {
  const lookup = lookupWithFetch(
    async () => new Response(JSON.stringify({ status: 0 }), { status: 200 }),
  );

  const result = await lookup(VALID_GTIN);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value, null);
});

test("openFoodFactsLookup: 404 is a clean miss", async () => {
  const lookup = lookupWithFetch(async () => new Response("", { status: 404 }));
  const result = await lookup(VALID_GTIN);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value, null);
});

test("openFoodFactsLookup: maps a hit to identity fields and a licensed candidate", async () => {
  const payload = {
    status: 1,
    product: {
      code: VALID_GTIN,
      product_name: "Coconut Milk",
      brands: "Grace, Grace Foods",
      quantity: "400 ml",
      image_front_url: "https://images.openfoodfacts.org/front.jpg",
    },
  };
  const lookup = lookupWithFetch(
    async () => new Response(JSON.stringify(payload), { status: 200 }),
  );

  const result = await lookup(VALID_GTIN);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const product = result.value;
  assert.notEqual(product, null);
  assert.equal(product?.brand, "Grace", "takes the first brand only");
  assert.equal(product?.sizeValue, 400);
  assert.equal(product?.sizeUnit, "ml");
  assert.equal(product?.images.length, 1);
  assert.equal(product?.images[0]?.license, "CC-BY-SA-3.0");
  assert.equal(product?.images[0]?.matchConfidence, 1);
});

test("openFoodFactsLookup: 429 is retryable, 400 is not", async () => {
  const throttled = lookupWithFetch(async () => new Response("", { status: 429 }));
  const throttledResult = await throttled(VALID_GTIN);
  assert.equal(throttledResult.ok, false);
  if (!throttledResult.ok) {
    assert.equal(throttledResult.error.kind, "rate_limited");
    assert.equal(throttledResult.error.retryable, true);
  }

  const badRequest = lookupWithFetch(async () => new Response("nope", { status: 400 }));
  const badResult = await badRequest(VALID_GTIN);
  assert.equal(badResult.ok, false);
  if (!badResult.ok) assert.equal(badResult.error.retryable, false);
});

test("openFoodFactsLookup: HTML error page is malformed_json, not a silent miss", async () => {
  const lookup = lookupWithFetch(
    async () => new Response("<!DOCTYPE html><html>throttled</html>", { status: 200 }),
  );

  const result = await lookup(VALID_GTIN);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, "malformed_json");
});

// ── auditCoverage ────────────────────────────────────────────────────────────

test("auditCoverage: counts hits, misses and image coverage", async () => {
  const lookup: LookupByGtin = async (gtin) =>
    gtin === VALID_GTIN ? ok(productWithImage(gtin)) : ok(null);

  const report = await auditCoverage([VALID_GTIN, "4006381333931"], lookup, {
    delayMs: 0,
    sleep: noSleep,
  });

  assert.equal(report.requested, 2);
  assert.equal(report.found, 1);
  assert.equal(report.withImage, 1);
  assert.equal(report.failed, 0);
  assert.equal(report.coveragePct, 50);
});

test("auditCoverage: a record without an image counts as found but not covered", async () => {
  const lookup: LookupByGtin = async (gtin) =>
    ok({ ...productWithImage(gtin), images: [] });

  const report = await auditCoverage([VALID_GTIN], lookup, { delayMs: 0, sleep: noSleep });

  assert.equal(report.found, 1);
  assert.equal(report.withImage, 0);
  assert.equal(report.coveragePct, 0);
});

test("auditCoverage: failures are excluded from the denominator, not counted as misses", async () => {
  const lookup: LookupByGtin = async (gtin) =>
    gtin === VALID_GTIN
      ? ok(productWithImage(gtin))
      : err({ kind: "rate_limited", retryable: true });

  const report = await auditCoverage([VALID_GTIN, "4006381333931"], lookup, {
    delayMs: 0,
    maxRetries: 1,
    sleep: noSleep,
  });

  assert.equal(report.failed, 1);
  assert.equal(report.withImage, 1);
  // 1 of 1 measurable, not 1 of 2 — throttling is not evidence of absence.
  assert.equal(report.coveragePct, 100);
});

test("auditCoverage: retries retryable errors up to the limit, then gives up", async () => {
  let attempts = 0;
  const lookup: LookupByGtin = async () => {
    attempts++;
    return err({ kind: "rate_limited", retryable: true });
  };

  const report = await auditCoverage([VALID_GTIN], lookup, {
    delayMs: 0,
    maxRetries: 2,
    sleep: noSleep,
  });

  assert.equal(attempts, 3, "initial attempt plus two retries");
  assert.equal(report.failed, 1);
});

test("auditCoverage: does not retry a non-retryable error", async () => {
  let attempts = 0;
  const lookup: LookupByGtin = async () => {
    attempts++;
    return err({ kind: "malformed_json", raw: "<html>", retryable: false });
  };

  const report = await auditCoverage([VALID_GTIN], lookup, {
    delayMs: 0,
    maxRetries: 3,
    sleep: noSleep,
  });

  assert.equal(attempts, 1);
  assert.equal(report.failed, 1);
});

test("auditCoverage: invalid GTINs are rejected locally and never looked up", async () => {
  let called = 0;
  const lookup: LookupByGtin = async (gtin) => {
    called++;
    return ok(productWithImage(gtin));
  };

  const report = await auditCoverage(["0055000000013", VALID_GTIN], lookup, {
    delayMs: 0,
    sleep: noSleep,
  });

  assert.equal(called, 1, "only the valid GTIN reaches the catalog");
  assert.equal(report.invalidGtins, 1);
  assert.equal(report.withImage, 1);
});
