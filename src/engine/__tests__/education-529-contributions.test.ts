import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { basePlanSettings, buildClientData } from "./fixtures";
import { LEGACY_FM_CLIENT } from "../ownership";
import type { Account, ClientData, Income, SavingsRule } from "../types";
import type { TaxYearParameters } from "../../lib/tax/types";

/**
 * Task 4 — external-grantor 529 contributions bypass household cash.
 *
 * A 529 funded by an OUTSIDE grantor (education529.grantorFamilyMemberId is
 * null/undefined — e.g. a grandparent) still receives its savings-rule
 * contribution as an account credit, but household checking is NOT debited
 * (the money is a gift arriving from outside the plan, same shape as an
 * employer match). Household-grantor 529s keep the existing behavior: checking
 * is debited for the contribution.
 *
 * The fixture is deliberately isolated (one salary, default checking, two 529s)
 * so checking only moves for the household-funded contribution.
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

// A 529 whose grantor is the household client — checking IS debited.
const hh529: Account = {
  id: "hh-529",
  name: "Household 529",
  category: "education_savings",
  subType: "529",
  titlingType: "jtwros",
  value: 0,
  basis: 0,
  growthRate: 0,
  rmdEnabled: false,
  education529: { grantorFamilyMemberId: LEGACY_FM_CLIENT, beneficiaryName: "Kid" },
  owners: [{ kind: "external_beneficiary", externalBeneficiaryId: "ben-1", percent: 1 }],
};

// A 529 funded by an outside grantor (grandparent) — checking is NOT debited.
const gp529: Account = {
  id: "gp-529",
  name: "Grandparent 529",
  category: "education_savings",
  subType: "529",
  titlingType: "jtwros",
  value: 0,
  basis: 0,
  growthRate: 0,
  rmdEnabled: false,
  education529: { grantorName: "Grandma", beneficiaryName: "Kid" },
  owners: [{ kind: "external_beneficiary", externalBeneficiaryId: "ben-2", percent: 1 }],
};

const salary: Income = {
  id: "inc-salary",
  type: "salary",
  name: "Client Salary",
  annualAmount: 150000,
  startYear: 2026,
  endYear: 2026,
  growthRate: 0,
  owner: "client",
};

const savingsRule = (id: string, accountId: string): SavingsRule => ({
  id,
  accountId,
  annualAmount: 10000,
  isDeductible: false,
  startYear: 2026,
  endYear: 2026,
});

function makeData() {
  const base = buildClientData({
    planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2026 },
  });
  return {
    ...base,
    accounts: [checking, hh529, gp529],
    incomes: [salary],
    expenses: [],
    liabilities: [],
    savingsRules: [savingsRule("sav-hh", "hh-529"), savingsRule("sav-gp", "gp-529")],
    withdrawalStrategy: [],
  };
}

describe("external-grantor 529 contributions", () => {
  it("credits both 529s but only debits checking for the household-funded one", () => {
    const y = runProjection(makeData())[0];

    // Both accounts received their contribution:
    expect(y.savings.byAccount["hh-529"]).toBe(10_000);
    expect(y.savings.byAccount["gp-529"]).toBe(10_000);
    expect(y.accountLedgers["hh-529"].endingValue).toBeCloseTo(10_000, 6);
    expect(y.accountLedgers["gp-529"].endingValue).toBeCloseTo(10_000, 6);

    // Checking ledger shows a savings_contribution debit of ONLY the
    // household-funded 10k — the grandparent gift never touches household cash.
    const checkingEntries = y.accountLedgers["chk"].entries.filter(
      (e) => e.category === "savings_contribution",
    );
    expect(checkingEntries.reduce((s, e) => s + e.amount, 0)).toBe(-10_000);

    // The external-grantor credit carries no household-checking counterparty.
    const gpEntry = y.accountLedgers["gp-529"].entries.find(
      (e) => e.category === "savings_contribution",
    );
    expect(gpEntry?.counterpartyId).toBeUndefined();
    const hhEntry = y.accountLedgers["hh-529"].entries.find(
      (e) => e.category === "savings_contribution",
    );
    expect(hhEntry?.counterpartyId).toBe("chk");
  });
});

/**
 * Task 6 — state 529 deduction flows from the projection into state income tax.
 *
 * A household-grantor 529 earns the resident state's 529 contribution deduction
 * (NY: capped at $10k MFJ); an external-grantor 529 (grandparent) earns NO
 * household deduction. Both fixtures are identical except for the grantor, so
 * the ONLY difference in state tax is the 529 subtraction. We assert the
 * household fixture pays less NY state tax and that the state-tax diag names the
 * 529 subtraction.
 */

