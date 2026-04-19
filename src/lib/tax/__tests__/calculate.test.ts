import { describe, it, expect } from "vitest";
import { calculateTaxYear } from "../calculate";
import { calcTaxableSocialSecurity } from "../ssTaxability";
import type { CalcInput, TaxYearParameters } from "../types";

// Reuse 2026 MFJ params from resolver test, adapted as a complete row.
function params2026(): TaxYearParameters {
  return {
    year: 2026,
    incomeBrackets: {
      married_joint: [
        { from: 0, to: 24800, rate: 0.10 },
        { from: 24800, to: 100800, rate: 0.12 },
        { from: 100800, to: 211950, rate: 0.22 },
        { from: 211950, to: 405000, rate: 0.24 },
        { from: 405000, to: 510400, rate: 0.32 },
        { from: 510400, to: 768700, rate: 0.35 },
        { from: 768700, to: null, rate: 0.37 },
      ],
      single: [
        { from: 0, to: 12400, rate: 0.10 },
        { from: 12400, to: 50400, rate: 0.12 },
        { from: 50400, to: 105700, rate: 0.22 },
        { from: 105700, to: 201775, rate: 0.24 },
        { from: 201775, to: 255350, rate: 0.32 },
        { from: 255350, to: 640600, rate: 0.35 },
        { from: 640600, to: null, rate: 0.37 },
      ],
      head_of_household: [
        { from: 0, to: 17700, rate: 0.10 },
        { from: 17700, to: 67450, rate: 0.12 },
        { from: 67450, to: 105700, rate: 0.22 },
        { from: 105700, to: 201750, rate: 0.24 },
        { from: 201750, to: 256200, rate: 0.32 },
        { from: 256200, to: 640600, rate: 0.35 },
        { from: 640600, to: null, rate: 0.37 },
      ],
      married_separate: [
        { from: 0, to: 12400, rate: 0.10 },
        { from: 12400, to: 50400, rate: 0.12 },
        { from: 50400, to: 105875, rate: 0.22 },
        { from: 105875, to: 201775, rate: 0.24 },
        { from: 201775, to: 255350, rate: 0.32 },
        { from: 255350, to: 384350, rate: 0.35 },
        { from: 384350, to: null, rate: 0.37 },
      ],
    },
    capGainsBrackets: {
      married_joint: { zeroPctTop: 99200, fifteenPctTop: 615900 },
      single: { zeroPctTop: 49600, fifteenPctTop: 547500 },
      head_of_household: { zeroPctTop: 66450, fifteenPctTop: 581550 },
      married_separate: { zeroPctTop: 49600, fifteenPctTop: 307950 },
    },
    stdDeduction: { married_joint: 32200, single: 16100, head_of_household: 24150, married_separate: 16100 },
    amtExemption: { mfj: 140200, singleHoh: 90100, mfs: 70100 },
    amtBreakpoint2628: { mfjShoh: 244500, mfs: 122250 },
    amtPhaseoutStart: { mfj: 1000000, singleHoh: 500000, mfs: 500000 },
    ssTaxRate: 0.062,
    ssWageBase: 184500,
    medicareTaxRate: 0.0145,
    addlMedicareRate: 0.009,
    addlMedicareThreshold: { mfj: 250000, single: 200000, mfs: 125000 },
    niitRate: 0.038,
    niitThreshold: { mfj: 250000, single: 200000, mfs: 125000 },
    qbi: { thresholdMfj: 405000, thresholdSingleHohMfs: 201775, phaseInRangeMfj: 150000, phaseInRangeOther: 75000 },
    contribLimits: {
      ira401kElective: 24500, ira401kCatchup50: 8000, ira401kCatchup6063: 11250,
      iraTradLimit: 7500, iraCatchup50: 1100,
      simpleLimitRegular: 17000, simpleCatchup50: 4000,
      hsaLimitSelf: 4400, hsaLimitFamily: 8750, hsaCatchup55: 1000,
    },
  };
}

function makeInput(overrides: Partial<CalcInput>): CalcInput {
  return {
    year: 2026,
    filingStatus: "married_joint",
    earnedIncome: 0,
    ordinaryIncome: 0,
    qualifiedDividends: 0,
    longTermCapitalGains: 0,
    shortTermCapitalGains: 0,
    qbiIncome: 0,
    taxExemptIncome: 0,
    socialSecurityGross: 0,
    aboveLineDeductions: 0,
    itemizedDeductions: 0,
    flatStateRate: 0,
    taxParams: params2026(),
    inflationFactor: 1.0,
    ...overrides,
  };
}

