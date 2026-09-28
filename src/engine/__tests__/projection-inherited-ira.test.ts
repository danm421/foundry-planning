import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { buildClientData, basePlanSettings, baseClient } from "./fixtures";
import { TAX_YEAR_2026 } from "./_fixtures/tax-year-2026";
import { LEGACY_FM_CLIENT } from "../ownership";
import type { Account, Expense, FamilyMember, RothConversion } from "../types";

// Spec example 2: owner born 1945 died 2022 (had started RMDs); heir (the
// client) born 1975 → 10-year rule with yearly RMDs, empty by Dec 31, 2032.
const HEIR_BIRTH_YEAR = 1975;

const soloClient: FamilyMember[] = [
  {
    id: LEGACY_FM_CLIENT, role: "client", relationship: "other",
    firstName: "Heir", lastName: "Test", dateOfBirth: `${HEIR_BIRTH_YEAR}-01-01`,
  },
];

const checking: Account = {
  id: "acct-checking", name: "Checking", category: "cash", subType: "checking",
  titlingType: "jtwros", value: 5000, basis: 5000, growthRate: 0, rmdEnabled: false,
  isDefaultChecking: true,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

function inheritedIra(overrides?: Partial<Account>): Account {
  return {
    id: "acct-inh", name: "Inherited IRA", category: "retirement", subType: "traditional_ira",
    titlingType: "jtwros", value: 400_000, basis: 0, growthRate: 0,
    // Deliberately off: an inherited IRA follows the beneficiary schedule regardless.
    rmdEnabled: false,
    owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    inheritedDeathYear: 2022, inheritedOwnerBirthYear: 1945,
    ...overrides,
  };
}

function project(acct: Account, planStartYear = 2026, planEndYear = 2034) {
  const data = buildClientData({
    client: { ...baseClient, dateOfBirth: `${HEIR_BIRTH_YEAR}-01-01`, spouseName: undefined, spouseDob: undefined },
    familyMembers: soloClient,
    accounts: [checking, acct],
    incomes: [], expenses: [], liabilities: [], savingsRules: [],
    withdrawalStrategy: [],
    planSettings: { ...basePlanSettings, planStartYear, planEndYear },
  });
  const years = runProjection(data);
  return (y: number) => {
    const row = years.find((r) => r.year === y);
    if (!row) throw new Error(`no projection row for ${y}`);
    return row;
  };
}

describe("projection — inherited IRA (10-year rule, owner had started RMDs)", () => {
  it("takes the life-expectancy RMD in 2026 even though the heir is 51 and rmdEnabled is false", () => {
    const year = project(inheritedIra())(2026);
    const ledger = year.accountLedgers["acct-inh"];
    expect(ledger.rmdAmount).toBeCloseTo(400_000 / 35.1, 6);
    expect(ledger.entries.some((e) => e.label === "Inherited IRA RMD (10-year rule, divisor 35.1)")).toBe(true);
    const src = year.taxDetail!.bySource["acct-inh:rmd"];
    expect(src.type).toBe("ordinary_income");
    expect(src.amount).toBeCloseTo(400_000 / 35.1, 6);
  });

  it("empties the account in 2032 and leaves it at $0 afterwards", () => {
    const at = project(inheritedIra());
    const final = at(2032).accountLedgers["acct-inh"];
    // At 0% growth each yearly RMD 2026–2031 removes 1/divisor, so 2032 opens
    // at 400,000 × 29.1 / 35.1. Pins that the yearly RMDs actually ran.
    expect(final.rmdAmount).toBeCloseTo((400_000 * 29.1) / 35.1, 2);
    expect(final.endingValue).toBe(0);
    expect(final.entries.some((e) => e.label === "Inherited IRA RMD (10-year rule, final payout)")).toBe(true);
    expect(at(2033).accountLedgers["acct-inh"].rmdAmount).toBe(0);
    expect(at(2033).accountLedgers["acct-inh"].endingValue).toBe(0);
    expect(at(2034).accountLedgers["acct-inh"].endingValue).toBe(0);
  });

  it("uses priorYearEndValue for the first plan year", () => {
    const year = project(inheritedIra({ priorYearEndValue: 380_000 }))(2026);
    expect(year.accountLedgers["acct-inh"].rmdAmount).toBeCloseTo(380_000 / 35.1, 6);
  });

  it("takes nothing in the year of death when that is the plan's first year", () => {
    const at = project(inheritedIra({ inheritedDeathYear: 2026 }));
    expect(at(2026).accountLedgers["acct-inh"].rmdAmount).toBe(0);
    expect(at(2027).accountLedgers["acct-inh"].rmdAmount).toBeGreaterThan(0);
  });
});

describe("projection — inherited Roth IRA", () => {
  it("has no yearly RMDs and pays the full balance out tax-free in 2032", () => {
    const at = project(inheritedIra({ id: "acct-inh", subType: "roth_ira" }));
    expect(at(2026).accountLedgers["acct-inh"].rmdAmount).toBe(0);
    const y2032 = at(2032);
    expect(y2032.accountLedgers["acct-inh"].rmdAmount).toBeCloseTo(400_000, 6);
    expect(y2032.accountLedgers["acct-inh"].endingValue).toBe(0);
    // Recorded as tax-free, and as the account's ONLY row: never
    // ordinary_income, and never the `<id>:rmd` key, which tax-diff's
    // recognizedForAccount sums as taxable without reading `type`.
    const inhRows = Object.entries(y2032.taxDetail!.bySource).filter(([k]) => k.includes("acct-inh"));
    expect(inhRows.map(([k, v]) => [k, v.type])).toEqual([["inherited_roth_tax_free:acct-inh", "tax_free"]]);
    expect(inhRows[0][1].amount).toBeCloseTo(400_000, 6);
    expect(y2032.taxDetail!.ordinaryIncome).toBe(0);
  });

  it("counts the tax-free payout in Total Income, and Net Cash Flow matches the cash that reached checking", () => {
    const y2032 = project(inheritedIra({ subType: "roth_ira" }))(2032);
    expect(y2032.totalIncome).toBeCloseTo(400_000, 6);
    expect(y2032.taxDetail!.ordinaryIncome).toBe(0);
    const chk = y2032.accountLedgers["acct-checking"];
    expect(chk.endingValue - chk.beginningValue).toBeCloseTo(400_000, 6);
    expect(y2032.netCashFlow).toBeCloseTo(chk.endingValue - chk.beginningValue, 6);
  });

  it("counts the payout as household cash when sizing surplus-capped savings (no checking account)", () => {
    // Without a default checking account the legacy path caps savings at the
    // year's household surplus, so the payout must count as an inflow there.
    const brokerage: Account = {
      id: "acct-brokerage", name: "Brokerage", category: "taxable", subType: "brokerage",
      titlingType: "jtwros", value: 0, basis: 0, growthRate: 0, rmdEnabled: false,
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    };
    const data = buildClientData({
      client: { ...baseClient, dateOfBirth: `${HEIR_BIRTH_YEAR}-01-01`, spouseName: undefined, spouseDob: undefined },
      familyMembers: soloClient,
      accounts: [brokerage, inheritedIra({ subType: "roth_ira" })],
      incomes: [], expenses: [], liabilities: [],
      savingsRules: [{
        id: "save-brokerage", accountId: "acct-brokerage", annualAmount: 10_000,
        isDeductible: false, startYear: 2026, endYear: 2034,
      }],
      withdrawalStrategy: [],
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2034 },
    });
    const years = runProjection(data);
    expect(years.find((r) => r.year === 2031)!.savings.total).toBe(0);
    expect(years.find((r) => r.year === 2032)!.savings.total).toBeCloseTo(10_000, 6);
  });
});

