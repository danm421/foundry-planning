// src/lib/tax/state-income/__tests__/compute.test.ts
import { describe, it, expect } from "vitest";
import { computeStateIncomeTax } from "../compute";
import type { ComputeStateIncomeTaxInput } from "../compute";

const BASE_FEDERAL_INCOME: ComputeStateIncomeTaxInput["federalIncome"] = {
  agi: 100_000,
  taxableIncome: 88_000,
  ordinaryIncome: 100_000,
  dividends: 0,
  capitalGains: 0,
  shortCapitalGains: 0,
  earnedIncome: 100_000,
  taxableSocialSecurity: 0,
  taxExemptIncome: 0,
};

const BASE_RETIREMENT: ComputeStateIncomeTaxInput["retirementBreakdown"] = {
  db: 0, ira: 0, k401: 0, annuity: 0,
};

describe("computeStateIncomeTax — no-income-tax states", () => {
  it.each(["AK", "FL", "NV", "NH", "SD", "TN", "TX", "WY"] as const)(
    "returns zero tax for %s",
    (state) => {
      const r = computeStateIncomeTax({
        state,
        year: 2026,
        filingStatus: "married_joint",
        primaryAge: 65,
        federalIncome: {
          agi: 200_000,
          taxableIncome: 175_000,
          ordinaryIncome: 100_000,
          dividends: 10_000,
          capitalGains: 30_000,
          shortCapitalGains: 0,
          earnedIncome: 0,
          taxableSocialSecurity: 20_000,
          taxExemptIncome: 0,
        },
        retirementBreakdown: { db: 0, ira: 0, k401: 0, annuity: 0 },
        preTaxContrib: 0,
        fallbackFlatRate: 0.05,
      });
      expect(r.stateTax).toBe(0);
      expect(r.hasIncomeTax).toBe(false);
      expect(r.state).toBe(state);
    },
  );

  it("returns flat-rate fallback when state is null", () => {
    const r = computeStateIncomeTax({
      state: null,
      year: 2026,
      filingStatus: "married_joint",
      primaryAge: 65,
      federalIncome: {
        agi: 200_000, taxableIncome: 175_000, ordinaryIncome: 100_000,
        dividends: 0, capitalGains: 0, shortCapitalGains: 0, earnedIncome: 0,
        taxableSocialSecurity: 0, taxExemptIncome: 0,
      },
      retirementBreakdown: { db: 0, ira: 0, k401: 0, annuity: 0 },
      preTaxContrib: 0,
      fallbackFlatRate: 0.05,
    });
    expect(r.stateTax).toBe(175_000 * 0.05);
    expect(r.state).toBeNull();
  });
});

describe("computeStateIncomeTax — income base", () => {
  it("CO 2026 uses Federal Taxable Income, not AGI", () => {
    const r = computeStateIncomeTax({
      state: "CO", year: 2026, filingStatus: "single", primaryAge: 45,
      federalIncome: {
        agi: 100_000, taxableIncome: 85_000, ordinaryIncome: 0,
        earnedIncome: 100_000, dividends: 0, capitalGains: 0, shortCapitalGains: 0,
        taxableSocialSecurity: 0, taxExemptIncome: 0,
      },
      retirementBreakdown: { db: 0, ira: 0, k401: 0, annuity: 0 },
      preTaxContrib: 0, fallbackFlatRate: 0,
    });
    expect(r.incomeBase).toBe("federal-taxable");
    expect(r.startingIncome).toBe(85_000); // not 100_000
  });

  it("CT 2026 adds back tax-exempt interest", () => {
    const r = computeStateIncomeTax({
      state: "CT", year: 2026, filingStatus: "single", primaryAge: 45,
      federalIncome: {
        agi: 100_000, taxableIncome: 85_000, ordinaryIncome: 0,
        earnedIncome: 95_000, dividends: 0, capitalGains: 0, shortCapitalGains: 0,
        taxableSocialSecurity: 0, taxExemptIncome: 5_000,
      },
      retirementBreakdown: { db: 0, ira: 0, k401: 0, annuity: 0 },
      preTaxContrib: 0, fallbackFlatRate: 0,
    });
    expect(r.addbacks.taxFreeInterest).toBe(5_000);
    expect(r.stateAGI).toBe(105_000); // 100_000 AGI + 5_000 addback
  });
});

