// Golden-fixture manifest for `npm run eval:planner` (golden.eval.ts).
//
// Adding a case must be a DATA change, not a code change: drop a scrubbed
// document at `src/lib/imports/planner/__tests__/fixtures/<slug>.txt` and add
// a matching entry here. See task-19's controller resolutions (R0) for why the
// five `.txt` files below are not checked in yet — the fixture text requires a
// PII scrub the repo owner has not yet performed. Until each file is dropped
// in, golden.eval.ts reports its case as a named skip rather than a pass.
export interface FixtureCase {
  slug: string;
  /** Human label for the eval output. */
  label: string;
  /** Assertions run against the PlanningDecisions the planner returned. */
  expect: {
    retirementAge?: number;
    spouseRetirementAge?: number;
    lifeExpectancy?: number;
    spouseLifeExpectancy?: number;
    inflationRate?: number;
    /** Minimum number of savings decisions expected. */
    minSavings?: number;
    /** accountName -> expected annualPercent. */
    savingsPercentByAccount?: Record<string, number>;
    /** accountName -> [employerMatchPct, employerMatchCap]. */
    savingsMatchByAccount?: Record<string, [number, number]>;
    /** owner -> expected basis. piaMonthly is asserted non-zero. */
    ssBasisByOwner?: Record<"client" | "spouse", string>;
    /** Substring that must appear in some decision reason. */
    reasonContains?: string[];
    minGoals?: number;
  };
}

export const FIXTURES: FixtureCase[] = [
  {
    slug: "emoney-facts-full",
    label: "eMoney Facts export, two earners with contributions and goals",
    expect: {
      retirementAge: 64,
      spouseRetirementAge: 60,
      lifeExpectancy: 95,
      spouseLifeExpectancy: 95,
      inflationRate: 0.03,
      minSavings: 3,
      savingsPercentByAccount: { "Zach 401(k)": 0.1, "Mariah 403(b)": 0.07 },
      savingsMatchByAccount: { "Zach 401(k)": [1, 0.04], "Mariah 403(b)": [1, 0.03] },
      ssBasisByOwner: { client: "estimated_from_income", spouse: "estimated_from_income" },
      minGoals: 4,
    },
  },
  {
    slug: "narrative-fact-pattern",
    label: "Narrative fact pattern with ranged retirement ages",
    expect: {
      retirementAge: 64,
      spouseRetirementAge: 60,
      lifeExpectancy: 95,
      inflationRate: 0.03,
      minSavings: 3,
      reasonContains: ["60"],
    },
  },
  {
    slug: "emoney-two-earner",
    label: "Two earners; spouse salary wrongly ends at death",
    expect: {
      retirementAge: 65,
      spouseRetirementAge: 65,
      lifeExpectancy: 95,
      savingsPercentByAccount: { "401(k) - James": 0.06 },
      ssBasisByOwner: { client: "stated_fra_amount", spouse: "estimated_from_income" },
    },
  },
  {
    slug: "emoney-detailed-expenses",
    label: "Itemised living expenses, 529-funded education goal",
    expect: { retirementAge: 65, spouseRetirementAge: 61, lifeExpectancy: 100, minGoals: 2 },
  },
  {
    slug: "emoney-high-net-worth",
    label: "High net worth; tiered employer match",
    expect: {
      retirementAge: 65,
      lifeExpectancy: 90,
      savingsMatchByAccount: { "Barclays 401K": [0.5, 0.06] },
      minGoals: 2,
    },
  },
];
