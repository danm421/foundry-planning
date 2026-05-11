// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ComparisonKpiStrip } from "../comparison-kpi-strip";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";

function fakePlan(
  index: number,
  label: string,
  overrides: {
    endingNW?: number;
    lifetimeTax?: number;
    toHeirs?: number;
    estateTax?: number;
    yearsSurvives?: number;
  } = {},
): ComparisonPlan {
  const years = Array.from(
    { length: overrides.yearsSurvives ?? 30 },
    (_, i) => ({ year: 2026 + i, portfolioAssets: { total: 1 } }),
  );
  years.push({
    year: 2026 + (overrides.yearsSurvives ?? 30),
    portfolioAssets: { total: overrides.endingNW ?? 1_000_000 },
  });
  return {
    index,
    isBaseline: index === 0,
    ref: { kind: "scenario", id: index === 0 ? "base" : `sid_${index}`, toggleState: {} },
    id: index === 0 ? "base" : `sid_${index}`,
    label,
    tree: {} as never,
    result: {
      years: years as never,
      firstDeathEvent: {
        federalEstateTax: overrides.estateTax ?? 0,
        stateEstateTax: 0,
        estateAdminExpenses: 0,
      },
      secondDeathEvent: undefined,
    } as never,
    lifetime: { total: overrides.lifetimeTax ?? 0, byBucket: {} as never },
    liquidityRows: [],
    finalEstate: { totalToHeirs: overrides.toHeirs ?? 0 } as never,
    panelData: null,
  };
}

describe("ComparisonKpiStrip (grid)", () => {
  it("renders one column per plan at N=2", () => {
    render(
      <ComparisonKpiStrip
        plans={[
          fakePlan(0, "Base", { endingNW: 1_000_000 }),
          fakePlan(1, "Roth", { endingNW: 1_200_000 }),
        ]}
        mcSuccessByIndex={{}}
      />,
    );
    expect(screen.getAllByRole("columnheader")).toHaveLength(2);
    expect(screen.getByText(/^base$/i)).toBeInTheDocument();
    expect(screen.getByText(/roth/i)).toBeInTheDocument();
  });

  it("renders 4 columns at N=4", () => {
    render(
      <ComparisonKpiStrip
        plans={[
          fakePlan(0, "Base"),
          fakePlan(1, "A"),
          fakePlan(2, "B"),
          fakePlan(3, "C"),
        ]}
        mcSuccessByIndex={{}}
      />,
    );
    expect(screen.getAllByRole("columnheader")).toHaveLength(4);
  });

  it("baseline column shows absolute Ending NW; other columns show ±delta", () => {
    render(
      <ComparisonKpiStrip
        plans={[
          fakePlan(0, "Base", { endingNW: 1_000_000 }),
          fakePlan(1, "Roth", { endingNW: 1_200_000 }),
        ]}
        mcSuccessByIndex={{}}
      />,
    );
    const baselineCol = screen.getByTestId("kpi-col-0");
    const compareCol = screen.getByTestId("kpi-col-1");
    expect(within(baselineCol).getByText(/\$1,000,000/)).toBeInTheDocument();
    expect(within(compareCol).getByText(/\+\$200,000/)).toBeInTheDocument();
  });

  it("colors delta green when better, rose when worse (per-KPI direction)", () => {
    render(
      <ComparisonKpiStrip
        plans={[
          fakePlan(0, "Base", { lifetimeTax: 100_000 }),
          fakePlan(1, "B", { lifetimeTax: 80_000 }),
        ]}
        mcSuccessByIndex={{}}
      />,
    );
    // Lower lifetime tax is better → delta of -20k should render in emerald.
    const compareCol = screen.getByTestId("kpi-col-1");
    const lifetimeRow = within(compareCol).getByText(/\$20,000/);
    expect(lifetimeRow.className).toMatch(/emerald/);
  });
});
