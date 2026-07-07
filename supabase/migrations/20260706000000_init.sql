-- Enable pg_trgm for fuzzy text matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- stores table
CREATE TABLE IF NOT EXISTS stores (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    branch TEXT,
    neighbourhood TEXT,
    parish TEXT,
    store_type TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    place_id TEXT,
    is_synthetic BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- products table
CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    canonical_name TEXT NOT NULL,
    category TEXT,
    unit_type TEXT,
    typical_unit_price DOUBLE PRECISION,
    aliases TEXT[]
);

CREATE INDEX IF NOT EXISTS products_canonical_name_trgm ON products USING gin (canonical_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS products_category ON products (category);

-- prices table
CREATE TABLE IF NOT EXISTS prices (
    id SERIAL PRIMARY KEY,
    product_id INTEGER REFERENCES products(id),
    store_id INTEGER REFERENCES stores(id),
    price DOUBLE PRECISION NOT NULL,
    unit_price DOUBLE PRECISION,
    confidence_score DOUBLE PRECISION DEFAULT 0.5,
    date_recorded DATE,
    currency TEXT DEFAULT 'JMD',
    is_synthetic BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prices_product_store ON prices(product_id, store_id);
CREATE INDEX IF NOT EXISTS idx_prices_product ON prices(product_id);
CREATE INDEX IF NOT EXISTS idx_prices_store ON prices(store_id);
CREATE INDEX IF NOT EXISTS idx_prices_is_synthetic ON prices(is_synthetic) WHERE is_synthetic = false;
CREATE INDEX IF NOT EXISTS idx_prices_confidence ON prices(confidence_score);
CREATE UNIQUE INDEX IF NOT EXISTS idx_prices_product_store_unique ON prices(product_id, store_id);

-- receipts table
CREATE TABLE IF NOT EXISTS receipts (
    id SERIAL PRIMARY KEY,
    user_id TEXT,
    store_id INTEGER REFERENCES stores(id),
    receipt_date DATE,
    total DOUBLE PRECISION,
    receipt_hash TEXT UNIQUE,
    image_type TEXT,
    receipt_category TEXT DEFAULT 'receipt',
    source TEXT DEFAULT 'ocr',
    fraud_flag BOOLEAN DEFAULT false,
    image_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- users table
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    display_name TEXT,
    points INTEGER DEFAULT 0,
    tier TEXT DEFAULT 'Shopper',
    streak_days INTEGER DEFAULT 0,
    last_upload_at TIMESTAMPTZ,
    weekly_budget DOUBLE PRECISION,
    family_size INTEGER,
    diet_preference TEXT,
    parish TEXT,
    telegram_chat_id TEXT,
    is_admin BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- shopping_list_items table
CREATE TABLE IF NOT EXISTS shopping_list_items (
    id SERIAL PRIMARY KEY,
    user_id TEXT REFERENCES users(id),
    product_id INTEGER REFERENCES products(id),
    raw_name TEXT,
    quantity DOUBLE PRECISION,
    quantity_requested DOUBLE PRECISION,
    is_recurring BOOLEAN DEFAULT false,
    added_at TIMESTAMPTZ DEFAULT NOW()
);

-- prescriptions table
CREATE TABLE IF NOT EXISTS prescriptions (
    id SERIAL PRIMARY KEY,
    user_id TEXT,
    receipt_id INTEGER REFERENCES receipts(id),
    store_id INTEGER REFERENCES stores(id),
    patient_name TEXT,
    prescriber TEXT,
    prescription_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- prescription_items table
CREATE TABLE IF NOT EXISTS prescription_items (
    id SERIAL PRIMARY KEY,
    prescription_id INTEGER REFERENCES prescriptions(id),
    drug_name TEXT,
    dosage TEXT,
    quantity INTEGER
);

-- fuel_grades table
CREATE TABLE IF NOT EXISTS fuel_grades (
    id SERIAL PRIMARY KEY,
    canonical_name TEXT NOT NULL,
    aliases TEXT[]
);

-- Insert sample stores
INSERT INTO stores (name, branch, parish, store_type, latitude, longitude, is_synthetic) VALUES
    ('Hi-Lo', 'New Kingston', 'Kingston', 'grocery', 17.9970, -76.7936, false),
    ('MegaMart', 'Constant Spring', 'Kingston', 'grocery', 18.0100, -76.7800, false),
    ('PriceSmart', 'Portmore', 'St. Catherine', 'wholesale', 17.9900, -76.7600, false),
    ('SuperPlus', 'Liguanea', 'Kingston', 'grocery', 18.0050, -76.8100, false),
    ('FreshMart', 'Barbican', 'Kingston', 'grocery', 17.9800, -76.7700, false),
    ('ValueMax', 'Half-Way Tree', 'Kingston', 'grocery', 18.0150, -76.7500, false)
ON CONFLICT DO NOTHING;

-- Insert sample products
INSERT INTO products (canonical_name, category, unit_type, typical_unit_price, aliases) VALUES
    ('Rice 1kg', 'Grains & Staples', 'kg', 420, ARRAY['white rice', 'long grain rice', 'rice 1 kilogram']),
    ('Cooking Oil 1L', 'Oils & Condiments', 'L', 680, ARRAY['vegetable oil', 'cooking oil', 'oil 1 litre']),
    ('Chicken Breast per kg', 'Meat & Poultry', 'kg', 890, ARRAY['chicken breast', 'fresh chicken', 'boneless chicken']),
    ('Bread Sandwich Loaf', 'Bakery', 'loaf', 320, ARRAY['sandwich bread', 'bread loaf', 'white bread']),
    ('Spaghetti 500g', 'Grains & Staples', 'g', 185, ARRAY['pasta', 'spaghetti', 'penne']),
    ('Macaroni 500g', 'Grains & Staples', 'g', 165, ARRAY['pasta', 'macaroni', 'elbow pasta']),
    ('Milk 1L', 'Dairy', 'L', 380, ARRAY['fresh milk', 'whole milk', 'milk 1 litre']),
    ('Eggs (dozen)', 'Dairy', 'dozen', 450, ARRAY['chicken eggs', 'eggs dozen', 'table eggs']),
    ('Sugar 1kg', 'Baking', 'kg', 250, ARRAY['white sugar', 'granulated sugar', 'caster sugar']),
    ('Flour 1kg', 'Baking', 'kg', 220, ARRAY['all purpose flour', 'wheat flour', 'plain flour']),
    ('Margarine 500g', 'Dairy', 'g', 380, ARRAY['butter spread', 'marge', 'spread']),
    ('Onions 1kg', 'Vegetables', 'kg', 280, ARRAY['yellow onions', 'red onions', 'onion']),
    ('Tomatoes 1kg', 'Vegetables', 'kg', 350, ARRAY['roma tomatoes', 'fresh tomatoes', 'tomato']),
    ('Potatoes 1kg', 'Vegetables', 'kg', 260, ARRAY['irish potatoes', 'white potatoes', 'potato']),
    ('Green Peas 500g', 'Canned Goods', 'g', 290, ARRAY['canned peas', 'garden peas', 'peas'])
ON CONFLICT DO NOTHING;

-- Insert sample prices (real data for some products)
INSERT INTO prices (product_id, store_id, price, confidence_score, date_recorded, is_synthetic) VALUES
    -- Rice
    (1, 1, 459, 0.9, CURRENT_DATE, false),
    (1, 2, 489, 0.9, CURRENT_DATE, false),
    (1, 3, 420, 0.9, CURRENT_DATE, false),
    (1, 4, 435, 0.8, CURRENT_DATE, false),
    (1, 5, 445, 0.8, CURRENT_DATE, false),
    (1, 6, 455, 0.8, CURRENT_DATE, false),
    -- Cooking Oil
    (2, 1, 720, 0.9, CURRENT_DATE, false),
    (2, 2, 749, 0.9, CURRENT_DATE, false),
    (2, 3, 650, 0.9, CURRENT_DATE, false),
    (2, 4, 720, 0.8, CURRENT_DATE, false),
    (2, 5, 749, 0.8, CURRENT_DATE, false),
    (2, 6, 680, 0.8, CURRENT_DATE, false),
    -- Chicken
    (3, 1, 890, 0.9, CURRENT_DATE, false),
    (3, 2, 950, 0.9, CURRENT_DATE, false),
    (3, 3, 980, 0.9, CURRENT_DATE, false),
    -- Bread
    (4, 1, 320, 0.8, CURRENT_DATE, false),
    (4, 2, 349, 0.8, CURRENT_DATE, false),
    (4, 3, 310, 0.8, CURRENT_DATE, false),
    -- Spaghetti
    (5, 1, 185, 0.7, CURRENT_DATE, false),
    (5, 2, 199, 0.7, CURRENT_DATE, false),
    (5, 3, 175, 0.7, CURRENT_DATE, false),
    -- Macaroni
    (6, 1, 179, 0.7, CURRENT_DATE, false),
    (6, 2, 189, 0.7, CURRENT_DATE, false),
    (6, 3, 165, 0.7, CURRENT_DATE, false)
ON CONFLICT DO NOTHING;

-- Insert a test user
INSERT INTO users (id, display_name, points, tier) VALUES
    ('test-user-001', 'Test User', 100, 'Shopper')
ON CONFLICT DO NOTHING;
-- Realtime: the UI subscribes to postgres_changes on prices
ALTER PUBLICATION supabase_realtime ADD TABLE prices;
