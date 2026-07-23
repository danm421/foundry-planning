// Run AFTER the risk_level migration is applied.
//   DATABASE_URL='...' npx tsx scripts/backfill-seed-risk-levels.ts
// Idempotent: safe to re-run; tags only exact seed names, only where untagged.
import { db } from "@/db";
import { modelPortfolios } from "@/db/schema";
import { tagSeedPortfolioRiskLevels } from "@/lib/cma/tag-seed-risk-levels";

async function main() {
  const firms = await db
    .selectDistinct({ firmId: modelPortfolios.firmId })
    .from(modelPortfolios);
  let total = 0;
  for (const { firmId } of firms) {
    const n = await tagSeedPortfolioRiskLevels(db, firmId);
    if (n > 0) console.log(`  ${firmId}: tagged ${n}`);
    total += n;
  }
  console.log(`Done. Tagged ${total} portfolios across ${firms.length} firms.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
