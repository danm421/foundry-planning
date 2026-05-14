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

  it("constructs a ScenarioRef of kind scenario when id is not 'base'", () => {
    const plan = buildSolverComparisonPlan({
      id: "11111111-1111-4111-8111-111111111111",
      label: "Working",
      tree,
      years,
      isBaseline: false,
      index: 1,
    });
    expect(plan.ref.kind).toBe("scenario");
  });

  it("constructs a ScenarioRef with id 'base' when id is 'base'", () => {
    const plan = buildSolverComparisonPlan({
      id: "base",
      label: "Base Facts",
      tree,
      years,
      isBaseline: true,
      index: 0,
    });
    expect(plan.ref.kind).toBe("scenario");
    expect((plan.ref as any).id).toBe("base");
  });
});
