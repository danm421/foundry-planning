// One-off data migration: ensure every firm has exactly one fixed 0% Cash
// asset class (slug='cash', asset_type='cash'). Steps per firm:
//   1. Rename a legacy "Cash / Money Market" row in place (preserves its id
//      so referencing holdings / overrides / allocations keep working).
//   2. Insert a Cash row if the firm still has none (guarded by NOT EXISTS).
//   3. Seed cma_set_values for Cash across all three sets (idempotent).
//   4. Force all Cash rows / set-values to zeros.
//
// Idempotent — safe to re-run. Must be run once against the prod branch at
// deploy time.
//
//   npx tsx --env-file=.env.local scripts/run-migration-cash-asset-class.ts
//
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { assetClasses } from "@/db/schema";
import { seedCmaSetsForFirm } from "@/lib/cma-sets";

async function main() {
  const firms = await db.selectDistinct({ firmId: assetClasses.firmId }).from(assetClasses);
  console.log(`Migrating ${firms.length} firm(s)…`);

  for (const { firmId } of firms) {
    // 1. Rename a legacy "Cash / Money Market" row in place (preserves id).
    await db.execute(sql`
      UPDATE asset_classes
      SET name = 'Cash', slug = 'cash', asset_type = 'cash',
          geometric_return = '0', arithmetic_mean = '0', volatility = '0',
          updated_at = now()
      WHERE firm_id = ${firmId} AND name = 'Cash / Money Market'
    `);

    // 2. Insert a Cash row if the firm still has none.
    await db.execute(sql`
      INSERT INTO asset_classes
        (firm_id, name, slug, geometric_return, arithmetic_mean, volatility,
         pct_ordinary_income, pct_lt_capital_gains, pct_qualified_dividends, pct_tax_exempt,
         sort_order, asset_type)
      SELECT ${firmId}, 'Cash', 'cash', '0', '0', '0',
             '1', '0', '0', '0',
             (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM asset_classes WHERE firm_id = ${firmId}),
             'cash'
      WHERE NOT EXISTS (
        SELECT 1 FROM asset_classes WHERE firm_id = ${firmId} AND slug = 'cash'
      )
    `);

    // 3. Ensure cma_set_values rows exist for Cash across all three sets.
    await seedCmaSetsForFirm(firmId);

    // 4. Force Cash to zeros + canonical tax profile everywhere. Cash income is
    //    100% ordinary (interest), matching the seed + the INSERT above — this
    //    also normalizes any renamed legacy row whose pct_* fields were non-zero.
    await db.execute(sql`
      UPDATE asset_classes
      SET geometric_return = '0', arithmetic_mean = '0', volatility = '0',
          pct_ordinary_income = '1', pct_lt_capital_gains = '0',
          pct_qualified_dividends = '0', pct_tax_exempt = '0',
          asset_type = 'cash', updated_at = now()
      WHERE firm_id = ${firmId} AND slug = 'cash'
    `);
    await db.execute(sql`
      UPDATE cma_set_values v
      SET geometric_return = '0', arithmetic_mean = '0', volatility = '0', updated_at = now()
      FROM asset_classes ac
      WHERE v.asset_class_id = ac.id AND ac.firm_id = ${firmId} AND ac.slug = 'cash'
    `);

    console.log(`  ✓ ${firmId}`);
  }

  console.log("Done.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
