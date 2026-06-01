// One-off data migration: seed the 3 named CMA sets (Historical/Projected/Custom)
// for every existing firm. Idempotent — safe to re-run. Must be run once against
// the prod branch at deploy time.
//
//   npx tsx --env-file=.env.local scripts/run-migration-cma-sets.ts
//
import { db } from "@/db";
import { assetClasses } from "@/db/schema";
import { seedCmaSetsForFirm } from "@/lib/cma-sets";

async function main() {
  const firms = await db.selectDistinct({ firmId: assetClasses.firmId }).from(assetClasses);
  console.log(`Seeding CMA sets for ${firms.length} firm(s)…`);
  for (const { firmId } of firms) {
    await seedCmaSetsForFirm(firmId);
    console.log(`  ✓ ${firmId}`);
  }
  console.log("Done.");
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