describe("computeStateIncomeTax — federal-taxable base states don't double-deduct the std deduction (Bug #1)", () => {
  // CO/MT/ND/SC start their return from federal TAXABLE income, which is already
  // net of the federal standard deduction. Subtracting a state std deduction on
  // top removes it twice. These states must apply a $0 state std deduction.
  it("CO 2026: no state std deduction on top of federal taxable income", () => {
    const r = computeStateIncomeTax({
      state: "CO", year: 2026, filingStatus: "single", primaryAge: 45,
      federalIncome: {
        agi: 100_000, taxableIncome: 85_000, ordinaryIncome: 0,
        earnedIncome: 100_000, dividends: 0, capitalGains: 0, shortCapitalGains: 0,
        taxableSocialSecurity: 0, taxExemptIncome: 0,
      },
      retirementBreakdown: { db: 0, ira: 0, k401: 0, annuity: 0 },
      preTaxContrib: 0, fallbackFlatRate: 0,
    });
    expect(r.stdDeduction).toBe(0);
    expect(r.stateTaxableIncome).toBe(85_000); // not 85000 - 16100
    // CO 2026 flat 4.4% on the full federal taxable income.
    expect(r.stateTax).toBeCloseTo(3740, 1); // not (85000 - 16100) × 0.044 = 3031.6
  });
});

describe("computeStateIncomeTax — SS handling", () => {
  it("CA subtracts SS (CA = exempt) so it doesn't tax federally taxable SS", () => {
    const r = computeStateIncomeTax({
      state: "CA", year: 2026, filingStatus: "married_joint", primaryAge: 70,
      federalIncome: {
        agi: 80_000, taxableIncome: 70_000, ordinaryIncome: 60_000,
        earnedIncome: 0, dividends: 0, capitalGains: 0, shortCapitalGains: 0,
        taxableSocialSecurity: 20_000, taxExemptIncome: 0,
      },
      retirementBreakdown: { db: 0, ira: 0, k401: 0, annuity: 0 },
      preTaxContrib: 0, fallbackFlatRate: 0,
    });
    expect(r.subtractions.socialSecurity).toBe(20_000);
  });
});

describe("computeStateIncomeTax — retirement integration", () => {
  it("PA: all retirement fully exempt", () => {
    const ssAmount = 25_000; // PA SS rule defaults to exempt → full taxableSocialSecurity subtracts
    const r = computeStateIncomeTax({
      state: "PA",
      year: 2026,
      filingStatus: "married_joint",
      primaryAge: 70,
      federalIncome: {
        agi: 200_000,
        taxableIncome: 175_000,
        ordinaryIncome: 100_000,
        earnedIncome: 0,
        dividends: 0,
        capitalGains: 0,
        shortCapitalGains: 0,
        taxableSocialSecurity: ssAmount,
        taxExemptIncome: 0,
      },
      retirementBreakdown: { db: 30_000, ira: 50_000, k401: 20_000, annuity: 0 },
      preTaxContrib: 0,
      fallbackFlatRate: 0,
    });
    expect(r.subtractions.retirementIncome).toBe(100_000);
    expect(r.subtractions.total).toBe(ssAmount + 100_000);
    expect(r.diag.notes.some((n) => n.toLowerCase().includes("retirement"))).toBe(true);
  });

  it("CO: combined SS+retirement cap clamps retirement subtraction", () => {
    // CO retirement rule: ageThreshold 55, perFilerCap $20K, combinedSsCap true.
    // married_joint → combinedCap = $20K × 2 = $40K.
    // CO SS rule: conditional with jointAgiThreshold $95K and ageFullExemption 65.
    // Use age 60 (between 55 and 65) so SS is NOT auto-exempt by age; instead the
    // 55–64 cliff applies. AGI $90K (below $95K) → SS fully exempt at state level
    // → ssResult.amount = taxableSocialSecurity = $10K.
    // Retirement qualifying = $50K IRA → capped to $40K by perFilerCap×filers.
    // Combined = $10K + $40K = $50K > $40K cap → retirement clamps to
    // max(0, $40K − $10K) = $30K.
    const r = computeStateIncomeTax({
      state: "CO",
      year: 2026,
      filingStatus: "married_joint",
      primaryAge: 60,
      spouseAge: 60,
      federalIncome: {
        agi: 90_000,
        taxableIncome: 80_000,
        ordinaryIncome: 50_000,
        earnedIncome: 0,
        dividends: 0,
        capitalGains: 0,
        shortCapitalGains: 0,
        taxableSocialSecurity: 10_000,
        taxExemptIncome: 0,
      },
      retirementBreakdown: { db: 0, ira: 50_000, k401: 0, annuity: 0 },
      preTaxContrib: 0,
      fallbackFlatRate: 0,
    });
    expect(r.subtractions.socialSecurity).toBe(10_000);
    expect(r.subtractions.retirementIncome).toBe(30_000);
    expect(r.subtractions.total).toBe(40_000);
  });
});