describe("projection — inherited Roth payout is reported as non-taxable income (bracket mode)", () => {
  // Every YearTaxInput the year can end on must carry the payout, or the tax
  // result's Non-Taxable Income flickers with whichever pass ran last: the
  // base input (surplus year), the education fold, the fill-bracket seeded
  // input, the supplemental loop (checking shortfall) and the legacy
  // no-checking loop.
  const owned = [{ kind: "family_member" as const, familyMemberId: LEGACY_FM_CLIENT, percent: 1 }];
  const brokerage: Account = {
    id: "acct-brokerage", name: "Brokerage", category: "taxable", subType: "brokerage",
    titlingType: "jtwros", value: 200_000, basis: 200_000, growthRate: 0, rmdEnabled: false, owners: owned,
  };
  // All basis, so a pre-59½ draw is still entirely tax-free.
  const eduRoth: Account = {
    id: "acct-edu-roth", name: "Roth IRA (education)", category: "retirement", subType: "roth_ira",
    titlingType: "jtwros", value: 30_000, basis: 30_000, growthRate: 0, rmdEnabled: false, owners: owned,
  };
  const ownIra: Account = {
    id: "acct-own-ira", name: "Own IRA", category: "retirement", subType: "traditional_ira",
    titlingType: "jtwros", value: 100_000, basis: 0, growthRate: 0, rmdEnabled: false, owners: owned,
  };
  const ownRoth: Account = {
    id: "acct-own-roth", name: "Own Roth", category: "retirement", subType: "roth_ira",
    titlingType: "jtwros", value: 0, basis: 0, growthRate: 0, rmdEnabled: false, owners: owned,
  };

  function year2032(opts: {
    withChecking: boolean;
    expense2032?: number;
    education2032?: boolean;
    fillBracket2032?: boolean;
  }) {
    const expenses: Expense[] = [];
    if (opts.expense2032) {
      expenses.push({ id: "exp-2032", name: "One-off", type: "living", annualAmount: opts.expense2032, growthRate: 0, startYear: 2032, endYear: 2032 });
    }
    if (opts.education2032) {
      expenses.push({
        id: "edu-2032", name: "College", type: "education", annualAmount: 20_000, growthRate: 0,
        startYear: 2032, endYear: 2032, dedicatedAccountIds: [eduRoth.id], payShortfallOutOfPocket: false,
      });
    }
    const data = buildClientData({
      client: { ...baseClient, dateOfBirth: `${HEIR_BIRTH_YEAR}-01-01`, spouseName: undefined, spouseDob: undefined },
      familyMembers: soloClient,
      accounts: [
        ...(opts.withChecking ? [checking] : []),
        brokerage,
        inheritedIra({ subType: "roth_ira" }),
        ...(opts.education2032 ? [eduRoth] : []),
        ...(opts.fillBracket2032 ? [ownIra, ownRoth] : []),
      ],
      incomes: [], expenses, liabilities: [], savingsRules: [],
      withdrawalStrategy: [{ accountId: "acct-brokerage", priorityOrder: 1, startYear: 2026, endYear: 2034 }],
      rothConversions: opts.fillBracket2032
        ? [{
            id: "rc-fill", name: "Fill 22%", destinationAccountId: ownRoth.id, sourceAccountIds: [ownIra.id],
            conversionType: "fill_up_bracket", fillUpBracket: 0.22, fixedAmount: 0,
            startYear: 2032, endYear: 2032, indexingRate: 0,
          }]
        : [],
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2034, taxEngineMode: "bracket" },
      taxYearRows: [TAX_YEAR_2026],
    });
    return runProjection(data).find((r) => r.year === 2032)!;
  }

  it("surplus year: the 400,000 is non-taxable income and moves no tax number", () => {
    const y = year2032({ withChecking: true });
    expect(y.withdrawals.byAccount["acct-brokerage"] ?? 0).toBe(0);
    expect(y.taxResult!.income.nonTaxableIncome).toBeCloseTo(400_000, 6);
    expect(y.taxResult!.flow.adjustedGrossIncome).toBe(0);
    expect(y.expenses.taxes).toBe(0);
    // The tax result's gross figure is separate from the cash-flow total, which
    // counts the payout once.
    expect(y.totalIncome).toBeCloseTo(400_000, 6);
  });

  it("education draw year: the 400,000 sits alongside the education draw's tax-free slice", () => {
    const y = year2032({ withChecking: true, education2032: true });
    expect(y.taxDetail!.bySource["education_tax_free:edu-2032"]?.amount).toBeCloseTo(20_000, 6);
    expect(y.taxResult!.income.nonTaxableIncome).toBeCloseTo(420_000, 6);
  });

  it("fill-bracket conversion year (seeded tax input): the 400,000 is still non-taxable income", () => {
    const y = year2032({ withChecking: true, fillBracket2032: true });
    expect(y.withdrawals.byAccount["acct-brokerage"] ?? 0).toBe(0);
    expect(y.taxDetail!.bySource["roth_conversion:rc-fill"]?.amount ?? 0).toBeGreaterThan(0);
    expect(y.taxResult!.income.nonTaxableIncome).toBeCloseTo(400_000, 6);
  });

  it("shortfall year (supplemental draw): the 400,000 is still non-taxable income", () => {
    const y = year2032({ withChecking: true, expense2032: 450_000 });
    expect(y.withdrawals.byAccount["acct-brokerage"]).toBeGreaterThan(0);
    expect(y.taxResult!.income.nonTaxableIncome).toBeCloseTo(400_000, 6);
  });

  it("no checking account, shortfall (legacy draw): the 400,000 is still non-taxable income", () => {
    const y = year2032({ withChecking: false, expense2032: 450_000 });
    expect(y.withdrawals.byAccount["acct-brokerage"]).toBeGreaterThan(0);
    expect(y.taxResult!.income.nonTaxableIncome).toBeCloseTo(400_000, 6);
  });
});

