// src/lib/tax/senior-deductions.ts
// Federal senior deductions NOT carried on the DB-seeded TaxYearParameters row
// (see plan design decision 1). Pure, framework-free.
import type { FilingStatus } from "./types";
import { floorToStep } from "./constants";

const MARRIED: ReadonlySet<FilingStatus> = new Set(["married_joint", "married_separate"]);

// §63(f) additional standard deduction per box (per 65+/blind taxpayer).
// 2026 published (Rev. Proc. 2025-32): $1,650/box married, $2,050/box unmarried.
const ADDL_STD_PER_BOX_2026 = { married: 1650, unmarried: 2050 } as const;

function age65BoxCount(fs: FilingStatus, primaryAge: number, spouseAge?: number): number {
  const married = fs === "married_joint";
  return (primaryAge >= 65 ? 1 : 0) + (married && (spouseAge ?? 0) >= 65 ? 1 : 0);
  // NOTE: blind boxes not modeled (no isBlind input) — audit F12 hook.
}

/** §63(f) additional standard deduction. Augments the STANDARD path only.
 *  `inflationFactor` is the resolver's general factor (1.0 for seeded 2026). */
export function getAdditionalStdDeduction(
  year: number, fs: FilingStatus, primaryAge: number, spouseAge: number | undefined,
  inflationFactor: number,
): number {
  const boxes = age65BoxCount(fs, primaryAge, spouseAge);
  if (boxes === 0) return 0;
  const perBox = MARRIED.has(fs) ? ADDL_STD_PER_BOX_2026.married : ADDL_STD_PER_BOX_2026.unmarried;
  return floorToStep(perBox * boxes * inflationFactor, 50);
}

// OBBBA temporary senior deduction (P.L. 119-21 §70103). $6,000/senior, TY2025-2028.
const OBBBA_PER_SENIOR = 6000;
const OBBBA_RATE = 0.06;
const OBBBA_FIRST_YEAR = 2025;
const OBBBA_LAST_YEAR = 2028;

/** OBBBA senior bonus deduction (reduces taxable income for std OR itemized filers).
 *  MAGI = AGI (+ §911/931/933 exclusions, not modeled here).
 *
 *  Phaseout is applied PER SENIOR, not against the combined base: each eligible
 *  spouse's $6,000 is independently reduced by 6% of MAGI over the threshold, then
 *  summed (P.L. 119-21 §70103 / new IRC §151(d)(5)(B): "each $6,000 amount is
 *  phased out separately"). For MFJ-both-65+ this means full phaseout at $250k
 *  ($150k + $6,000/0.06), and $6,000 (not $9,000) remaining at $200k. A combined-
 *  base formula would mis-state the MFJ phaseout — keep this per-senior. */
export function getObbbaSeniorBonus(
  year: number, fs: FilingStatus, primaryAge: number, spouseAge: number | undefined,
  magi: number,
): number {
  if (year < OBBBA_FIRST_YEAR || year > OBBBA_LAST_YEAR) return 0;
  const married = fs === "married_joint";
  const seniors = (primaryAge >= 65 ? 1 : 0) + (married && (spouseAge ?? 0) >= 65 ? 1 : 0);
  if (seniors === 0) return 0;
  const threshold = married ? 150_000 : 75_000;
  const phaseoutPerSenior = Math.max(0, OBBBA_RATE * (magi - threshold));
  const perSenior = Math.max(0, OBBBA_PER_SENIOR - phaseoutPerSenior);
  return perSenior * seniors;
}
