import { assert } from "../lib/assert.js";

/** GTIN-8, GTIN-12 (UPC-A), GTIN-13 (EAN-13), GTIN-14. */
const VALID_LENGTHS = new Set([8, 12, 13, 14]);

/**
 * Validate a GTIN's structure and check digit.
 *
 * Worth doing locally because the input arrives by hand — someone reading
 * barcodes off shelves in a supermarket. A transposed digit is indistinguishable
 * from a genuine catalog miss once it reaches the network, which would quietly
 * depress the coverage number this pipeline exists to measure.
 */
export function isValidGtin(gtin: string): boolean {
  if (!/^\d+$/.test(gtin)) return false;
  if (!VALID_LENGTHS.has(gtin.length)) return false;

  // Standard GS1 mod-10: weights alternate 3/1 from the right, excluding the
  // check digit itself, and the total must land on a multiple of ten.
  const digits = gtin.split("").map(Number);
  const check = digits[digits.length - 1];
  assert(check !== undefined, "gtin has at least one digit");

  let sum = 0;
  for (let i = digits.length - 2; i >= 0; i--) {
    const digit = digits[i];
    assert(digit !== undefined, "digit index in range");
    const weight = (digits.length - 2 - i) % 2 === 0 ? 3 : 1;
    sum += digit * weight;
  }

  return (10 - (sum % 10)) % 10 === check;
}

/** Left-pad to GTIN-13 so short UPCs match catalog records stored in EAN form. */
export function normalizeGtin(gtin: string): string {
  const trimmed = gtin.trim();
  return trimmed.length < 13 ? trimmed.padStart(13, "0") : trimmed;
}
