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
    giftEvents: [],
    planSettings: { planStartYear: 2026 } as ClientData["planSettings"],
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

  it("living-expense-scale multiplies only retirement (post-plan-start) living expenses, leaving current living + non-living alone", () => {
    const out = applyMutations(makeBase(), [
      { kind: "living-expense-scale", multiplier: 1.1 },
    ]);
    const cooper = out.expenses.find((e) => e.id === "expense-living-cooper")!;
    const susan = out.expenses.find((e) => e.id === "expense-living-susan")!;
    const insurance = out.expenses.find((e) => e.id === "expense-insurance")!;
    // Current living expense (startYear 2026 === planStartYear) is what the
    // advisor typed — never scaled.
    expect(cooper.annualAmount).toBe(120000);
    // Retirement living expense (startYear 2030 > planStartYear) is scaled.
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

  it("savings-roth-percent sets rothPercent on the matching rule", () => {
    const stepped = applyMutations(makeBase(), [
      {
        kind: "savings-roth-percent",
        accountId: "account-401k-cooper",
        rothPercent: 1,
      },
    ]);
    expect(
      stepped.savingsRules.find((r) => r.accountId === "account-401k-cooper")!
        .rothPercent,
    ).toBe(1);

    const split = applyMutations(stepped, [
      {
        kind: "savings-roth-percent",
        accountId: "account-401k-cooper",
        rothPercent: 0.4,
      },
    ]);
    expect(
      split.savingsRules.find((r) => r.accountId === "account-401k-cooper")!
        .rothPercent,
    ).toBe(0.4);
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
    // Current living expense untouched; retirement living expense scaled by 0.9.
    expect(
      out.expenses.find((e) => e.id === "expense-living-cooper")!.annualAmount,
    ).toBe(120000);
    expect(
      out.expenses.find((e) => e.id === "expense-living-susan")!.annualAmount,
    ).toBeCloseTo(72000);
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

// ── Re-resolution of milestone-anchored year refs ───────────────────────────
//
// When a mutation moves a household milestone (e.g., retirement age, plan end
// age), every income/expense/savings rule/withdrawal/transfer/roth conversion
// whose start- or end-year is anchored to that milestone should have its
// concrete `startYear`/`endYear` reshifted. The engine itself treats
// `startYearRef`/`endYearRef` as view-only metadata and only reads the
// resolved numbers, so without this pass dependent rows silently keep their
// pre-mutation windows and the projection diverges from what the UI promises.

function makeRefsBase(): ClientData {
  return {
    client: {
      firstName: "Cooper",
      lastName: "Smith",
      dateOfBirth: "1965-03-15", // birth year 1965
      retirementAge: 65, // → client_retirement = 2030
      retirementMonth: 1,
      planEndAge: 95, // → client_end = 2060
      lifeExpectancy: 95,
      spouseName: "Susan",
      spouseDob: "1967-05-20", // birth year 1967
      spouseRetirementAge: 63, // → spouse_retirement = 2030
      spouseRetirementMonth: 1,
      spouseLifeExpectancy: 93,
      filingStatus: "married_joint",
    },
    accounts: [],
    incomes: [
      {
        id: "income-salary-cooper",
        type: "salary",
        name: "Cooper Salary",
        annualAmount: 150000,
        startYear: 2026,
        endYear: 2029, // last year before retirement (transition end = year - 1)
        growthRate: 0.03,
        owner: "client",
        startYearRef: "plan_start",
        endYearRef: "client_retirement",
      },
      {
        id: "income-deferred-cooper",
        type: "deferred",
        name: "Pension",
        annualAmount: 40000,
        startYear: 2030, // first year of retirement
        endYear: 2060,
        growthRate: 0.0,
        owner: "client",
        startYearRef: "client_retirement",
        endYearRef: "client_end",
      },
      {
        id: "income-other-untied",
        type: "other",
        name: "Royalties",
        annualAmount: 5000,
        startYear: 2026,
        endYear: 2065,
        growthRate: 0.0,
        owner: "client",
        // No refs — should not be touched by re-resolution.
      },
    ],
    expenses: [
      {
        id: "expense-living-cooper",
        type: "living",
        name: "Living (pre-retirement)",
        annualAmount: 120000,
        startYear: 2026,
        endYear: 2029,
        growthRate: 0.025,
        startYearRef: "plan_start",
        endYearRef: "client_retirement",
      },
    ],
    liabilities: [],
    savingsRules: [
      {
        id: "savings-401k-cooper",
        accountId: "account-401k-cooper",
        annualAmount: 23000,
        startYear: 2026,
        endYear: 2029,
        isDeductible: true,
        startYearRef: "plan_start",
        endYearRef: "client_retirement",
      },
    ],
    withdrawalStrategy: [],
    giftEvents: [],
    planSettings: {
      planStartYear: 2026,
      planEndYear: 2065,
    } as ClientData["planSettings"],
  };
}

describe("applyMutations — milestone-ref re-resolution", () => {
  it("retirement-age (client) reshifts end-at-retirement income endYear", () => {
    const out = applyMutations(makeRefsBase(), [
      { kind: "retirement-age", person: "client", age: 70 },
    ]);
    const salary = out.incomes.find((i) => i.id === "income-salary-cooper")!;
    // birth 1965 + age 70 = 2035; end-position on transition ref = year - 1
    expect(salary.endYear).toBe(2034);
    // startYearRef is "plan_start" — unchanged
    expect(salary.startYear).toBe(2026);
  });

  it("retirement-age (client) reshifts start-at-retirement income startYear", () => {
    const out = applyMutations(makeRefsBase(), [
      { kind: "retirement-age", person: "client", age: 70 },
    ]);
    const pension = out.incomes.find((i) => i.id === "income-deferred-cooper")!;
    // start-position on transition ref = milestone year (2035)
    expect(pension.startYear).toBe(2035);
    // endYearRef = "client_end" is also a transition ref (end-position →
    // year - 1). Unchanged because planEndAge wasn't mutated: 1965 + 95 - 1.
    expect(pension.endYear).toBe(2059);
  });

  it("retirement-age (client) reshifts retirement-anchored expense and savings rule", () => {
    const out = applyMutations(makeRefsBase(), [
      { kind: "retirement-age", person: "client", age: 70 },
    ]);
    const expense = out.expenses.find((e) => e.id === "expense-living-cooper")!;
    expect(expense.endYear).toBe(2034);
    const savings = out.savingsRules.find((s) => s.id === "savings-401k-cooper")!;
    expect(savings.endYear).toBe(2034);
  });

  it("rows without refs are left untouched", () => {
    const out = applyMutations(makeRefsBase(), [
      { kind: "retirement-age", person: "client", age: 70 },
    ]);
    const untied = out.incomes.find((i) => i.id === "income-other-untied")!;
    expect(untied.startYear).toBe(2026);
    expect(untied.endYear).toBe(2065);
  });

  it("preserves the original startYearRef/endYearRef strings", () => {
    const out = applyMutations(makeRefsBase(), [
      { kind: "retirement-age", person: "client", age: 70 },
    ]);
    const salary = out.incomes.find((i) => i.id === "income-salary-cooper")!;
    expect(salary.startYearRef).toBe("plan_start");
    expect(salary.endYearRef).toBe("client_retirement");
  });

  it("non-anchor mutations don't reshift anything", () => {
    const base = makeRefsBase();
    const out = applyMutations(base, [
      { kind: "living-expense-scale", multiplier: 1.1 },
    ]);
    // Re-resolution still runs but produces identical years (same anchors).
    const salary = out.incomes.find((i) => i.id === "income-salary-cooper")!;
    expect(salary.endYear).toBe(2029);
    const expense = out.expenses.find((e) => e.id === "expense-living-cooper")!;
    expect(expense.endYear).toBe(2029);
  });
});

describe("living-expense-amount", () => {
  it("scales existing retirement rows proportionally to sum to the amount", () => {
    const tree = {
      ...makeBase(),
      planSettings: {
        planStartYear: 2026,
        planEndYear: 2070,
        inflationRate: 0.025,
      } as ClientData["planSettings"],
      expenses: [
        { id: "r1", type: "living", name: "Base", annualAmount: 30_000, startYear: 2040, endYear: 2070, growthRate: 0 },
        { id: "r2", type: "living", name: "Travel", annualAmount: 10_000, startYear: 2040, endYear: 2070, growthRate: 0 },
        { id: "c1", type: "living", name: "Current", annualAmount: 50_000, startYear: 2026, endYear: 2039, growthRate: 0 },
      ],
    } as unknown as ClientData;
    const out = applyMutations(tree, [{ kind: "living-expense-amount", amount: 80_000 }]);
    const r1 = out.expenses.find((e) => e.id === "r1")!;
    const r2 = out.expenses.find((e) => e.id === "r2")!;
    const c1 = out.expenses.find((e) => e.id === "c1")!;
    expect(r1.annualAmount + r2.annualAmount).toBe(80_000); // total hits target
    expect(r1.annualAmount).toBe(60_000); // 30k/40k * 80k
    expect(r2.annualAmount).toBe(20_000);
    expect(c1.annualAmount).toBe(50_000); // current phase untouched
  });

  it("even-splits the amount across all-zero retirement rows", () => {
    const tree = {
      ...makeBase(),
      planSettings: {
        planStartYear: 2026,
        planEndYear: 2070,
        inflationRate: 0.025,
      } as ClientData["planSettings"],
      expenses: [
        { id: "r1", type: "living", name: "A", annualAmount: 0, startYear: 2040, endYear: 2070, growthRate: 0 },
        { id: "r2", type: "living", name: "B", annualAmount: 0, startYear: 2040, endYear: 2070, growthRate: 0 },
      ],
    } as unknown as ClientData;
    const out = applyMutations(tree, [{ kind: "living-expense-amount", amount: 60_000 }]);
    expect(out.expenses.find((e) => e.id === "r1")!.annualAmount).toBe(30_000);
    expect(out.expenses.find((e) => e.id === "r2")!.annualAmount).toBe(30_000);
  });

  it("synthesizes a retirement row when none exists", () => {
    const tree = {
      ...makeBase(),
      planSettings: {
        planStartYear: 2026,
        planEndYear: 2070,
        inflationRate: 0.025,
      } as ClientData["planSettings"],
      client: {
        ...makeBase().client,
        retirementAge: 65,
      },
      expenses: [
        { id: "c1", type: "living", name: "Current", annualAmount: 50_000, startYear: 2026, endYear: 2039, growthRate: 0 },
      ],
    } as unknown as ClientData;
    const out = applyMutations(tree, [{ kind: "living-expense-amount", amount: 70_000 }]);
    const retirement = out.expenses.filter((e) => e.type === "living" && e.startYear > 2026);
    expect(retirement).toHaveLength(1);
    expect(retirement[0].annualAmount).toBe(70_000);
    expect(retirement[0].name).toBe("Retirement Living Expenses");
  });
});

describe("applyMutations — stress test", () => {
  it("stress-inflation sets planSettings.livingExpenseInflationOverride only", () => {
    const data = makeBase();
    const out = applyMutations(data, [{ kind: "stress-inflation", rate: 0.06 }]);
    expect(out.planSettings.livingExpenseInflationOverride).toBe(0.06);
    // The plan's general inflation assumption stays put — the stressor is
    // scoped to living expenses, not tax indexing / incomes / savings.
    expect(out.planSettings.inflationRate).toBe(data.planSettings.inflationRate);
    expect(data.planSettings.livingExpenseInflationOverride).toBeUndefined(); // original untouched
  });

  it("stress-ss-haircut sets planSettings.ssBenefitHaircut", () => {
    const data = makeBase();
    const out = applyMutations(data, [{ kind: "stress-ss-haircut", pct: 0.23, startYear: 2034 }]);
    expect(out.planSettings.ssBenefitHaircut).toEqual({ pct: 0.23, startYear: 2034 });
    expect(data.planSettings.ssBenefitHaircut).toBeUndefined(); // original untouched
  });

  it("stress-disability sets planSettings.disabilityEvent", () => {
    const data = makeBase();
    const out = applyMutations(data, [{ kind: "stress-disability", person: "spouse", startYear: 2030 }]);
    expect(out.planSettings.disabilityEvent).toEqual({ person: "spouse", startYear: 2030 });
    expect(data.planSettings.disabilityEvent).toBeUndefined(); // original untouched
  });

  it("stress-market-crash sets planSettings.marketShock", () => {
    const data = makeBase();
    const out = applyMutations(data, [{ kind: "stress-market-crash", year: 2030, drawdownPct: 0.3 }]);
    expect(out.planSettings.marketShock).toEqual({ year: 2030, drawdownPct: 0.3 });
    expect(data.planSettings.marketShock).toBeUndefined(); // original untouched
  });

  it("stress-exemption-cap sets planSettings.lifetimeExemptionCap", () => {
    const data = makeBase();
    const capBefore = data.planSettings.lifetimeExemptionCap ?? null;
    const out = applyMutations(data, [{ kind: "stress-exemption-cap", cap: 7_000_000 }]);
    expect(out.planSettings.lifetimeExemptionCap).toBe(7_000_000);
    // applyMutations must not mutate its input (deep clone) — the source data's
    // cap stays whatever it was before the call.
    expect(data.planSettings.lifetimeExemptionCap ?? null).toBe(capBefore);
  });
});

describe("applyMutations — technique upserts", () => {
  const rc = {
    id: "rc-1",
    name: "Conv",
    destinationAccountId: "acc-roth",
    sourceAccountIds: ["acc-trad"],
    conversionType: "fixed_amount" as const,
    fixedAmount: 20000,
    startYear: 2030,
    endYear: 2035,
    indexingRate: 0,
  };

  it("adds a roth conversion when none exists with that id", () => {
    const out = applyMutations(makeBase(), [
      { kind: "roth-conversion-upsert", id: "rc-1", value: rc },
    ]);
    expect(out.rothConversions).toHaveLength(1);
    expect(out.rothConversions?.[0].fixedAmount).toBe(20000);
  });

  it("replaces an existing roth conversion with the same id", () => {
    const base = { ...makeBase(), rothConversions: [rc] };
    const out = applyMutations(base, [
      { kind: "roth-conversion-upsert", id: "rc-1", value: { ...rc, fixedAmount: 50000 } },
    ]);
    expect(out.rothConversions).toHaveLength(1);
    expect(out.rothConversions?.[0].fixedAmount).toBe(50000);
  });

  it("removes a roth conversion when value is null", () => {
    const base = { ...makeBase(), rothConversions: [rc] };
    const out = applyMutations(base, [
      { kind: "roth-conversion-upsert", id: "rc-1", value: null },
    ]);
    expect(out.rothConversions).toEqual([]);
  });

  it("does not mutate the input tree", () => {
    const base = makeBase();
    applyMutations(base, [{ kind: "roth-conversion-upsert", id: "rc-1", value: rc }]);
    expect(base.rothConversions ?? []).toEqual([]);
  });
});

// ── Life-expectancy → plan-horizon recompute ─────────────────────────────────
//
// The engine's year loop is bounded by planSettings.planEndYear, not by life
// expectancy. The base-facts PUT route re-derives planEndAge/planEndYear when
// LE changes; applyMutations must do the same for a solver LE lever, or
// raising LE past the stored horizon adds no chart years (while lowering it
// still visibly shortens the chart via earlier death events).

describe("applyMutations — life-expectancy horizon recompute", () => {
  // makeRefsBase: client born 1965 (LE 95 → 2060), spouse born 1967 (LE 93 →
  // 2060), stored planEndAge 95, stored planEndYear 2065.

  it("raising client LE past the stored horizon extends planEndAge + planEndYear", () => {
    const out = applyMutations(makeRefsBase(), [
      { kind: "life-expectancy", person: "client", age: 105 },
    ]);
    // Last death now 1965 + 105 = 2070.
    expect(out.client.planEndAge).toBe(105);
    expect(out.planSettings.planEndYear).toBe(2070);
  });

  it("reshifts client_end-anchored rows to the new horizon", () => {
    const out = applyMutations(makeRefsBase(), [
      { kind: "life-expectancy", person: "client", age: 105 },
    ]);
    const pension = out.incomes.find((i) => i.id === "income-deferred-cooper")!;
    // endYearRef "client_end" is a transition ref (end position → year - 1):
    // 1965 + 105 - 1 = 2069 (was 2059).
    expect(pension.endYear).toBe(2069);
  });

  it("lowering client LE anchors the horizon to the surviving spouse's death year", () => {
    const out = applyMutations(makeRefsBase(), [
      { kind: "life-expectancy", person: "client", age: 85 },
    ]);
    // Client dies 2050 but spouse (1967 + 93) lives to 2060 — horizon is the
    // LAST death, so planEndYear shrinks from 2065 to 2060, not 2050.
    expect(out.client.planEndAge).toBe(95);
    expect(out.planSettings.planEndYear).toBe(2060);
  });

  it("raising spouse LE extends the horizon", () => {
    const out = applyMutations(makeRefsBase(), [
      { kind: "life-expectancy", person: "spouse", age: 105 },
    ]);
    // Spouse death 1967 + 105 = 2072 → planEndAge in client years = 107.
    expect(out.client.planEndAge).toBe(107);
    expect(out.planSettings.planEndYear).toBe(2072);
  });

  it("non-LE mutations leave the stored horizon untouched", () => {
    const out = applyMutations(makeRefsBase(), [
      { kind: "retirement-age", person: "client", age: 70 },
    ]);
    expect(out.client.planEndAge).toBe(95);
    expect(out.planSettings.planEndYear).toBe(2065);
  });
});

describe("applyMutations — surplus allocation", () => {
  it("surplus-allocation writes surplusSpendPct + surplusSaveAccountId", () => {
    const data = makeBase();
    const out = applyMutations(data, [
      { kind: "surplus-allocation", spendPct: 0.3, saveAccountId: "acct-brokerage" },
    ]);
    expect(out.planSettings.surplusSpendPct).toBe(0.3);
    expect(out.planSettings.surplusSaveAccountId).toBe("acct-brokerage");
    // input untouched (deep clone)
    expect(data.planSettings.surplusSpendPct).toBeUndefined();
  });

  it("preserves a null saveAccountId (household checking default)", () => {
    const out = applyMutations(makeBase(), [
      { kind: "surplus-allocation", spendPct: 0.5, saveAccountId: null },
    ]);
    expect(out.planSettings.surplusSpendPct).toBe(0.5);
    expect(out.planSettings.surplusSaveAccountId).toBeNull();
  });
});
