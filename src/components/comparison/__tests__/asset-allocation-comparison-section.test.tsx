// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AssetAllocationComparisonSection } from "../asset-allocation-comparison-section";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";

vi.mock("@/components/investments/asset-allocation-donut", () => ({
  AssetAllocationDonut: () => <div data-testid="donut" />,
}));

function mkPlan(label: string, allocation: unknown): ComparisonPlan {
  return {
    index: 0,
    isBaseline: true,
    ref: { kind: "scenario", id: label },
    id: label,
    label,
    tree: {} as ComparisonPlan["tree"],
    result: { years: [] } as ComparisonPlan["result"],
    lifetime: {} as ComparisonPlan["lifetime"],
    liquidityRows: [],
    finalEstate: null,
    panelData: null,
    allocation: allocation as ComparisonPlan["allocation"],
  };
}

describe("AssetAllocationComparisonSection", () => {
  it("renders empty state when allocation is null", () => {
    render(<AssetAllocationComparisonSection plans={[mkPlan("A", null)]} mode="detailed" />);
    expect(screen.getByText(/No investable accounts/i)).toBeTruthy();
  });

  it("renders one donut per plan with allocation", () => {
    const fakeAlloc = { totalInvestableValue: 1, byAssetClass: [], byAssetType: [], unallocatedValue: 0, totalClassifiedValue: 0, excludedNonInvestableValue: 0, contributionsByAssetClass: {}, contributionsByAssetType: {}, unallocatedContributions: [] };
    render(<AssetAllocationComparisonSection plans={[mkPlan("A", fakeAlloc), mkPlan("B", fakeAlloc)]} mode="detailed" />);
    expect(screen.getAllByTestId("donut")).toHaveLength(2);
  });
});
