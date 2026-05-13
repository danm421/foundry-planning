import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import type { ClientData, FamilyMember } from "../types";
import type { TaxYearParameters } from "../../lib/tax/types";

const CLIENT_FM_ID = "00000000-0000-0000-0000-000000000001";
const SPOUSE_FM_ID = "00000000-0000-0000-0000-000000000002";

// 2026 MFJ-style brackets cribbed from projection-roth-fill-bracket.test.ts.
// We need real bracket data because bracket-mode is the path under test.
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

/** Two age-75 spouses, a $2M IRA (drives RMDs — start age 73 for pre-1960
 *  births), and a SS stream. Short 2-year projection. The fixture is
 *  intentionally a high-income retiree so the state engine has something
 *  non-zero to chew on for CA. */
function retireeScenario(residenceState: "CA" | null, flatStateRate = 0): ClientData {
  return {
    client: {
      firstName: "Pat",
      lastName: "Retiree",
      dateOfBirth: "1951-01-01", // age 75 in 2026 (RMDs trigger at 73 for pre-1960 births)
      spouseDob: "1951-06-01",   // age 75 in 2026
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
        value: 200_000,
        basis: 200_000,
        growthRate: 0,
        rmdEnabled: false,
        owners: [
          { kind: "family_member", familyMemberId: CLIENT_FM_ID, percent: 0.5 },
          { kind: "family_member", familyMemberId: SPOUSE_FM_ID, percent: 0.5 },
        ],
      },
      {
        id: "acc-ira",
        name: "Pat Trad IRA",
        category: "retirement",
        subType: "traditional_ira",
        value: 2_000_000,
        basis: 0,
        growthRate: 0.05,
        rmdEnabled: true,
        owners: [
          { kind: "family_member", familyMemberId: CLIENT_FM_ID, percent: 1 },
        ],
      },
    ],
    incomes: [
      {
        id: "inc-ss",
        name: "Pat SS",
        type: "social_security",
        owner: "client",
        annualAmount: 40_000,
        growthRate: 0.02,
        startYear: 2026,
        endYear: 2055,
        claimingAge: 70,
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
      flatStateRate,
      inflationRate: 0,
      planStartYear: 2026,
      planEndYear: 2027,
      taxEngineMode: "bracket",
      taxInflationRate: 0.025,
      estateAdminExpenses: 0,
      flatStateEstateRate: 0,
      residenceState,
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
        firstName: "Pat",
        lastName: "Retiree",
        relationship: "other",
        role: "client",
        dateOfBirth: "1951-01-01",
      } as FamilyMember,
      {
        id: SPOUSE_FM_ID,
        firstName: "Partner",
        lastName: "Retiree",
        relationship: "other",
        role: "spouse",
        dateOfBirth: "1951-06-01",
      } as FamilyMember,
    ],
    externalBeneficiaries: [],
    taxYearRows: [TAX_YEAR_2026],
  } as ClientData;
}

describe("projection — state tax integration", () => {
  it("uses bracket-mode state tax when residenceState set to CA", () => {
    const years = runProjection(retireeScenario("CA"));
    expect(years.length).toBeGreaterThan(0);

    const y0 = years[0]!;
    const state = y0.taxResult?.state;
    expect(state, "year-0 taxResult.state must be populated").toBeDefined();
    expect(state!.state).toBe("CA");
    expect(state!.hasIncomeTax).toBe(true);
    // CA on a $2M IRA + $40k SS retiree generates a non-trivial state tax bill.
    expect(state!.stateTax).toBeGreaterThan(0);
    // The bracket result's stateTax must match what got pushed into the
    // top-level flow.stateTax (proves both branches in calculate.ts agree).
    expect(y0.taxResult!.flow.stateTax).toBe(state!.stateTax);
  });

  it("preserves flat-rate fallback when residenceState is null", () => {
    const years = runProjection(retireeScenario(null, 0.05));
    const y0 = years[0]!;
    const state = y0.taxResult?.state;
    expect(state, "year-0 taxResult.state must be populated").toBeDefined();
    // Null residence → fallback path: state code is null, but flat rate produces tax.
    expect(state!.state).toBeNull();
    expect(state!.stateTax).toBeGreaterThan(0);
    // And the populated stateTax matches taxable * flatStateRate.
    const expected = Math.max(0, y0.taxResult!.flow.taxableIncome) * 0.05;
    expect(state!.stateTax).toBeCloseTo(expected, 2);
    expect(y0.taxResult!.flow.stateTax).toBeCloseTo(expected, 2);
  });
});
