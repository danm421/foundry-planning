// src/components/portal/__tests__/investment-allocation-bars.test.tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { InvestmentAllocationBars } from "../investment-allocation-bars";

describe("InvestmentAllocationBars", () => {
  it("adds a trailing Unclassified row when residual > 0.5%", () => {
    // sum = 0.9, residual = 0.1 (10%)
    render(
      <InvestmentAllocationBars
        allocations={[
          { name: "US Large Cap", weight: 0.6 },
          { name: "Bonds", weight: 0.3 },
        ]}
      />,
    );
    expect(screen.getByText(/unclassified/i)).toBeInTheDocument();
    expect(screen.getByText("10.00%")).toBeInTheDocument();
  });

  it("does NOT add Unclassified when allocations sum to ~1.0", () => {
    render(
      <InvestmentAllocationBars
        allocations={[{ name: "US Large Cap", weight: 1 }]}
      />,
    );
    expect(screen.queryByText(/unclassified/i)).toBeNull();
  });

  it("renders provided allocation names", () => {
    render(
      <InvestmentAllocationBars
        allocations={[
          { name: "US Large Cap", weight: 0.6 },
          { name: "Bonds", weight: 0.4 },
        ]}
      />,
    );
    expect(screen.getByText("US Large Cap")).toBeInTheDocument();
    expect(screen.getByText("Bonds")).toBeInTheDocument();
  });
});
