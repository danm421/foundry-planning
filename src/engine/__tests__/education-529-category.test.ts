import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { basePlanSettings, buildClientData, sampleFamilyMembers } from "./fixtures";
import { LEGACY_FM_CLIENT } from "../ownership";
import type { Account, Expense, FamilyMember } from "../types";
import type { TaxYearParameters } from "../../lib/tax/types";

/**
 * Task 7 — pin test. `applyEducationFunding` (projection.ts) and
 * `categorizeDraw` (withdrawal.ts) key off `subType === "529"`, not
 * `category`, so a dedicated account filed under the new `education_savings`
 * category should draw identically to a legacy 529-filed-as-taxable account:
 * tax-free, and decrementing the dedicated balance. This test exists to catch
 * a regression if a future change adds a category filter to the education
 * pass that excludes `education_savings`.
 */

const checking: Account = {
  id: "chk",
  name: "Checking",
  category: "cash",
  subType: "checking",
  titlingType: "jtwros",
  value: 100000,
  basis: 100000,
  growthRate: 0,
  rmdEnabled: false,
  isDefaultChecking: true,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

const educationSavings529: Account = {
  id: "es529",
  name: "529 College Fund",
  category: "education_savings",
  subType: "529",
  titlingType: "jtwros",
  value: 30000,
  basis: 30000,
  growthRate: 0,
  rmdEnabled: false,
  education529: { grantorFamilyMemberId: LEGACY_FM_CLIENT, beneficiaryFamilyMemberId: "kid-1", beneficiaryName: "Kid" },
  owners: [{ kind: "external_beneficiary", externalBeneficiaryId: "ben-1", percent: 1 }],
};

const eduExpense: Expense = {
  id: "edu",
  type: "education",
  name: "College",
  annualAmount: 20000,
  startYear: 2026,
  endYear: 2026,
  growthRate: 0,
  dedicatedAccountIds: [educationSavings529.id],
  payShortfallOutOfPocket: false,
};

describe("applyEducationFunding — education_savings category", () => {
  it("draws a dedicated education_savings 529 tax-free and decrements its balance", () => {
    const base = buildClientData({
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2026 },
    });
    const data = {
      ...base,
      accounts: [checking, educationSavings529],
      incomes: [],
      expenses: [eduExpense],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
    };

    const years = runProjection(data);
    const y0 = years[0];

    const goal = y0.educationGoals?.find((g) => g.goalId === "edu");
    expect(goal).toBeDefined();
    expect(goal!.dedicatedAssetsBOY).toBe(30000);
    expect(goal!.goalExpense).toBe(20000);
    expect(goal!.dedicatedWithdrawal).toBe(20000);
    expect(goal!.shortfall).toBe(0);
    expect(goal!.dedicatedAssetsEOY).toBeCloseTo(10000, 6);

    // 529 draw is tax-free: no ordinary income / capital gains booked under
    // the goal source.
    const taxSource = y0.taxDetail!.bySource["education:edu"];
    expect(taxSource).toBeUndefined();

    // The 529 balance dropped by exactly the draw; checking is untouched.
    expect(y0.accountLedgers["es529"].endingValue).toBeCloseTo(10000, 6);
    expect(y0.accountLedgers["chk"].endingValue).toBeCloseTo(100000, 6);
  });
});

/**
 * Task 8 — 529 → Roth rollover pass (SECURE 2.0 §126). Leftover 529 balances
 * roll to the beneficiary's Roth IRA, capped each year at the annual IRA limit
 * and, cumulatively, at a $35,000 lifetime allowance. The rollover is tax-free
 * and (with a destination Roth) lands as Roth basis; with no destination the
 * funds simply exit the plan.
 *
 * Minimal 2026 federal params so the tax resolver is populated (the rollover
 * pass needs `taxYearParams` to derive the IRA limit). Beneficiary "kid-1" is
 * age 19 in 2026 → the base IRA limit ($7,000), no catch-up.
 */
