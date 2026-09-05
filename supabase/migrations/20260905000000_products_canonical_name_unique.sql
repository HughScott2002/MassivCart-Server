-- scripts/seed-products.ts upserts with ON CONFLICT (canonical_name), but no
-- unique constraint on that column ever existed. Every batch failed with 42P10
-- ("no unique or exclusion constraint matching the ON CONFLICT specification")
-- and the catalog stayed at its 15 placeholder rows while 791 real products sat
-- unused in data/products-seed.json.
--
-- The index is on the bare column, not lower(trim(...)), because ON CONFLICT
-- only matches an index whose columns match the conflict target exactly. That
-- leaves case-variant duplicates ("Grace Rice 2kg" vs "grace rice 2kg")
-- technically insertable; canonical-name normalisation belongs with the wider
-- schema work in #16, not here.

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_canonical_name_unique
    ON products (canonical_name);
