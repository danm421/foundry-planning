import { describe, it, expect } from "vitest";
import type { ClientData } from "@/engine/types";
import { applyMutations } from "../apply-mutations";

function makeBase(): ClientData {
  return {
    client: {
      firstName: "Cooper",
      lastName: "Smith",
      dateOfBirth: "1965-03-15",
      retirementAge: 65,
      retirementMonth: 1,
      planEndAge: 95,
      lifeExpectancy: 95,
      spouseName: "Susan",
      spouseDob: "1967-05-20",
      spouseRetirementAge: 63,
      spouseRetirementMonth: 1,
      spouseLifeExpectancy: 93,
      filingStatus: "married_joint",
    },
    accounts: [],
    incomes: [
      {
        id: "income-ss-cooper",
        type: "social_security",
        name: "Cooper SS",
        annualAmount: 30000,
        startYear: 2030,
        endYear: 2055,
        growthRate: 0.025,
        owner: "client",
        claimingAge: 67,
      },
      {
        id: "income-ss-susan",
        type: "social_security",
        name: "Susan SS",
        annualAmount: 25000,
        startYear: 2032,
        endYear: 2060,
        growthRate: 0.025,
        owner: "spouse",
        claimingAge: 67,
      },
      {
        id: "income-salary-cooper",
        type: "salary",
        name: "Cooper Salary",
        annualAmount: 150000,
        startYear: 2026,
        endYear: 2030,
        growthRate: 0.03,
        owner: "client",
      },
    ],
    expenses: [
      {
        id: "expense-living-cooper",
        type: "living",
        name: "Living Expenses",
        annualAmount: 120000,
        startYear: 2026,
        endYear: 2055,
        growthRate: 0.025,
      },
      {
        id: "expense-living-susan",
        type: "living",
        name: "Living Expenses (post-retirement)",
        annualAmount: 80000,
        startYear: 2030,
        endYear: 2060,
        growthRate: 0.025,
      },
      {
        id: "expense-insurance",
        type: "insurance",
        name: "Health",
        annualAmount: 12000,
        startYear: 2026,
        endYear: 2055,
        growthRate: 0.04,
      },
    ],
    liabilities: [],
    savingsRules: [
      {
        id: "savings-401k-cooper",
        accountId: "account-401k-cooper",
        annualAmount: 23000,
        startYear: 2026,
        endYear: 2030,
        isDeductible: true,
      },
      {
        id: "savings-ira-susan",
        accountId: "account-ira-susan",
        annualAmount: 7000,
        startYear: 2026,
        endYear: 2030,
        isDeductible: true,
      },
    ],
    withdrawalStrategy: [],
    planSettings: {} as ClientData["planSettings"],
  };
}

