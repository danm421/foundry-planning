-- 1. Add slug column to asset_classes for programmatic lookup
ALTER TABLE asset_classes ADD COLUMN slug VARCHAR(50);
--> statement-breakpoint
CREATE UNIQUE INDEX asset_classes_firm_slug_uniq
  ON asset_classes (firm_id, slug) WHERE slug IS NOT NULL;
--> statement-breakpoint

-- 2. Add 'asset_mix' to growth_source enum
ALTER TYPE growth_source ADD VALUE 'asset_mix';
--> statement-breakpoint

-- 3. Create account_asset_allocations table
CREATE TABLE account_asset_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  asset_class_id UUID NOT NULL REFERENCES asset_classes(id) ON DELETE CASCADE,
  weight DECIMAL(5,4) NOT NULL DEFAULT 0,
  UNIQUE (account_id, asset_class_id)
);
--> statement-breakpoint

-- 4. Seed Inflation asset class for every existing firm
INSERT INTO asset_classes (
  id, firm_id, name, slug,
  geometric_return, arithmetic_mean, volatility,
  pct_ordinary_income, pct_lt_capital_gains,
  pct_qualified_dividends, pct_tax_exempt,
  sort_order
)
SELECT
  gen_random_uuid(), firm_id, 'Inflation', 'inflation',
  0.0250, 0.0255, 0.0050,
  1.0000, 0.0000, 0.0000, 0.0000,
  999
FROM (SELECT DISTINCT firm_id FROM asset_classes) AS firms;

-- 5. Add growth_source columns for categories that don't have them yet
--    (only taxable, cash, retirement have them; real_estate, business,
--     life_insurance do not — but asset_mix as category default needs
--     to be supported for taxable and retirement, which already exist)
