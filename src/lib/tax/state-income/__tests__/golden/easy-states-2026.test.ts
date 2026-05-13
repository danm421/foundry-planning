// src/lib/tax/state-income/__tests__/golden/easy-states-2026.test.ts
// Golden fixtures for easy-path 2026 states (flat-rate or bracket, FAGI-base, no SS/retirement).
// Profile: wage-earner, $120K AGI, single OR married_joint, age 45.
//
// Approach: hand-computed from the workbook data files (brackets-2026.ts,
// std-deductions.ts, exemptions.ts) with the bracket formula inlined here
// (not imported from applyBrackets). This means if the compute fn's math
// changes, the test will catch the regression.
//
// Inlined bracket formula:
//   tax = 0
//   for each tier: if taxable > tier.from, tax += (min(taxable, tier.to ?? ∞) - tier.from) × rate
//
// Workbook discrepancies noted vs. the plan's listed rates:
//   GA: workbook has 5.19% (not 5.39%)  — workbook is source of truth
//   IN: workbook has 2.95% (not 3.05%)  — workbook is source of truth
//   KY: workbook has 3.5% (not 4%)      — workbook is source of truth
//   KY: joint std deduction = 3360 (same as single, NOT doubled) per workbook note
//   NC: workbook has 3.99% (not 4.25%)  — workbook is source of truth
//   OH: compute fn uses row.single/joint exemption directly (2400/4800), NOT the
//       AGI-stepped values noted in exemptions.ts; test expects what the fn computes.

import { describe, it, expect } from "vitest";
import { computeStateIncomeTax } from "../../compute";
import type { USPSStateCode } from "@/lib/usps-states";
import type { FilingStatus } from "@/lib/tax/types";

const AGI = 120_000;

const BASE_FEDERAL_INCOME = {
  agi: AGI,
  taxableIncome: 100_000,
  ordinaryIncome: AGI,
  earnedIncome: AGI,
  dividends: 0,
  capitalGains: 0,
  taxableSocialSecurity: 0,
  taxExemptIncome: 0,
};

const BASE_RETIREMENT = { db: 0, ira: 0, k401: 0, annuity: 0 };

interface Case {
  state: USPSStateCode;
  filingStatus: FilingStatus;
  expected: number;
  math: string;
}

