import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db/schema", () => ({
  scenarios: { id: "id", clientId: "client_id", isBaseCase: "is_base_case" },
  planSettings: {
    clientId: "client_id",
    scenarioId: "scenario_id",
    inflationRate: "inflation_rate",
  },
  portalCalculatorStates: {
    clientId: "client_id",
    calculatorKey: "calculator_key",
    state: "state",
  },
}));
vi.mock("drizzle-orm", () => ({ and: (...a: unknown[]) => a, eq: (...a: unknown[]) => a }));

/**
 * The loader fires three selects (scenario, then settings + saved state in
 * parallel). Queue one result per call, in order.
 */
let queue: unknown[][] = [];
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve(queue.shift() ?? []) }),
      }),
    }),
  },
}));

import { loadSavingsGoal, FALLBACK_INFLATION_RATE } from "../load-savings-goal";
import { createDefaultSavingsGoalState } from "@/lib/calculators/savings-goal-state";

const SCENARIO = [{ id: "s1" }];

beforeEach(() => {
  queue = [];
});

describe("loadSavingsGoal", () => {
  it("reads the household's own inflation rate, coercing the decimal STRING", () => {
    queue = [SCENARIO, [{ inflationRate: "0.0254" }], []];
    return loadSavingsGoal("c1").then((dto) => {
      expect(dto.inflationRate).toBe(0.0254);
    });
  });

  it("falls back when there is no plan_settings row", async () => {
    queue = [SCENARIO, [], []];
    expect((await loadSavingsGoal("c1")).inflationRate).toBe(FALLBACK_INFLATION_RATE);
  });

  it("falls back when the client has no base scenario yet", async () => {
    queue = [[], [], []];
    expect((await loadSavingsGoal("c1")).inflationRate).toBe(FALLBACK_INFLATION_RATE);
  });

  // Each raw value kills a different clause of the guard. "not-a-number" only
  // exercises `Number.isFinite`; without a case on each side of the range the
  // `>= 0 && <= 1` clause could be deleted with every test still green, and a
  // column holding a mis-scaled "5" would compound the goal at 500% a year.
  it.each([["not-a-number"], ["5.0000"], ["-0.0200"]])(
    "falls back on the unparseable or out-of-range rate %s rather than yielding NaN",
    async (raw) => {
      queue = [SCENARIO, [{ inflationRate: raw }], []];
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
    queue = [SCENARIO, [{ inflationRate: "0.0300" }], [{ state: saved }]];
    expect((await loadSavingsGoal("c1")).state).toEqual(saved);
  });

  it("falls back to defaults on a stored payload that no longer validates", async () => {
    queue = [SCENARIO, [{ inflationRate: "0.0300" }], [{ state: { v: 1, name: "" } }]];
    const dto = await loadSavingsGoal("c1");
    expect(dto.state).toEqual(createDefaultSavingsGoalState());
  });
});
