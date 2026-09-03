// @vitest-environment jsdom
// src/components/solver/summaries/__tests__/retirement-comparison-view.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RetirementComparisonView } from "../retirement-comparison-view";
import type { RetirementComparisonPageData } from "@/lib/presentations/pages/retirement-comparison/types";

const EMPTY_BUCKETS = { cash: 0, taxable: 0, preTax: 0, roth: 0, hsa: 0 };

const DATA: RetirementComparisonPageData = {
  title: "Retirement Comparison",
  subtitle: "Base Case vs. Proposed",
  baselineLabel: "Base Case",
  scenarioLabel: "Proposed",
  isEmpty: false,
  verdict: { headline: "91% chance your plan fully funds your life — up from 73%." },
  kpis: [
    { label: "Plan confidence", base: "73%", scenario: "91%", delta: "+18 pts", direction: 1, show: true },
    { label: "Legacy to heirs", base: "$2.0M", scenario: "$2.4M", delta: "+$400K", direction: 0, show: true },
  ],
  overlay: [{ year: 2025, floor: 100, scenarioAhead: 20, baseAhead: 0 }],
  atRetirement: { baseYear: 2040, scenarioYear: 2040, base: { ...EMPTY_BUCKETS, roth: 100 }, scenario: { ...EMPTY_BUCKETS, roth: 200 } },
  atEndOfLife: { baseYear: 2065, scenarioYear: 2065, base: EMPTY_BUCKETS, scenario: EMPTY_BUCKETS },
  maxSpend: { show: false, baseToday: 0, scenarioToday: 0, series: [] },
  confidence: { show: false, points: [] },
  showPortfolioMatrix: false,
  showAiSummary: false,
  aiMarkdown: "",
};

describe("<RetirementComparisonView />", () => {
  it("renders the verdict headline and comparison KPIs; never an AI section", () => {
    render(<RetirementComparisonView data={DATA} />);
    expect(screen.getByText(/91% chance your plan fully funds your life/)).toBeInTheDocument();
    expect(screen.getByText("Plan confidence")).toBeInTheDocument();
    expect(screen.getByText("91%")).toBeInTheDocument();
    expect(screen.getByText("+18 pts")).toBeInTheDocument();
    expect(screen.queryByText(/AI/i)).not.toBeInTheDocument();
  });

  // Every delta used to print in the success colour whichever way it moved, so
  // a drop in plan confidence read as good news. Assert the class per direction
  // — a delta whose tone is wrong is worse than one that is missing.
  it("colors each delta by its direction, not by its sign", () => {
    const data: RetirementComparisonPageData = {
      ...DATA,
      kpis: [
        { label: "Plan confidence", base: "90%", scenario: "73%", delta: "−17 pts", direction: -1, show: true },
        { label: "Retirement age", base: "65", scenario: "60", delta: "−5 yrs", direction: 1, show: true },
        { label: "Legacy to heirs", base: "$10.0M", scenario: "$2.1M", delta: "−$7.9M", direction: 0, show: true },
      ],
    };
    render(<RetirementComparisonView data={data} />);
    expect(screen.getByText("−17 pts")).toHaveClass("text-crit");
    expect(screen.getByText("−5 yrs")).toHaveClass("text-good");
    expect(screen.getByText("−$7.9M")).toHaveClass("text-ink");
  });

  it("renders the empty state", () => {
    render(<RetirementComparisonView data={{ ...DATA, isEmpty: true }} />);
    expect(screen.getByText(/Run the comparison/)).toBeInTheDocument();
  });
});