describe("computeStateIncomeTax — cap-gains integration", () => {
  it("AR subtracts 50% of LTCG", () => {
    const r = computeStateIncomeTax({
      state: "AR", year: 2026, filingStatus: "single", primaryAge: 60,
      federalIncome: {
        agi: 200_000, taxableIncome: 180_000, ordinaryIncome: 100_000,
        earnedIncome: 100_000, dividends: 0, capitalGains: 80_000,
        shortCapitalGains: 0, taxableSocialSecurity: 0, taxExemptIncome: 0,
      },
      retirementBreakdown: { db: 0, ira: 0, k401: 0, annuity: 0 },
      preTaxContrib: 0, fallbackFlatRate: 0,
    });
    expect(r.subtractions.capitalGains).toBe(40_000);
    expect(r.specialRulesApplied).toContain("AR-LTCG-carveout");
  });

  it("AR with no LTCG → does NOT flag LTCG-carveout (regression net)", () => {
    const r = computeStateIncomeTax({
      state: "AR", year: 2026, filingStatus: "single", primaryAge: 60,
      federalIncome: {
        agi: 200_000, taxableIncome: 180_000, ordinaryIncome: 100_000,
        earnedIncome: 100_000, dividends: 0, capitalGains: 0,
        shortCapitalGains: 0, taxableSocialSecurity: 0, taxExemptIncome: 0,
      },
      retirementBreakdown: { db: 0, ira: 0, k401: 0, annuity: 0 },
      preTaxContrib: 0, fallbackFlatRate: 0,
    });
    expect(r.subtractions.capitalGains).toBe(0);
    expect(r.specialRulesApplied).not.toContain("AR-LTCG-carveout");
  });

  it("WA: gains-only with standard exclusion, $500K LTCG → $222K taxable → $15,540", () => {
    // WA 2026 standard exclusion = $278,000 (from std-deductions.ts).
    // $500K LTCG − $278K = $222K taxable × 7% = $15,540.
    const WA_2026_EXCLUSION = 278_000;
    const r = computeStateIncomeTax({
      state: "WA", year: 2026, filingStatus: "married_joint", primaryAge: 60,
      federalIncome: {
        agi: 1_000_000, taxableIncome: 900_000, ordinaryIncome: 500_000,
        earnedIncome: 500_000, dividends: 0, capitalGains: 500_000,
        shortCapitalGains: 0, taxableSocialSecurity: 0, taxExemptIncome: 0,
      },
      retirementBreakdown: { db: 0, ira: 0, k401: 0, annuity: 0 },
      preTaxContrib: 0, fallbackFlatRate: 0,
    });
    expect(r.stateTax).toBeCloseTo(15_540, 2);
    expect(r.startingIncome).toBe(500_000);
    expect(r.stateAGI).toBe(500_000);
    expect(r.stateTaxableIncome).toBe(500_000 - WA_2026_EXCLUSION);
    expect(r.stdDeduction).toBe(WA_2026_EXCLUSION);
    expect(r.specialRulesApplied).toContain("WA-gains-only");
  });

  it("WA: $200K LTCG (below the ~$278K exclusion) → $0 tax", () => {
    const r = computeStateIncomeTax({
      state: "WA", year: 2026, filingStatus: "married_joint", primaryAge: 60,
      federalIncome: {
        agi: 500_000, taxableIncome: 450_000, ordinaryIncome: 300_000,
        earnedIncome: 300_000, dividends: 0, capitalGains: 200_000,
        shortCapitalGains: 0, taxableSocialSecurity: 0, taxExemptIncome: 0,
      },
      retirementBreakdown: { db: 0, ira: 0, k401: 0, annuity: 0 },
      preTaxContrib: 0, fallbackFlatRate: 0,
    });
    expect(r.stateTax).toBe(0);
    expect(r.stateTaxableIncome).toBe(0);
    expect(r.specialRulesApplied).toContain("WA-gains-only");
  });
});

