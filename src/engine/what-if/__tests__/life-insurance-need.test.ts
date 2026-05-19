import { describe, it, expect } from "vitest";
import { runProjection } from "@/engine/projection";
import {
  buildLifeInsuranceWhatIfData,
  runLifeInsuranceWhatIf,
  survivorEndingPortfolio,
  SYNTHETIC_POLICY_ID,
} from "../life-insurance-need";
import type { ClientData } from "@/engine/types";
import {
  baseClient,
  basePlanSettings,
  sampleAccounts,
  sampleFamilyMembers,
  sampleLiabilities,
} from "@/engine/__tests__/fixtures";
import type { Liability } from "@/engine/types";

/** Liability fixture for selective-debt-payoff tests. Matches the real
 *  `Liability` shape. */
function makeLiability(over: { id: string; balance: number }): Liability {
  return {
    id: over.id,
    name: over.id,
    balance: over.balance,
    interestRate: 0.05,
    monthlyPayment: 1_000,
    startYear: 2020,
    startMonth: 1,
    termMonths: 360,
    extraPayments: [],
    owners: [],
  };
}

/** Married household fixture. lifeExpectancy / spouseLifeExpectancy are set so
 *  the engine's death-event machinery has a death year to fire on. The
 *  `familyMembers` array is required — the life-insurance payout routes the
 *  death benefit to the survivor via a `householdRole`-tagged beneficiary,
 *  which only resolves when the survivor's FamilyMember row exists. */
function marriedBase(): ClientData {
  return {
    client: {
      ...baseClient,
      dateOfBirth: "1970-01-01",
      filingStatus: "married_joint",
      lifeExpectancy: 90,
      spouseName: "Spouse",
      spouseDob: "1972-01-01",
      spouseLifeExpectancy: 92,
    },
    accounts: sampleAccounts,
    incomes: [],
    expenses: [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2070 },
    familyMembers: sampleFamilyMembers,
    entities: [],
    giftEvents: [],
  } as ClientData;
}

