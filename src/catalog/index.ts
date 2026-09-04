/**
 * Catalog: GTIN → product identity + licensed image candidates. Self-contained —
 * imports nothing from the app except lib/result and lib/assert. The app wires
 * config and logging at its composition point (scripts/catalog-audit.ts).
 * See README.md in this folder.
 */
export { auditCoverage, type AuditOptions, type CoverageReport, type CoverageRow } from "./audit.js";
export { isValidGtin, normalizeGtin } from "./gtin.js";
export {
  openFoodFactsLookup,
  parseQuantity,
  type OpenFoodFactsConfig,
} from "./openfoodfacts.js";
export type {
  CatalogError,
  CatalogLog,
  CatalogProduct,
  ImageCandidate,
  LookupByGtin,
} from "./types.js";
