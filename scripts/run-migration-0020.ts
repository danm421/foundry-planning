import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  console.log("Applying migration 0020_asset_mix...");

  // 1. Add slug column
  console.log("  Adding slug column to asset_classes...");
  await sql`ALTER TABLE asset_classes ADD COLUMN IF NOT EXISTS slug VARCHAR(50)`;

  // 2. Create unique index (idempotent via IF NOT EXISTS)
  console.log("  Creating unique index on (firm_id, slug)...");
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS asset_classes_firm_slug_uniq ON asset_classes (firm_id, slug) WHERE slug IS NOT NULL`;

  // 3. Add asset_mix enum value — can't use IF NOT EXISTS, so check first
  console.log("  Adding 'asset_mix' to growth_source enum...");
  const enumCheck = await sql`SELECT 1 FROM pg_enum WHERE enumlabel = 'asset_mix' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'growth_source')`;
  if (enumCheck.length === 0) {
    await sql`ALTER TYPE growth_source ADD VALUE 'asset_mix'`;
  } else {
    console.log("    (already exists, skipping)");
  }

  // 4. Create account_asset_allocations table
  console.log("  Creating account_asset_allocations table...");
  await sql`
    CREATE TABLE IF NOT EXISTS account_asset_allocations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      asset_class_id UUID NOT NULL REFERENCES asset_classes(id) ON DELETE CASCADE,
      weight DECIMAL(5,4) NOT NULL DEFAULT 0,
      UNIQUE (account_id, asset_class_id)
    )
  `;

  // 5. Seed Inflation asset class (only if not already seeded)
  console.log("  Seeding Inflation asset class...");
  const existing = await sql`SELECT 1 FROM asset_classes WHERE slug = 'inflation' LIMIT 1`;
  if (existing.length === 0) {
    await sql`
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
      FROM (SELECT DISTINCT firm_id FROM asset_classes) AS firms
    `;
  } else {
    console.log("    (already seeded, skipping)");
  }

  console.log("Migration 0020 applied successfully!");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