describe("buildLifeInsuranceWhatIfData", () => {
  it("sets the deceased client's life expectancy to their age in the death year", () => {
    const out = buildLifeInsuranceWhatIfData({
      data: marriedBase(),
      deceased: "client",
      deathYear: 2030,
      faceValue: 1_000_000,
      proceedsGrowthRate: 0.05,
      livingExpenseAtDeath: null,
      payoffLiabilityIds: [],
    });
    // born 1970, dies 2030 -> age 60
    expect(out.client.lifeExpectancy).toBe(60);
    // survivor (spouse) life expectancy untouched
    expect(out.client.spouseLifeExpectancy).toBe(92);
  });

  it("sets the deceased spouse's life expectancy to their age in the death year", () => {
    const out = buildLifeInsuranceWhatIfData({
      data: marriedBase(),
      deceased: "spouse",
      deathYear: 2032,
      faceValue: 0,
      proceedsGrowthRate: 0.05,
      livingExpenseAtDeath: null,
      payoffLiabilityIds: [],
    });
    // spouse born 1972, dies 2032 -> age 60
    expect(out.client.spouseLifeExpectancy).toBe(60);
    expect(out.client.lifeExpectancy).toBe(90); // client untouched
  });

  it("injects a life_insurance account for the deceased with the candidate face value", () => {
    const out = buildLifeInsuranceWhatIfData({
      data: marriedBase(),
      deceased: "client",
      deathYear: 2030,
      faceValue: 1_000_000,
      proceedsGrowthRate: 0.05,
      livingExpenseAtDeath: null,
      payoffLiabilityIds: [],
    });
    const policy = out.accounts.find((a) => a.category === "life_insurance");
    expect(policy).toBeDefined();
    expect(policy!.insuredPerson).toBe("client");
    expect(policy!.lifeInsurance!.faceValue).toBe(1_000_000);
    expect(policy!.lifeInsurance!.postPayoutGrowthRate).toBe(0.05);
  });

  it("does not override planSettings.estateAdminExpenses", () => {
    const data = marriedBase();
    data.planSettings.estateAdminExpenses = 31_000;
    const out = buildLifeInsuranceWhatIfData({
      data,
      deceased: "client",
      deathYear: 2030,
      faceValue: 1_000_000,
      proceedsGrowthRate: 0.05,
      livingExpenseAtDeath: null,
      payoffLiabilityIds: [],
    });
    expect(out.planSettings.estateAdminExpenses).toBe(31_000);
  });

  it("sets the synthetic policy's postPayoutGrowthRate from proceedsGrowthRate", () => {
    const out = buildLifeInsuranceWhatIfData({
      data: marriedBase(),
      deceased: "client",
      deathYear: 2030,
      faceValue: 1_000_000,
      proceedsGrowthRate: 0.062,
      livingExpenseAtDeath: null,
      payoffLiabilityIds: [],
    });
    const synthetic = out.accounts.find((a) => a.id === SYNTHETIC_POLICY_ID)!;
    expect(synthetic.lifeInsurance!.postPayoutGrowthRate).toBe(0.062);
    expect(synthetic.lifeInsurance!.postPayoutRealization).toBeUndefined();
  });

  it("attaches postPayoutRealization when proceedsRealization is supplied", () => {
    const realization = {
      pctOrdinaryIncome: 0.1,
      pctLtCapitalGains: 0.7,
      pctQualifiedDividends: 0.15,
      pctTaxExempt: 0.05,
      turnoverPct: 0,
    };
    const out = buildLifeInsuranceWhatIfData({
      data: marriedBase(),
      deceased: "client",
      deathYear: 2030,
      faceValue: 1_000_000,
      proceedsGrowthRate: 0.062,
      proceedsRealization: realization,
      livingExpenseAtDeath: null,
      payoffLiabilityIds: [],
    });
    const synthetic = out.accounts.find((a) => a.id === SYNTHETIC_POLICY_ID)!;
    expect(synthetic.lifeInsurance!.postPayoutRealization).toEqual(realization);
  });

  it("pays the synthetic policy out to the survivor at the death year", () => {
    const data = marriedBase();

    // Baseline: same death year, no synthetic policy → measures the
    // survivor's portfolio without any death benefit.
    const baseline = buildLifeInsuranceWhatIfData({
      data,
      deceased: "client",
      deathYear: 2030,
      faceValue: 0,
      proceedsGrowthRate: 0.05,
      livingExpenseAtDeath: null,
      payoffLiabilityIds: [],
    });
    const out = buildLifeInsuranceWhatIfData({
      data,
      deceased: "client",
      deathYear: 2030,
      faceValue: 2_000_000,
      proceedsGrowthRate: 0.05,
      livingExpenseAtDeath: null,
      payoffLiabilityIds: [],
    });

    // The death event reclassifies the policy at end-of-death-year; the
    // proceeds first surface as a portfolio line the FOLLOWING year (2031).
    // Compare that post-death year against the no-policy baseline.
    const baselineRow = runProjection(baseline).find((y) => y.year === 2031)!;
    const proceedsRow = runProjection(out).find((y) => y.year === 2031)!;

    // proceeds (~2M, §101 tax-free, grown one year at 5%) land in the
    // survivor's portfolio — the post-death total is higher than the
    // no-policy baseline by roughly the face value.
    const delta = proceedsRow.portfolioAssets.total - baselineRow.portfolioAssets.total;
    expect(delta).toBeGreaterThan(1_900_000);

    // The proceeds specifically land as a cash account owned by the survivor.
    expect(proceedsRow.portfolioAssets.cash[SYNTHETIC_POLICY_ID]).toBeGreaterThan(
      1_900_000,
    );
  });
});

