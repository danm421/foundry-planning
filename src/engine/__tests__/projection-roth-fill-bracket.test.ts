import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import type { ClientData, FamilyMember, RothConversion } from "../types";
import type { TaxYearParameters } from "../../lib/tax/types";

const CLIENT_FM_ID = "00000000-0000-0000-0000-000000000001";
const SPOUSE_FM_ID = "00000000-0000-0000-0000-000000000002";

// 2026 MFJ-style brackets with the standard 7-tier ordinary-income schedule.
// The taxInflationRate (set on plan settings) auto-inflates downstream years.
const TAX_YEAR_2026: TaxYearParameters = {
  year: 2026,
  incomeBrackets: {
    married_joint: [
      { from: 0,      to: 23200,   rate: 0.10 },
      { from: 23200,  to: 94300,   rate: 0.12 },
      { from: 94300,  to: 201050,  rate: 0.22 },
      { from: 201050, to: 383900,  rate: 0.24 },
      { from: 383900, to: 487450,  rate: 0.32 },
      { from: 487450, to: 731200,  rate: 0.35 },
      { from: 731200, to: null,    rate: 0.37 },
    ],
    single: [
      { from: 0,      to: 11600,   rate: 0.10 },
      { from: 11600,  to: 47150,   rate: 0.12 },
      { from: 47150,  to: 100525,  rate: 0.22 },
      { from: 100525, to: 191950,  rate: 0.24 },
      { from: 191950, to: 243725,  rate: 0.32 },
      { from: 243725, to: 609350,  rate: 0.35 },
      { from: 609350, to: null,    rate: 0.37 },
    ],
    head_of_household: [{ from: 0, to: null, rate: 0.22 }],
    married_separate:  [{ from: 0, to: null, rate: 0.22 }],
  },
  capGainsBrackets: {
    married_joint:     { zeroPctTop: 94050,  fifteenPctTop: 583750 },
    single:            { zeroPctTop: 47025,  fifteenPctTop: 518900 },
    head_of_household: { zeroPctTop: 63000,  fifteenPctTop: 551350 },
    married_separate:  { zeroPctTop: 47025,  fifteenPctTop: 291850 },
  },
  trustIncomeBrackets: [
    { from: 0,     to: 3300,  rate: 0.10 },
    { from: 3300,  to: 16250, rate: 0.37 },
    { from: 16250, to: null,  rate: 0.37 },
  ],
  trustCapGainsBrackets: [
    { from: 0,    to: 3350, rate: 0 },
    { from: 3350, to: null, rate: 0.20 },
  ],
  stdDeduction: { married_joint: 30000, single: 15000, head_of_household: 21900, married_separate: 15000 },
  amtExemption: { mfj: 137000, singleHoh: 88100, mfs: 68500 },
  amtBreakpoint2628: { mfjShoh: 239100, mfs: 119550 },
  amtPhaseoutStart: { mfj: 1237450, singleHoh: 618700, mfs: 618725 },
  ssTaxRate: 0.062,
  ssWageBase: 176100,
  medicareTaxRate: 0.0145,
  addlMedicareRate: 0.009,
  addlMedicareThreshold: { mfj: 250000, single: 200000, mfs: 125000 },
  niitRate: 0.038,
  niitThreshold: { mfj: 250000, single: 200000, mfs: 125000 },
  qbi: {
    thresholdMfj: 383900,
    thresholdSingleHohMfs: 191950,
    phaseInRangeMfj: 100000,
    phaseInRangeOther: 50000,
  },
  contribLimits: {
    ira401kElective: 23500,
    ira401kCatchup50: 7500,
    ira401kCatchup6063: 11250,
    iraTradLimit: 7000,
    iraCatchup50: 1000,
    simpleLimitRegular: 17000,
    simpleCatchup50: 4000,
    hsaLimitSelf: 4400,
    hsaLimitFamily: 8750,
    hsaCatchup55: 1000,
  },
};

/**
 * Reproduces the production bug from the tax-bracket report:
 *   - Strategy: `fill_up_bracket` topping out the 22% bracket.
 *   - Pre-SS years (mid-60s, 401k contributions active) — the simple proxy
 *     undershoots because above-line deductions aren't subtracted.
 *   - SS-active years (older) — the proxy overshoots because taxable-SS
 *     stacks on top of conversion-driven ordinary income.
 *
 * After the two-pass fix, in years where the source IRA has balance, the
 * post-conversion `incomeTaxBase` should land at the 22% bracket ceiling
 * (within $5) — no undershoot, no overshoot into the 24% bracket.
 */
