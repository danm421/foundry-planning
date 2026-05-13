// scripts/generate-state-income-goldens.local.ts
//
// Generates golden JSON files for the all-51-jurisdictions state-income test suite.
//
// Run:   npx tsx scripts/generate-state-income-goldens.local.ts
//
// Reruns are safe — overwrites the 4 JSON files (2 years × 2 profiles).
// Also prints a sanity-check summary so reviewer can spot anomalies before commit.
//
// Filename uses the `.local.ts` suffix to mirror the project convention; the file
// is gitignored. Re-add intentionally with `git add -f` to commit a snapshot for
// future re-runs.

import fs from "node:fs";
import path from "node:path";
import { computeStateIncomeTax } from "../src/lib/tax/state-income/compute";
import {
  USPS_STATE_CODES,
  type USPSStateCode,
} from "../src/lib/usps-states";
import {
  RETIREE_MFJ_AGE70,
  WAGE_EARNER_SINGLE_AGE40,
} from "../src/lib/tax/state-income/__tests__/golden/fixtures";

const OUT_DIR = path.join(
  __dirname,
  "../src/lib/tax/state-income/__tests__/golden",
);

// Use a 4-decimal canonical form: keeps the JSON readable while preserving
// enough precision for `toBeCloseTo(_, 2)` (tolerance 0.005) on engine values
// that land at half-cent boundaries (e.g. OH $1967.625, RI $3148.125).
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

const NO_TAX_STATES: USPSStateCode[] = [
  "AK",
  "FL",
  "NV",
  "NH",
  "SD",
  "TN",
  "TX",
  "WY",
];
const BIG_TAX_STATES: USPSStateCode[] = ["CA", "NY", "MA", "NJ", "DC", "HI"];

type Snapshot = Record<string, number>;

function generate(): {
  files: string[];
  snapshots: Record<string, Snapshot>;
} {
  const files: string[] = [];
  const snapshots: Record<string, Snapshot> = {};

  for (const year of [2025, 2026] as const) {
    for (const [name, fixture] of [
      ["retiree", RETIREE_MFJ_AGE70] as const,
      ["wage", WAGE_EARNER_SINGLE_AGE40] as const,
    ]) {
      const out: Snapshot = {};
      for (const s of USPS_STATE_CODES) {
        const r = computeStateIncomeTax(fixture(s, year));
        out[s] = round4(r.stateTax);
      }
      const file = path.join(
        OUT_DIR,
        `golden-expected-${year}-${name}.json`,
      );
      fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
      files.push(file);
      snapshots[`${year}-${name}`] = out;
      console.log(`Wrote ${file}`);
    }
  }

  return { files, snapshots };
}

function sanityCheck(snapshots: Record<string, Snapshot>): void {
  console.log("\n=== Sanity check ===");
  let issues = 0;

  for (const key of Object.keys(snapshots)) {
    const snap = snapshots[key]!;
    // No-tax states must all be 0.
    for (const s of NO_TAX_STATES) {
      if (snap[s] !== 0) {
        console.log(`  [FAIL] ${key}: ${s} = ${snap[s]} (expected 0)`);
        issues++;
      }
    }
    // WA: retiree has $20K LTCG (well below $278K exclusion); wage earner $0 LTCG.
    // Both profiles should produce 0.
    if (snap["WA"] !== 0) {
      console.log(`  [FAIL] ${key}: WA = ${snap["WA"]} (expected 0)`);
      issues++;
    }
    // Big-tax states should be positive for both profiles.
    for (const s of BIG_TAX_STATES) {
      if (!(snap[s]! > 0)) {
        console.log(
          `  [WARN] ${key}: ${s} = ${snap[s]} (expected > 0 for big-tax state)`,
        );
        issues++;
      }
    }
  }

  if (issues === 0) {
    console.log("  All sanity checks passed.");
  } else {
    console.log(`  ${issues} sanity issue(s) found — review before commit.`);
  }
}

function printSummary(snapshots: Record<string, Snapshot>): void {
  console.log("\n=== Summary (state × profile/year) ===");
  const keys = Object.keys(snapshots).sort();
  const header = `state   ${keys.map((k) => k.padStart(14)).join(" ")}`;
  console.log(header);
  for (const s of USPS_STATE_CODES) {
    const row = keys
      .map((k) => snapshots[k]![s]!.toFixed(4).padStart(14))
      .join(" ");
    console.log(`${s.padEnd(7)} ${row}`);
  }
}

const { snapshots } = generate();
printSummary(snapshots);
sanityCheck(snapshots);