describe("computeStateIncomeTax — bracket recapture", () => {
  it("CA at $1.5M MJ flags recapture", () => {
    const r = computeStateIncomeTax({
      state: "CA",
      year: 2026,
      filingStatus: "married_joint",
      primaryAge: 55,
      federalIncome: {
        agi: 1_500_000,
        taxableIncome: 1_400_000,
        ordinaryIncome: 1_500_000,
        earnedIncome: 1_500_000,
        dividends: 0,
        capitalGains: 0,
        shortCapitalGains: 0,
        taxableSocialSecurity: 0,
        taxExemptIncome: 0,
      },
      retirementBreakdown: { db: 0, ira: 0, k401: 0, annuity: 0 },
      preTaxContrib: 0,
      fallbackFlatRate: 0,
    });
    expect(r.specialRulesApplied).toContain("CA-recapture");
    expect(r.diag.notes.some((n) => n.toLowerCase().includes("ca recapture"))).toBe(true);
  });

  it("CA at $150K MJ does NOT flag recapture (regression net)", () => {
    const r = computeStateIncomeTax({
      state: "CA",
      year: 2026,
      filingStatus: "married_joint",
      primaryAge: 55,
      federalIncome: {
        agi: 150_000,
        taxableIncome: 130_000,
        ordinaryIncome: 150_000,
        earnedIncome: 150_000,
        dividends: 0,
        capitalGains: 0,
        shortCapitalGains: 0,
        taxableSocialSecurity: 0,
        taxExemptIncome: 0,
      },
      retirementBreakdown: { db: 0, ira: 0, k401: 0, annuity: 0 },
      preTaxContrib: 0,
      fallbackFlatRate: 0,
    });
    expect(r.specialRulesApplied).not.toContain("CA-recapture");
  });
});

