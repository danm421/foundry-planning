import { describe, it, expect } from "vitest";
import { buildEarlyYearsLadderData, EARLY_YEARS_LADDER_PAGE_ID, rungKey } from "../view-model";
import { derivedKey } from "@/lib/presentations/derived-refs";
import type { BuildDataContext } from "@/components/presentations/registry";
import type { EarlyYearsLadderPageOptions } from "../types";

const OPTS: EarlyYearsLadderPageOptions = {
  rungs: { mode: "relative", offsets: [0, 0.03, 0.06] },
  milestoneAges: [40, 50, 65],
  tidbits: [],
};

/** A projection year at `age`, with a nominal portfolio and this year's savings. */
const yr = (age: number, liquid: number, savingsTotal: number) => ({
  year: 2026 + (age - 29),
  ages: { client: age },
  income: { salaries: 120_000, total: 120_000 },
  savings: { byAccount: {}, total: savingsTotal, employerTotal: 0 },
  portfolioAssets: { liquidTotal: liquid },
});

interface Rule {
  id: string;
  accountId: string;
  annualAmount: number;
  annualPercent?: number;
  contributeMax?: boolean;
  startYear: number;
  endYear: number;
}

const oneRule: Rule[] = [
  { id: "r1", accountId: "a1", annualPercent: 0.08, annualAmount: 0, startYear: 2020, endYear: 2060 },
];

function baseTree(savingsRules: Rule[] = oneRule) {
  return {
    planSettings: { inflationRate: 0.03, planStartYear: 2026 },
    savingsRules,
    incomes: [
      {
        id: "i1",
        type: "salary",
        owner: "client",
        annualAmount: 120_000,
        growthRate: 0,
        startYear: 2020,
        endYear: 2070,
      },
    ],
  };
}

interface RungTotals {
  savings: number;
  at65: number;
}

function ctx(
  rungTotals: RungTotals[],
  opts: { tree?: ReturnType<typeof baseTree>; ages?: number[] } = {},
): BuildDataContext {
  const tree = opts.tree ?? baseTree();
  const ages = opts.ages ?? [29, 40, 50, 65];
  const years = (savings: number, at65: number) =>
    ages.map((age) => yr(age, age === 65 ? at65 : { 29: 84_000, 40: 300_000, 50: 700_000 }[age] ?? 0, savings));
  const bundlesByRef: Record<string, unknown> = {};
  rungTotals.forEach((r, i) => {
    bundlesByRef[derivedKey(EARLY_YEARS_LADDER_PAGE_ID, rungKey(i))] = {
      clientData: tree,
      projection: { years: years(r.savings, r.at65) },
      scenarioLabel: `Rung ${i + 1}`,
    };
  });
  return {
    years: years(rungTotals[0].savings, rungTotals[0].at65),
    clientData: tree,
    bundlesByRef,
  } as never;
}

const THREE_RUNGS: RungTotals[] = [
  { savings: 9_600, at65: 3_000_000 },
  { savings: 13_200, at65: 3_900_000 },
  { savings: 16_800, at65: 4_800_000 },
];

