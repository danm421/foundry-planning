import { describe, it, expect } from "vitest";
import type { ClientData, ProjectionYear } from "@/engine/types";
import { buildSolverComparisonPlan } from "../build-solver-comparison-plan";

const baseClient: ClientData["client"] = {
  firstName: "Cooper",
  lastName: "Smith",
  dateOfBirth: "1965-03-15",
  retirementAge: 65,
  planEndAge: 95,
  filingStatus: "single",
};

const tree = {
  client: baseClient,
  accounts: [],
  incomes: [],
  expenses: [],
  liabilities: [],
  savingsRules: [],
  withdrawalStrategy: [],
  giftEvents: [],
  planSettings: {} as ClientData["planSettings"],
} as ClientData;

const years: ProjectionYear[] = [
  { year: 2026 } as ProjectionYear,
  { year: 2027 } as ProjectionYear,
];

describe("buildSolverComparisonPlan", () => {
  it("returns a ComparisonPlan-shaped object with the supplied tree and result", () => {
    const plan = buildSolverComparisonPlan({
      id: "base",
      label: "Base Facts",
      tree,
      years,
      isBaseline: true,
      index: 0,
    });
    expect(plan.id).toBe("base");
    expect(plan.label).toBe("Base Facts");
    expect(plan.isBaseline).toBe(true);
    expect(plan.tree).toBe(tree);
    expect(plan.result.years).toBe(years);
  });

  it("stubs the auxiliary fields with empty / null values", () => {
    const plan = buildSolverComparisonPlan({
      id: "working:v1",
      label: "Working",
      tree,
      years,
      isBaseline: false,
      index: 1,
    });
    expect(plan.liquidityRows).toEqual([]);
    expect(plan.finalEstate).toBeNull();
    expect(plan.panelData).toBeNull();
    expect(plan.allocation).toBeNull();
    expect(plan.lifetime).toBeDefined();
    expect(plan.lifetime.total).toBe(0);
  });

  // Solver plans wrap transient in-memory trees (live base + working edits) that
  // are NOT saved scenarios. They must be snapshot refs so useSharedMcRun's
  // cacheScenarioId() returns null and runs Monte Carlo client-side on the
  // supplied tree — fetching `?scenario=working:v1` 500s (no such scenario).
  it("constructs a snapshot ScenarioRef for the working plan", () => {
    const plan = buildSolverComparisonPlan({
      id: "working:v1",
      label: "Working",
      tree,
      years,
      isBaseline: false,
      index: 1,
    });
    expect(plan.ref.kind).toBe("snapshot");
  });

  it("constructs a snapshot ScenarioRef for the base plan", () => {
    const plan = buildSolverComparisonPlan({
      id: "base:v1",
      label: "Base Facts",
      tree,
      years,
      isBaseline: true,
      index: 0,
    });
    expect(plan.ref.kind).toBe("snapshot");
  });
});
