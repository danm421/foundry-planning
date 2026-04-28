/**
 * Regression guard: gifts with recipientExternalBeneficiaryId pointing at an
 * external_beneficiaries row with kind='charity' must flow into the charitable-
 * deduction tax pass and appear in deductionBreakdown.belowLine.charitable.
 * The production wiring lives in src/engine/projection.ts (~line 1559-1597).
 *
 * Plan 3a wired the filter directly in runProjection; this test is a regression
 * guard added in Plan 3b (Task 3). The key assertion is deductionBreakdown.belowLine.charitable > 0
 * rather than charityCarryforward (which is what Plan 3a's tests covered).
 */

import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import type { ClientData, FamilyMember, Gift, Expense } from "../types";
import type { TaxYearParameters } from "../../lib/tax/types";

const CLIENT_FM_ID = "fm-client-rg1";
const CHARITY_EB_ID = "eb-charity-1";

// Minimal bracket-mode tax parameters for 2026. We use stdDeduction = 30000 MFJ
// and a 10% flat bracket so the math is predictable. The charity test needs
// bracket mode so willItemize can evaluate to true.
const TAX_YEAR_2026: TaxYearParameters = {
  year: 2026,
  incomeBrackets: {
    married_joint:     [{ from: 0, to: null, rate: 0.10 }],
    single:            [{ from: 0, to: null, rate: 0.10 }],
    head_of_household: [{ from: 0, to: null, rate: 0.10 }],
    married_separate:  [{ from: 0, to: null, rate: 0.10 }],
  },
  capGainsBrackets: {
    married_joint:     { zeroPctTop: 94050, fifteenPctTop: 583750 },
    single:            { zeroPctTop: 47025, fifteenPctTop: 518900 },
    head_of_household: { zeroPctTop: 63000, fifteenPctTop: 551350 },
    married_separate:  { zeroPctTop: 47025, fifteenPctTop: 291850 },
  },
  trustIncomeBrackets: [
    { from: 0,     to: 3300,  rate: 0.10 },
    { from: 3300,  to: 16250, rate: 0.37 },
    { from: 16250, to: null,  rate: 0.37 },
  ],
  trustCapGainsBrackets: [
    { from: 0,     to: 3350,  rate: 0 },
    { from: 3350,  to: null,  rate: 0.20 },
  ],
  // stdDeduction = 30000 MFJ. Our itemized expense below is $40k so itemizing wins.
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

function buildTree(): ClientData {
  return {
    client: {
      firstName: "Regression",
      lastName: "Guard",
      dateOfBirth: "1968-01-01",
      filingStatus: "married_joint",
      retirementAge: 67,
      planEndAge: 90,
    },
    accounts: [
      {
        id: "acc-cash",
        name: "Joint Checking",
        category: "cash",
        subType: "checking",
        value: 2_000_000,
        basis: 2_000_000,
        growthRate: 0,
        rmdEnabled: false,
        owners: [{ kind: "family_member", familyMemberId: CLIENT_FM_ID, percent: 1 }],
      } as ClientData["accounts"][number],
    ],
    incomes: [
      {
        id: "inc-salary",
        name: "Salary",
        type: "salary",
        owner: "client",
        // $500k income → AGI ≈ $500k. 60% AGI limit = $300k. $50k gift is fully deductible.
        annualAmount: 500_000,
        growthRate: 0,
        startYear: 2026,
        endYear: 2030,
      } as ClientData["incomes"][number],
    ],
    expenses: [
      // A $40k below-the-line deduction (e.g. mortgage interest) ensures
      // itemizedDeductions > stdDeduction ($30k) BEFORE the charitable pass,
      // so willItemize evaluates to true.
      {
        id: "exp-mortgage",
        type: "other",
        name: "Mortgage Interest",
        annualAmount: 40_000,
        startYear: 2026,
        endYear: 2030,
        growthRate: 0,
        deductionType: "below_line",
      } as Expense,
    ],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    planSettings: {
      flatFederalRate: 0,
      flatStateRate: 0,
      inflationRate: 0,
      planStartYear: 2026,
      planEndYear: 2030,
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
    familyMembers: [
      {
        id: CLIENT_FM_ID,
        firstName: "Regression",
        lastName: "Guard",
        relationship: "other",
        role: "client",
        dateOfBirth: "1968-01-01",
      } as FamilyMember,
    ],
    externalBeneficiaries: [
      { id: CHARITY_EB_ID, name: "Stanford", kind: "charity", charityType: "public" },
    ],
    taxYearRows: [TAX_YEAR_2026],
  } as ClientData;
}

describe("charitable-deduction picks up recipient_external_beneficiary_id gifts", () => {
  it("applies AGI deduction for a $50k cash gift to a public charity", () => {
    const tree = buildTree();
    tree.gifts = [
      {
        id: "g1",
        year: 2026,
        amount: 50_000,
        grantor: "client",
        recipientExternalBeneficiaryId: CHARITY_EB_ID,
        useCrummeyPowers: false,
      } as Gift,
    ];

    const result = runProjection(tree);
    const y = result.find((r) => r.year === 2026)!;

    expect(y).toBeDefined();
    // $40k mortgage interest forces itemizing (> $30k std deduction).
    // $50k gift to public charity is well within 60% AGI limit ($500k × 60% = $300k)
    // so the full $50k must appear in the charitable-deduction breakdown.
    expect(y.deductionBreakdown?.belowLine.charitable ?? 0).toBeGreaterThan(0);
    expect(y.deductionBreakdown?.belowLine.charitable ?? 0).toBe(50_000);
    // Carryforward should be empty — fully consumed in current year.
    expect(y.charityCarryforward?.cashPublic).toEqual([]);
  });

  it("gift without recipientExternalBeneficiaryId does not increase charitable deduction", () => {
    const tree = buildTree();
    // A non-charity gift (no EB link) should produce 0 charitable deduction.
    tree.gifts = [
      {
        id: "g2",
        year: 2026,
        amount: 50_000,
        grantor: "client",
        useCrummeyPowers: false,
      } as Gift,
    ];

    const result = runProjection(tree);
    const y = result.find((r) => r.year === 2026)!;

    expect(y.deductionBreakdown?.belowLine.charitable ?? 0).toBe(0);
  });
});
