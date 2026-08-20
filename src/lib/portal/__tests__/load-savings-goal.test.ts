import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db/schema", () => ({
  scenarios: { id: "id", clientId: "client_id", isBaseCase: "is_base_case" },
  clients: { id: "id", firmId: "firm_id" },
  assetClasses: {
    id: "id",
    firmId: "firm_id",
    slug: "slug",
    geometricReturn: "geometric_return",
  },
  clientCmaOverrides: {
    clientId: "client_id",
    sourceAssetClassId: "source_asset_class_id",
    geometricReturn: "geometric_return",
  },
  planSettings: {
    clientId: "client_id",
    scenarioId: "scenario_id",
    inflationRate: "inflation_rate",
    inflationRateSource: "inflation_rate_source",
    useCustomCma: "use_custom_cma",
  },
  portalCalculatorStates: {
    clientId: "client_id",
    calculatorKey: "calculator_key",
    state: "state",
  },
}));
vi.mock("drizzle-orm", () => ({ and: (...a: unknown[]) => a, eq: (...a: unknown[]) => a }));

/**
 * Every query ends in `.limit()`, so the queue shifts once per query in call
 * order: scenario, then the parallel trio (settings, saved state, the firm's
 * inflation asset class), then the client CMA override — which only fires when
 * the plan says `use_custom_cma`.
 */
let queue: unknown[][] = [];
type Chain = {
  from: () => Chain;
  innerJoin: () => Chain;
  where: () => Chain;
  limit: () => Promise<unknown[]>;
};
vi.mock("@/db", () => {
  const chain: Chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(queue.shift() ?? []),
  };
  return { db: { select: () => chain } };
});

import { loadSavingsGoal, FALLBACK_INFLATION_RATE } from "../load-savings-goal";
import { createDefaultSavingsGoalState } from "@/lib/calculators/savings-goal-state";

const SCENARIO = [{ id: "s1" }];
const INFLATION_CLASS = [{ id: "ac-inflation", geometricReturn: "0.0240" }];

/** `inflation_rate_source` is NOT NULL DEFAULT 'asset_class' — most rows look like this. */
const assetClassSourced = (rate: string, useCustomCma = false) => [
  { inflationRate: rate, inflationRateSource: "asset_class", useCustomCma },
];
const customSourced = (rate: string) => [
  { inflationRate: rate, inflationRateSource: "custom", useCustomCma: false },
];

beforeEach(() => {
  queue = [];
});

describe("loadSavingsGoal", () => {
  // The whole screen — the monthly number, the chart's goal line, the crossing
  // date — rides on this rate, and the workspace prints it as "your plan's
  // X% inflation". On the app's DEFAULT source the engine IGNORES the
  // inflation_rate column entirely, so reading it makes that sentence false.
  it("resolves the firm's inflation asset class, not the raw column, on the asset_class source", async () => {
    queue = [SCENARIO, assetClassSourced("0.0300"), [], INFLATION_CLASS];
    expect((await loadSavingsGoal("c1")).inflationRate).toBe(0.024);
  });

  it("reads the raw column on the custom source, coercing the decimal STRING", async () => {
    queue = [SCENARIO, customSourced("0.0254"), [], INFLATION_CLASS];
    expect((await loadSavingsGoal("c1")).inflationRate).toBe(0.0254);
  });

  it("prefers the client's own CMA override over the firm's asset class", async () => {
    queue = [
      SCENARIO,
      assetClassSourced("0.0300", true),
      [],
      INFLATION_CLASS,
      [{ geometricReturn: "0.0350" }],
    ];
    expect((await loadSavingsGoal("c1")).inflationRate).toBe(0.035);
  });

  it("ignores a client CMA override the plan has not opted into", async () => {
    queue = [
      SCENARIO,
      assetClassSourced("0.0300", false),
      [],
      INFLATION_CLASS,
      [{ geometricReturn: "0.0350" }],
    ];
    expect((await loadSavingsGoal("c1")).inflationRate).toBe(0.024);
  });

  // A firm with no Inflation asset class gets 0 everywhere else in the app.
  // Showing 3% here instead would put the calculator out of step with the plan
  // it claims to quote — the exact defect this resolution exists to close.
  it("yields zero when the firm holds no inflation asset class, matching the engine", async () => {
    queue = [SCENARIO, assetClassSourced("0.0300"), [], []];
    expect((await loadSavingsGoal("c1")).inflationRate).toBe(0);
  });

  it("falls back when there is no plan_settings row", async () => {
    queue = [SCENARIO, [], [], INFLATION_CLASS];
    expect((await loadSavingsGoal("c1")).inflationRate).toBe(FALLBACK_INFLATION_RATE);
  });

  it("falls back when the client has no base scenario yet", async () => {
    queue = [[], [], INFLATION_CLASS];
    expect((await loadSavingsGoal("c1")).inflationRate).toBe(FALLBACK_INFLATION_RATE);
  });

  // Each raw value kills a different clause of the guard. "not-a-number" only
  // exercises `Number.isFinite`; without a case on each side of the range the
  // `>= 0 && <= 1` clause could be deleted with every test still green, and a
  // column holding a mis-scaled "5" would compound the goal at 500% a year.
  it.each([["not-a-number"], ["5.0000"], ["-0.0200"]])(
    "falls back on the unparseable or out-of-range rate %s rather than yielding NaN",
    async (raw) => {
      queue = [SCENARIO, customSourced(raw), [], INFLATION_CLASS];
      const dto = await loadSavingsGoal("c1");
      expect(Number.isFinite(dto.inflationRate)).toBe(true);
      expect(dto.inflationRate).toBe(FALLBACK_INFLATION_RATE);
    },
  );

  it("returns the client's saved setup when it still validates", async () => {
    const saved = {
      v: 1,
      name: "Boat",
      targetToday: 40_000,
      targetYear: 2033,
      currentSavings: 1_000,
      annualReturn: 0.08,
      mode: "contribute",
      monthlyContribution: 150,
    };
    queue = [SCENARIO, assetClassSourced("0.0300"), [{ state: saved }], INFLATION_CLASS];
    expect((await loadSavingsGoal("c1")).state).toEqual(saved);
  });

  it("falls back to defaults on a stored payload that no longer validates", async () => {
    queue = [
      SCENARIO,
      assetClassSourced("0.0300"),
      [{ state: { v: 1, name: "" } }],
      INFLATION_CLASS,
    ];
    const dto = await loadSavingsGoal("c1");
    expect(dto.state).toEqual(createDefaultSavingsGoalState());
  });
});
