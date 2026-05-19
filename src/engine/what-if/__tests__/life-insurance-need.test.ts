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
      growthRate: 0.05,
      finalExpenses: 25_000,
      livingExpenseAtDeath: null,
      payOffDebtsAtDeath: false,
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
      growthRate: 0.05,
      finalExpenses: 0,
      livingExpenseAtDeath: null,
      payOffDebtsAtDeath: false,
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
      growthRate: 0.05,
      finalExpenses: 25_000,
      livingExpenseAtDeath: null,
      payOffDebtsAtDeath: false,
    });
    const policy = out.accounts.find((a) => a.category === "life_insurance");
    expect(policy).toBeDefined();
    expect(policy!.insuredPerson).toBe("client");
    expect(policy!.lifeInsurance!.faceValue).toBe(1_000_000);
    expect(policy!.lifeInsurance!.postPayoutGrowthRate).toBe(0.05);
  });

  it("overrides estate admin expenses with the final-expenses input", () => {
    const out = buildLifeInsuranceWhatIfData({
      data: marriedBase(),
      deceased: "spouse",
      deathYear: 2032,
      faceValue: 0,
      growthRate: 0.05,
      finalExpenses: 40_000,
      livingExpenseAtDeath: null,
      payOffDebtsAtDeath: false,
    });
    expect(out.planSettings.estateAdminExpenses).toBe(40_000);
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
      growthRate: 0.05,
      finalExpenses: 0,
      livingExpenseAtDeath: null,
      payOffDebtsAtDeath: false,
    });
    const out = buildLifeInsuranceWhatIfData({
      data,
      deceased: "client",
      deathYear: 2030,
      faceValue: 2_000_000,
      growthRate: 0.05,
      finalExpenses: 0,
      livingExpenseAtDeath: null,
      payOffDebtsAtDeath: false,
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
      growthRate: 0.05,
      finalExpenses: 0,
      livingExpenseAtDeath: 80_000,
      payOffDebtsAtDeath: false,
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
      growthRate: 0.05,
      finalExpenses: 0,
      livingExpenseAtDeath: 80_000,
      payOffDebtsAtDeath: false,
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
      growthRate: 0.05,
      finalExpenses: 0,
      livingExpenseAtDeath: null,
      payOffDebtsAtDeath: false,
    });
    expect(out.expenses).toHaveLength(1);
    expect(out.expenses[0].endYear).toBe(2070);
  });
});

describe("buildLifeInsuranceWhatIfData — pay off debts at death", () => {
  it("clears liabilities and books a death-year payoff outflow when enabled", () => {
    const data = marriedBase();
    // Use sampleLiabilities fixture (mortgage, 300k balance, starts 2026)
    data.liabilities = [{ ...sampleLiabilities[0] }];
    const out = buildLifeInsuranceWhatIfData({
      data,
      deceased: "client",
      deathYear: 2030,
      faceValue: 0,
      growthRate: 0.05,
      finalExpenses: 0,
      livingExpenseAtDeath: null,
      payOffDebtsAtDeath: true,
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

  it("leaves liabilities in place when the toggle is off", () => {
    const data = marriedBase();
    data.liabilities = [{ ...sampleLiabilities[0] }];
    const out = buildLifeInsuranceWhatIfData({
      data,
      deceased: "client",
      deathYear: 2030,
      faceValue: 0,
      growthRate: 0.05,
      finalExpenses: 0,
      livingExpenseAtDeath: null,
      payOffDebtsAtDeath: false,
    });
    expect(out.liabilities).toHaveLength(1);
    expect(out.expenses.find((e) => e.id === "li-solver-debt-payoff")).toBeUndefined();
  });
});

describe("runLifeInsuranceWhatIf + survivorEndingPortfolio", () => {
  it("ending portfolio is monotonically increasing in face value", () => {
    const base = {
      data: marriedBase(),
      deceased: "client" as const,
      deathYear: 2030,
      growthRate: 0.05,
      finalExpenses: 25_000,
      livingExpenseAtDeath: null,
      payOffDebtsAtDeath: false,
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
      growthRate: 0.05,
      finalExpenses: 0,
      livingExpenseAtDeath: null,
      payOffDebtsAtDeath: false,
    });
    // spouse born 1972, LE 92 -> dies 2064
    expect(projection[projection.length - 1].year).toBeGreaterThanOrEqual(2064);
  });
});
