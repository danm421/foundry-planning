import { describe, it, expect } from "vitest";
import type { ClientData } from "@/engine/types";
import { mutationsToScenarioChanges } from "../mutations-to-scenario-changes";

const CLIENT_ID = "00000000-0000-4000-8000-000000000001";

function makeSource(): ClientData {
  return {
    client: {
      firstName: "Cooper",
      lastName: "Smith",
      dateOfBirth: "1965-03-15",
      retirementAge: 65,
      retirementMonth: 1,
      planEndAge: 95,
      lifeExpectancy: 95,
      spouseRetirementAge: 63,
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
    ],
    expenses: [
      {
        id: "expense-living-cooper",
        type: "living",
        name: "Living",
        annualAmount: 120000,
        startYear: 2026,
        endYear: 2055,
        growthRate: 0.025,
      },
      {
        id: "expense-living-susan",
        type: "living",
        name: "Living (retired)",
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
        accountId: "account-401k",
        annualAmount: 23000,
        startYear: 2026,
        endYear: 2030,
        isDeductible: true,
      },
    ],
    withdrawalStrategy: [],
    planSettings: {} as ClientData["planSettings"],
  } as ClientData;
}

describe("mutationsToScenarioChanges", () => {
  it("retirement-age (client) → one client-target row with retirementAge diff", () => {
    const drafts = mutationsToScenarioChanges(
      makeSource(),
      CLIENT_ID,
      [{ kind: "retirement-age", person: "client", age: 67 }],
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      opType: "edit",
      targetKind: "client",
      targetId: CLIENT_ID,
      payload: { retirementAge: { from: 65, to: 67 } },
    });
  });

  it("retirement-age + life-expectancy (same person) coalesce into one client row", () => {
    const drafts = mutationsToScenarioChanges(
      makeSource(),
      CLIENT_ID,
      [
        { kind: "retirement-age", person: "client", age: 67 },
        { kind: "life-expectancy", person: "client", age: 100 },
      ],
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0].payload).toEqual({
      retirementAge: { from: 65, to: 67 },
      lifeExpectancy: { from: 95, to: 100 },
    });
  });

  it("retirement-age client + spouse retirement-age both land on the same client row", () => {
    const drafts = mutationsToScenarioChanges(
      makeSource(),
      CLIENT_ID,
      [
        { kind: "retirement-age", person: "client", age: 67 },
        { kind: "retirement-age", person: "spouse", age: 65 },
      ],
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0].payload).toEqual({
      retirementAge: { from: 65, to: 67 },
      spouseRetirementAge: { from: 63, to: 65 },
    });
  });

  it("includes optional retirementMonth in the payload only when supplied", () => {
    const drafts = mutationsToScenarioChanges(
      makeSource(),
      CLIENT_ID,
      [{ kind: "retirement-age", person: "client", age: 67, month: 6 }],
    );
    expect(drafts[0].payload).toEqual({
      retirementAge: { from: 65, to: 67 },
      retirementMonth: { from: 1, to: 6 },
    });
  });

  it("multiple per-field income mutations coalesce into one income row", () => {
    const source = makeSource();
    // Add a salary income to the fixture for this test.
    source.incomes.push({
      id: "income-salary-cooper",
      type: "salary",
      name: "Cooper Salary",
      annualAmount: 150000,
      startYear: 2026,
      endYear: 2030,
      growthRate: 0.03,
      owner: "client",
    });
    const drafts = mutationsToScenarioChanges(source, CLIENT_ID, [
      {
        kind: "income-annual-amount",
        incomeId: "income-salary-cooper",
        annualAmount: 175000,
      },
      {
        kind: "income-tax-type",
        incomeId: "income-salary-cooper",
        taxType: "qbi",
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
    ]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      targetKind: "income",
      targetId: "income-salary-cooper",
    });
    expect(drafts[0].payload).toEqual({
      annualAmount: { from: 150000, to: 175000 },
      taxType: { from: null, to: "qbi" },
      isSelfEmployment: { from: false, to: true },
      startYear: { from: 2026, to: 2027 },
    });
  });

  it("income-annual-amount drops no-op when value matches source", () => {
    const source = makeSource();
    source.incomes.push({
      id: "income-salary-cooper",
      type: "salary",
      name: "Cooper Salary",
      annualAmount: 150000,
      startYear: 2026,
      endYear: 2030,
      growthRate: 0.03,
      owner: "client",
    });
    const drafts = mutationsToScenarioChanges(source, CLIENT_ID, [
      {
        kind: "income-annual-amount",
        incomeId: "income-salary-cooper",
        annualAmount: 150000,
      },
    ]);
    expect(drafts).toHaveLength(0);
  });

  it("expense-annual-amount targets only the matching expense", () => {
    const drafts = mutationsToScenarioChanges(
      makeSource(),
      CLIENT_ID,
      [
        {
          kind: "expense-annual-amount",
          expenseId: "expense-living-susan",
          annualAmount: 75000,
        },
      ],
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      targetKind: "expense",
      targetId: "expense-living-susan",
      payload: { annualAmount: { from: 80000, to: 75000 } },
    });
  });

  it("expense-annual-amount drops no-op when value matches source", () => {
    const drafts = mutationsToScenarioChanges(
      makeSource(),
      CLIENT_ID,
      [
        {
          kind: "expense-annual-amount",
          expenseId: "expense-living-cooper",
          annualAmount: 120000,
        },
      ],
    );
    expect(drafts).toHaveLength(0);
  });

  it("living-expense-scale fans out to one row per living-type expense, multiplied", () => {
    const drafts = mutationsToScenarioChanges(
      makeSource(),
      CLIENT_ID,
      [{ kind: "living-expense-scale", multiplier: 1.1 }],
    );
    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toMatchObject({
      targetKind: "expense",
      targetId: "expense-living-cooper",
      payload: { annualAmount: { from: 120000, to: 132000 } },
    });
    expect(drafts[1]).toMatchObject({
      targetKind: "expense",
      targetId: "expense-living-susan",
      payload: { annualAmount: { from: 80000, to: 88000 } },
    });
  });

  it("ss-claim-age produces an edit row on the matching incomes row", () => {
    const drafts = mutationsToScenarioChanges(
      makeSource(),
      CLIENT_ID,
      [{ kind: "ss-claim-age", person: "client", age: 70 }],
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      targetKind: "income",
      targetId: "income-ss-cooper",
      payload: { claimingAge: { from: 67, to: 70 } },
    });
  });

  it("savings-contribution produces a savings_rule edit row", () => {
    const drafts = mutationsToScenarioChanges(
      makeSource(),
      CLIENT_ID,
      [
        {
          kind: "savings-contribution",
          accountId: "account-401k",
          annualAmount: 30000,
        },
      ],
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      targetKind: "savings_rule",
      targetId: "savings-401k-cooper",
      payload: { annualAmount: { from: 23000, to: 30000 } },
    });
  });

  it("savings-roth-percent produces a savings_rule edit row", () => {
    const drafts = mutationsToScenarioChanges(makeSource(), CLIENT_ID, [
      {
        kind: "savings-roth-percent",
        accountId: "account-401k",
        rothPercent: 0.5,
      },
    ]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      targetKind: "savings_rule",
      targetId: "savings-401k-cooper",
      payload: { rothPercent: { from: null, to: 0.5 } },
    });
  });

  it("multiple per-field savings mutations coalesce into one savings_rule row", () => {
    const drafts = mutationsToScenarioChanges(
      makeSource(),
      CLIENT_ID,
      [
        {
          kind: "savings-contribution",
          accountId: "account-401k",
          annualAmount: 30000,
        },
        {
          kind: "savings-annual-percent",
          accountId: "account-401k",
          percent: 0.1,
        },
        {
          kind: "savings-growth-rate",
          accountId: "account-401k",
          rate: 0.04,
        },
        {
          kind: "savings-employer-match-pct",
          accountId: "account-401k",
          pct: 0.5,
          cap: 0.06,
        },
        {
          kind: "savings-deductible",
          accountId: "account-401k",
          value: false,
        },
        {
          kind: "savings-start-year",
          accountId: "account-401k",
          year: 2027,
        },
      ],
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      targetKind: "savings_rule",
      targetId: "savings-401k-cooper",
    });
    expect(drafts[0].payload).toEqual({
      annualAmount: { from: 23000, to: 30000 },
      annualPercent: { from: null, to: 0.1 },
      growthRate: { from: null, to: 0.04 },
      employerMatchPct: { from: null, to: 0.5 },
      employerMatchCap: { from: null, to: 0.06 },
      isDeductible: { from: true, to: false },
      startYear: { from: 2026, to: 2027 },
    });
  });

  it("drops savings mutations that match the source value (no-op)", () => {
    const drafts = mutationsToScenarioChanges(
      makeSource(),
      CLIENT_ID,
      [
        {
          kind: "savings-contribution",
          accountId: "account-401k",
          annualAmount: 23000,
        },
      ],
    );
    expect(drafts).toHaveLength(0);
  });

  it("assigns sequential orderIndex starting at 0", () => {
    const drafts = mutationsToScenarioChanges(
      makeSource(),
      CLIENT_ID,
      [
        { kind: "retirement-age", person: "client", age: 67 },
        { kind: "ss-claim-age", person: "client", age: 70 },
        {
          kind: "savings-contribution",
          accountId: "account-401k",
          annualAmount: 30000,
        },
      ],
    );
    expect(drafts.map((d) => d.orderIndex)).toEqual([0, 1, 2]);
  });

  it("drops no-op mutations whose target value already matches base", () => {
    const drafts = mutationsToScenarioChanges(
      makeSource(),
      CLIENT_ID,
      [{ kind: "retirement-age", person: "client", age: 65 }],
    );
    expect(drafts).toHaveLength(0);
  });
});