describe("applyMutations", () => {
  it("returns a deep clone (does not mutate input)", () => {
    const base = makeBase();
    const before = JSON.parse(JSON.stringify(base));
    applyMutations(base, [
      { kind: "retirement-age", person: "client", age: 67 },
    ]);
    expect(base).toEqual(before);
  });

  it("retirement-age (client) updates clients.retirementAge and optional month", () => {
    const out = applyMutations(makeBase(), [
      { kind: "retirement-age", person: "client", age: 67, month: 6 },
    ]);
    expect(out.client.retirementAge).toBe(67);
    expect(out.client.retirementMonth).toBe(6);
    expect(out.client.spouseRetirementAge).toBe(63);
  });

  it("retirement-age (spouse) updates spouseRetirementAge/Month", () => {
    const out = applyMutations(makeBase(), [
      { kind: "retirement-age", person: "spouse", age: 65 },
    ]);
    expect(out.client.spouseRetirementAge).toBe(65);
    expect(out.client.retirementAge).toBe(65);
  });

  it("living-expense-scale multiplies every living-type expense and leaves others alone", () => {
    const out = applyMutations(makeBase(), [
      { kind: "living-expense-scale", multiplier: 1.1 },
    ]);
    const cooper = out.expenses.find((e) => e.id === "expense-living-cooper")!;
    const susan = out.expenses.find((e) => e.id === "expense-living-susan")!;
    const insurance = out.expenses.find((e) => e.id === "expense-insurance")!;
    expect(cooper.annualAmount).toBeCloseTo(132000);
    expect(susan.annualAmount).toBeCloseTo(88000);
    expect(insurance.annualAmount).toBe(12000);
  });

  it("income-annual-amount updates only the matching income by id", () => {
    const out = applyMutations(makeBase(), [
      {
        kind: "income-annual-amount",
        incomeId: "income-salary-cooper",
        annualAmount: 175000,
      },
    ]);
    expect(
      out.incomes.find((i) => i.id === "income-salary-cooper")!.annualAmount,
    ).toBe(175000);
    expect(
      out.incomes.find((i) => i.id === "income-ss-cooper")!.annualAmount,
    ).toBe(30000);
  });

  it("income per-field mutations set their respective fields", () => {
    const out = applyMutations(makeBase(), [
      {
        kind: "income-tax-type",
        incomeId: "income-salary-cooper",
        taxType: "qbi",
      },
      {
        kind: "income-growth-source",
        incomeId: "income-salary-cooper",
        source: "inflation",
      },
      {
        kind: "income-growth-rate",
        incomeId: "income-salary-cooper",
        rate: 0.04,
      },
      {
        kind: "income-self-employment",
        incomeId: "income-salary-cooper",
        value: true,
      },
      {
        kind: "income-start-year",
        incomeId: "income-salary-cooper",
        year: 2027,
      },
      {
        kind: "income-end-year",
        incomeId: "income-salary-cooper",
        year: 2035,
      },
    ]);
    const inc = out.incomes.find((i) => i.id === "income-salary-cooper")!;
    expect(inc.taxType).toBe("qbi");
    expect(inc.growthSource).toBe("inflation");
    expect(inc.growthRate).toBe(0.04);
    expect(inc.isSelfEmployment).toBe(true);
    expect(inc.startYear).toBe(2027);
    expect(inc.endYear).toBe(2035);
  });

  it("expense-annual-amount updates only the matching expense by id", () => {
    const out = applyMutations(makeBase(), [
      {
        kind: "expense-annual-amount",
        expenseId: "expense-living-susan",
        annualAmount: 75000,
      },
    ]);
    expect(
      out.expenses.find((e) => e.id === "expense-living-cooper")!.annualAmount,
    ).toBe(120000);
    expect(
      out.expenses.find((e) => e.id === "expense-living-susan")!.annualAmount,
    ).toBe(75000);
    expect(out.expenses.find((e) => e.id === "expense-insurance")!.annualAmount).toBe(
      12000,
    );
  });

  it("ss-claim-age targets the matching owner's social_security income", () => {
    const out = applyMutations(makeBase(), [
      { kind: "ss-claim-age", person: "client", age: 70 },
    ]);
    const cooperSs = out.incomes.find((i) => i.id === "income-ss-cooper")!;
    const susanSs = out.incomes.find((i) => i.id === "income-ss-susan")!;
    expect(cooperSs.claimingAge).toBe(70);
    expect(susanSs.claimingAge).toBe(67);
  });

  it("savings-contribution updates the rule matching accountId", () => {
    const out = applyMutations(makeBase(), [
      {
        kind: "savings-contribution",
        accountId: "account-401k-cooper",
        annualAmount: 30000,
      },
    ]);
    const cooper = out.savingsRules.find(
      (r) => r.accountId === "account-401k-cooper",
    )!;
    const susan = out.savingsRules.find(
      (r) => r.accountId === "account-ira-susan",
    )!;
    expect(cooper.annualAmount).toBe(30000);
    expect(susan.annualAmount).toBe(7000);
  });

  it("savings-annual-percent sets annualPercent (or clears with null)", () => {
    const stepped = applyMutations(makeBase(), [
      {
        kind: "savings-annual-percent",
        accountId: "account-401k-cooper",
        percent: 0.1,
      },
    ]);
    expect(
      stepped.savingsRules.find((r) => r.accountId === "account-401k-cooper")!
        .annualPercent,
    ).toBe(0.1);
    const cleared = applyMutations(stepped, [
      {
        kind: "savings-annual-percent",
        accountId: "account-401k-cooper",
        percent: null,
      },
    ]);
    expect(
      cleared.savingsRules.find((r) => r.accountId === "account-401k-cooper")!
        .annualPercent,
    ).toBeNull();
  });

  it("savings-contribute-max toggles contributeMax", () => {
    const out = applyMutations(makeBase(), [
      {
        kind: "savings-contribute-max",
        accountId: "account-401k-cooper",
        value: true,
      },
    ]);
    expect(
      out.savingsRules.find((r) => r.accountId === "account-401k-cooper")!
        .contributeMax,
    ).toBe(true);
  });

  it("savings-growth-rate and savings-growth-source set their respective fields", () => {
    const out = applyMutations(makeBase(), [
      {
        kind: "savings-growth-rate",
        accountId: "account-401k-cooper",
        rate: 0.03,
      },
      {
        kind: "savings-growth-source",
        accountId: "account-401k-cooper",
        source: "inflation",
      },
    ]);
    const rule = out.savingsRules.find(
      (r) => r.accountId === "account-401k-cooper",
    )!;
    expect(rule.growthRate).toBe(0.03);
    expect(rule.growthSource).toBe("inflation");
  });

  it("savings-deductible and savings-apply-cap set the boolean flags", () => {
    const out = applyMutations(makeBase(), [
      {
        kind: "savings-deductible",
        accountId: "account-401k-cooper",
        value: false,
      },
      {
        kind: "savings-apply-cap",
        accountId: "account-401k-cooper",
        value: false,
      },
    ]);
    const rule = out.savingsRules.find(
      (r) => r.accountId === "account-401k-cooper",
    )!;
    expect(rule.isDeductible).toBe(false);
    expect(rule.applyContributionLimit).toBe(false);
  });

  it("savings-employer-match-pct sets both pct and cap (cap nullable)", () => {
    const out = applyMutations(makeBase(), [
      {
        kind: "savings-employer-match-pct",
        accountId: "account-401k-cooper",
        pct: 0.5,
        cap: 0.06,
      },
    ]);
    const rule = out.savingsRules.find(
      (r) => r.accountId === "account-401k-cooper",
    )!;
    expect(rule.employerMatchPct).toBe(0.5);
    expect(rule.employerMatchCap).toBe(0.06);
  });

  it("savings-employer-match-amount sets the flat amount", () => {
    const out = applyMutations(makeBase(), [
      {
        kind: "savings-employer-match-amount",
        accountId: "account-401k-cooper",
        amount: 5000,
      },
    ]);
    expect(
      out.savingsRules.find((r) => r.accountId === "account-401k-cooper")!
        .employerMatchAmount,
    ).toBe(5000);
  });

  it("savings-start-year and savings-end-year update the timeline", () => {
    const out = applyMutations(makeBase(), [
      {
        kind: "savings-start-year",
        accountId: "account-401k-cooper",
        year: 2027,
      },
      {
        kind: "savings-end-year",
        accountId: "account-401k-cooper",
        year: 2035,
      },
    ]);
    const rule = out.savingsRules.find(
      (r) => r.accountId === "account-401k-cooper",
    )!;
    expect(rule.startYear).toBe(2027);
    expect(rule.endYear).toBe(2035);
  });

  it("life-expectancy (client) updates clients.lifeExpectancy", () => {
    const out = applyMutations(makeBase(), [
      { kind: "life-expectancy", person: "client", age: 100 },
    ]);
    expect(out.client.lifeExpectancy).toBe(100);
    expect(out.client.spouseLifeExpectancy).toBe(93);
  });

  it("life-expectancy (spouse) updates spouseLifeExpectancy", () => {
    const out = applyMutations(makeBase(), [
      { kind: "life-expectancy", person: "spouse", age: 98 },
    ]);
    expect(out.client.spouseLifeExpectancy).toBe(98);
    expect(out.client.lifeExpectancy).toBe(95);
  });

  it("applies multiple mutations of different kinds in order", () => {
    const out = applyMutations(makeBase(), [
      { kind: "retirement-age", person: "client", age: 67 },
      { kind: "living-expense-scale", multiplier: 0.9 },
      { kind: "ss-claim-age", person: "client", age: 70 },
      {
        kind: "savings-contribution",
        accountId: "account-401k-cooper",
        annualAmount: 30000,
      },
      { kind: "life-expectancy", person: "client", age: 100 },
    ]);
    expect(out.client.retirementAge).toBe(67);
    expect(
      out.expenses.find((e) => e.id === "expense-living-cooper")!.annualAmount,
    ).toBeCloseTo(108000);
    expect(
      out.incomes.find((i) => i.id === "income-ss-cooper")!.claimingAge,
    ).toBe(70);
    expect(
      out.savingsRules.find((r) => r.accountId === "account-401k-cooper")!
        .annualAmount,
    ).toBe(30000);
    expect(out.client.lifeExpectancy).toBe(100);
  });
});
