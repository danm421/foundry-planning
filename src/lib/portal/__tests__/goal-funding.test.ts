import { describe, it, expect } from "vitest";
import type { ProjectionYear } from "@/engine/types";
import {
  buildGoalFunding,
  yearCoverage,
  type GoalFundingExpense,
} from "../goal-funding";

// Minimal ProjectionYear factory — only the fields the funding math reads.
// `over` is intentionally loose, matching retirement-funding.test.ts. `income`
// merges rather than replaces: a bare spread would drop the sibling income
// fields `otherInflows()` sums and every coverage figure would come back NaN.
function yr(
  year: number,
  { income, ...over }: Record<string, unknown> & { income?: Record<string, number> } = {},
): ProjectionYear {
  return {
    year,
    income: {
      socialSecurity: 0,
      salaries: 0,
      business: 0,
      deferred: 0,
      capitalGains: 0,
      trust: 0,
      other: 0,
      ...income,
    },
    withdrawals: { byAccount: {}, total: 0 },
    accountLedgers: {},
    expenses: { bySource: {} },
    totalExpenses: 0,
    ...over,
  } as unknown as ProjectionYear;
}

const noFamily = new Map<string, string>();

function expense(over: Partial<GoalFundingExpense> = {}): GoalFundingExpense {
  return { id: "e1", type: "other", name: "Boat", isGoal: true, ...over };
}

describe("yearCoverage", () => {
  it("is 1 when inflows cover the year's expenses", () => {
    expect(yearCoverage(yr(2030, { income: { salaries: 100_000 }, totalExpenses: 80_000 }))).toBe(1);
  });

  it("is the covered share when inflows fall short", () => {
    // 60k of inflows against 100k of expenses = 60% covered.
    expect(
      yearCoverage(yr(2030, { income: { salaries: 60_000 }, totalExpenses: 100_000 })),
    ).toBeCloseTo(0.6);
  });

  it("counts withdrawals and RMDs, not just income", () => {
    const y = yr(2030, {
      income: { salaries: 20_000 },
      withdrawals: { byAccount: {}, total: 30_000 },
      accountLedgers: { ira: { rmdAmount: 10_000 } },
      totalExpenses: 100_000,
    });
    expect(yearCoverage(y)).toBeCloseTo(0.6);
  });

  it("is 1 for a year with no expenses", () => {
    expect(yearCoverage(yr(2030))).toBe(1);
  });
});

describe("buildGoalFunding — retirement", () => {
  it("sums spending and funding from the retirement year onward", () => {
    const years = [
      // Pre-retirement year: short, but must not count toward the goal.
      yr(2029, { income: { salaries: 0 }, totalExpenses: 50_000 }),
      yr(2030, { income: { salaries: 100_000 }, totalExpenses: 100_000 }),
      yr(2031, { income: { salaries: 50_000 }, totalExpenses: 100_000 }),
    ];
    const [goal] = buildGoalFunding({
      years,
      expenses: [],
      accounts: [],
      familyMemberNamesById: noFamily,
      retirementYear: 2030,
    });
    expect(goal.id).toBe("retirement");
    expect(goal.cost).toBe(200_000);
    expect(goal.funded).toBe(150_000);
    expect(goal.pctFunded).toBeCloseTo(0.75);
    expect(goal.startYear).toBe(2030);
    expect(goal.endYear).toBe(2031);
  });

  it("is omitted when the client has no retirement year", () => {
    const years = [yr(2030, { income: { salaries: 10 }, totalExpenses: 10 })];
    expect(
      buildGoalFunding({
        years,
        expenses: [],
        accounts: [],
      familyMemberNamesById: noFamily,
        retirementYear: null,
      }),
    ).toEqual([]);
  });
});

describe("buildGoalFunding — flagged goal expenses", () => {
  it("funds a goal pro-rata at the year's coverage", () => {
    const years = [
      yr(2030, {
        income: { salaries: 50_000 },
        totalExpenses: 100_000,
        expenses: { bySource: { e1: 20_000 } },
      }),
    ];
    const [goal] = buildGoalFunding({
      years,
      expenses: [expense()],
      accounts: [],
      familyMemberNamesById: noFamily,
      retirementYear: null,
    });
    expect(goal.kind).toBe("other");
    expect(goal.label).toBe("Boat");
    expect(goal.cost).toBe(20_000);
    expect(goal.funded).toBe(10_000);
    expect(goal.pctFunded).toBeCloseTo(0.5);
  });

  it("ignores an expense the advisor did not flag as a goal", () => {
    const years = [
      yr(2030, { income: { salaries: 100 }, totalExpenses: 100, expenses: { bySource: { e1: 100 } } }),
    ];
    expect(
      buildGoalFunding({
        years,
        expenses: [expense({ isGoal: false })],
        accounts: [],
      familyMemberNamesById: noFamily,
        retirementYear: null,
      }),
    ).toEqual([]);
  });

  it("drops a goal the projection never reaches", () => {
    const years = [yr(2030, { income: { salaries: 100 }, totalExpenses: 100 })];
    expect(
      buildGoalFunding({
        years,
        expenses: [expense()],
        accounts: [],
      familyMemberNamesById: noFamily,
        retirementYear: null,
      }),
    ).toEqual([]);
  });
});

