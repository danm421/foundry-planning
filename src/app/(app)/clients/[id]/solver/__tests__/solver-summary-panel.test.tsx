// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { SolverSummaryPanel } from "../solver-summary-panel";
import type { ProjectionYear } from "@/engine";

vi.mock("@/components/solver/summaries/registry", () => {
  const def = { label: "", build: () => ({}), Component: () => null };
  return {
    SUMMARY_TABS: [
      { key: "retirement", label: "Retirement" },
      { key: "retirementComparison", label: "Retirement Comparison" },
      { key: "tax", label: "Tax" },
      { key: "medicare", label: "Medicare" },
      { key: "estate", label: "Estate" },
      { key: "lifeInsurance", label: "Life Insurance" },
    ],
    SUMMARY_REGISTRY: {
      retirement: def, retirementComparison: def, tax: def,
      medicare: def, estate: def, lifeInsurance: def,
    },
  };
});

// Stub the Run-button panels so this test doesn't pull in the fetch hook/charts.
vi.mock("../solver-retirement-comparison-panel", () => ({
  SolverRetirementComparisonPanel: () => <div data-testid="rc-panel" />,
}));
vi.mock("../solver-life-insurance-summary-panel", () => ({
  SolverLifeInsuranceSummaryPanel: () => <div data-testid="li-panel" />,
}));

const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());

const years = [{ year: 2025 }] as unknown as ProjectionYear[];
const base = {
  clientId: "c1", source: "base" as const, mutations: [],
  years,
  workingTree: { client: {} } as never,
  clientName: "Ada", spouseName: null, mcSuccessRate: 0.9,
  baseClientData: { client: {} } as never,
  baseProjection: years,
  extraAccountMixes: [],
  liAssumptions: {} as never,
  liModelPortfolioLabel: "Plan default rate",
};

describe("SolverSummaryPanel", () => {
  it("renders the sub-tab row and switches summaries", () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <SolverSummaryPanel {...base} activeSummary="tax" onSummaryChange={onChange} />,
    );
    fireEvent.click(getByRole("tab", { name: "Medicare" }));
    expect(onChange).toHaveBeenCalledWith("medicare");
  });

  // Regression: retirementComparison used to early-return before useMemo, so
  // switching to/from it on a mounted panel changed the hook count and crashed
  // React ("rendered fewer/more hooks"). Hooks must stay unconditional.
  it("switches to the retirementComparison tab and back without a hooks error", () => {
    const onChange = vi.fn();
    const { rerender, getByTestId, queryByTestId } = render(
      <SolverSummaryPanel {...base} activeSummary="tax" onSummaryChange={onChange} />,
    );
    rerender(<SolverSummaryPanel {...base} activeSummary="retirementComparison" onSummaryChange={onChange} />);
    expect(getByTestId("rc-panel")).toBeTruthy();
    rerender(<SolverSummaryPanel {...base} activeSummary="tax" onSummaryChange={onChange} />);
    expect(queryByTestId("rc-panel")).toBeNull();
  });
});