describe("projection — a non-inherited IRA is unchanged", () => {
  it("still takes no RMD before the owner's own RMD age", () => {
    const year = project(inheritedIra({ inheritedDeathYear: null, inheritedOwnerBirthYear: null, rmdEnabled: true }))(2026);
    expect(year.accountLedgers["acct-inh"].rmdAmount).toBe(0);
  });
});

describe("projection — a pre-59½ voluntary draw from an inherited Traditional IRA (§72(t)(2)(A)(ii))", () => {
  // The heir is 51 in 2026. The inherited RMD (~11,396) and $5,000 of checking
  // cannot cover a $100,000 expense, so the withdrawal strategy draws the rest
  // from the same IRA, beyond its RMD.
  function year2026(acct: Account) {
    const data = buildClientData({
      client: { ...baseClient, dateOfBirth: `${HEIR_BIRTH_YEAR}-01-01`, spouseName: undefined, spouseDob: undefined },
      familyMembers: soloClient,
      accounts: [checking, acct],
      incomes: [], liabilities: [], savingsRules: [],
      expenses: [{ id: "exp-2026", name: "One-off", type: "living", annualAmount: 100_000, growthRate: 0, startYear: 2026, endYear: 2026 }],
      withdrawalStrategy: [{ accountId: "acct-inh", priorityOrder: 1, startYear: 2026, endYear: 2034 }],
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2027, taxEngineMode: "bracket" },
      taxYearRows: [TAX_YEAR_2026],
    });
    return runProjection(data).find((r) => r.year === 2026)!;
  }

  it("is ordinary income with no early-withdrawal penalty", () => {
    const y = year2026(inheritedIra());
    const draw = y.withdrawals.byAccount["acct-inh"] ?? 0;
    expect(draw).toBeGreaterThan(50_000);
    expect(y.taxDetail!.bySource["withdrawal:acct-inh"]).toEqual({ type: "ordinary_income", amount: draw });
    expect(y.taxResult!.flow.earlyWithdrawalPenalty).toBe(0);
    expect(y.expenses.bySource["withdrawal_penalty:acct-inh"]).toBeUndefined();
  });

  it("control: the same draw from the heir's own IRA is penalized 10%", () => {
    const y = year2026(inheritedIra({ inheritedDeathYear: null, inheritedOwnerBirthYear: null }));
    const draw = y.withdrawals.byAccount["acct-inh"] ?? 0;
    expect(draw).toBeGreaterThan(50_000);
    expect(y.taxResult!.flow.earlyWithdrawalPenalty).toBeCloseTo(draw * 0.1, 6);
    expect(y.expenses.bySource["withdrawal_penalty:acct-inh"]).toBeCloseTo(draw * 0.1, 6);
  });
});