describe("buildGoalFunding — education", () => {
  const edu = expense({ id: "edu1", type: "education", name: "College", isGoal: false });

  it("counts the dedicated draw as fully funded and the shortfall as unfunded", () => {
    const years = [
      yr(2032, {
        income: { salaries: 200_000 },
        totalExpenses: 100_000,
        educationGoals: [
          {
            goalId: "edu1",
            goalExpense: 40_000,
            dedicatedWithdrawal: 30_000,
            outOfPocketWithdrawal: 0,
            shortfall: 10_000,
          },
        ],
      }),
    ];
    const [goal] = buildGoalFunding({
      years,
      expenses: [edu],
      accounts: [],
      familyMemberNamesById: noFamily,
      retirementYear: null,
    });
    expect(goal.kind).toBe("education");
    expect(goal.cost).toBe(40_000);
    expect(goal.funded).toBe(30_000);
    expect(goal.pctFunded).toBeCloseTo(0.75);
  });

  it("discounts the out-of-pocket slice by the year's coverage", () => {
    // Household covers half its expenses, so half of the $20k paid from cash
    // flow is really funded; the $20k 529 draw is unaffected.
    const years = [
      yr(2032, {
        income: { salaries: 50_000 },
        totalExpenses: 100_000,
        educationGoals: [
          {
            goalId: "edu1",
            goalExpense: 40_000,
            dedicatedWithdrawal: 20_000,
            outOfPocketWithdrawal: 20_000,
            shortfall: 0,
          },
        ],
      }),
    ];
    const [goal] = buildGoalFunding({
      years,
      expenses: [edu],
      accounts: [],
      familyMemberNamesById: noFamily,
      retirementYear: null,
    });
    expect(goal.funded).toBe(30_000);
    expect(goal.pctFunded).toBeCloseTo(0.75);
  });

  it("skips accumulation rows so the span covers the expense years only", () => {
    const years = [
      yr(2030, {
        totalExpenses: 0,
        educationGoals: [
          {
            goalId: "edu1",
            goalExpense: 0,
            dedicatedWithdrawal: 0,
            outOfPocketWithdrawal: 0,
            shortfall: 0,
            accumulation: true,
          },
        ],
      }),
      yr(2032, {
        income: { salaries: 100_000 },
        totalExpenses: 40_000,
        educationGoals: [
          {
            goalId: "edu1",
            goalExpense: 40_000,
            dedicatedWithdrawal: 40_000,
            outOfPocketWithdrawal: 0,
            shortfall: 0,
          },
        ],
      }),
    ];
    const [goal] = buildGoalFunding({
      years,
      expenses: [edu],
      accounts: [],
      familyMemberNamesById: noFamily,
      retirementYear: null,
    });
    expect(goal.startYear).toBe(2032);
    expect(goal.pctFunded).toBe(1);
  });

  it("names the beneficiary", () => {
    const years = [
      yr(2032, {
        income: { salaries: 100_000 },
        totalExpenses: 40_000,
        educationGoals: [
          {
            goalId: "edu1",
            goalExpense: 40_000,
            dedicatedWithdrawal: 40_000,
            outOfPocketWithdrawal: 0,
            shortfall: 0,
          },
        ],
      }),
    ];
    const [goal] = buildGoalFunding({
      years,
      expenses: [expense({ ...edu, forFamilyMemberId: "fm1" })],
      accounts: [],
      familyMemberNamesById: new Map([["fm1", "Ava"]]),
      retirementYear: null,
    });
    expect(goal.forName).toBe("Ava");
  });
});

describe("buildGoalFunding — ordering", () => {
  it("puts retirement first, then goals by the year funding starts", () => {
    const years = [
      yr(2030, {
        income: { salaries: 100_000 },
        totalExpenses: 100_000,
        expenses: { bySource: { late: 10_000 } },
      }),
      yr(2028, {
        income: { salaries: 100_000 },
        totalExpenses: 100_000,
        expenses: { bySource: { early: 10_000 } },
      }),
    ];
    const lines = buildGoalFunding({
      years,
      expenses: [
        expense({ id: "late", name: "Second home" }),
        expense({ id: "early", name: "Wedding" }),
      ],
      accounts: [],
      familyMemberNamesById: noFamily,
      retirementYear: 2030,
    });
    expect(lines.map((l) => l.id)).toEqual(["retirement", "early", "late"]);
  });
});
