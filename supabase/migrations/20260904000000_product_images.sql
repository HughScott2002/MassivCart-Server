-- Phase 0.5: image pipeline foundations (issue #22)
--
-- Two changes:
--   1. products gains identity fields so image matching can key on GTIN rather
--      than fuzzy name matching against synthetic names like "Grace White Rice 2kg".
--   2. product_images stores image candidates with provenance and a review status,
--      rather than a bare image_url column, so licensing and attribution survive.

-- ── products: identity fields ────────────────────────────────────────────────
ALTER TABLE products ADD COLUMN IF NOT EXISTS brand TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS size_value NUMERIC;
ALTER TABLE products ADD COLUMN IF NOT EXISTS size_unit TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS gtin TEXT;

-- A GTIN identifies exactly one package worldwide, so it must not repeat. Rows
-- without one are still valid — most of the catalog has no GTIN captured yet.
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_gtin_unique
    ON products (gtin)
    WHERE gtin IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_products_brand ON products (brand);

-- ── product_images ───────────────────────────────────────────────────────────
-- storage_path holds the path within the Supabase Storage bucket, never a full
-- URL. The public URL is derived at read time so the bucket or project can move
-- without a data migration.
CREATE TABLE IF NOT EXISTS product_images (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    storage_path TEXT NOT NULL,
    source TEXT NOT NULL,
    source_url TEXT,
    license TEXT,
    attribution TEXT,
    match_confidence DOUBLE PRECISION,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT product_images_status_check
        CHECK (status IN ('pending', 'approved', 'rejected')),
    CONSTRAINT product_images_match_confidence_range
        CHECK (match_confidence IS NULL OR (match_confidence >= 0 AND match_confidence <= 1))
);

-- At most one approved image per product. Rejected and pending candidates may
-- accumulate freely — they are the audit trail for the review workload.
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_images_one_approved
    ON product_images (product_id)
    WHERE status = 'approved';

CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images (product_id);
CREATE INDEX IF NOT EXISTS idx_product_images_status ON product_images (status);

-- Same storage object must not be registered twice for one product.
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_images_product_path_unique
    ON product_images (product_id, storage_path);
