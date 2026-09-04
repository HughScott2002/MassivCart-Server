# catalog

GTIN → product identity + licensed image candidates, catalog-agnostic. This
folder is a lib: it imports nothing from the rest of the app except the shared
`lib/result` and `lib/assert` primitives. The app wires it up in one place
(`scripts/catalog-audit.ts`).

```
gtin ──▶ auditCoverage(gtins, lookup, opts?) ──▶ CoverageReport
                          │
                          └─ lookup: LookupByGtin — the ONLY catalog contract:
                             (gtin) → Result<CatalogProduct | null, CatalogError>
```

- `gtin.ts` — GS1 mod-10 check digit validation and GTIN-13 normalization
- `openfoodfacts.ts` — the one `LookupByGtin` implementation, timeout-bounded
- `audit.ts` — serial coverage measurement with bounded retry and backoff
- `types.ts` — catalog contract + `CatalogError` union

## Why the shapes are what they are

`ImageCandidate` is a `product_images` row minus `product_id` and
`storage_path` — the two fields only the storage pipeline can know. Persisting a
candidate is an insert, not a translation. `CatalogProduct`'s identity fields
(`brand`, `sizeValue`, `sizeUnit`, `gtin`) mirror the columns added to `products`
in the Phase 0.5 migration, so one lookup populates both sides.

## Rules (TigerStyle)

- Expected failures return `Result`; only programmer errors throw (via `assert`).
- A GTIN the catalog has never heard of is `Ok(null)`, **not** an error. That
  distinction is the whole coverage measurement — folding misses into errors, or
  errors into misses, produces a number that means nothing.
- Limits on everything: request timeout, retry count, inter-request delay,
  logged/error string lengths. No unbounded anything.
- `CatalogError.retryable` drives backoff. Throttling and 5xx are retryable; a
  malformed payload or a bad check digit is not.
- No `process.env` reads in this folder — config is injected by the caller.

## Lookups are global, never country-filtered

Jamaican brands export heavily, so their GTINs are routinely recorded in Open
Food Facts under UK, US or Canadian entries. `brands_tags=grace` returns 236
products worldwide against a far smaller Jamaica-tagged subset. Filtering by
country would undercount usable coverage badly. GTIN is a global key; query it
globally.

## Open Food Facts etiquette

OFF requires a descriptive `User-Agent` carrying contact details, and throttles
bursts — an unthrottled sweep returns HTML error pages rather than JSON. Hence
`userAgent` has no default, and `auditCoverage` is serial with a base delay.
Image data is CC BY-SA 3.0, so `license` and `attribution` travel with every
candidate and must survive to the point of display.
