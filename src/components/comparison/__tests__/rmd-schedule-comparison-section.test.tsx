// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RmdScheduleComparisonSection } from "../rmd-schedule-comparison-section";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";

vi.mock("react-chartjs-2", () => ({
  Bar: () => <div data-testid="chart" />,
}));

function mkPlan(label: string, rmds: Array<{ year: number; byAccount: Record<string, number> }>): ComparisonPlan {
  return {
    index: 0,
    isBaseline: true,
    ref: { kind: "scenario", id: label },
    id: label,
    label,
    tree: {
      accounts: [
        { id: "ira1", name: "Trad IRA 1", category: "retirement", subType: "traditional_ira", value: 0, basis: 0, growthRate: 0, rmdEnabled: true },
        { id: "ira2", name: "Trad IRA 2", category: "retirement", subType: "traditional_ira", value: 0, basis: 0, growthRate: 0, rmdEnabled: true },
      ],
    } as ComparisonPlan["tree"],
    result: {
      years: rmds.map((r) => ({
        year: r.year,
        accountLedgers: Object.fromEntries(
          Object.entries(r.byAccount).map(([id, amt]) => [
            id,
            { rmdAmount: amt } as { rmdAmount: number },
          ]),
        ),
      })) as ComparisonPlan["result"]["years"],
    } as ComparisonPlan["result"],
    lifetime: {} as ComparisonPlan["lifetime"],
    liquidityRows: [],
    finalEstate: null,
    panelData: null,
  };
}

describe("RmdScheduleComparisonSection", () => {
  it("renders one chart per plan that has RMDs in range", () => {
    render(
      <RmdScheduleComparisonSection
        plans={[
          mkPlan("A", [
            { year: 2035, byAccount: { ira1: 10_000, ira2: 5_000 } },
            { year: 2036, byAccount: { ira1: 11_000, ira2: 5_500 } },
          ]),
          mkPlan("B", [
            { year: 2035, byAccount: { ira1: 0, ira2: 0 } },
          ]),
        ]}
        yearRange={null}
      />,
    );
    // Plan A has a chart, Plan B shows empty-state for its card
    expect(screen.getAllByTestId("chart")).toHaveLength(1);
    expect(screen.getByText(/No RMDs/i)).toBeTruthy();
  });

  it("renders an empty state when no plan has RMDs in range", () => {
    render(
      <RmdScheduleComparisonSection
        plans={[mkPlan("A", [{ year: 2035, byAccount: {} }])]}
        yearRange={null}
      />,
    );
    expect(screen.getByText(/No RMDs/i)).toBeTruthy();
  });
});
