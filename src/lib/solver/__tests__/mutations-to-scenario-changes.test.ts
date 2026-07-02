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
    giftEvents: [],
    planSettings: { planStartYear: 2026 } as ClientData["planSettings"],
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

  it("living-expense-scale fans out only to retirement (post-plan-start) living expenses; current stays as typed", () => {
    const drafts = mutationsToScenarioChanges(
      makeSource(),
      CLIENT_ID,
      [{ kind: "living-expense-scale", multiplier: 1.1 }],
    );
    // expense-living-cooper (startYear 2026 === planStartYear) is the current
    // living expense — never solved. Only the retirement row is scaled.
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      targetKind: "expense",
      targetId: "expense-living-susan",
      payload: { annualAmount: { from: 80000, to: 88000 } },
    });
  });

  it("living-expense-scale + expense-annual-amount on the same expense coalesce into one edit row (F3: no scenario_changes_unique dup)", () => {
    const drafts = mutationsToScenarioChanges(makeSource(), CLIENT_ID, [
      { kind: "living-expense-scale", multiplier: 1.1 },
      {
        kind: "expense-annual-amount",
        expenseId: "expense-living-susan",
        annualAmount: 90000,
      },
    ]);
    const susanRows = drafts.filter(
      (d) => d.targetKind === "expense" && d.targetId === "expense-living-susan",
    );
    // Two `edit` rows for the same expense would violate
    // scenario_changes_unique (scenarioId, targetKind, targetId, opType).
    expect(susanRows).toHaveLength(1);
    expect(susanRows[0].opType).toBe("edit");
    // Last write wins: the explicit annual amount overrides the scaled value;
    // `from` stays the base value.
    expect(susanRows[0].payload).toEqual({
      annualAmount: { from: 80000, to: 90000 },
    });
    // No (targetKind, targetId, opType) collision anywhere in the output.
    const keys = drafts.map((d) => `${d.targetKind}:${d.targetId}:${d.opType}`);
    expect(new Set(keys).size).toBe(keys.length);
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

describe("living-expense-amount → scenario changes", () => {
  it("emits per-row edit diffs when retirement rows exist", () => {
    const source = {
      ...makeSource(),
      planSettings: { planStartYear: 2026 } as ClientData["planSettings"],
      expenses: [
        {
          id: "r1",
          type: "living" as const,
          name: "Retirement Living",
          annualAmount: 40_000,
          startYear: 2040,
          endYear: 2070,
          growthRate: 0.025,
        },
      ],
    };
    const drafts = mutationsToScenarioChanges(source, CLIENT_ID, [
      { kind: "living-expense-amount", amount: 80_000 },
    ]);
    const edit = drafts.find((d) => d.targetKind === "expense" && d.targetId === "r1");
    expect(edit?.opType).toBe("edit");
    expect((edit?.payload as Record<string, { from: number; to: number }>).annualAmount).toEqual({
      from: 40_000,
      to: 80_000,
    });
  });

  it("emits an add draft when synthesizing a retirement row (no existing retirement expenses)", () => {
    const source = {
      ...makeSource(),
      planSettings: {
        planStartYear: 2026,
        planEndYear: 2070,
        inflationRate: 0.025,
      } as ClientData["planSettings"],
      expenses: [] as ClientData["expenses"],
    };
    const drafts = mutationsToScenarioChanges(source, CLIENT_ID, [
      { kind: "living-expense-amount", amount: 70_000 },
    ]);
    const add = drafts.find((d) => d.targetKind === "expense" && d.opType === "add");
    expect(add).toBeTruthy();
    const payload = add?.payload as {
      annualAmount: number;
      startYearRef: string;
      endYearRef: string;
    };
    expect(payload.annualAmount).toBe(70_000);
    // The year-refs anchor the synthesized row to retirement on reload — the
    // load-bearing fields that resolveRefYears re-resolves. Guard them.
    expect(payload.startYearRef).toBe("client_retirement");
    expect(payload.endYearRef).toBe("plan_end");
  });
});

describe("mutationsToScenarioChanges — technique upserts", () => {
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

  it("emits an add change for a roth conversion not in the source tree", () => {
    const src = makeSource(); // no rothConversions
    const drafts = mutationsToScenarioChanges(src, CLIENT_ID, [
      { kind: "roth-conversion-upsert", id: "rc-1", value: rc },
    ]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].opType).toBe("add");
    expect(drafts[0].targetKind).toBe("roth_conversion");
    expect(drafts[0].targetId).toBe("rc-1");
    expect(drafts[0].payload).toEqual(rc);
  });

  it("emits an edit change with a field diff for an existing roth conversion", () => {
    const src = { ...makeSource(), rothConversions: [rc] };
    const drafts = mutationsToScenarioChanges(src, CLIENT_ID, [
      { kind: "roth-conversion-upsert", id: "rc-1", value: { ...rc, fixedAmount: 50000 } },
    ]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].opType).toBe("edit");
    expect(drafts[0].payload).toEqual({ fixedAmount: { from: 20000, to: 50000 } });
  });

  it("emits a remove change when value is null and the technique exists", () => {
    const src = { ...makeSource(), rothConversions: [rc] };
    const drafts = mutationsToScenarioChanges(src, CLIENT_ID, [
      { kind: "roth-conversion-upsert", id: "rc-1", value: null },
    ]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].opType).toBe("remove");
    expect(drafts[0].payload).toBeNull();
  });

  it("emits nothing for a no-op edit", () => {
    const src = { ...makeSource(), rothConversions: [rc] };
    const drafts = mutationsToScenarioChanges(src, CLIENT_ID, [
      { kind: "roth-conversion-upsert", id: "rc-1", value: { ...rc } },
    ]);
    expect(drafts).toHaveLength(0);
  });
});

