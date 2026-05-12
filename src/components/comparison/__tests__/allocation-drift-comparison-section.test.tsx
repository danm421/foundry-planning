// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AllocationDriftComparisonSection } from "../allocation-drift-comparison-section";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";

vi.mock("react-chartjs-2", () => ({
  Line: () => <div data-testid="chart" />,
  Bar: () => <div data-testid="chart" />,
}));

function mkPlan(label: string, years: number[] = [2030]): ComparisonPlan {
  return {
    index: 0,
    isBaseline: true,
    ref: { kind: "scenario", id: label },
    id: label,
    label,
    tree: {} as ComparisonPlan["tree"],
    result: {
      years: years.map((year) => ({
        year,
        portfolioAssets: {
          taxable: {}, cash: {}, retirement: {}, realEstate: {}, business: {},
          lifeInsurance: {}, trustsAndBusinesses: {}, accessibleTrustAssets: {},
          taxableTotal: 100, cashTotal: 50, retirementTotal: 200, realEstateTotal: 150,
          businessTotal: 0, lifeInsuranceTotal: 0, trustsAndBusinessesTotal: 0,
          accessibleTrustAssetsTotal: 0, total: 500,
        },
      })) as ComparisonPlan["result"]["years"],
    } as ComparisonPlan["result"],
    lifetime: {} as ComparisonPlan["lifetime"],
    liquidityRows: [],
    finalEstate: null,
    panelData: null,
  };
}

describe("AllocationDriftComparisonSection", () => {
  it("renders one chart per plan", () => {
    render(
      <AllocationDriftComparisonSection
        plans={[mkPlan("A"), mkPlan("B")]}
        yearRange={null}
      />,
    );
    expect(screen.getAllByTestId("chart")).toHaveLength(2);
  });

  it("includes plan labels", () => {
    render(
      <AllocationDriftComparisonSection
        plans={[mkPlan("Plan A"), mkPlan("Plan B")]}
        yearRange={null}
      />,
    );
    expect(screen.getByText("Plan A")).toBeTruthy();
    expect(screen.getByText("Plan B")).toBeTruthy();
  });

  it("renders an empty state when total portfolio is 0 in every clipped year", () => {
    const empty: ComparisonPlan = {
      ...mkPlan("Empty"),
      result: {
        years: [
          {
            year: 2030,
            portfolioAssets: {
              taxable: {}, cash: {}, retirement: {}, realEstate: {}, business: {},
              lifeInsurance: {}, trustsAndBusinesses: {}, accessibleTrustAssets: {},
              taxableTotal: 0, cashTotal: 0, retirementTotal: 0, realEstateTotal: 0,
              businessTotal: 0, lifeInsuranceTotal: 0, trustsAndBusinessesTotal: 0,
              accessibleTrustAssetsTotal: 0, total: 0,
            },
          },
        ] as ComparisonPlan["result"]["years"],
      } as ComparisonPlan["result"],
    };
    render(<AllocationDriftComparisonSection plans={[empty]} yearRange={null} />);
    expect(screen.getByText(/No portfolio data/i)).toBeTruthy();
  });

  it("renders the multi-year area chart when yearRange spans multiple years", () => {
    const { container } = render(
      <AllocationDriftComparisonSection
        plans={[mkPlan("base", [2026, 2027, 2028])]}
        yearRange={{ start: 2026, end: 2028 }}
      />,
    );
    expect(container.querySelector("[data-test='allocation-drift-area']")).not.toBeNull();
    expect(container.querySelector("[data-test='allocation-drift-bar']")).toBeNull();
  });

  it("renders the single-year horizontal bar when start === end", () => {
    const { container } = render(
      <AllocationDriftComparisonSection
        plans={[mkPlan("base", [2026, 2027, 2028])]}
        yearRange={{ start: 2026, end: 2026 }}
      />,
    );
    expect(container.querySelector("[data-test='allocation-drift-bar']")).not.toBeNull();
    expect(container.querySelector("[data-test='allocation-drift-area']")).toBeNull();
  });
});
