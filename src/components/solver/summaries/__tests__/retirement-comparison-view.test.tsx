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
  isEmpty: false,
  verdict: { headline: "91% chance your plan fully funds your life — up from 73%." },
  kpis: [
    { label: "Probability of success", base: "73%", scenario: "91%", delta: "+18 pts", show: true },
    { label: "Legacy to heirs", base: "$2.0M", scenario: "$2.4M", delta: "+$400K", show: true },
  ],
  overlay: [{ year: 2025, floor: 100, scenarioAhead: 20, baseAhead: 0 }],
  atRetirement: { year: 2040, base: { ...EMPTY_BUCKETS, roth: 100 }, scenario: { ...EMPTY_BUCKETS, roth: 200 } },
  atEndOfLife: { year: 2065, base: EMPTY_BUCKETS, scenario: EMPTY_BUCKETS },
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
    expect(screen.getByText("Probability of success")).toBeInTheDocument();
    expect(screen.getByText("91%")).toBeInTheDocument();
    expect(screen.getByText("+18 pts")).toBeInTheDocument();
    expect(screen.queryByText(/AI/i)).not.toBeInTheDocument();
  });

  it("renders the empty state", () => {
    render(<RetirementComparisonView data={{ ...DATA, isEmpty: true }} />);
    expect(screen.getByText(/Run the comparison/)).toBeInTheDocument();
  });
});
