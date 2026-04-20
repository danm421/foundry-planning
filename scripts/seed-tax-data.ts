// Seeds tax_year_parameters from data/tax/*.xlsx.
// Idempotent: re-running upserts by year.
//
// Usage:
//   npm run seed:tax-data
//   npm run seed:tax-data -- --dry-run
//   npm run seed:tax-data -- --write-snapshot

import { taxYearParameters } from "../src/db/schema";
import { sql } from "drizzle-orm";
import { parseIrsUpdatesSheet } from "./parsers/irs-updates-sheet";
import type { TaxYearParameters } from "../src/lib/tax/types";
import { writeFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_FILE = path.join(process.cwd(), "data/tax/2022-2026 Tax Values Updated.xlsx");

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const writeSnapshot = args.includes("--write-snapshot");
  const fileArg = args.find((a) => a.startsWith("--file="));
  const filePath = fileArg ? fileArg.slice("--file=".length) : DEFAULT_FILE;

  console.log(`Parsing: ${filePath}`);
  const years = await parseIrsUpdatesSheet(filePath);
  console.log(`Found ${years.length} year rows: ${years.map((y) => y.year).join(", ")}`);

  validate(years);

  printSummary(years);

  if (writeSnapshot) {
    const snapshotPath = path.join(process.cwd(), "data/tax/snapshot.json");
    writeFileSync(snapshotPath, JSON.stringify(years, null, 2));
    console.log(`Wrote snapshot: ${snapshotPath}`);
  }

  if (dryRun) {
    console.log("--dry-run: skipping DB write");
    return;
  }

  // Lazy-import DB so dry-run path doesn't require DATABASE_URL at module load.
  const { db } = await import("../src/db");

  for (const y of years) {
    await upsertYear(y, db);
    console.log(`Upserted ${y.year}`);
  }

  console.log("Done.");
  process.exit(0);
}

function validate(years: TaxYearParameters[]) {
  for (const y of years) {
    // Brackets monotonically increasing
    for (const status of Object.keys(y.incomeBrackets) as Array<keyof typeof y.incomeBrackets>) {
      const tiers = y.incomeBrackets[status];
      for (let i = 1; i < tiers.length; i++) {
        if (tiers[i].from < tiers[i - 1].from) {
          throw new Error(`${y.year} ${status}: brackets not monotonically increasing`);
        }
      }
    }
    // Rates in [0, 1]
    if (y.ssTaxRate < 0 || y.ssTaxRate > 1) throw new Error(`${y.year}: ssTaxRate out of range`);
    if (y.medicareTaxRate < 0 || y.medicareTaxRate > 1) throw new Error(`${y.year}: medicareTaxRate out of range`);
    if (y.niitRate < 0 || y.niitRate > 1) throw new Error(`${y.year}: niitRate out of range`);
    // Required scalars present
    if (!y.stdDeduction.married_joint) throw new Error(`${y.year}: stdDeduction.married_joint missing`);
    if (!y.ssWageBase) throw new Error(`${y.year}: ssWageBase missing`);
  }
}