describe("buildLifeInsuranceWhatIfData — living expenses at death", () => {
  it("replaces living expenses from the death year with the override amount", () => {
    const data = marriedBase();
    data.expenses = [
      {
        id: "e1",
        type: "living",
        name: "Lifestyle",
        annualAmount: 120_000,
        startYear: 2026,
        endYear: 2070,
        growthRate: 0,
      },
    ];
    const out = buildLifeInsuranceWhatIfData({
      data,
      deceased: "client",
      deathYear: 2030,
      faceValue: 0,
      proceedsGrowthRate: 0.05,
      livingExpenseAtDeath: 80_000,
      payoffLiabilityIds: [],
    });
    const living = out.expenses.filter((e) => e.type === "living");
    // original ended the year before death
    const original = living.find((e) => e.id === "e1")!;
    expect(original.endYear).toBe(2029);
    // replacement starts at death year at the override amount
    const replacement = living.find((e) => e.startYear === 2030)!;
    expect(replacement.annualAmount).toBe(80_000);
    expect(replacement.growthRate).toBe(basePlanSettings.inflationRate);
    expect(replacement.endYear).toBe(2070);
  });

  it("the post-death living expense covers the extended survivor horizon", () => {
    const data = marriedBase();
    data.planSettings.planEndYear = 2040; // shorter than survivor's death year (2064)
    const out = buildLifeInsuranceWhatIfData({
      data,
      deceased: "client",
      deathYear: 2030,
      faceValue: 0,
      proceedsGrowthRate: 0.05,
      livingExpenseAtDeath: 80_000,
      payoffLiabilityIds: [],
    });
    const replacement = out.expenses.find((e) => e.id === "li-solver-living-at-death")!;
    // spouse born 1972 + LE 92 -> dies 2064; the replacement must run through
    // the EXTENDED horizon, not the original short planEndYear (2040).
    expect(replacement.endYear).toBe(2064);
  });

  it("leaves living expenses untouched when the override is null", () => {
    const data = marriedBase();
    data.expenses = [
      {
        id: "e1",
        type: "living",
        name: "Lifestyle",
        annualAmount: 120_000,
        startYear: 2026,
        endYear: 2070,
        growthRate: 0,
      },
    ];
    const out = buildLifeInsuranceWhatIfData({
      data,
      deceased: "client",
      deathYear: 2030,
      faceValue: 0,
      proceedsGrowthRate: 0.05,
      livingExpenseAtDeath: null,
      payoffLiabilityIds: [],
    });
    expect(out.expenses).toHaveLength(1);
    expect(out.expenses[0].endYear).toBe(2070);
  });
});

describe("buildLifeInsuranceWhatIfData — pay off debts at death", () => {
  it("clears the selected liability and books a death-year payoff outflow", () => {
    const data = marriedBase();
    // Use sampleLiabilities fixture (mortgage, 300k balance, starts 2026)
    data.liabilities = [{ ...sampleLiabilities[0] }];
    const out = buildLifeInsuranceWhatIfData({
      data,
      deceased: "client",
      deathYear: 2030,
      faceValue: 0,
      proceedsGrowthRate: 0.05,
      livingExpenseAtDeath: null,
      payoffLiabilityIds: ["liab-mortgage"],
    });
    // liabilities cleared so the survivor carries no debt past death
    expect(out.liabilities).toHaveLength(0);
    // a one-time death-year "other" expense covers the payoff
    const payoff = out.expenses.find((e) => e.id === "li-solver-debt-payoff");
    expect(payoff).toBeDefined();
    expect(payoff!.startYear).toBe(2030);
    expect(payoff!.endYear).toBe(2030);
    expect(payoff!.annualAmount).toBeGreaterThan(0);
  });

  it("leaves liabilities in place when the id list is empty", () => {
    const data = marriedBase();
    data.liabilities = [{ ...sampleLiabilities[0] }];
    const out = buildLifeInsuranceWhatIfData({
      data,
      deceased: "client",
      deathYear: 2030,
      faceValue: 0,
      proceedsGrowthRate: 0.05,
      livingExpenseAtDeath: null,
      payoffLiabilityIds: [],
    });
    expect(out.liabilities).toHaveLength(1);
    expect(out.expenses.find((e) => e.id === "li-solver-debt-payoff")).toBeUndefined();
  });
});