describe("computeStateIncomeTax — age-65 standard-deduction add-on (per filer)", () => {
  // BUG #20: add65Joint is a PER-FILER amount; a couple where BOTH spouses are
  // 65+ gets 2× the joint add-on, not 1×.
  // BUG #23: getStdDeduction must honor an older spouse, not just primaryAge.
  // VT 2026: joint base 15300, add65Joint 1250 (per filer).
  it("VT 2026 MFJ both age 70 → stdDeduction = 17800 (15300 + 2×1250)", () => {
    const r = computeStateIncomeTax({
      state: "VT",
      year: 2026,
      filingStatus: "married_joint",
      primaryAge: 70,
      spouseAge: 70,
      federalIncome: BASE_FEDERAL_INCOME,
      retirementBreakdown: BASE_RETIREMENT,
      preTaxContrib: 0,
      fallbackFlatRate: 0,
    });
    expect(r.stdDeduction).toBe(17_800);
  });

  it("VT 2026 MFJ primary 60, spouse 70 → stdDeduction = 16550 (15300 + 1×1250)", () => {
    // Proves spouseAge is honored even when primaryAge < 65.
    const r = computeStateIncomeTax({
      state: "VT",
      year: 2026,
      filingStatus: "married_joint",
      primaryAge: 60,
      spouseAge: 70,
      federalIncome: BASE_FEDERAL_INCOME,
      retirementBreakdown: BASE_RETIREMENT,
      preTaxContrib: 0,
      fallbackFlatRate: 0,
    });
    expect(r.stdDeduction).toBe(16_550);
  });

  it("VT 2026 single age 70 → stdDeduction = 8900 (7650 + 1×1250) unchanged", () => {
    // Single-filer behavior must be untouched: base single 7650 + add65Single 1250.
    const r = computeStateIncomeTax({
      state: "VT",
      year: 2026,
      filingStatus: "single",
      primaryAge: 70,
      federalIncome: BASE_FEDERAL_INCOME,
      retirementBreakdown: BASE_RETIREMENT,
      preTaxContrib: 0,
      fallbackFlatRate: 0,
    });
    expect(r.stdDeduction).toBe(8_900);
  });

  it("NE 2026 MFJ both age 70 → stdDeduction = 20400 (17700 + 2×1350)", () => {
    const r = computeStateIncomeTax({
      state: "NE",
      year: 2026,
      filingStatus: "married_joint",
      primaryAge: 70,
      spouseAge: 70,
      federalIncome: BASE_FEDERAL_INCOME,
      retirementBreakdown: BASE_RETIREMENT,
      preTaxContrib: 0,
      fallbackFlatRate: 0,
    });
    expect(r.stdDeduction).toBe(20_400);
  });

  it("DE 2026 MFJ both age 70 → stdDeduction = 11500 (6500 + 2×2500)", () => {
    const r = computeStateIncomeTax({
      state: "DE",
      year: 2026,
      filingStatus: "married_joint",
      primaryAge: 70,
      spouseAge: 70,
      federalIncome: BASE_FEDERAL_INCOME,
      retirementBreakdown: BASE_RETIREMENT,
      preTaxContrib: 0,
      fallbackFlatRate: 0,
    });
    expect(r.stdDeduction).toBe(11_500);
  });

  it("VT 2026 MFJ both under 65 → stdDeduction = 15300 (no add-on)", () => {
    const r = computeStateIncomeTax({
      state: "VT",
      year: 2026,
      filingStatus: "married_joint",
      primaryAge: 60,
      spouseAge: 60,
      federalIncome: BASE_FEDERAL_INCOME,
      retirementBreakdown: BASE_RETIREMENT,
      preTaxContrib: 0,
      fallbackFlatRate: 0,
    });
    expect(r.stdDeduction).toBe(15_300);
  });
});

describe("computeStateIncomeTax — easy FAGI-base states", () => {
  it("AZ 2026 single, $100K FAGI, no SS/retirement → flat 2.5% on (AGI − std ded)", () => {
    const r = computeStateIncomeTax({
      state: "AZ",
      year: 2026,
      filingStatus: "single",
      primaryAge: 45,
      federalIncome: BASE_FEDERAL_INCOME,
      retirementBreakdown: BASE_RETIREMENT,
      preTaxContrib: 0,
      fallbackFlatRate: 0,
    });
    // AZ uses Federal AGI as base. Std deduction single 2026 = 8350. No exemption.
    // Taxable = 100_000 - 8350 = 91_650. Rate 2.5% → 2291.25.
    expect(r.stateTax).toBeCloseTo(2291.25, 2);
    expect(r.incomeBase).toBe("federal-agi");
    expect(r.stateAGI).toBe(100_000);
    expect(r.stdDeduction).toBe(8350);
    expect(r.stateTaxableIncome).toBe(91_650);
    expect(r.hasIncomeTax).toBe(true);
  });
});
