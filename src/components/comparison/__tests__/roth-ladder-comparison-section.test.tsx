// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RothLadderComparisonSection } from "../roth-ladder-comparison-section";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";

vi.mock("react-chartjs-2", () => ({
  Bar: () => <div data-testid="chart" />,
}));

function mkPlan(
  label: string,
  conversions: Array<{ year: number; entries: Array<{ id: string; name: string; gross: number; taxable: number }> }>,
): ComparisonPlan {
  const conversionMap = new Map(conversions.map((c) => [c.year, c.entries]));
  const minYear = Math.min(...conversions.map((c) => c.year), 2030);
  const maxYear = Math.max(...conversions.map((c) => c.year), 2030);
  const years: ComparisonPlan["result"]["years"] = [];
  for (let yr = minYear; yr <= maxYear; yr++) {
    years.push({
      year: yr,
      rothConversions: conversionMap.get(yr),
    } as ComparisonPlan["result"]["years"][number]);
  }
  return {
    index: 0,
    isBaseline: true,
    ref: { kind: "scenario", id: label },
    id: label,
    label,
    tree: {} as ComparisonPlan["tree"],
    result: { years } as ComparisonPlan["result"],
    lifetime: {} as ComparisonPlan["lifetime"],
    liquidityRows: [],
    finalEstate: null,
    panelData: null,
    allocation: null,
  };
}

describe("RothLadderComparisonSection", () => {
  it("renders one chart per plan with conversions", () => {
    render(
      <RothLadderComparisonSection
        plans={[
          mkPlan("A", [
            { year: 2032, entries: [{ id: "c1", name: "Trad → Roth", gross: 50_000, taxable: 50_000 }] },
            { year: 2033, entries: [{ id: "c1", name: "Trad → Roth", gross: 60_000, taxable: 60_000 }] },
          ]),
          mkPlan("B", []),
        ]}
        yearRange={null}
      />,
    );
    expect(screen.getAllByTestId("chart")).toHaveLength(1);
    expect(screen.getByText(/No Roth conversions/i)).toBeTruthy();
  });

  it("renders an empty state when no plan has conversions", () => {
    render(
      <RothLadderComparisonSection
        plans={[mkPlan("A", [])]}
        yearRange={null}
      />,
    );
    expect(screen.getByText(/No Roth conversions/i)).toBeTruthy();
  });
});