// Minimal 2026 federal params so bracket-mode is active (state engine uses its
// own state bracket tables; these only gate useBracket + feed federal AGI).
const TAX_YEAR_2026: TaxYearParameters = {
  year: 2026,
  incomeBrackets: {
    married_joint: [
      { from: 0, to: 23200, rate: 0.1 },
      { from: 23200, to: 94300, rate: 0.12 },
      { from: 94300, to: 201050, rate: 0.22 },
      { from: 201050, to: 383900, rate: 0.24 },
      { from: 383900, to: 487450, rate: 0.32 },
      { from: 487450, to: 731200, rate: 0.35 },
      { from: 731200, to: null, rate: 0.37 },
    ],
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

function bracketData(opts: { grantorHousehold: boolean }): ClientData {
  const the529: Account = {
    id: "the-529",
    name: "College 529",
    category: "education_savings",
    subType: "529",
    titlingType: "jtwros",
    value: 0,
    basis: 0,
    growthRate: 0,
    rmdEnabled: false,
    education529: opts.grantorHousehold
      ? { grantorFamilyMemberId: LEGACY_FM_CLIENT, beneficiaryName: "Kid" }
      : { grantorName: "Grandma", beneficiaryName: "Kid" },
    owners: [{ kind: "external_beneficiary", externalBeneficiaryId: "ben-1", percent: 1 }],
  };
  const wages: Income = {
    id: "inc-salary",
    type: "salary",
    name: "Client Salary",
    annualAmount: 200_000,
    startYear: 2026,
    endYear: 2026,
    growthRate: 0,
    owner: "client",
  };
  const base = buildClientData({
    planSettings: {
      ...basePlanSettings,
      flatFederalRate: 0,
      flatStateRate: 0,
      inflationRate: 0,
      planStartYear: 2026,
      planEndYear: 2026,
      taxEngineMode: "bracket",
      residenceState: "NY",
    },
  });
  return {
    ...base,
    accounts: [checking, the529],
    incomes: [wages],
    expenses: [],
    liabilities: [],
    savingsRules: [savingsRule("sav-529", "the-529")],
    withdrawalStrategy: [],
    taxYearRows: [TAX_YEAR_2026],
  } as ClientData;
}

describe("state 529 deduction — projection → state income tax", () => {
  it("household-grantor 529 lowers NY state tax and names the 529 subtraction in diag", () => {
    const household = runProjection(bracketData({ grantorHousehold: true }))[0]!;
    const external = runProjection(bracketData({ grantorHousehold: false }))[0]!;

    const hhState = household.taxResult?.state;
    const extState = external.taxResult?.state;
    expect(hhState?.state).toBe("NY");
    expect(hhState!.hasIncomeTax).toBe(true);

    // Contribution amount is $10k (savingsRule) but NY caps the MFJ deduction at
    // $10k — the full contribution is deductible here. Household pays LESS NY tax.
    expect(extState!.stateTax - hhState!.stateTax).toBeGreaterThan(0);
    // The $10k subtraction × NY marginal (~6%) ≈ several hundred dollars.
    expect(extState!.stateTax - hhState!.stateTax).toBeGreaterThan(300);

    // The subtraction landed in the state-taxable-income line (10k lower).
    expect(extState!.stateTaxableIncome - hhState!.stateTaxableIncome).toBeCloseTo(10_000, 6);

    // Diag names the 529 subtraction; external grantor earns no such note.
    expect(hhState!.diag.notes.some((n) => n.includes("529"))).toBe(true);
    expect(extState!.diag.notes.some((n) => n.includes("529"))).toBe(false);
  });
});
