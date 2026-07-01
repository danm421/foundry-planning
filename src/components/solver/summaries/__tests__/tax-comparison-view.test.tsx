// @vitest-environment jsdom
// src/components/solver/summaries/__tests__/tax-comparison-view.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TaxComparisonView } from "../tax-comparison-view";
import type { TaxComparisonPageData } from "@/lib/presentations/pages/tax-comparison/view-model";

const DATA: TaxComparisonPageData = {
  title: "Tax Comparison",
  subtitle: "Base Case vs. Proposed · Lifetime 2025–2065",
  isEmpty: false,
  bracketMode: false,
  kpis: [
    { label: "Lifetime Total Tax", base: "$1.2M", scenario: "$0.9M", delta: "−$300K", direction: 1, show: true },
  ],
  chart: [
    { year: 2025, federalOrdinary: 10000, capGains: 2000, state: 3000, total: 15000, baseTotal: 18000 },
  ],
  bracket: null,
  composition: null,
  narrative: ["Your plan lowers lifetime taxes by about $300K."],
};

describe("<TaxComparisonView />", () => {
  it("renders the subtitle, a comparison KPI, and the narrative", () => {
    render(<TaxComparisonView data={DATA} />);
    expect(screen.getByText(/Base Case vs\. Proposed/)).toBeInTheDocument();
    expect(screen.getByText("Lifetime Total Tax")).toBeInTheDocument();
    expect(screen.getByText("$0.9M")).toBeInTheDocument();
    expect(screen.getByText("−$300K")).toBeInTheDocument();
    expect(screen.getByText(/lowers lifetime taxes/)).toBeInTheDocument();
  });

  it("renders the empty state", () => {
    render(<TaxComparisonView data={{ ...DATA, isEmpty: true }} />);
    expect(screen.getByText(/No scenario to compare yet/)).toBeInTheDocument();
  });
});