const TAX_YEAR_2026: TaxYearParameters = {
  year: 2026,
  incomeBrackets: {
    married_joint: [{ from: 0, to: null, rate: 0.22 }],
    single: [{ from: 0, to: null, rate: 0.22 }],
    head_of_household: [{ from: 0, to: null, rate: 0.22 }],
    married_separate: [{ from: 0, to: null, rate: 0.22 }],
  },
  capGainsBrackets: {
    married_joint: { zeroPctTop: 94050, fifteenPctTop: 583750 },
    single: { zeroPctTop: 47025, fifteenPctTop: 518900 },
    head_of_household: { zeroPctTop: 63000, fifteenPctTop: 551350 },
    married_separate: { zeroPctTop: 47025, fifteenPctTop: 291850 },
  },
  trustIncomeBrackets: [
    { from: 0, to: 3300, rate: 0.1 },
    { from: 3300, to: null, rate: 0.37 },
  ],
  trustCapGainsBrackets: [
    { from: 0, to: 3350, rate: 0 },
    { from: 3350, to: null, rate: 0.2 },
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

// Beneficiary aged 19 in 2026 (born 2007) → base IRA limit, no catch-up.
const beneficiaryKid: FamilyMember = {
  id: "kid-1",
  role: "child",
  relationship: "child",
  firstName: "Kid",
  lastName: "Smith",
  dateOfBirth: "2007-06-01",
};

/** $50,000 529 with rollover enabled from 2026, no internal growth so the
 *  drain schedule is clean. `rothRolloverAccountId` set by the caller. */
function rollover529(rothAccountId: string | undefined): Account {
  return {
    id: "roll529",
    name: "529 Rollover Fund",
    category: "education_savings",
    subType: "529",
    titlingType: "jtwros",
    value: 50000,
    basis: 50000,
    growthRate: 0,
    rmdEnabled: false,
    education529: {
      grantorFamilyMemberId: LEGACY_FM_CLIENT,
      beneficiaryFamilyMemberId: "kid-1",
      beneficiaryName: "Kid",
      rothRolloverEnabled: true,
      rothRolloverStartYear: 2026,
      rothRolloverAccountId: rothAccountId ?? null,
    },
    owners: [{ kind: "external_beneficiary", externalBeneficiaryId: "ben-1", percent: 1 }],
  };
}

const kidRoth: Account = {
  id: "kid-roth",
  name: "Beneficiary Roth IRA",
  category: "retirement",
  subType: "roth_ira",
  titlingType: "jtwros",
  value: 0,
  basis: 0,
  growthRate: 0.05,
  rmdEnabled: false,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

describe("529 → Roth rollover (SECURE 2.0 §126)", () => {
  it("rolls to a household Roth IRA: annual cap, $35k lifetime cap, tax-free", () => {
    const base = buildClientData({
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2031, inflationRate: 0 },
      familyMembers: [...sampleFamilyMembers, beneficiaryKid],
    });
    const data = {
      ...base,
      accounts: [checking, rollover529("kid-roth"), kidRoth],
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      taxYearRows: [TAX_YEAR_2026],
    };

    const years = runProjection(data);

    // Year 1 rollover equals the annual IRA limit ($7,000). Roth has no BOY
    // balance and 5% growth applies before the rollover credit, so its EOY is
    // exactly the rolled amount in year 1.
    const y2026 = years.find((y) => y.year === 2026)!;
    const y2026RollIn = y2026.accountLedgers["kid-roth"].entries
      .filter((e) => e.label === "Rollover from 529")
      .reduce((s, e) => s + e.amount, 0);
    expect(y2026RollIn).toBe(7000);
    expect(y2026.accountLedgers["kid-roth"].endingValue).toBeCloseTo(7000, 6);
    // 529 dropped by exactly the rolled amount.
    expect(y2026.accountLedgers["roll529"].endingValue).toBeCloseTo(43000, 6);

    // Cumulative rolled principal across the whole projection = exactly $35,000
    // (5 years × $7,000). The source 529 falls from $50k to $15k, no further.
    const totalRolledOut = years.reduce(
      (s, y) =>
        s +
        (y.accountLedgers["roll529"]?.entries ?? [])
          .filter((e) => e.label === "529 → Roth IRA rollover")
          .reduce((a, e) => a - e.amount, 0), // outflow entries are negative
      0,
    );
    expect(totalRolledOut).toBeCloseTo(35000, 6);
    const totalRolledIn = years.reduce(
      (s, y) =>
        s +
        (y.accountLedgers["kid-roth"]?.entries ?? [])
          .filter((e) => e.label === "Rollover from 529")
          .reduce((a, e) => a + e.amount, 0),
      0,
    );
    expect(totalRolledIn).toBeCloseTo(35000, 6);

    const yFinal = years.find((y) => y.year === 2031)!;
    expect(yFinal.accountLedgers["roll529"].endingValue).toBeCloseTo(15000, 6);
    // Cap exhausted: the year after the 5th roll (2031) moves nothing.
    const y2031RollIn = yFinal.accountLedgers["kid-roth"].entries.filter(
      (e) => e.label === "Rollover from 529",
    );
    expect(y2031RollIn).toHaveLength(0);

    // Roth grew beyond the rolled principal (5% compounding on prior balances).
    expect(yFinal.accountLedgers["kid-roth"].endingValue).toBeGreaterThan(35000);
    // The rollover is tax-free: no ordinary income booked in any year.
    for (const y of years) {
      expect(y.taxDetail?.ordinaryIncome ?? 0).toBeCloseTo(0, 6);
    }
  });

  it("with no destination Roth: 529 drains on the same schedule, nothing receives it", () => {
    const base = buildClientData({
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2031, inflationRate: 0 },
      familyMembers: [...sampleFamilyMembers, beneficiaryKid],
    });
    const data = {
      ...base,
      accounts: [checking, rollover529(undefined)],
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      taxYearRows: [TAX_YEAR_2026],
    };

    const years = runProjection(data);

    // Same $7k/yr → $35k lifetime drain: 529 ends at $15k.
    const yFinal = years.find((y) => y.year === 2031)!;
    expect(yFinal.accountLedgers["roll529"].endingValue).toBeCloseTo(15000, 6);
    const totalRolledOut = years.reduce(
      (s, y) =>
        s +
        (y.accountLedgers["roll529"]?.entries ?? [])
          .filter((e) => e.label === "529 → Roth IRA rollover")
          .reduce((a, e) => a - e.amount, 0),
      0,
    );
    expect(totalRolledOut).toBeCloseTo(35000, 6);

    // No account other than the draining 529 moved — the funds left the plan.
    // Checking is untouched, and no Roth account exists to receive anything.
    expect(yFinal.accountLedgers["chk"].endingValue).toBeCloseTo(100000, 6);
    expect(yFinal.accountLedgers["kid-roth"]).toBeUndefined();
  });

  it("respects rothRolloverStartYear: no rollover before the start year", () => {
    const late529 = rollover529("kid-roth");
    late529.education529!.rothRolloverStartYear = 2028;
    const base = buildClientData({
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2028, inflationRate: 0 },
      familyMembers: [...sampleFamilyMembers, beneficiaryKid],
    });
    const data = {
      ...base,
      accounts: [checking, late529, kidRoth],
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      taxYearRows: [TAX_YEAR_2026],
    };

    const years = runProjection(data);

    // 2026 + 2027 are before the start year → 529 untouched, Roth empty.
    const y2027 = years.find((y) => y.year === 2027)!;
    expect(y2027.accountLedgers["roll529"].endingValue).toBeCloseTo(50000, 6);
    expect(y2027.accountLedgers["kid-roth"].endingValue).toBeCloseTo(0, 6);
    // 2028: rollover begins.
    const y2028 = years.find((y) => y.year === 2028)!;
    expect(y2028.accountLedgers["roll529"].endingValue).toBeCloseTo(43000, 6);
    expect(y2028.accountLedgers["kid-roth"].endingValue).toBeCloseTo(7000, 6);
  });
});