describe("calculateTaxYear — Scenario 1: MFJ retirees", () => {
  // $80k SS + $40k IRA + $10k LTCG, 2026, no state tax
  const result = calculateTaxYear(makeInput({
    socialSecurityGross: 80000,
    ordinaryIncome: 40000,         // IRA distribution
    longTermCapitalGains: 10000,
    flatStateRate: 0,
  }));

  it("computes taxable SS (combined 50000 + 40000 + 10000 = 90000 → 85% capped)", () => {
    // Combined = ordinary + LTCG + 0.5×SS = 40000 + 10000 + 40000 = 90000
    // > base2 44000 → 85% taxable: tier1=6000 + tier2=85% × (90000-44000)=39100 → 45100
    // Capped at 85% × 80000 = 68000 → taxable SS = 45100
    expect(result.income.taxableSocialSecurity).toBeCloseTo(45100, 0);
  });

  it("places LTCG entirely in 0% bracket (stacked top under 99200)", () => {
    expect(result.flow.capitalGainsTax).toBe(0);
  });

  it("computes a small federal tax", () => {
    // Total income = 40000 + 10000 + 45100 = 95100
    // AGI = 95100, std ded MFJ = 32200
    // Taxable income = 62900; income tax base = 62900 - 10000 = 52900
    // Brackets MFJ: 24800×0.10 + (52900-24800)×0.12 = 2480 + 3372 = 5852
    expect(result.flow.regularTaxCalc).toBeCloseTo(5852, 0);
    expect(result.flow.regularFederalIncomeTax).toBeCloseTo(5852, 0);
  });

  it("has no AMT, NIIT, or QBI", () => {
    expect(result.flow.amtAdditional).toBe(0);
    expect(result.flow.niit).toBe(0);
    expect(result.flow.qbiDeduction).toBe(0);
  });
});

describe("calculateTaxYear — Scenario 2: MFJ working couple", () => {
  // $300k W-2 + $50k qual div + $20k LTCG, 2026
  const result = calculateTaxYear(makeInput({
    earnedIncome: 300000,
    qualifiedDividends: 50000,
    longTermCapitalGains: 20000,
    flatStateRate: 0.05,
  }));

  it("triggers NIIT on investment income above MFJ threshold", () => {
    // MAGI = 300000 + 50000 + 20000 = 370000 → excess = 120000
    // Investment income = 70000 → NIIT = 70000 × 3.8% = 2660
    expect(result.flow.niit).toBeCloseTo(2660, 0);
  });

  it("computes additional Medicare on earned income above $250k", () => {
    // (300000 - 250000) × 0.9% = 450
    expect(result.flow.additionalMedicare).toBeCloseTo(450, 0);
  });

  it("applies LTCG/qual div at 15% (above 99200 0% top)", () => {
    // Ordinary base: 300000 - 32200 = 267800. Cap gains stack on top.
    // (50000 + 20000) × 15% = 10500 (all within 15% bracket since stack top = 337800 < 615900)
    expect(result.flow.capitalGainsTax).toBeCloseTo(10500, 0);
  });
});

describe("calculateTaxYear — Scenario 3: HNW HoH", () => {
  // $1.5M ordinary + $500k LTCG, 2026
  const result = calculateTaxYear(makeInput({
    filingStatus: "head_of_household",
    ordinaryIncome: 1500000,
    longTermCapitalGains: 500000,
    flatStateRate: 0,
  }));

  it("hits top federal bracket on ordinary", () => {
    // AGI 2000000, std HoH 24150, taxable 1975850
    // Income tax base = 1975850 - 500000 = 1475850 (HoH brackets)
    // HoH brackets: 17700×0.10 + (67450-17700)×0.12 + (105700-67450)×0.22 + (201750-105700)×0.24
    //   + (256200-201750)×0.32 + (640600-256200)×0.35 + (1475850-640600)×0.37
    // = 1770 + 5970 + 8415 + 23052 + 17424 + 134540 + 309042.5 = 500213.5
    expect(result.flow.regularTaxCalc).toBeCloseTo(500214, 0);
  });

  it("applies LTCG mostly at 20% (above 581550 fifteen top after stacking)", () => {
    // Ordinary base 1475850; cap gains 500000 stacks on top
    // 15% covers (581550 - 1475850) = negative → 0 in 15%
    // 20% covers all 500000 → 100000
    expect(result.flow.capitalGainsTax).toBeCloseTo(100000, 0);
  });

  it("applies full NIIT (3.8% × 500000 since LTCG = 500k, MAGI excess = 1750000)", () => {
    expect(result.flow.niit).toBeCloseTo(19000, 0);
  });
});