describe("buildLifeInsuranceWhatIfData — selective debt payoff", () => {
  it("retires only the selected liabilities and leaves the rest", () => {
    const data = marriedBase();
    data.liabilities = [
      makeLiability({ id: "loan-a", balance: 100_000 }),
      makeLiability({ id: "loan-b", balance: 250_000 }),
    ];
    const out = buildLifeInsuranceWhatIfData({
      data,
      deceased: "client",
      deathYear: 2030,
      faceValue: 0,
      proceedsGrowthRate: 0.05,
      livingExpenseAtDeath: null,
      payoffLiabilityIds: ["loan-a"],
    });
    expect(out.liabilities.map((l) => l.id)).toEqual(["loan-b"]);
    const payoff = out.expenses.find((e) => e.id === "li-solver-debt-payoff");
    expect(payoff).toBeDefined();
    expect(payoff!.startYear).toBe(2030);
  });

  it("books no payoff and removes nothing when the list is empty", () => {
    const data = marriedBase();
    data.liabilities = [makeLiability({ id: "loan-a", balance: 100_000 })];
    const out = buildLifeInsuranceWhatIfData({
      data,
      deceased: "client",
      deathYear: 2030,
      faceValue: 0,
      proceedsGrowthRate: 0.05,
      livingExpenseAtDeath: null,
      payoffLiabilityIds: [],
    });
    expect(out.liabilities).toHaveLength(1);
    expect(out.expenses.find((e) => e.id === "li-solver-debt-payoff")).toBeUndefined();
  });

  it("ignores ids that no longer exist", () => {
    const data = marriedBase();
    data.liabilities = [makeLiability({ id: "loan-a", balance: 100_000 })];
    const out = buildLifeInsuranceWhatIfData({
      data,
      deceased: "client",
      deathYear: 2030,
      faceValue: 0,
      proceedsGrowthRate: 0.05,
      livingExpenseAtDeath: null,
      payoffLiabilityIds: ["loan-a", "ghost-loan"],
    });
    expect(out.liabilities).toHaveLength(0);
    expect(out.expenses.find((e) => e.id === "li-solver-debt-payoff")).toBeDefined();
  });
});

describe("runLifeInsuranceWhatIf + survivorEndingPortfolio", () => {
  it("ending portfolio is monotonically increasing in face value", () => {
    const base = {
      data: marriedBase(),
      deceased: "client" as const,
      deathYear: 2030,
      proceedsGrowthRate: 0.05,
      livingExpenseAtDeath: null,
      payoffLiabilityIds: [],
    };
    const low = survivorEndingPortfolio(
      runLifeInsuranceWhatIf({ ...base, faceValue: 500_000 }),
      base.deceased,
      base.data,
    );
    const high = survivorEndingPortfolio(
      runLifeInsuranceWhatIf({ ...base, faceValue: 3_000_000 }),
      base.deceased,
      base.data,
    );
    expect(high).toBeGreaterThan(low);
  });

  it("extends the plan horizon to cover the survivor's life expectancy", () => {
    const data = marriedBase();
    data.planSettings.planEndYear = 2040; // shorter than survivor's LE year
    const projection = runLifeInsuranceWhatIf({
      data,
      deceased: "client",
      deathYear: 2030,
      faceValue: 1_000_000,
      proceedsGrowthRate: 0.05,
      livingExpenseAtDeath: null,
      payoffLiabilityIds: [],
    });
    // spouse born 1972, LE 92 -> dies 2064
    expect(projection[projection.length - 1].year).toBeGreaterThanOrEqual(2064);
  });
});