// ---------------------------------------------------------------------------
// Hand-computed cases
// All values derived from src/lib/tax/state-income/data/{brackets-2026,std-deductions,exemptions}.ts
// ---------------------------------------------------------------------------
const CASES: Case[] = [
  // ── AZ ──────────────────────────────────────────────────────────────────
  // stdDed single=8350  bracket: flat 2.5%  exemption: credit age65+ only (age 45 → 0)
  // taxable = 120000 − 8350 = 111650  →  111650 × 0.025 = 2791.25
  {
    state: "AZ",
    filingStatus: "single",
    expected: 2791.25,
    math: "(120_000 − 8_350) × 0.025 = 2_791.25",
  },
  // stdDed joint=16700  bracket: flat 2.5%  exemption: 0
  // taxable = 120000 − 16700 = 103300  →  103300 × 0.025 = 2582.50
  {
    state: "AZ",
    filingStatus: "married_joint",
    expected: 2582.5,
    math: "(120_000 − 16_700) × 0.025 = 2_582.50",
  },

  // ── IL ──────────────────────────────────────────────────────────────────
  // stdDed=0  bracket: flat 4.95%  exemption: 2925 single / 5850 joint (deduction)
  // single: taxable = 120000 − 0 − 2925 = 117075  →  117075 × 0.0495 = 5795.21
  {
    state: "IL",
    filingStatus: "single",
    expected: 5795.21,
    math: "(120_000 − 0 − 2_925) × 0.0495 = 5_795.2125",
  },
  // joint: taxable = 120000 − 0 − 5850 = 114150  →  114150 × 0.0495 = 5650.425
  {
    state: "IL",
    filingStatus: "married_joint",
    expected: 5650.425,
    math: "(120_000 − 0 − 5_850) × 0.0495 = 5_650.425",
  },

  // ── IN ──────────────────────────────────────────────────────────────────
  // Rate in workbook: 2.95% (plan says 3.05% — workbook wins)
  // stdDed=0  exemption: 1000 single / 2000 joint (deduction); age 45 → no 65+ add
  // single: taxable = 120000 − 0 − 1000 = 119000  →  119000 × 0.0295 = 3510.50
  {
    state: "IN",
    filingStatus: "single",
    expected: 3510.5,
    math: "(120_000 − 0 − 1_000) × 0.0295 = 3_510.50  [rate 2.95% per workbook]",
  },
  // joint: taxable = 120000 − 0 − 2000 = 118000  →  118000 × 0.0295 = 3481.00
  {
    state: "IN",
    filingStatus: "married_joint",
    expected: 3481.0,
    math: "(120_000 − 0 − 2_000) × 0.0295 = 3_481.00",
  },

  // ── KY ──────────────────────────────────────────────────────────────────
  // Rate in workbook: 3.5% (plan says 4% — workbook wins)
  // stdDed single=3360, joint=3360 (not doubled per workbook note)
  // exemption: type=none for age 45 (65+ credit only)
  // single: taxable = 120000 − 3360 = 116640  →  116640 × 0.035 = 4082.40
  {
    state: "KY",
    filingStatus: "single",
    expected: 4082.4,
    math: "(120_000 − 3_360) × 0.035 = 4_082.40  [rate 3.5%, joint stdDed same as single per workbook]",
  },
  // joint: stdDed=3360 (same)  →  taxable = 116640  →  4082.40
  {
    state: "KY",
    filingStatus: "married_joint",
    expected: 4082.4,
    math: "(120_000 − 3_360) × 0.035 = 4_082.40  [joint stdDed=3360, not doubled]",
  },

  // ── MA ──────────────────────────────────────────────────────────────────
  // stdDed=0  bracket: [0, 1083150) @ 5%  exemption: 4400 single / 8800 joint (deduction)
  // single: taxable = 120000 − 0 − 4400 = 115600  →  115600 × 0.05 = 5780.00
  {
    state: "MA",
    filingStatus: "single",
    expected: 5780.0,
    math: "(120_000 − 0 − 4_400) × 0.05 = 5_780.00",
  },
  // joint: taxable = 120000 − 0 − 8800 = 111200  →  111200 × 0.05 = 5560.00
  {
    state: "MA",
    filingStatus: "married_joint",
    expected: 5560.0,
    math: "(120_000 − 0 − 8_800) × 0.05 = 5_560.00",
  },

  // ── MI ──────────────────────────────────────────────────────────────────
  // stdDed=0  bracket: flat 4.25%  exemption: 5900 single / 11800 joint (deduction)
  // single: taxable = 120000 − 0 − 5900 = 114100  →  114100 × 0.0425 = 4849.25
  {
    state: "MI",
    filingStatus: "single",
    expected: 4849.25,
    math: "(120_000 − 0 − 5_900) × 0.0425 = 4_849.25",
  },
  // joint: taxable = 120000 − 0 − 11800 = 108200  →  108200 × 0.0425 = 4598.50
  {
    state: "MI",
    filingStatus: "married_joint",
    expected: 4598.5,
    math: "(120_000 − 0 − 11_800) × 0.0425 = 4_598.50",
  },

  // ── MS ──────────────────────────────────────────────────────────────────
  // stdDed single=2300  bracket: {from:10000, to:null, rate:0.04}
  // exemption: 6000 single / 12000 joint (deduction)
  // single: taxable = 120000 − 2300 − 6000 = 111700
  //   slice = 111700 − 10000 = 101700  →  101700 × 0.04 = 4068.00
  {
    state: "MS",
    filingStatus: "single",
    expected: 4068.0,
    math: "taxable=111_700; (111_700 − 10_000) × 0.04 = 4_068.00",
  },
  // joint: stdDed=4600  taxable = 120000 − 4600 − 12000 = 103400
  //   slice = 103400 − 10000 = 93400  →  93400 × 0.04 = 3736.00
  {
    state: "MS",
    filingStatus: "married_joint",
    expected: 3736.0,
    math: "taxable=103_400; (103_400 − 10_000) × 0.04 = 3_736.00",
  },

  // ── NC ──────────────────────────────────────────────────────────────────
  // Rate in workbook: 3.99% (plan says 4.25% — workbook wins)
  // stdDed single=12750  exemption: type=none
  // single: taxable = 120000 − 12750 = 107250  →  107250 × 0.0399 = 4279.275
  {
    state: "NC",
    filingStatus: "single",
    expected: 4279.275,
    math: "(120_000 − 12_750) × 0.0399 = 4_279.275  [rate 3.99% per workbook]",
  },
  // joint: stdDed=25500  taxable = 120000 − 25500 = 94500  →  94500 × 0.0399 = 3770.55
  {
    state: "NC",
    filingStatus: "married_joint",
    expected: 3770.55,
    math: "(120_000 − 25_500) × 0.0399 = 3_770.55",
  },

  // ── PA ──────────────────────────────────────────────────────────────────
  // stdDed=0  bracket: flat 3.07%  exemption: type=none
  // taxable = 120000  →  120000 × 0.0307 = 3684.00
  {
    state: "PA",
    filingStatus: "single",
    expected: 3684.0,
    math: "120_000 × 0.0307 = 3_684.00",
  },
  {
    state: "PA",
    filingStatus: "married_joint",
    expected: 3684.0,
    math: "120_000 × 0.0307 = 3_684.00",
  },

  // ── UT ──────────────────────────────────────────────────────────────────
  // stdDed=0  bracket: flat 4.5%  exemption: type=none (std-ded-as-credit not in Section A)
  // taxable = 120000  →  120000 × 0.045 = 5400.00
  {
    state: "UT",
    filingStatus: "single",
    expected: 5400.0,
    math: "120_000 × 0.045 = 5_400.00",
  },
  {
    state: "UT",
    filingStatus: "married_joint",
    expected: 5400.0,
    math: "120_000 × 0.045 = 5_400.00",
  },

  // ── ID ──────────────────────────────────────────────────────────────────
  // stdDed single=16100  bracket: {from:4811, to:null, rate:0.053}  exemption: none
  // single: taxable = 120000 − 16100 = 103900
  //   slice = 103900 − 4811 = 99089  →  99089 × 0.053 = 5251.717
  {
    state: "ID",
    filingStatus: "single",
    expected: 5251.72,
    math: "taxable=103_900; (103_900 − 4_811) × 0.053 = 5_251.717",
  },
  // joint: stdDed=32200  taxable = 120000 − 32200 = 87800
  //   bracket from=9622  slice = 87800 − 9622 = 78178  →  78178 × 0.053 = 4143.434
  {
    state: "ID",
    filingStatus: "married_joint",
    expected: 4143.43,
    math: "taxable=87_800; (87_800 − 9_622) × 0.053 = 4_143.434",
  },

  // ── OH ──────────────────────────────────────────────────────────────────
  // stdDed=0  bracket: {from:26050, to:null, rate:0.0275}
  // exemption: deduction 2400 single / 4800 joint (compute fn uses row values directly;
  //   actual law steps down to 1900/3800 at $120K AGI, but Section A does not implement
  //   the step-down — test locks the current compute-fn behavior)
  // single: taxable = 120000 − 0 − 2400 = 117600
  //   slice = 117600 − 26050 = 91550  →  91550 × 0.0275 = 2517.625
  {
    state: "OH",
    filingStatus: "single",
    expected: 2517.625,
    math: "taxable=117_600; (117_600 − 26_050) × 0.0275 = 2_517.625  [exemption=2400, pre-step-down]",
  },
  // joint: taxable = 120000 − 0 − 4800 = 115200
  //   slice = 115200 − 26050 = 89150  →  89150 × 0.0275 = 2451.625
  {
    state: "OH",
    filingStatus: "married_joint",
    expected: 2451.625,
    math: "taxable=115_200; (115_200 − 26_050) × 0.0275 = 2_451.625  [exemption=4800, pre-step-down]",
  },

  // ── VA ──────────────────────────────────────────────────────────────────
  // stdDed single=8750  exemption: 930 single / 1860 joint (deduction)
  // brackets: [0,3000)@2%, [3000,5000)@3%, [5000,17000)@5%, [17000,∞)@5.75%
  // single: taxable = 120000 − 8750 − 930 = 110320
  //   tier1: 3000 × 0.02 = 60
  //   tier2: (5000−3000) × 0.03 = 60
  //   tier3: (17000−5000) × 0.05 = 600
  //   tier4: (110320−17000) × 0.0575 = 93320 × 0.0575 = 5365.90
  //   total = 60 + 60 + 600 + 5365.90 = 6085.90
  {
    state: "VA",
    filingStatus: "single",
    expected: 6085.9,
    math: "taxable=110_320; 3000×0.02 + 2000×0.03 + 12000×0.05 + 93320×0.0575 = 6_085.90",
  },
  // joint: stdDed=17500  exemption=1860  taxable = 120000 − 17500 − 1860 = 100640
  //   tier1: 3000 × 0.02 = 60
  //   tier2: 2000 × 0.03 = 60
  //   tier3: 12000 × 0.05 = 600
  //   tier4: (100640−17000) × 0.0575 = 83640 × 0.0575 = 4809.30
  //   total = 60 + 60 + 600 + 4809.30 = 5529.30
  {
    state: "VA",
    filingStatus: "married_joint",
    expected: 5529.3,
    math: "taxable=100_640; 3000×0.02 + 2000×0.03 + 12000×0.05 + 83640×0.0575 = 5_529.30",
  },

  // ── GA ──────────────────────────────────────────────────────────────────
  // Rate in workbook: 5.19% (plan says 5.39% — workbook wins)
  // stdDed single=12000  bracket: flat 5.19%  exemption: type=exemption, single=0, joint=0
  //   (GA has no personal exemption — only dependent; age 45 no dependents assumed)
  // single: taxable = 120000 − 12000 − 0 = 108000  →  108000 × 0.0519 = 5605.20
  {
    state: "GA",
    filingStatus: "single",
    expected: 5605.2,
    math: "(120_000 − 12_000) × 0.0519 = 5_605.20  [rate 5.19% per workbook, not 5.39%]",
  },
  // joint: stdDed=24000  taxable = 120000 − 24000 = 96000  →  96000 × 0.0519 = 4982.40
  {
    state: "GA",
    filingStatus: "married_joint",
    expected: 4982.4,
    math: "(120_000 − 24_000) × 0.0519 = 4_982.40",
  },

  // ── LA ──────────────────────────────────────────────────────────────────
  // stdDed single=12875  bracket: flat 3%  exemption: type=none (replaced by combined std ded)
  // single: taxable = 120000 − 12875 = 107125  →  107125 × 0.03 = 3213.75
  {
    state: "LA",
    filingStatus: "single",
    expected: 3213.75,
    math: "(120_000 − 12_875) × 0.03 = 3_213.75",
  },
  // joint: stdDed=25750  taxable = 120000 − 25750 = 94250  →  94250 × 0.03 = 2827.50
  {
    state: "LA",
    filingStatus: "married_joint",
    expected: 2827.5,
    math: "(120_000 − 25_750) × 0.03 = 2_827.50",
  },
];

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------
describe("easy-states 2026 golden", () => {
  it.each(CASES)(
    "$state $filingStatus → $expected",
    ({ state, filingStatus, expected }) => {
      const r = computeStateIncomeTax({
        state,
        year: 2026,
        filingStatus,
        primaryAge: 45,
        federalIncome: BASE_FEDERAL_INCOME,
        retirementBreakdown: BASE_RETIREMENT,
        preTaxContrib: 0,
        fallbackFlatRate: 0,
      });
      expect(r.stateTax).toBeCloseTo(expected, 2);
    },
  );
});
