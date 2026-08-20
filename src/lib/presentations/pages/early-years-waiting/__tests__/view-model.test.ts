import { describe, it, expect } from "vitest";
import {
  buildEarlyYearsWaitingData,
  EARLY_YEARS_WAITING_PAGE_ID,
  delayKey,
} from "../view-model";
import { derivedKey } from "@/lib/presentations/derived-refs";
import type { BuildDataContext } from "@/components/presentations/registry";
import type { EarlyYearsWaitingPageOptions } from "../types";

const OPTS: EarlyYearsWaitingPageOptions = {
  rungOffset: 0.03,
  delays: [0, 5, 10],
  milestoneAges: [40, 50, 65],
  tidbits: [],
};

const yr = (age: number, liquid: number, savingsTotal: number) => ({
  year: 2026 + (age - 29),
  ages: { client: age },
  income: { salaries: 120_000, total: 120_000 },
  savings: { byAccount: {}, total: savingsTotal, employerTotal: 0 },
  portfolioAssets: { liquidTotal: liquid },
});

const baseTree = {
  planSettings: { inflationRate: 0.03, planStartYear: 2026 },
  savingsRules: [
    {
      id: "r1",
      accountId: "a1",
      annualAmount: 0,
      annualPercent: 0.08,
      isDeductible: true,
      startYear: 2020,
      endYear: 2060,
    },
  ],
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

interface Arm {
  savings: number;
  at: [number, number, number];
}

/** The plan as it stands: 8% of $120,000. The page reads the client's CURRENT
 *  rate off this bundle, so it has to be distinct from the arms — conflating
 *  the two is how a fixture reports every uncapped chart as capped. */
const BASE_SAVINGS = 9_600;

/** One bundle per delay, plus the base. `at` is the liquid portfolio at ages
 *  40/50/65; `savings` is the arm's FIRST-YEAR contribution, which is what the
 *  cap footnote reads — so a delayed arm still contributes the base amount
 *  there, exactly as the engine would. */
function ctx(arms: Arm[], tree: unknown = baseTree): BuildDataContext {
  const years = (savings: number, at: [number, number, number]) => [
    yr(29, 40_000, savings),
    yr(40, at[0], savings),
    yr(50, at[1], savings),
    yr(65, at[2], savings),
  ];
  const baseYears = years(BASE_SAVINGS, [230_000, 510_000, 1_140_000]);
  const bundlesByRef: Record<string, unknown> = {
    base: { clientData: tree, projection: { years: baseYears }, scenarioLabel: "Base Case" },
  };
  arms.forEach((a, i) => {
    bundlesByRef[derivedKey(EARLY_YEARS_WAITING_PAGE_ID, delayKey(i))] = {
      clientData: tree,
      projection: { years: years(a.savings, a.at) },
      scenarioLabel: `Delay ${i}`,
    };
  });
  return {
    years: baseYears,
    projection: { years: baseYears },
    clientData: tree,
    scenarioLabel: "Base Case",
    bundlesByRef,
  } as unknown as BuildDataContext;
}

const arms: Arm[] = [
  // Starts now, so its first year already funds the raised 11%.
  { savings: 13_200, at: [260_000, 590_000, 1_340_000] },
  // Postponed, so year one is still the base contribution.
  { savings: BASE_SAVINGS, at: [235_000, 540_000, 1_205_000] },
  { savings: BASE_SAVINGS, at: [215_000, 495_000, 1_090_000] },
];

describe("buildEarlyYearsWaitingData", () => {
  it("draws one cluster per milestone age and one bar per delay", () => {
    const d = buildEarlyYearsWaitingData(ctx(arms), OPTS);
    expect(d.groups.map((g) => g.age)).toEqual([40, 50, 65]);
    expect(d.groups[0].bars).toHaveLength(3);
  });

  it("names each series by its delay, not by a rate", () => {
    const d = buildEarlyYearsWaitingData(ctx(arms), OPTS);
    expect(d.seriesLabels).toEqual(["Start now", "Start in 5 years", "Start in 10 years"]);
  });

  it("carries each bar in today's and nominal dollars", () => {
    const d = buildEarlyYearsWaitingData(ctx(arms), OPTS);
    // Age 65 is 2062, 36 years out at 3%: 1_340_000 / 1.03^36 ≈ 462_000.
    expect(d.groups[2].year).toBe(2062);
    expect(d.groups[2].bars[0].value.today).toBeLessThan(600_000);
    expect(d.groups[2].bars[0].value.today).toBeGreaterThan(0);
    expect(d.groups[2].bars[0].value.nominal).toBe(1_340_000);
  });

  it("prices the wait in the takeaway, at the LAST milestone the chart reaches", () => {
    const d = buildEarlyYearsWaitingData(ctx(arms), OPTS);
    expect(d.takeaway).toContain("age 65");
    expect(d.takeaway).toContain("five years");
    expect(d.takeaway).toContain("today");
    expect(d.takeaway).toContain("in 2062 dollars");
  });

  it("says nothing about a wait when the advisor charted only one start date", () => {
    const d = buildEarlyYearsWaitingData(ctx([arms[0]]), { ...OPTS, delays: [0] });
    expect(d.takeaway).toBeNull();
  });

  it("footnotes the IRS limit when the raised contribution could not be funded", () => {
    // Asked for 11% of $120,000 = $13,200; the start-now arm delivered $10,000.
    const d = buildEarlyYearsWaitingData(
      ctx([{ ...arms[0], savings: 10_000 }, arms[1], arms[2]]),
      OPTS,
    );
    expect(d.isCapped).toBe(true);
  });

  it("reads the cap off the START-NOW arm only", () => {
    // Every delayed arm still contributes the BASE amount in year one, so
    // judging them against the raised rate would report every chart as capped.
    expect(buildEarlyYearsWaitingData(ctx(arms), OPTS).isCapped).toBe(false);
  });

  it("does not footnote a limit that did not bind", () => {
    expect(buildEarlyYearsWaitingData(ctx(arms), OPTS).isCapped).toBe(false);
  });

  it("prints an empty-state sentence naming WHY when nothing can be raised", () => {
    const d = buildEarlyYearsWaitingData(ctx(arms, { ...baseTree, savingsRules: [] }), OPTS);
    expect(d.groups).toEqual([]);
    expect(d.emptyMessage).toContain("no payroll retirement contributions");
  });

  it("says the client is already at the annual maximum rather than that they save nothing", () => {
    const maxed = {
      ...baseTree,
      savingsRules: [
        {
          id: "r1",
          accountId: "a1",
          annualAmount: 0,
          contributeMax: true,
          isDeductible: true,
          startYear: 2020,
          endYear: 2060,
        },
      ],
    };
    const d = buildEarlyYearsWaitingData(ctx(arms, maxed), OPTS);
    expect(d.emptyMessage).toContain("annual IRS maximum");
  });

  it("skips a milestone age the projection never reaches", () => {
    const d = buildEarlyYearsWaitingData(ctx(arms), {
      ...OPTS,
      milestoneAges: [40, 50, 65, 80],
    });
    expect(d.groups.map((g) => g.age)).toEqual([40, 50, 65]);
  });

  it("renders its empty state when a variant is missing", () => {
    const c = ctx(arms);
    delete (c.bundlesByRef as Record<string, unknown>)[
      derivedKey(EARLY_YEARS_WAITING_PAGE_ID, delayKey(1))
    ];
    expect(buildEarlyYearsWaitingData(c, OPTS).groups).toEqual([]);
  });
});