describe("buildEarlyYearsLadderData", () => {
  it("charts one bar per rung at each milestone age", () => {
    const d = buildEarlyYearsLadderData(ctx(THREE_RUNGS), OPTS);
    expect(d.groups.map((g) => g.age)).toEqual([40, 50, 65]);
    expect(d.groups[2].bars).toHaveLength(3);
  });

  it("marks the client's own rate as the current bar", () => {
    const d = buildEarlyYearsLadderData(ctx(THREE_RUNGS), OPTS);
    expect(d.groups[0].bars.map((b) => b.isCurrent)).toEqual([true, false, false]);
    expect(d.groups[0].bars.map((b) => b.label)).toEqual(["Save 8%", "Save 11%", "Save 14%"]);
  });

  it("reports every figure in today's dollars, not nominal", () => {
    const d = buildEarlyYearsLadderData(ctx(THREE_RUNGS), OPTS);
    // age 65 → year 2062 → 36 years of 3% inflation. 3_000_000 / 1.03^36,
    // computed independently: node -e "console.log(3e6/Math.pow(1.03,36))"
    expect(d.groups[2].bars[0].value).toBeCloseTo(1_035_097, -3);
    expect(d.groups[2].bars[0].value).toBeLessThan(3_000_000);
  });

  it("flags the ladder as capped when two rungs fund the same dollars", () => {
    // The IRS deferral limit bites: 11% and 14% both land on $23,500.
    const d = buildEarlyYearsLadderData(
      ctx([
        { savings: 9_600, at65: 3_000_000 },
        { savings: 23_500, at65: 4_200_000 },
        { savings: 23_500, at65: 4_200_000 },
      ]),
      OPTS,
    );
    expect(d.cappedRungLabels).toEqual(["Save 14%"]);
  });

  it("does not flag a cap when every rung funds a different amount", () => {
    expect(buildEarlyYearsLadderData(ctx(THREE_RUNGS), OPTS).cappedRungLabels).toEqual([]);
  });

  // Two rungs at the same percent fund the same dollars because they are the
  // same plan, not because a limit bit. Reporting that as a cap would print an
  // IRS footnote onto a sheet where nothing was capped.
  it("does not flag a cap when two rungs ask for the same percent", () => {
    const d = buildEarlyYearsLadderData(
      ctx([
        { savings: 9_600, at65: 3_000_000 },
        { savings: 9_600, at65: 3_000_000 },
        { savings: 13_200, at65: 3_900_000 },
      ]),
      { ...OPTS, rungs: { mode: "relative", offsets: [0, 0, 0.03] } },
    );
    expect(d.cappedRungLabels).toEqual([]);
  });

  it("names the gap at the last milestone age in the takeaway", () => {
    const d = buildEarlyYearsLadderData(ctx(THREE_RUNGS), OPTS);
    // 4_800_000/1.03^36 − 3_000_000/1.03^36 ≈ 621_058.
    expect(d.takeaway).toBe(
      "At age 65, saving 14% instead of 8% leaves you about $621k more — in today's dollars.",
    );
  });

  it("drops a milestone age the projection never reaches", () => {
    const d = buildEarlyYearsLadderData(ctx(THREE_RUNGS, { ages: [29, 40, 50] }), OPTS);
    expect(d.groups.map((g) => g.age)).toEqual([40, 50]);
  });

  // The bars are derived FROM BASE. In a deck built on another scenario the
  // page's own projection saves at a different rate, and labelling the bars
  // from it would print rung percents the bars disagree with.
  it("reads the client's current rate from the base bundle, not the deck's scenario", () => {
    const c = ctx(THREE_RUNGS);
    // The deck's own scenario saves 12% of pay; the base plan saves 8%.
    (c as { years: unknown }).years = [yr(29, 84_000, 14_400)];
    (c.bundlesByRef as Record<string, unknown>).base = {
      clientData: baseTree(),
      projection: { years: [yr(29, 84_000, 9_600)] },
      scenarioLabel: "Base Case",
    };
    const d = buildEarlyYearsLadderData(c, OPTS);
    expect(d.groups[0].bars.map((b) => b.label)).toEqual(["Save 8%", "Save 11%", "Save 14%"]);
    expect(d.subtitle).toBe("Base Case · Every figure in today's dollars");
  });

  it("renders an empty state rather than a chart when no variant was built", () => {
    const bare = ctx(THREE_RUNGS);
    (bare as { bundlesByRef: Record<string, unknown> }).bundlesByRef = {};
    const d = buildEarlyYearsLadderData(bare, OPTS);
    expect(d.groups).toEqual([]);
    expect(d.takeaway).toBeNull();
    expect(d.emptyMessage).toBe("This chart could not be built for this plan.");
  });

  // Every rung would re-run the identical plan, so three bars under three
  // different labels would all be the same number wearing three hats.
  it("renders an empty state when no deferral account can be moved", () => {
    const twoRulesOneAccount = [
      { id: "r1", accountId: "a1", annualPercent: 0.05, annualAmount: 0, startYear: 2020, endYear: 2060 },
      { id: "r2", accountId: "a1", annualPercent: 0.03, annualAmount: 0, startYear: 2020, endYear: 2060 },
    ];
    const d = buildEarlyYearsLadderData(
      ctx(THREE_RUNGS, { tree: baseTree(twoRulesOneAccount) }),
      OPTS,
    );
    expect(d.groups).toEqual([]);
    expect(d.emptyMessage).toBe(
      "This plan's retirement contributions can't be modelled as a single savings rate, so there is nothing to raise here.",
    );
  });

  // F1 — the sheet before this one reports the dollars a maxed-out contributor
  // saves. Saying there are none here contradicts it inside one deck.
  it("says the contributions are already at the maximum rather than denying them", () => {
    const maxedOut = [
      { id: "r1", accountId: "a1", annualAmount: 0, contributeMax: true, startYear: 2020, endYear: 2060 },
      { id: "r2", accountId: "a2", annualAmount: 0, contributeMax: true, startYear: 2020, endYear: 2060 },
    ];
    const d = buildEarlyYearsLadderData(ctx(THREE_RUNGS, { tree: baseTree(maxedOut) }), OPTS);
    expect(d.groups).toEqual([]);
    expect(d.emptyMessage).toBe(
      "This plan's retirement contributions are already set to the annual IRS maximum, so there is no rate left to raise.",
    );
  });

  it("says a plan with no deferral at all has nothing to raise", () => {
    const d = buildEarlyYearsLadderData(ctx(THREE_RUNGS, { tree: baseTree([]) }), OPTS);
    expect(d.emptyMessage).toBe(
      "This plan has no payroll retirement contributions to model, so there is no contribution to raise.",
    );
  });

  it("says so when the plan never reaches a milestone age on the chart", () => {
    const d = buildEarlyYearsLadderData(ctx(THREE_RUNGS, { ages: [29] }), OPTS);
    expect(d.groups).toEqual([]);
    expect(d.emptyMessage).toBe(
      "This plan does not run to any of the milestone ages on this chart.",
    );
  });

  it("carries no empty message when it has a chart to draw", () => {
    expect(buildEarlyYearsLadderData(ctx(THREE_RUNGS), OPTS).emptyMessage).toBeNull();
  });
});