describe("calculateTaxYear — Scenario 4: Single retiree, low income", () => {
  const result = calculateTaxYear(makeInput({
    filingStatus: "single",
    socialSecurityGross: 30000,
    ordinaryIncome: 20000,
    qualifiedDividends: 5000,
    flatStateRate: 0,
  }));

  it("computes partial SS taxability", () => {
    // Combined = 20000 + 5000 + 15000 = 40000 (single)
    // base1 25000, base2 34000 → > base2
    // tier1 = min(50% × 9000, 50% × 30000) = 4500
    // tier2 = 85% × (40000-34000) = 5100
    // Sum 9600, cap 25500 → 9600
    expect(result.income.taxableSocialSecurity).toBeCloseTo(9600, 0);
  });

  it("results in low or zero federal tax (likely under standard deduction)", () => {
    // AGI = 20000 + 5000 + 9600 = 34600, std single 16100, taxable = 18500
    // Income tax base = 18500 - 5000 = 13500 (qual div separately)
    // Brackets single: 12400×0.10 + (13500-12400)×0.12 = 1240 + 132 = 1372
    expect(result.flow.regularTaxCalc).toBeCloseTo(1372, 0);
  });
});

describe("calculateTaxYear — Scenario 5: MFJ small business with QBI", () => {
  const result = calculateTaxYear(makeInput({
    earnedIncome: 80000,
    qbiIncome: 200000,
    flatStateRate: 0,
  }));

  it("computes QBI deduction (under threshold)", () => {
    // AGI = 280000, std 32200, taxable before QBI = 247800
    // 247800 < threshold 405000 → full 20% × 200000 = 40000
    // Cap = 20% × (247800 - 0) = 49560 → no cap binds
    expect(result.flow.qbiDeduction).toBe(40000);
  });

  it("reduces taxable income by the QBI deduction", () => {
    // Taxable = 247800 - 40000 = 207800
    expect(result.flow.taxableIncome).toBeCloseTo(207800, 0);
  });
});

describe("calculateTaxYear — Scenario 6: MFJ day trader with STCG (NIIT regression)", () => {
  // $100k earned + $200k STCG, no state tax
  // Verifies IRC §1411(c)(1)(A)(iii): STCG counts as net investment income for NIIT
  const result = calculateTaxYear(makeInput({
    earnedIncome: 100000,
    shortTermCapitalGains: 200000,
    flatStateRate: 0,
  }));

  it("includes STCG in NIIT investment income per IRC §1411", () => {
    // MAGI = 100000 + 200000 = 300000, threshold MFJ = 250000, excess = 50000
    // Investment income = 200000 (STCG), cap at min(200000, 50000) = 50000
    // NIIT = 50000 × 3.8% = 1900
    expect(result.flow.niit).toBeCloseTo(1900, 0);
  });

  it("taxes STCG at ordinary rates in the federal bracket calc", () => {
    // AGI = 300000, std MFJ = 32200, taxable = 267800
    // No LTCG or qual div → full 267800 taxed at ordinary brackets
    // MFJ brackets: 24800×0.10 + (100800-24800)×0.12 + (211950-100800)×0.22
    //             + (267800-211950)×0.24
    // = 2480 + 9120 + 24453 + 13404 = 49457
    expect(Math.round(result.flow.regularTaxCalc)).toBe(49457);
  });
});

describe("calcTaxableSocialSecurity — pia_at_fra-derived gross integration", () => {
  it("treats pia_at_fra-derived gross identically to manual gross", () => {
    // Use an SS gross that corresponds to Client PIA 2000/mo × 12 × 0.70 (claim-62/FRA-67)
    // = $16,800/yr. Other income $50,000. Filing MFJ.
    const input = { ssGross: 16800, otherIncome: 50000, taxExemptInterest: 0, filingStatus: "married_joint" as const };
    const taxable = calcTaxableSocialSecurity(input);
    // Combined = 50000 + 8400 + 0 = 58400. Above 44000, so tier2 math.
    // tier1 = min(6000, 8400) = 6000, tier2 = 0.85 × (58400 − 44000) = 12240
    // total = 18240, cap = 0.85 × 16800 = 14280 → 14280
    expect(taxable).toBeCloseTo(14280, 2);
  });
});
