// The two Early Years sheets ship in one deck and both print the household's
// savings rate. They must print the SAME one.
//
// They did not. On a real two-earner household (Cooper & Susan, dev) the
// standing sheet said 5% and the ladder's own "what you save now" bar said
// "Save 12%", four inches apart in the same PDF. The standing sheet divided
// what the ENGINE contributed by household salary; the ladder summed the
// savings rules' `annualPercent`s, which the engine resolves against each
// ACCOUNT OWNER's salary slice — a sum across three different denominators
// that also ignores the §402(g) cap.
//
// This file pins the two together on that exact household shape.

import { describe, it, expect } from "vitest";
import { buildEarlyYearsStandingData } from "../../early-years-standing/view-model";
import { buildEarlyYearsLadderData, EARLY_YEARS_LADDER_PAGE_ID, rungKey } from "../view-model";
import { householdSavingsRate } from "@/lib/presentations/savings-rate";
import { derivedKey } from "@/lib/presentations/derived-refs";
import type { BuildDataContext } from "@/components/presentations/registry";

// Cooper & Susan, as the dev tree really is:
//   Cooper  $250,000 + $75,000 + $20,000 = $345,000
//   Susan   $160,000
//   household                              $505,000
// Susan's 401(k) runs a 10%-of-HER-salary rule    → $16,000
// Cooper's IRA runs a "contribute the max" rule   →  $7,500
//   what the engine actually contributes          → $23,500  = 4.65% of gross
const COOPER_SALARY = 345_000;
const SUSAN_SALARY = 160_000;
const HOUSEHOLD_SALARY = COOPER_SALARY + SUSAN_SALARY;
const CONTRIBUTED = 23_500;

const income = (id: string, owner: string, annualAmount: number) => ({
  id,
  type: "salary",
  name: id,
  annualAmount,
  startYear: 2020,
  endYear: 2060,
  growthRate: 0,
  owner,
});

function cooperTree() {
  return {
    client: { firstName: "Cooper" },
    planSettings: { inflationRate: 0.03, planStartYear: 2026 },
    familyMembers: [
      { id: "fm-cooper", role: "client" },
      { id: "fm-susan", role: "spouse" },
    ],
    accounts: [
      {
        id: "susan-401k",
        owners: [{ kind: "family_member", familyMemberId: "fm-susan", percent: 1 }],
      },
      {
        id: "cooper-ira",
        owners: [{ kind: "family_member", familyMemberId: "fm-cooper", percent: 1 }],
      },
    ],
    savingsRules: [
      {
        id: "r-susan",
        accountId: "susan-401k",
        annualAmount: 0,
        annualPercent: 0.1,
        startYear: 2026,
        endYear: 2040,
      },
      {
        id: "r-cooper",
        accountId: "cooper-ira",
        annualAmount: 10_000,
        annualPercent: null,
        contributeMax: true,
        startYear: 2026,
        endYear: 2034,
      },
    ],
    incomes: [
      income("i-cooper-salary", "client", 250_000),
      income("i-cooper-firm", "client", 75_000),
      income("i-cooper-side", "client", 20_000),
      income("i-susan", "spouse", SUSAN_SALARY),
    ],
  };
}

/** A projection year at `age` for a plan contributing `savings` a year. */
const yr = (age: number, savings: number, liquid: number) => ({
  year: 2026 + (age - 38),
  ages: { client: age },
  income: { salaries: HOUSEHOLD_SALARY, total: HOUSEHOLD_SALARY },
  savings: { byAccount: {}, total: savings, employerTotal: 4_800 },
  portfolioAssets: { liquidTotal: liquid },
});

/**
 * One deck's context: both sheets are pinned to Base Case, so the standing
 * page's `years` and the ladder's `base` bundle are the same projection.
 */
function deckCtx(): BuildDataContext {
  const tree = cooperTree();
  const years = (savings: number, at65: number) =>
    [38, 40, 50, 65].map((age) =>
      yr(age, savings, age === 65 ? at65 : { 38: 720_000, 40: 800_000, 50: 1_400_000 }[age] ?? 0),
    );
  const base = {
    clientData: tree,
    projection: { years: years(CONTRIBUTED, 4_000_000) },
    scenarioLabel: "Base Case",
  };
  const bundlesByRef: Record<string, unknown> = { base };
  // Three rungs, each funding more than the last.
  [CONTRIBUTED, 38_650, 53_800].forEach((savings, i) => {
    bundlesByRef[derivedKey(EARLY_YEARS_LADDER_PAGE_ID, rungKey(i))] = {
      clientData: tree,
      projection: { years: years(savings, 4_000_000 + i * 600_000) },
      scenarioLabel: `Rung ${i + 1}`,
    };
  });
  return {
    years: base.projection.years,
    projection: base.projection,
    clientData: tree,
    scenarioLabel: "Base Case",
    bundlesByRef,
  } as unknown as BuildDataContext;
}

describe("the two Early Years sheets agree about the savings rate", () => {
  const LADDER_OPTS = {
    rungs: { mode: "relative" as const, offsets: [0, 0.03, 0.06] },
    milestoneAges: [40, 50, 65],
    tidbits: [],
  };

  it("prints one rate, not two, for a two-earner household", () => {
    const standing = buildEarlyYearsStandingData(deckCtx(), {
      showMatchLine: true,
      tidbits: [],
    });
    const ladder = buildEarlyYearsLadderData(deckCtx(), LADDER_OPTS);
    const baseline = ladder.rungs.find((r) => r.isCurrent);

    // The quantity itself, so a change to the shared definition is caught too:
    // what the engine contributed over the salary it came out of.
    expect(standing.savingsRatePct).toBeCloseTo(CONTRIBUTED / HOUSEHOLD_SALARY, 9);
    expect(baseline?.percent).toBeCloseTo(standing.savingsRatePct, 9);
    // And what the client actually reads on each sheet.
    expect(baseline?.label).toBe("Save 5%");
  });

  it("does not sum the savings rules' own percents", () => {
    // 10% (of Susan's pay) + $10,000/$505,000 was the old answer: 12%. Both
    // terms are measured against something else, and the flat $10,000 is not
    // even what that rule contributes — its `contributeMax` overrides it.
    const ladder = buildEarlyYearsLadderData(deckCtx(), LADDER_OPTS);
    expect(ladder.rungs.map((r) => r.label)).toEqual(["Save 5%", "Save 8%", "Save 11%"]);
  });
});

describe("householdSavingsRate", () => {
  it("is zero when there is no salary to divide by", () => {
    expect(
      householdSavingsRate({
        income: { salaries: 0 },
        savings: { total: 9_600 },
      } as never),
    ).toBe(0);
  });

  it("is zero rather than a crash when the projection has no years", () => {
    expect(householdSavingsRate(undefined)).toBe(0);
  });
});
