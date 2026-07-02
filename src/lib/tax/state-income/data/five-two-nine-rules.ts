// src/lib/tax/state-income/data/five-two-nine-rules.ts
// Hand-encoded from published 2025 state 529 rules.
// v1 simplifications: contributions assumed to go to resident-state plan
// (in-state-only restrictions never bite); carryforwards, AGI gates, and MFS caps not modeled.
// Values need yearly tax-data refresh before each tax year (same caveat as retirement-rules.ts).

import type { USPSStateCode } from "@/lib/usps-states";
import type { Plan529Rule } from "../types";

const NONE: Plan529Rule = { kind: "none", notes: "No state 529 deduction or credit." };

export const PLAN_529_RULES_2026: Partial<Record<USPSStateCode, Plan529Rule>> = {
  AL: { kind: "deduction", basis: "per_taxpayer", capSingle: 5_000, capJoint: 10_000, notes: "In-state plan only." },
  AR: { kind: "deduction", basis: "per_taxpayer", capSingle: 5_000, capJoint: 10_000, notes: "In-state plans; smaller cap for out-of-state rollovers ignored v1." },
  AZ: { kind: "deduction", basis: "per_taxpayer", capSingle: 2_000, capJoint: 4_000, notes: "Any state's plan (parity state)." },
  CA: NONE,
  CO: { kind: "deduction", basis: "per_beneficiary", capSingle: 20_700, capJoint: 31_000, notes: "Per-taxpayer-per-beneficiary caps, indexed annually — verify current year." },
  CT: { kind: "deduction", basis: "per_taxpayer", capSingle: 5_000, capJoint: 10_000, notes: "CHET only; 5-yr carryforward not modeled." },
  DC: { kind: "deduction", basis: "per_taxpayer", capSingle: 4_000, capJoint: 8_000, notes: "DC plan only; joint cap requires separate accounts." },
  DE: { kind: "deduction", basis: "per_taxpayer", capSingle: 1_000, capJoint: 2_000, notes: "AGI limits ($100k/$200k) not modeled v1." },
  GA: { kind: "deduction", basis: "per_beneficiary", capSingle: 4_000, capJoint: 8_000, notes: "Path2College only." },
  HI: NONE,
  IA: { kind: "deduction", basis: "per_beneficiary", capSingle: 5_800, capJoint: 11_600, notes: "Per-taxpayer-per-beneficiary, indexed — verify current year." },
  ID: { kind: "deduction", basis: "per_taxpayer", capSingle: 6_000, capJoint: 12_000, notes: "IDeal only." },
  IL: { kind: "deduction", basis: "per_taxpayer", capSingle: 10_000, capJoint: 20_000, notes: "Bright Start/Bright Directions only." },
  IN: { kind: "credit", creditRate: 0.2, creditMaxSingle: 1_500, creditMaxJoint: 1_500, notes: "20% credit on contributions to Indiana529, max $1,500 ($750 MFS)." },
  KS: { kind: "deduction", basis: "per_beneficiary", capSingle: 3_000, capJoint: 6_000, notes: "Any state's plan (parity state)." },
  KY: NONE,
  LA: { kind: "deduction", basis: "per_beneficiary", capSingle: 2_400, capJoint: 4_800, notes: "START only; unlimited carryforward not modeled." },
  MA: { kind: "deduction", basis: "per_taxpayer", capSingle: 1_000, capJoint: 2_000, notes: "MA plans only." },
  MD: { kind: "deduction", basis: "per_beneficiary", capSingle: 2_500, capJoint: 5_000, notes: "Per-account-holder-per-beneficiary; 10-yr carryforward not modeled." },
  ME: NONE, // NextGen contributions no longer state-deductible — verify.
  MI: { kind: "deduction", basis: "per_taxpayer", capSingle: 5_000, capJoint: 10_000, notes: "MESP only; net of qualified withdrawals same-year not modeled." },
  MN: { kind: "deduction", basis: "per_taxpayer", capSingle: 1_500, capJoint: 3_000, notes: "Alternatively a credit for lower incomes — deduction modeled v1. Any state's plan." },
  MO: { kind: "deduction", basis: "per_taxpayer", capSingle: 8_000, capJoint: 16_000, notes: "Any state's plan (parity state)." },
  MS: { kind: "deduction", basis: "per_taxpayer", capSingle: 10_000, capJoint: 20_000, notes: "MACS/MPACT only." },
  MT: { kind: "deduction", basis: "per_taxpayer", capSingle: 3_000, capJoint: 6_000, notes: "Any state's plan (parity state)." },
  NC: NONE,
  ND: { kind: "deduction", basis: "per_taxpayer", capSingle: 5_000, capJoint: 10_000, notes: "College SAVE only." },
  NE: { kind: "deduction", basis: "per_taxpayer", capSingle: 10_000, capJoint: 10_000, notes: "$5,000 MFS — MFS not modeled." },
  NJ: { kind: "deduction", basis: "per_taxpayer", capSingle: 10_000, capJoint: 10_000, notes: "NJBEST; only at gross income ≤ $200k — AGI gate not modeled v1." },
  NM: { kind: "deduction", basis: "unlimited", notes: "Full deduction, NM plans." },
  NY: { kind: "deduction", basis: "per_taxpayer", capSingle: 5_000, capJoint: 10_000, notes: "NY 529 Direct/Advisor only." },
  OH: { kind: "deduction", basis: "per_beneficiary", capSingle: 4_000, capJoint: 4_000, notes: "CollegeAdvantage; unlimited carryforward not modeled." },
  OK: { kind: "deduction", basis: "per_taxpayer", capSingle: 10_000, capJoint: 20_000, notes: "OK 529 only; 5-yr carryforward not modeled." },
  OR: { kind: "credit", creditRate: 1, creditMaxSingle: 180, creditMaxJoint: 360, notes: "Income-tiered % (5-100%) simplified: flat max credit — refine later." },
  PA: { kind: "deduction", basis: "per_beneficiary", capSingle: 19_000, capJoint: 38_000, notes: "Cap = federal annual gift exclusion per beneficiary; any state's plan. Verify exclusion amount yearly." },
  RI: { kind: "deduction", basis: "per_taxpayer", capSingle: 500, capJoint: 1_000, notes: "CollegeBound Saver only." },
  SC: { kind: "deduction", basis: "unlimited", notes: "Future Scholar; fully deductible." },
  UT: { kind: "credit", creditRate: 0.0447, creditMaxSingle: 114, creditMaxJoint: 228, notes: "my529; per-qualified-beneficiary caps, indexed — verify current year." },
  VA: { kind: "deduction", basis: "per_beneficiary", capSingle: 4_000, capJoint: 4_000, notes: "Per-account $4k/yr with carryforward; unlimited at age 70+ not modeled." },
  VT: { kind: "credit", creditRate: 0.1, creditMaxSingle: 250, creditMaxJoint: 500, notes: "10% of first $2,500 per beneficiary (per filer)." },
  WI: { kind: "deduction", basis: "per_beneficiary", capSingle: 5_130, capJoint: 5_130, notes: "Edvest; per-beneficiary, indexed — verify current year." },
  WV: { kind: "deduction", basis: "unlimited", notes: "SMART529; fully deductible." },
};

/** No-income-tax states + any state missing from the table resolve to NONE. */
export function get529Rule(state: USPSStateCode): Plan529Rule {
  return PLAN_529_RULES_2026[state] ?? NONE;
}