describe("mutationsToScenarioChanges — stress overrides → plan_settings", () => {
  it("coalesces every stressor into ONE plan_settings edit (no unique-index collision)", () => {
    const src = {
      ...makeSource(),
      planSettings: { planStartYear: 2026, inflationRate: 0.025 } as ClientData["planSettings"],
    };
    const drafts = mutationsToScenarioChanges(src, CLIENT_ID, [
      { kind: "stress-inflation", rate: 0.05 },
      { kind: "stress-ss-haircut", pct: 0.23, startYear: 2035 },
      { kind: "stress-disability", person: "client", startYear: 2032 },
      { kind: "stress-market-crash", year: 2030, drawdownPct: 0.4 },
      { kind: "stress-exemption-cap", cap: 7_000_000 },
    ]);

    const ps = drafts.filter((d) => d.targetKind === "plan_settings");
    expect(ps).toHaveLength(1); // single row → no (scenarioId, kind, id, opType) collision
    expect(ps[0]).toMatchObject({ opType: "edit", targetId: "plan_settings" });
    expect(ps[0].payload).toEqual({
      inflationRate: { from: 0.025, to: 0.05 },
      ssBenefitHaircut: { from: null, to: { pct: 0.23, startYear: 2035 } },
      disabilityEvent: { from: null, to: { person: "client", startYear: 2032 } },
      marketShock: { from: null, to: { year: 2030, drawdownPct: 0.4 } },
      lifetimeExemptionCap: { from: null, to: 7_000_000 },
    });
  });

  it("drops a stress-inflation override that matches the base rate (no-op)", () => {
    const src = {
      ...makeSource(),
      planSettings: { planStartYear: 2026, inflationRate: 0.03 } as ClientData["planSettings"],
    };
    const drafts = mutationsToScenarioChanges(src, CLIENT_ID, [
      { kind: "stress-inflation", rate: 0.03 },
    ]);
    expect(drafts.filter((d) => d.targetKind === "plan_settings")).toHaveLength(0);
  });
});
