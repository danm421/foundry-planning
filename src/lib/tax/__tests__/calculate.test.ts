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
    trustIncomeBrackets: [],
    trustCapGainsBrackets: [],
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
    rothPhaseout: { startMfj: null, endMfj: null, startSingle: null, endSingle: null },
    iraDeduct: { coveredStartMfj: null, coveredEndMfj: null, coveredStartSingle: null,
                 coveredEndSingle: null, spousalStartMfj: null, spousalEndMfj: null },
    studentLoan: { maxDeduction: null, startMfj: null, endMfj: null, startSingle: null, endSingle: null },
    ctc: { perChild: null, refundableMax: null, odcPerDependent: null },
    saversCredit: { mfj: [], single: [], hoh: [] },
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

  it("M5: echoes qbiIncome back on income.qbi", () => {
    expect(result.income.qbi).toBe(200000);
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

describe("calculateTaxYear — preferential base capped at taxable income (Bug #4/#5)", () => {
  // Per the Qualified Dividends & Capital Gain Tax Worksheet, the amount taxed at
  // preferential 0/15/20% rates is min(net cap gain + qual div, taxable income).
  // When below-line deductions (or QBI) exceed ordinary income, the spilled-over
  // deduction reduces the preferentially-taxed gain — it is NOT taxed.
  it("taxes only min(gains, taxableIncome) when deductions spill into the gain", () => {
    // MFJ 2026, ordinary 0, LTCG 150000, std deduction 32200.
    //   taxableIncome = 150000 - 32200 = 117800
    //   incomeTaxBase  = max(0, 117800 - 150000) = 0  (stacking floor)
    //   preferential base = min(150000, 117800) = 117800
    //   0% covers 99200, 15% covers 117800-99200=18600 → 18600×0.15 = 2790
    // (Unclamped/buggy: 150000 gain → 15% on 150000-99200=50800 → 7620.)
    const result = calculateTaxYear(makeInput({
      longTermCapitalGains: 150_000,
      flatStateRate: 0,
    }));
    expect(result.flow.capitalGainsTax).toBeCloseTo(2790, 0);
  });

  it("keeps the invariant incomeTaxBase + preferentialBase == taxableIncome (partial spill)", () => {
    // MFJ 2026, ordinary 10000, LTCG 150000, std 32200.
    //   taxableIncome = 160000 - 32200 = 127800; incomeTaxBase = max(0,127800-150000)=0
    //   preferential base = min(150000, 127800) = 127800
    //   0% covers 99200, 15% on 127800-99200=28600 → 4290
    const result = calculateTaxYear(makeInput({
      ordinaryIncome: 10_000,
      longTermCapitalGains: 150_000,
      flatStateRate: 0,
    }));
    expect(result.flow.capitalGainsTax).toBeCloseTo(4290, 0);
  });
});

describe("calculateTaxYear — §199A QBI deduction flows through to AMTI (Bug #6)", () => {
  // IRC §199A(f)(2): the QBI deduction IS allowed for AMT. Form 6251 line 1 begins
  // from Form 1040 taxable income, which is already net of QBI. So AMTI must be
  // built from post-QBI taxableIncome, not taxableIncomeBeforeQbi.
  it("reduces tentative AMT by 26% of the QBI deduction when AMT binds below the 28% breakpoint", () => {
    // MFJ 2026, earned 100000, QBI income 200000, ISO spread 60000.
    //   AGI 300000, std 32200, taxableIncomeBeforeQbi = 267800
    //   QBI deduction = 20% × 200000 = 40000 (under threshold)
    //   taxableIncome = 227800; incomeTaxBase = 227800 (no gains)
    //   regularTax = 2480+9120+24453+3804 = 39857
    //   stdDeductionAddBack = 32200
    //   Fixed AMTI = 227800 + 32200 + 60000 = 320000; taxableAmti = 320000-140200 = 179800 (<244500)
    //     TMT = 179800 × 0.26 = 46748 → amtAdditional = 46748 - 39857 = 6891
    //   Buggy AMTI = 267800 + 32200 + 60000 = 360000; taxableAmti = 219800
    //     TMT = 219800 × 0.26 = 57148 → amtAdditional = 17291 (overstated by 26%×40000 = 10400)
    const result = calculateTaxYear(makeInput({
      earnedIncome: 100_000,
      qbiIncome: 200_000,
      isoSpread: 60_000,
      flatStateRate: 0,
    }));
    expect(result.flow.qbiDeduction).toBe(40_000);
    expect(result.flow.amtAdditional).toBeCloseTo(6891, 0);
  });
});

describe("calculateTaxYear — SS §86 uses muni interest only, not the broad bucket (Bug #11)", () => {
  // IRC §86(b)(2)(B) / Pub 915: only tax-exempt INTEREST (Form 1040 line 2a) enters
  // the combined-income test. Non-interest non-taxable receipts (Roth-equivalent /
  // return-of-capital / non-taxable business pass-through) must NOT inflate it.
  it("excludes broad taxExemptIncome from combined income when taxExemptInterest is supplied", () => {
    // MFJ 2026, SS 40000, ordinary 30000, taxExemptIncome 50000 (non-muni), taxExemptInterest 0.
    //   otherIncomeForSs = 30000
    //   Fixed combined = 30000 + 0.5×40000 + 0 = 50000 (> base2 44000)
    //     taxable = 6000 + 0.85×(50000-44000) = 6000 + 5100 = 11100
    //   Buggy combined = 30000 + 20000 + 50000 = 100000 → taxable capped at 0.85×40000 = 34000
    const result = calculateTaxYear(makeInput({
      socialSecurityGross: 40_000,
      ordinaryIncome: 30_000,
      taxExemptIncome: 50_000,
      taxExemptInterest: 0,
      flatStateRate: 0,
    }));
    expect(result.income.taxableSocialSecurity).toBeCloseTo(11100, 0);
  });

  it("falls back to taxExemptIncome when taxExemptInterest is omitted (back-compat)", () => {
    // Same inputs but no taxExemptInterest field → old behaviour: 50000 treated as muni.
    const result = calculateTaxYear(makeInput({
      socialSecurityGross: 40_000,
      ordinaryIncome: 30_000,
      taxExemptIncome: 50_000,
      flatStateRate: 0,
    }));
    expect(result.income.taxableSocialSecurity).toBeCloseTo(34000, 0);
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

describe("calculateTaxYear — AMTI std-deduction add-back (Form 6251 line 2a)", () => {
  // Bug #9: the standard deduction is NOT allowed for AMT (IRC §56(b)(1)(E)) and
  // must be added back into AMTI. A standard-deduction filer's tentative minimum
  // tax should therefore be computed on AMTI that includes the std deduction.
  //
  // Single, $250k ordinary, no LTCG. std 16100, exemption 90100, phaseout starts
  // at 500000 (no phaseout). 244500 breakpoint not crossed → 26% only.
  //   Buggy AMTI = 250000 - 16100 = 233900 → taxable 143800 → TMT 37388
  //   Fixed AMTI = 250000           → taxable 159900 → TMT 41574
  //
  // Regular tax surfaces tentative AMT only via amtAdditional = max(0, TMT -
  // regularTax). Regular single tax on 233900:
  //   12400*.10 + (50400-12400)*.12 + (105700-50400)*.22 + (201775-105700)*.24
  //   + (233900-201775)*.32 = 1240+4560+12166+23058+10280 = 51304
  // Both TMTs are below 51304, so a no-ISO case yields amtAdditional 0 either
  // way. To make the add-back load-bearing, add an ISO spread sized so the FIXED
  // AMTI tips past regular tax while the BUGGY AMTI does not.
  it("add-back raises tentative AMT past regular tax with an ISO spread the buggy AMTI would miss", () => {
    // ISO spread 50000.
    //   Fixed: AMTI 250000+50000=300000 → taxable 209900 → TMT 54574 > 51304
    //          → amtAdditional = 54574 - 51304 = 3270
    //   Buggy: AMTI 233900+50000=283900 → taxable 193800 → TMT 50388 < 51304
    //          → amtAdditional 0
    const withIso = calculateTaxYear(makeInput({
      filingStatus: "single",
      ordinaryIncome: 250_000,
      isoSpread: 50_000,
      flatStateRate: 0,
    }));
    expect(withIso.flow.amtAdditional).toBeGreaterThan(0);
    expect(withIso.flow.amtAdditional).toBeCloseTo(54_574 - 51_304, 0);
  });
});

describe("calculateTaxYear — AMT Part III stacks LTCG on the regular base (Bug #19)", () => {
  // Form 6251 Part III computes preferential amounts off the regular Schedule D
  // worksheet — gains stack on the same regular ordinary base (incomeTaxBase)
  // used by the regular cap-gains tax, NOT the reduced post-exemption AMTI
  // ordinary portion. Stacking on the AMTI ordinary portion (which the large AMT
  // exemption pushes below the 0% cap-gains top) mis-prices gains at 0% and
  // understates TMT.
  //
  // MFJ, ordinary 150000, LTCG 30000, ISO 50000, no state tax.
  //   AGI 180000, std 32200, taxable-before-qbi 147800.
  //   incomeTaxBase = 147800 - 30000 = 117800  (> 0% top 99200).
  //   regularTax = 15340, regular capGainsTax = 30000×15% = 4500.
  //   AMTI = 147800 + 32200 (std add-back) + 50000 (ISO) = 230000.
  //   taxableAmti = 230000 - 140200 = 89800; ltcg 30000; ordinaryAmti 59800.
  //   ordinary portion 26% = 15548.
  //   Buggy floor = ordinaryAmti 59800 → stack top 89800 < 99200 → gains at 0%
  //     → TMT 15548 < regular+cap 19840 → amtAdditional 0.
  //   Fixed floor = incomeTaxBase 117800 → gains at 15% = 4500
  //     → TMT 20048 > 19840 → amtAdditional 208.
  const result = calculateTaxYear(makeInput({
    filingStatus: "married_joint",
    ordinaryIncome: 150_000,
    longTermCapitalGains: 30_000,
    isoSpread: 50_000,
    flatStateRate: 0,
  }));

  it("places AMT LTCG in the 15% bracket via the regular ordinary base, raising TMT", () => {
    expect(result.flow.amtAdditional).toBeGreaterThan(0);
    expect(result.flow.amtAdditional).toBeCloseTo(208, 0);
  });
});

describe("calculateTaxYear — F12 §63(f) additional standard deduction", () => {
  // IRC §63(f): a 65+ taxpayer (or spouse) on the STANDARD path gets an extra
  // standard-deduction box ($1,650/box married, $2,050/box unmarried for 2026 per
  // Rev. Proc. 2025-32). This engine's belowLineDeductions reports the FULL
  // standard deduction (base + §63(f)), so for a senior std filer it rises by the
  // §63(f) amount AND taxableIncome falls by the same amount.
  it("MFJ both 65+ standard filer: +$3,300 std deduction, -$3,300 taxable income", () => {
    // year 2029 so the OBBBA bonus (which also cuts taxable income) doesn't muddy
    // the §63(f)-only delta. 2 boxes × $1,650 = $3,300.
    const base = makeInput({ year: 2029, ordinaryIncome: 120_000, primaryAge: 70, spouseAge: 70 });
    const young = calculateTaxYear({ ...base, primaryAge: 60, spouseAge: 60 });
    const old = calculateTaxYear(base);
    // §63(f) flows into belowLineDeductions (engine reports the full standard ded).
    expect(old.flow.belowLineDeductions - young.flow.belowLineDeductions).toBe(3300);
    // taxableIncome lower by the same $3,300.
    expect(young.flow.taxableIncome - old.flow.taxableIncome).toBe(3300);
    // Hand check: AGI 120000, std MFJ 32200 + 3300 = 35500 → taxable 84500.
    expect(old.flow.taxableIncome).toBe(84500);
    expect(young.flow.taxableIncome).toBe(87800); // 120000 - 32200
  });

  it("single 65+ standard filer: +$2,050 std deduction", () => {
    const base = makeInput({ year: 2029, filingStatus: "single", ordinaryIncome: 80_000, primaryAge: 67 });
    const young = calculateTaxYear({ ...base, primaryAge: 60 });
    const old = calculateTaxYear(base);
    expect(old.flow.belowLineDeductions - young.flow.belowLineDeductions).toBe(2050);
    expect(young.flow.taxableIncome - old.flow.taxableIncome).toBe(2050);
  });

  it("does not augment when the filer ITEMIZES above the augmented standard", () => {
    // Itemized 50000 > std 32200+3300 → itemized wins; §63(f) does not stack on it.
    const base = makeInput({ year: 2029, ordinaryIncome: 120_000, itemizedDeductions: 50_000 });
    const young = calculateTaxYear({ ...base, primaryAge: 60, spouseAge: 60 });
    const old = calculateTaxYear({ ...base, primaryAge: 70, spouseAge: 70 });
    expect(old.flow.belowLineDeductions).toBe(50_000);
    expect(old.flow.taxableIncome).toBe(young.flow.taxableIncome); // identical — itemized path
  });
});

describe("calculateTaxYear — F12 AMT add-back of the augmented standard deduction", () => {
  // The standard deduction (incl. §63(f) add-on) is disallowed for AMT
  // (IRC §56(b)(1)(E)) and must be added back to AMTI. A senior std filer's
  // taxableIncome drops by §63(f) and so does regular tax — but the AMT add-back
  // rises by the same §63(f) amount, leaving AMTI (hence tentative minimum tax)
  // UNCHANGED vs an otherwise-identical younger filer. Since flow doesn't expose
  // AMTI/TMT directly, we prove AMTI is flat via the identity:
  //   amtAdditional = TMT − regularTax, TMT constant ⇒
  //   Δ amtAdditional = −Δ regularTax  (senior's lower regular tax ⇒ higher add'l AMT).
  it("adds the augmented std deduction back to AMTI (TMT held flat across ages)", () => {
    // year 2029 → no OBBBA bonus to perturb taxableIncome differently from AMTI.
    const base = makeInput({
      year: 2029, filingStatus: "single", ordinaryIncome: 250_000,
      isoSpread: 50_000, flatStateRate: 0,
    });
    const young = calculateTaxYear({ ...base, primaryAge: 60 });
    const old = calculateTaxYear({ ...base, primaryAge: 67 });
    // Senior gets +$2,050 std ded → taxableIncome and regular tax both lower.
    expect(young.flow.taxableIncome - old.flow.taxableIncome).toBe(2050);
    expect(old.flow.amtAdditional).toBeGreaterThan(0); // AMT actually binds
    // TMT unchanged (std added back) ⇒ amtAdditional rises by exactly the
    // regular-tax drop. If the add-back were NOT augmented, AMTI would fall by
    // 2050 and this identity would break.
    const regularTaxDrop = young.flow.regularTaxCalc - old.flow.regularTaxCalc;
    expect(old.flow.amtAdditional - young.flow.amtAdditional).toBe(regularTaxDrop);
  });
});

describe("calculateTaxYear — F13 OBBBA senior bonus", () => {
  // P.L. 119-21 §70103: $6,000/senior temporary deduction, TY2025-2028, reduces
  // taxable income for std OR itemized filers. MAGI = AGI here (no foreign excl).
  it("MFJ both 65+ below phaseout: -$12,000 taxable income vs the 2029 sunset year", () => {
    const i2026 = makeInput({ year: 2026, ordinaryIncome: 120_000, primaryAge: 70, spouseAge: 70 });
    const i2029 = { ...i2026, year: 2029 };
    // Both years carry the same §63(f) +$3,300 (age-based, not sunsetting), so the
    // taxableIncome gap is purely the $12,000 OBBBA bonus.
    expect(calculateTaxYear(i2029).flow.taxableIncome - calculateTaxYear(i2026).flow.taxableIncome).toBe(12000);
  });

  it("single 65+ at $175k MAGI is fully phased out → no bonus reduction", () => {
    // AGI = 175000 (ordinary only). single threshold 75000; 6%×(175k-75k)=6000 → bonus 0.
    const i2026 = makeInput({ year: 2026, filingStatus: "single", ordinaryIncome: 175_000, primaryAge: 67 });
    const i2029 = { ...i2026, year: 2029 };
    expect(calculateTaxYear(i2026).flow.taxableIncome).toBe(calculateTaxYear(i2029).flow.taxableIncome);
  });

  it("year 2029 sunset: no bonus even below phaseout", () => {
    const i2029 = makeInput({ year: 2029, ordinaryIncome: 120_000, primaryAge: 70, spouseAge: 70 });
    // taxable = AGI 120000 - std(32200 + 3300 §63(f)) = 84500, no bonus.
    expect(calculateTaxYear(i2029).flow.taxableIncome).toBe(84500);
  });

  it("bonus is allowed for AMT — reduces AMTI, NOT added back (not a §56 preference)", () => {
    // Single 65+, 2026 vs 2029, ISO spread sized so AMT binds in both years. The
    // OBBBA bonus is a deduction ALLOWED for AMT: it reduces regular taxable income
    // AND AMTI alike (it is NOT a §56(b) add-back item). So in 2026 both taxable
    // income and AMTI fall by the bonus. With no gains, TMT = amtAdditional +
    // regularTaxCalc; the bonus sits in the 26% AMT band, so TMT drops by ~26% of it.
    // AGI 120k: single bonus = 6000 - 6%×(120k-75k) = 6000-2700 = 3300.
    const lower = makeInput({
      filingStatus: "single", ordinaryIncome: 120_000, isoSpread: 120_000,
      primaryAge: 67, flatStateRate: 0,
    });
    const y2026 = calculateTaxYear({ ...lower, year: 2026 });
    const y2029 = calculateTaxYear({ ...lower, year: 2029 });
    // taxableIncome lower in 2026 by the $3,300 bonus.
    expect(y2029.flow.taxableIncome - y2026.flow.taxableIncome).toBe(3300);
    expect(y2026.flow.amtAdditional).toBeGreaterThan(0);
    expect(y2029.flow.amtAdditional).toBeGreaterThan(0);
    // No gains ⇒ TMT = amtAdditional + regularTaxCalc. Bonus reduces AMTI (allowed
    // for AMT, no add-back) ⇒ TMT drops by 26% of the $3,300 bonus = $858.
    const tmt2026 = y2026.flow.amtAdditional + y2026.flow.regularTaxCalc;
    const tmt2029 = y2029.flow.amtAdditional + y2029.flow.regularTaxCalc;
    expect(tmt2029 - tmt2026).toBe(Math.round(3300 * 0.26)); // 858
  });
});

describe("calculateTaxYear — F7 itemizer SALT added back to AMTI (Form 6251 line 2a)", () => {
  // IRC §56(b)(1)(A)(ii): the itemized SALT deduction (Schedule A line 7, post-§164
  // cap) is disallowed for AMT and must be added back to AMTI. A standard-deduction
  // filer's SALT is irrelevant (they deduct no SALT) — only itemizers add it back.
  //
  // MFJ 2026, ordinary 600000, itemized 80000 (incl. SALT), ISO spread 250000 so AMT
  // binds in BOTH cases (otherwise the assertion is vacuous). SALT 0 vs 40000.
  //
  //   Regular path (identical both cases — itemized TOTAL is 80000 regardless of how
  //   much of it is SALT; ISO is not regular income):
  //     AGI 600000, itemized 80000 > std 32200 → taxable 520000 = incomeTaxBase.
  //     regularTax MFJ on 520000:
  //       24800×.10 + (100800-24800)×.12 + (211950-100800)×.22 + (405000-211950)×.24
  //       + (510400-405000)×.32 + (520000-510400)×.35
  //       = 2480 + 9120 + 24453 + 46332 + 33728 + 3360 = 119473.
  //
  //   AMT exemption MFJ 140200; phaseout starts 1000000 (AMTI < 1M → no phaseout);
  //   28% breakpoint 244500. No LTCG → all AMTI ordinary.
  //     noSalt:  AMTI = 520000 + 0     + 250000 = 770000 → taxable 629800
  //              TMT = 244500×.26 + (629800-244500)×.28 = 63570 + 107884 = 171454
  //              amtAdditional = 171454 - 119473 = 51981
  //     withSalt:AMTI = 520000 + 40000 + 250000 = 810000 → taxable 669800
  //              TMT = 244500×.26 + (669800-244500)×.28 = 63570 + 119084 = 182654
  //              amtAdditional = 182654 - 119473 = 63181
  //     Δ amtAdditional = 11200 = 40000 × 0.28 (SALT add-back taxed at the 28% band).
  it("itemizer's SALT is added back to AMTI; regular tax unchanged, TMT higher by 28% × SALT", () => {
    const noSalt = calculateTaxYear(makeInput({
      ordinaryIncome: 600_000, itemizedDeductions: 80_000, saltDeducted: 0,
      isoSpread: 250_000, flatStateRate: 0,
    }));
    const withSalt = calculateTaxYear(makeInput({
      ordinaryIncome: 600_000, itemizedDeductions: 80_000, saltDeducted: 40_000,
      isoSpread: 250_000, flatStateRate: 0,
    }));
    // Regular tax identical (itemized total unchanged; ISO not regular income).
    expect(withSalt.flow.regularFederalIncomeTax).toBe(noSalt.flow.regularFederalIncomeTax);
    expect(noSalt.flow.regularFederalIncomeTax).toBe(119_473);
    // AMT actually binds in both cases (non-vacuous).
    expect(noSalt.flow.amtAdditional).toBeGreaterThan(0);
    expect(withSalt.flow.amtAdditional).toBeGreaterThan(0);
    // SALT add-back raises AMTI by 40000 → TMT (hence amtAdditional) by 28% × 40000.
    expect(withSalt.flow.amtAdditional).toBeGreaterThan(noSalt.flow.amtAdditional);
    expect(noSalt.flow.amtAdditional).toBeCloseTo(51_981, 0);
    expect(withSalt.flow.amtAdditional).toBeCloseTo(63_181, 0);
    expect(withSalt.flow.amtAdditional - noSalt.flow.amtAdditional).toBeCloseTo(11_200, 0);
  });

  it("standard-deduction filer's saltDeducted is ignored (no SALT deducted to add back)", () => {
    // Same income but no itemized deductions → std path. saltDeducted must not move AMTI:
    // the std add-back (F12) already covers the disallowed standard deduction.
    const a = calculateTaxYear(makeInput({
      ordinaryIncome: 600_000, isoSpread: 250_000, saltDeducted: 0, flatStateRate: 0,
    }));
    const b = calculateTaxYear(makeInput({
      ordinaryIncome: 600_000, isoSpread: 250_000, saltDeducted: 40_000, flatStateRate: 0,
    }));
    expect(b.flow.amtAdditional).toBe(a.flow.amtAdditional);
  });
});

describe("calculateTaxYear — ISO spread as an AMT preference item", () => {
  // Single filer with enough ordinary income that AMTI sits well above the
  // exemption edge, so an ISO bargain element pushes tentative AMT past regular.
  const base = makeInput({
    filingStatus: "single",
    ordinaryIncome: 250_000,
    flatStateRate: 0,
  });

  it("ISO spread increases AMTI and can produce additional AMT", () => {
    const withoutIso = calculateTaxYear(base);
    const withIso = calculateTaxYear({ ...base, isoSpread: 100_000 });

    // ISO bargain element is added to AMTI → tentative AMT rises → additional AMT.
    expect(withIso.flow.amtAdditional).toBeGreaterThan(withoutIso.flow.amtAdditional);

    // ISO spread is NOT regular taxable income — regular tax is unchanged.
    expect(withIso.flow.regularTaxCalc).toBeCloseTo(withoutIso.flow.regularTaxCalc, 2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Federal credit layer wired into the roll-up (Task 9).
//
// `params2026()` deliberately leaves every credit column NULL — that is the live
// DB state today. `params2026WithCredits()` is the seeded counterpart; the
// unseeded path gets its own test below.
// ─────────────────────────────────────────────────────────────────────────────

function params2026WithCredits(): TaxYearParameters {
  return {
    ...params2026(),
    ctc: { perChild: 2000, refundableMax: 1700, odcPerDependent: 500 },
    saversCredit: {
      mfj: [
        { rate: 0.5, agiCeiling: 48000 },
        { rate: 0.2, agiCeiling: 52000 },
        { rate: 0.1, agiCeiling: 80000 },
      ],
      single: [
        { rate: 0.5, agiCeiling: 24000 },
        { rate: 0.2, agiCeiling: 26000 },
        { rate: 0.1, agiCeiling: 40000 },
      ],
      hoh: [
        { rate: 0.5, agiCeiling: 36000 },
        { rate: 0.2, agiCeiling: 39000 },
        { rate: 0.1, agiCeiling: 60000 },
      ],
    },
  };
}

describe("calculateTaxYear — credits: absent household is behaviour-preserving", () => {
  // Regression guard for every existing caller: `household` is optional and
  // nothing supplies it yet, so the credit-aware roll-up must reduce EXACTLY to
  // the old five-term sum. Income is picked so all five terms land on exact
  // dollars (at $300k of wages the 0.9% surtax is 449.99999999999994, which
  // would force a toBeCloseTo).
  //   AGI 380000; std 32200 → taxableIncome 347800; incomeTaxBase 277800
  //   regularFederalIncomeTax 51857 (= 2480 + 9120 + 24453 + 65850×0.24=15804)
  //   capitalGainsTax         10500 (= 70000 × 0.15, stacked 277800→347800)
  //   amtAdditional               0 (TMT 44148 + 10500 = 54648 < 51857 + 10500)
  //   niit                     2660 (= min(70000, 380000-250000) × 0.038)
  //   additionalMedicare        540 (= (310000-250000) × 0.009)
  //   total                   65557
  const result = calculateTaxYear(makeInput({
    earnedIncome: 310_000,
    qualifiedDividends: 50_000,
    longTermCapitalGains: 20_000,
    flatStateRate: 0,
  }));

  it("reports zero nonrefundable and zero refundable credits", () => {
    expect(result.flow.taxCredits).toBe(0);
    expect(result.flow.refundableCredits).toBe(0);
  });

  it("totalFederalTax is exactly the sum of the five component terms", () => {
    expect(result.flow.totalFederalTax).toBe(
      result.flow.regularFederalIncomeTax +
      result.flow.capitalGainsTax +
      result.flow.amtAdditional +
      result.flow.niit +
      result.flow.additionalMedicare,
    );
    expect(result.flow.regularFederalIncomeTax).toBe(51_857);
    expect(result.flow.capitalGainsTax).toBe(10_500);
    expect(result.flow.amtAdditional).toBe(0);
    expect(result.flow.niit).toBe(2_660);
    expect(result.flow.additionalMedicare).toBe(540);
    expect(result.flow.totalFederalTax).toBe(65_557);
  });
});

describe("calculateTaxYear — credits: nonrefundable clamped at tax, refundable goes past zero", () => {
  // MFJ, $60,000 wages, 3 qualifying children, credit columns seeded.
  //   AGI 60000; std 32200 → taxableIncome = incomeTaxBase = 27800
  //   regularTaxCalc = 24800×0.10 + (27800-24800)×0.12 = 2480 + 360 = 2840
  //   capitalGainsTax 0; AMTI = 27800 + 32200 = 60000 < 140200 exemption → amtAdditional 0
  //   niit 0; additionalMedicare 0  → taxBeforeCredits = 2840
  //   CTC gross = 3 × 2000 = 6000; MAGI 60000 < 400000 → no phase-down
  //   nonrefundable used = min(6000, 2840) = 2840   (the R5 clamp binds)
  //   ACTC = min(6000-2840 = 3160, 3 × 1700 = 5100, 0.15 × (60000-2500) = 8625) = 3160
  //   totalFederalTax = max(0, 2840 - 2840) + 0 + 0 - 3160 = -3160
  const result = calculateTaxYear(makeInput({
    earnedIncome: 60_000,
    taxParams: params2026WithCredits(),
    flatStateRate: 0,
    household: {
      qualifyingChildren: 3,
      otherDependents: 0,
      aotcStudents: [],
      retirementContributions: { client: 0, spouse: 0 },
    },
  }));

  it("caps the nonrefundable total at regular + cap-gains + AMT-additional", () => {
    const taxBeforeCredits =
      result.flow.regularFederalIncomeTax + result.flow.capitalGainsTax + result.flow.amtAdditional;
    expect(taxBeforeCredits).toBe(2_840);
    expect(result.flow.taxCredits).toBeLessThanOrEqual(taxBeforeCredits);
    expect(result.flow.taxCredits).toBe(2_840);
  });

  it("keeps refundable dollars out of taxCredits", () => {
    expect(result.flow.refundableCredits).toBe(3_160);
  });

  it("leaves regularFederalIncomeTax as the PRE-credit bracket tax", () => {
    expect(result.flow.regularTaxCalc).toBe(2_840);
    expect(result.flow.regularFederalIncomeTax).toBe(2_840);
  });

  it("lets totalFederalTax go negative — a refund, not a floored zero", () => {
    expect(result.flow.totalFederalTax).toBe(-3_160);
  });
});

describe("calculateTaxYear — credits: Saver's sunset keys off the REQUESTED year", () => {
  // `taxParams.year` stays 2026 in both calls (the resolver stamps the SOURCE
  // year on inflated out-year params). Only `input.year` moves. SECURE 2.0 §103
  // retires the credit after 2026, so 2027 must yield nothing.
  //   AGI 50000; std 32200 → taxableIncome 17800 → regularTaxCalc = 17800 × 0.10 = 1780
  //   AMTI = 17800 + 32200 = 50000 < 140200 → amtAdditional 0; no NIIT, no addl Medicare
  //   Saver's: AGI 50000 clears the 48000 ceiling and lands in the SECOND tier
  //            (ceiling 52000, rate 0.2) — deliberately not the top tier, so a
  //            mutant handing `credits.ts` a wrong `agi` picks a different RATE
  //            rather than coincidentally re-landing on 0.5.
  //            min(2000, 2000) + min(0, 2000) = 2000 → credit = 0.2 × 2000 = 400
  //   2026: totalFederalTax = max(0, 1780 - 400) = 1380
  //   2027: totalFederalTax = max(0, 1780 - 0)   = 1780
  const household = {
    qualifyingChildren: 0,
    otherDependents: 0,
    aotcStudents: [],
    retirementContributions: { client: 2000, spouse: 0 },
  };
  const in2026 = calculateTaxYear(makeInput({
    year: 2026, earnedIncome: 50_000, taxParams: params2026WithCredits(),
    flatStateRate: 0, household,
  }));
  const in2027 = calculateTaxYear(makeInput({
    year: 2027, earnedIncome: 50_000, taxParams: params2026WithCredits(),
    flatStateRate: 0, household,
  }));

  it("allows the Saver's Credit in 2026, at the AGI tier's own rate", () => {
    expect(in2026.flow.adjustedGrossIncome).toBe(50_000);
    expect(in2026.flow.regularTaxCalc).toBe(1_780);
    expect(in2026.flow.taxCredits).toBe(400);
    expect(in2026.flow.totalFederalTax).toBe(1_380);
  });

  it("denies it in 2027 even though taxParams.year is still 2026", () => {
    // Non-vacuous: the params row really is still stamped 2026.
    expect(in2027.diag.bracketsUsed.year).toBe(2026);
    expect(in2027.flow.regularTaxCalc).toBe(1_780);
    expect(in2027.flow.taxCredits).toBe(0);
    expect(in2027.flow.totalFederalTax).toBe(1_780);
  });
});

describe("calculateTaxYear — credits: ACTC earned-income floor uses earned income, not AGI", () => {
  // MFJ, wages 12500, above-line deductions 2500 → AGI 10000. The two figures are
  // deliberately different so a mutant that hands `credits.ts` AGI is observable.
  //   taxableIncome = max(0, 10000 - 32200) = 0 → regularTaxCalc 0, no AMT/NIIT/Medicare
  //   taxBeforeCredits = 0 → nothing nonrefundable can be used
  //   CTC gross = 2 × 2000 = 4000 → unused 4000
  //   ACTC = min(4000, 2 × 1700 = 3400, 0.15 × (12500 - 2500) = 1500) = 1500
  //          (with AGI substituted: 0.15 × (10000 - 2500) = 1125 — a different number)
  const result = calculateTaxYear(makeInput({
    earnedIncome: 12_500,
    aboveLineDeductions: 2_500,
    taxParams: params2026WithCredits(),
    flatStateRate: 0,
    household: {
      qualifyingChildren: 2,
      otherDependents: 0,
      aotcStudents: [],
      retirementContributions: { client: 0, spouse: 0 },
    },
  }));

  it("has AGI genuinely below earned income (non-vacuous)", () => {
    expect(result.flow.adjustedGrossIncome).toBe(10_000);
    expect(result.income.earnedIncome).toBe(12_500);
  });

  it("computes the 15% floor off earned income", () => {
    expect(result.flow.taxCredits).toBe(0);
    expect(result.flow.refundableCredits).toBe(1_500);
    expect(result.flow.totalFederalTax).toBe(-1_500);
  });
});

describe("calculateTaxYear — credits: AOTC splits across the nonrefundable/refundable line", () => {
  // MFJ, wages 170000 — the midpoint of the unindexed 160000-180000 AOTC range,
  // so the surviving fraction is exactly 0.5 (no float residue).
  //   AGI 170000; std 32200 → taxableIncome = incomeTaxBase = 137800
  //   regularTaxCalc = 2480 + 9120 + (137800-100800)×0.22 = 2480 + 9120 + 8140 = 19740
  //   AMTI = 137800 + 32200 = 170000 → taxable AMTI 29800 → TMT 7748 < 19740 → 0
  //   AOTC raw = min(2000, 4000) + 0.25 × min(2000, 2000) = 2000 + 500 = 2500
  //        phased = 2500 × 0.5 = 1250; refundable = min(0.4 × 1250, 1000) = 500
  //        nonrefundable = 1250 - 500 = 750
  //   totalFederalTax = max(0, 19740 - 750) + 0 + 0 - 500 = 18990 - 500 = 18490
  const result = calculateTaxYear(makeInput({
    earnedIncome: 170_000,
    taxParams: params2026WithCredits(),
    flatStateRate: 0,
    household: {
      qualifyingChildren: 0,
      otherDependents: 0,
      aotcStudents: [{ qualifiedExpenses: 4_000 }],
      retirementContributions: { client: 0, spouse: 0 },
    },
  }));

  it("applies the 60% nonrefundable slice against tax", () => {
    expect(result.flow.regularFederalIncomeTax).toBe(19_740);
    expect(result.flow.taxCredits).toBe(750);
  });

  it("reports the 40% refundable slice separately", () => {
    expect(result.flow.refundableCredits).toBe(500);
    expect(result.flow.totalFederalTax).toBe(18_490);
  });
});

describe("calculateTaxYear — credits: unseeded credit columns mean ZERO, never NaN", () => {
  // `params2026()` has ctc.{perChild,refundableMax,odcPerDependent} all null and
  // empty Saver's tables — today's live DB state. A household with 3 children
  // must therefore get nothing, and the roll-up must stay a real number.
  const result = calculateTaxYear(makeInput({
    earnedIncome: 60_000,
    flatStateRate: 0,
    household: {
      qualifyingChildren: 3,
      otherDependents: 2,
      aotcStudents: [],
      retirementContributions: { client: 2_000, spouse: 2_000 },
    },
  }));

  it("yields zero credits and the undisturbed 2840 of bracket tax", () => {
    expect(result.flow.taxCredits).toBe(0);
    expect(result.flow.refundableCredits).toBe(0);
    expect(result.flow.totalFederalTax).toBe(2_840);
  });
});

describe("calculateTaxYear — credits: NIIT is outside the credit-offsettable base", () => {
  // The scenario that makes R5/R7 load-bearing: a household with REAL NIIT but
  // ZERO chapter-1 subpart A tax for credits to bite into. If `taxBeforeCredits`
  // were built from the grand total (regular + capGains + AMT + NIIT + Medicare)
  // instead of the first three terms, the CTC would eat the NIIT and the ACTC
  // leftover would shrink to match.
  //
  // MFJ: wages 20000, LTCG 240000, itemized 170000 (so the gain lands in the 0%
  // band and nothing ordinary survives), 1 qualifying child.
  //   AGI 260000; itemized 170000 > std 32200 → taxableIncome 90000
  //   incomeTaxBase = max(0, 90000 - 240000) = 0            → regularTaxCalc 0
  //   preferential base = min(240000, 90000) = 90000, stacked 0→90000 < 99200
  //                                                          → capitalGainsTax 0
  //   AMTI = 90000 + 0 (itemizer, no SALT) < 140200 exemption → amtAdditional 0
  //   NIIT = min(240000, 260000-250000) × 0.038 = 10000 × 0.038 = 380
  //   additionalMedicare = 0 (wages 20000 < 250000)
  //   taxBeforeCredits = 0 + 0 + 0 = 0  →  NOTHING nonrefundable can be used
  //   ACTC = min(2000 unused, 1 × 1700, 0.15 × (20000-2500) = 2625) = 1700
  //   totalFederalTax = max(0, 0 - 0) + 380 + 0 - 1700 = -1320
  //
  // With NIIT folded into taxBeforeCredits: 380 of CTC would be "used"
  // (taxCredits 380), the ACTC leftover would drop to 1620, and the total would
  // read -1240 instead of -1320.
  const result = calculateTaxYear(makeInput({
    earnedIncome: 20_000,
    longTermCapitalGains: 240_000,
    itemizedDeductions: 170_000,
    taxParams: params2026WithCredits(),
    flatStateRate: 0,
    household: {
      qualifyingChildren: 1,
      otherDependents: 0,
      aotcStudents: [],
      retirementContributions: { client: 0, spouse: 0 },
    },
  }));

  it("has real NIIT and no subpart-A tax (non-vacuous)", () => {
    expect(result.flow.niit).toBe(380);
    expect(result.flow.regularFederalIncomeTax).toBe(0);
    expect(result.flow.capitalGainsTax).toBe(0);
    expect(result.flow.amtAdditional).toBe(0);
  });

  it("does not let nonrefundable credits touch the NIIT", () => {
    expect(result.flow.taxCredits).toBe(0);
    expect(result.flow.refundableCredits).toBe(1_700);
    expect(result.flow.totalFederalTax).toBe(-1_320);
  });
});