function printSummary(years: TaxYearParameters[]) {
  console.log("\nSummary:");
  console.log("Year | StdDed MFJ | Top MFJ Bracket Top | SS Wage Base");
  for (const y of years) {
    const topBracket = y.incomeBrackets.married_joint[5]?.to ?? 0; // 35% top
    console.log(`${y.year} | $${y.stdDeduction.married_joint.toLocaleString()} | $${topBracket?.toLocaleString() ?? "N/A"} | $${y.ssWageBase.toLocaleString()}`);
  }
  console.log("");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function upsertYear(y: TaxYearParameters, db: any) {
  await db
    .insert(taxYearParameters)
    .values({
      year: y.year,
      incomeBrackets: y.incomeBrackets,
      capGainsBrackets: y.capGainsBrackets,
      stdDeductionMfj: String(y.stdDeduction.married_joint),
      stdDeductionSingle: String(y.stdDeduction.single),
      stdDeductionHoh: String(y.stdDeduction.head_of_household),
      stdDeductionMfs: String(y.stdDeduction.married_separate),
      amtExemptionMfj: String(y.amtExemption.mfj),
      amtExemptionSingleHoh: String(y.amtExemption.singleHoh),
      amtExemptionMfs: String(y.amtExemption.mfs),
      amtBreakpoint2628MfjShoh: String(y.amtBreakpoint2628.mfjShoh),
      amtBreakpoint2628Mfs: String(y.amtBreakpoint2628.mfs),
      amtPhaseoutStartMfj: String(y.amtPhaseoutStart.mfj),
      amtPhaseoutStartSingleHoh: String(y.amtPhaseoutStart.singleHoh),
      amtPhaseoutStartMfs: String(y.amtPhaseoutStart.mfs),
      ssTaxRate: String(y.ssTaxRate),
      ssWageBase: String(y.ssWageBase),
      medicareTaxRate: String(y.medicareTaxRate),
      addlMedicareRate: String(y.addlMedicareRate),
      addlMedicareThresholdMfj: String(y.addlMedicareThreshold.mfj),
      addlMedicareThresholdSingle: String(y.addlMedicareThreshold.single),
      addlMedicareThresholdMfs: String(y.addlMedicareThreshold.mfs),
      niitRate: String(y.niitRate),
      niitThresholdMfj: String(y.niitThreshold.mfj),
      niitThresholdSingle: String(y.niitThreshold.single),
      niitThresholdMfs: String(y.niitThreshold.mfs),
      qbiThresholdMfj: String(y.qbi.thresholdMfj),
      qbiThresholdSingleHohMfs: String(y.qbi.thresholdSingleHohMfs),
      qbiPhaseInRangeMfj: String(y.qbi.phaseInRangeMfj),
      qbiPhaseInRangeOther: String(y.qbi.phaseInRangeOther),
      ira401kElective: String(y.contribLimits.ira401kElective),
      ira401kCatchup50: String(y.contribLimits.ira401kCatchup50),
      ira401kCatchup6063: y.contribLimits.ira401kCatchup6063 != null ? String(y.contribLimits.ira401kCatchup6063) : null,
      iraTradLimit: String(y.contribLimits.iraTradLimit),
      iraCatchup50: String(y.contribLimits.iraCatchup50),
      simpleLimitRegular: String(y.contribLimits.simpleLimitRegular),
      simpleCatchup50: String(y.contribLimits.simpleCatchup50),
      hsaLimitSelf: String(y.contribLimits.hsaLimitSelf),
      hsaLimitFamily: String(y.contribLimits.hsaLimitFamily),
      hsaCatchup55: String(y.contribLimits.hsaCatchup55),
    })
    .onConflictDoUpdate({
      target: taxYearParameters.year,
      set: {
        incomeBrackets: sql`excluded.income_brackets`,
        capGainsBrackets: sql`excluded.cap_gains_brackets`,
        stdDeductionMfj: sql`excluded.std_deduction_mfj`,
        stdDeductionSingle: sql`excluded.std_deduction_single`,
        stdDeductionHoh: sql`excluded.std_deduction_hoh`,
        stdDeductionMfs: sql`excluded.std_deduction_mfs`,
        amtExemptionMfj: sql`excluded.amt_exemption_mfj`,
        amtExemptionSingleHoh: sql`excluded.amt_exemption_single_hoh`,
        amtExemptionMfs: sql`excluded.amt_exemption_mfs`,
        amtBreakpoint2628MfjShoh: sql`excluded.amt_breakpoint_2628_mfj_shoh`,
        amtBreakpoint2628Mfs: sql`excluded.amt_breakpoint_2628_mfs`,
        amtPhaseoutStartMfj: sql`excluded.amt_phaseout_start_mfj`,
        amtPhaseoutStartSingleHoh: sql`excluded.amt_phaseout_start_single_hoh`,
        amtPhaseoutStartMfs: sql`excluded.amt_phaseout_start_mfs`,
        ssTaxRate: sql`excluded.ss_tax_rate`,
        ssWageBase: sql`excluded.ss_wage_base`,
        medicareTaxRate: sql`excluded.medicare_tax_rate`,
        addlMedicareRate: sql`excluded.addl_medicare_rate`,
        addlMedicareThresholdMfj: sql`excluded.addl_medicare_threshold_mfj`,
        addlMedicareThresholdSingle: sql`excluded.addl_medicare_threshold_single`,
        addlMedicareThresholdMfs: sql`excluded.addl_medicare_threshold_mfs`,
        niitThresholdMfj: sql`excluded.niit_threshold_mfj`,
        niitThresholdSingle: sql`excluded.niit_threshold_single`,
        niitThresholdMfs: sql`excluded.niit_threshold_mfs`,
        qbiThresholdMfj: sql`excluded.qbi_threshold_mfj`,
        qbiThresholdSingleHohMfs: sql`excluded.qbi_threshold_single_hoh_mfs`,
        qbiPhaseInRangeMfj: sql`excluded.qbi_phase_in_range_mfj`,
        qbiPhaseInRangeOther: sql`excluded.qbi_phase_in_range_other`,
        ira401kElective: sql`excluded.ira_401k_elective`,
        ira401kCatchup50: sql`excluded.ira_401k_catchup_50`,
        ira401kCatchup6063: sql`excluded.ira_401k_catchup_60_63`,
        iraTradLimit: sql`excluded.ira_trad_limit`,
        iraCatchup50: sql`excluded.ira_catchup_50`,
        simpleLimitRegular: sql`excluded.simple_limit_regular`,
        simpleCatchup50: sql`excluded.simple_catchup_50`,
        hsaLimitSelf: sql`excluded.hsa_limit_self`,
        hsaLimitFamily: sql`excluded.hsa_limit_family`,
        hsaCatchup55: sql`excluded.hsa_catchup_55`,
      },
    });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