function fillBracketScenario(): ClientData {
  const conversion: RothConversion = {
    id: "rc-fill",
    name: "Fill 22%",
    destinationAccountId: "acc-roth",
    sourceAccountIds: ["acc-ira"],
    conversionType: "fill_up_bracket",
    fillUpBracket: 0.22,
    fixedAmount: 0,
    startYear: 2026,
    indexingRate: 0,
  };

  return {
    client: {
      firstName: "Cooper",
      lastName: "Test",
      dateOfBirth: "1970-01-01", // age 56 in 2026
      spouseDob: "1975-01-01",  // age 51 in 2026
      filingStatus: "married_joint",
      retirementAge: 65,
      planEndAge: 90,
      spouseRetirementAge: 65,
    },
    accounts: [
      {
        id: "acc-checking",
        name: "Joint Checking",
        category: "cash",
        subType: "checking",
        value: 100_000,
        basis: 100_000,
        growthRate: 0,
        rmdEnabled: false,
        owners: [
          { kind: "family_member", familyMemberId: CLIENT_FM_ID, percent: 0.5 },
          { kind: "family_member", familyMemberId: SPOUSE_FM_ID, percent: 0.5 },
        ],
      },
      {
        id: "acc-ira",
        name: "Cooper Trad IRA",
        category: "retirement",
        subType: "traditional_ira",
        value: 3_000_000,
        basis: 0,
        growthRate: 0.05,
        rmdEnabled: true,
        owners: [
          { kind: "family_member", familyMemberId: CLIENT_FM_ID, percent: 1 },
        ],
      },
      {
        id: "acc-roth",
        name: "Cooper Roth IRA",
        category: "retirement",
        subType: "roth_ira",
        value: 0,
        basis: 0,
        growthRate: 0.05,
        rmdEnabled: false,
        owners: [
          { kind: "family_member", familyMemberId: CLIENT_FM_ID, percent: 1 },
        ],
      },
    ],
    incomes: [
      {
        id: "inc-salary",
        name: "Cooper salary",
        type: "salary",
        owner: "client",
        annualAmount: 80_000,
        growthRate: 0.02,
        startYear: 2026,
        endYear: 2034,
      },
      {
        id: "inc-ss",
        name: "Cooper SS",
        type: "social_security",
        owner: "client",
        annualAmount: 40_000,
        growthRate: 0.02,
        startYear: 2026,
        endYear: 2055,
        claimingAge: 67, // starts in 2037 (born 1970)
      },
    ],
    expenses: [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [
      { accountId: "acc-checking", priorityOrder: 1, startYear: 2026, endYear: 2055 },
    ],
    planSettings: {
      flatFederalRate: 0,
      flatStateRate: 0,
      inflationRate: 0,
      planStartYear: 2026,
      planEndYear: 2045,
      taxEngineMode: "bracket",
      taxInflationRate: 0.025,
      estateAdminExpenses: 0,
      flatStateEstateRate: 0,
    },
    entities: [],
    deductions: [],
    transfers: [],
    assetTransactions: [],
    gifts: [],
    giftEvents: [],
    wills: [],
    rothConversions: [conversion],
    familyMembers: [
      {
        id: CLIENT_FM_ID,
        firstName: "Cooper",
        lastName: "Test",
        relationship: "other",
        role: "client",
        dateOfBirth: "1970-01-01",
      } as FamilyMember,
      {
        id: SPOUSE_FM_ID,
        firstName: "Partner",
        lastName: "Test",
        relationship: "other",
        role: "spouse",
        dateOfBirth: "1975-01-01",
      } as FamilyMember,
    ],
    externalBeneficiaries: [],
    taxYearRows: [TAX_YEAR_2026],
  } as ClientData;
}

describe("Roth fill_up_bracket — projection accuracy", () => {
  it("post-conversion incomeTaxBase lands at the 22% bracket ceiling across SS-active and pre-SS years", () => {
    const years = runProjection(fillBracketScenario());

    // Spot-check a pre-SS year (2030, client age 60) and an SS-active year
    // (2040, client age 70 — well past claimingAge 67). In both, the conversion
    // should land us at the 22% bracket top without bleeding into 24%.
    const checks = [2030, 2040];
    for (const yr of checks) {
      const year = years.find((y) => y.year === yr);
      expect(year, `year ${yr} should exist`).toBeDefined();
      const conv = (year!.rothConversions ?? [])[0];
      expect(conv, `year ${yr} should have a roth conversion`).toBeDefined();
      expect(conv!.taxable, `year ${yr} conversion taxable > 0`).toBeGreaterThan(0);

      const tier = year!.taxResult!.diag.marginalBracketTier;
      const incomeTaxBase = year!.taxResult!.flow.incomeTaxBase;

      // findMarginalTier treats a value exactly at `tier.to` as belonging to
      // the NEXT tier (the next dollar's rate). So a perfect bracket fill can
      // legitimately surface as either:
      //   - rate = 0.22 with base ≈ tier.to, OR
      //   - rate = 0.24 with base ≈ tier.from (which equals the 22% ceiling).
      const bracket22Top = tier.rate === 0.24 ? tier.from : tier.to ?? 0;
      expect(
        Math.abs(incomeTaxBase - bracket22Top),
        `year ${yr}: incomeTaxBase ${incomeTaxBase} should be near 22% ceiling ${bracket22Top}`,
      ).toBeLessThan(5);
      // Marginal rate must not be > 24% (would indicate severe overshoot).
      expect(tier.rate, `year ${yr} marginal rate`).toBeLessThanOrEqual(0.24);
    }
  });
});

// ─── Task 4: Roth slice of 401(k) savings contribution lands in rothValueEoY ──

function rothSavingsScenario(): ClientData {
  return {
    client: {
      firstName: "Alex",
      lastName: "Test",
      dateOfBirth: "1980-01-01",
      filingStatus: "single",
      retirementAge: 65,
      planEndAge: 90,
    },
    accounts: [
      {
        id: "acct-checking",
        name: "Checking",
        category: "cash",
        subType: "checking",
        value: 200_000,
        basis: 200_000,
        growthRate: 0,
        rmdEnabled: false,
        owners: [{ kind: "family_member", familyMemberId: CLIENT_FM_ID, percent: 1 }],
      },
      {
        id: "acct-401k",
        name: "401k",
        category: "retirement",
        subType: "401k",
        value: 100_000,
        rothValue: 0,
        basis: 0,
        growthRate: 0,
        rmdEnabled: false,
        owners: [{ kind: "family_member", familyMemberId: CLIENT_FM_ID, percent: 1 }],
      },
    ],
    incomes: [
      {
        id: "inc-salary",
        name: "Salary",
        type: "salary",
        owner: "client",
        annualAmount: 100_000,
        growthRate: 0,
        startYear: 2026,
        endYear: 2044,
      },
    ],
    expenses: [],
    liabilities: [],
    savingsRules: [
      {
        id: "rule-401k",
        accountId: "acct-401k",
        annualAmount: 12_000,
        rothPercent: 0.25,
        isDeductible: true,
        applyContributionLimit: false,
        startYear: 2026,
        endYear: 2044,
      },
    ],
    withdrawalStrategy: [],
    planSettings: {
      flatFederalRate: 0,
      flatStateRate: 0,
      inflationRate: 0,
      planStartYear: 2026,
      planEndYear: 2044,
      taxEngineMode: "flat",
      taxInflationRate: 0,
      estateAdminExpenses: 0,
      flatStateEstateRate: 0,
    },
    entities: [],
    deductions: [],
    transfers: [],
    assetTransactions: [],
    gifts: [],
    giftEvents: [],
    wills: [],
    rothConversions: [],
    familyMembers: [
      {
        id: CLIENT_FM_ID,
        firstName: "Alex",
        lastName: "Test",
        relationship: "other",
        role: "client",
        dateOfBirth: "1980-01-01",
      } as FamilyMember,
    ],
    externalBeneficiaries: [],
    taxYearRows: [TAX_YEAR_2026],
  } as ClientData;
}

describe("Roth savings contribution credits rothValue", () => {
  it("credits the Roth slice of a 401(k) savings contribution into rothValueEoY", () => {
    const years = runProjection(rothSavingsScenario());
    const firstYear = years.find((y) => y.year === 2026);
    expect(firstYear, "year 2026 should exist").toBeDefined();
    const k401 = firstYear!.accountLedgers["acct-401k"];
    expect(k401, "401k ledger should exist").toBeDefined();
    // 25% of 12,000 = 3,000 Roth-designated — no growth (rate=0), so exactly 3,000
    expect(k401.rothValueEoY).toBeCloseTo(3000, 0);
  });
});