describe("projection — a Roth conversion never draws from an inherited IRA", () => {
  const ownRoth: Account = {
    id: "acct-own-roth", name: "Own Roth", category: "retirement", subType: "roth_ira",
    titlingType: "jtwros", value: 0, basis: 0, growthRate: 0, rmdEnabled: false,
    owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
  };
  const fixed50k: RothConversion = {
    id: "rc", name: "Convert 50k", destinationAccountId: ownRoth.id, sourceAccountIds: ["acct-inh"],
    conversionType: "fixed_amount", fixedAmount: 50_000, startYear: 2026, endYear: 2026, indexingRate: 0,
  };
  // Sized by the projection's own joint solve before it is applied, so the
  // sizer must skip the inherited source too, or it taxes a phantom conversion.
  const fill22: RothConversion = {
    id: "rc", name: "Fill 22%", destinationAccountId: ownRoth.id, sourceAccountIds: ["acct-inh"],
    conversionType: "fill_up_bracket", fillUpBracket: 0.22, fixedAmount: 0, startYear: 2026, endYear: 2026, indexingRate: 0,
  };
  const notInherited = { inheritedDeathYear: null, inheritedOwnerBirthYear: null };

  // Checking is large enough to pay the conversion's tax without a draw.
  function year2026(acct: Account, conversions: RothConversion[]) {
    const data = buildClientData({
      client: { ...baseClient, dateOfBirth: `${HEIR_BIRTH_YEAR}-01-01`, spouseName: undefined, spouseDob: undefined },
      familyMembers: soloClient,
      accounts: [{ ...checking, value: 200_000, basis: 200_000 }, acct, ownRoth],
      incomes: [], expenses: [], liabilities: [], savingsRules: [],
      withdrawalStrategy: [],
      rothConversions: conversions,
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2027, taxEngineMode: "bracket" },
      taxYearRows: [TAX_YEAR_2026],
    });
    return runProjection(data).find((r) => r.year === 2026)!;
  }

  it.each([
    ["fixed amount", fixed50k],
    ["fill the 22% bracket", fill22],
  ])("%s: converts nothing and adds no conversion income or tax", (_, conv) => {
    const y = year2026(inheritedIra(), [conv]);
    const baseline = year2026(inheritedIra(), []);
    const inh = y.accountLedgers["acct-inh"];
    expect(inh.entries.filter((e) => e.sourceId === "rc")).toEqual([]);
    // Only the inherited RMD left the account.
    expect(inh.distributions).toBeCloseTo(400_000 / 35.1, 6);
    expect(inh.endingValue).toBeCloseTo(400_000 - 400_000 / 35.1, 6);
    expect(y.accountLedgers["acct-own-roth"].endingValue).toBe(0);
    expect(y.taxDetail!.bySource["roth_conversion:rc"]).toBeUndefined();
    expect((y.rothConversions ?? []).filter((c) => c.gross > 0)).toEqual([]);
    // No phantom income: the year is taxed exactly like the no-conversion year.
    expect(y.taxResult!.flow.adjustedGrossIncome).toBeCloseTo(baseline.taxResult!.flow.adjustedGrossIncome, 6);
    expect(y.expenses.taxes).toBeCloseTo(baseline.expenses.taxes, 6);
  });

  it("control: without the inherited fields the fixed conversion moves $50,000", () => {
    const y = year2026(inheritedIra(notInherited), [fixed50k]);
    const out = y.accountLedgers["acct-inh"].entries.filter((e) => e.sourceId === "rc");
    expect(out.map((e) => e.amount)).toEqual([-50_000]);
    expect(y.accountLedgers["acct-own-roth"].endingValue).toBe(50_000);
    expect(y.taxDetail!.bySource["roth_conversion:rc"]?.amount).toBe(50_000);
  });

  it("a bracket fill listing the inherited IRA first does not lock it away from spending draws", () => {
    // The fill converts from the heir's own IRA; the spending shortfall can
    // only be drawn from the inherited IRA. Reserving the inherited balance for
    // the conversion (it comes first in the list) would leave the draw at $0.
    const ownIra: Account = {
      id: "acct-own-ira", name: "Own IRA", category: "retirement", subType: "traditional_ira",
      titlingType: "jtwros", value: 200_000, basis: 0, growthRate: 0, rmdEnabled: false,
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    };
    const data = buildClientData({
      client: { ...baseClient, dateOfBirth: `${HEIR_BIRTH_YEAR}-01-01`, spouseName: undefined, spouseDob: undefined },
      familyMembers: soloClient,
      accounts: [checking, inheritedIra({ value: 60_000 }), ownIra, ownRoth],
      incomes: [], liabilities: [], savingsRules: [],
      expenses: [{ id: "exp-2026", name: "One-off", type: "living", annualAmount: 40_000, growthRate: 0, startYear: 2026, endYear: 2026 }],
      withdrawalStrategy: [{ accountId: "acct-inh", priorityOrder: 1, startYear: 2026, endYear: 2034 }],
      rothConversions: [{ ...fill22, sourceAccountIds: ["acct-inh", ownIra.id] }],
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2027, taxEngineMode: "bracket" },
      taxYearRows: [TAX_YEAR_2026],
    });
    const y = runProjection(data).find((r) => r.year === 2026)!;
    // Everything left after the RMD was drawn for spending.
    expect(y.withdrawals.byAccount["acct-inh"]).toBeCloseTo(60_000 - 60_000 / 35.1, 6);
    expect(y.accountLedgers["acct-inh"].entries.filter((e) => e.sourceId === "rc")).toEqual([]);
    const converted = y.accountLedgers["acct-own-roth"].endingValue;
    expect(converted).toBeGreaterThan(0);
    expect(y.accountLedgers["acct-own-ira"].endingValue).toBeCloseTo(200_000 - converted, 6);
  });

  it("control: without the inherited fields the bracket fill converts and is taxed", () => {
    const y = year2026(inheritedIra(notInherited), [fill22]);
    const baseline = year2026(inheritedIra(notInherited), []);
    const moved = y.accountLedgers["acct-own-roth"].endingValue;
    expect(moved).toBeGreaterThan(50_000);
    expect(y.taxDetail!.bySource["roth_conversion:rc"]?.amount).toBeCloseTo(moved, 6);
    expect(y.expenses.taxes).toBeGreaterThan(baseline.expenses.taxes);
  });
});
