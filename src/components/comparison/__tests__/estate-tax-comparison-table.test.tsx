// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EstateTaxComparisonTable } from "../estate-tax-comparison-table";
import type { ProjectionResult } from "@/engine/projection";

function fakeResult(over: { federal?: number; state?: number; admin?: number } = {}): ProjectionResult {
  return {
    years: [],
    firstDeathEvent: {
      year: 2050,
      federalEstateTax: over.federal ?? 100_000,
      stateEstateTax: over.state ?? 0,
      estateAdminExpenses: over.admin ?? 0,
      totalTaxesAndExpenses: (over.federal ?? 100_000) + (over.state ?? 0) + (over.admin ?? 0),
      drainAttributions: [],
    },
    secondDeathEvent: undefined,
  } as never;
}

describe("EstateTaxComparisonTable (N columns)", () => {
  it("renders one column per plan at N=4 plus a label column", () => {
    render(
      <EstateTaxComparisonTable
        plans={[
          { label: "Base", result: fakeResult({ federal: 100 }) },
          { label: "A",    result: fakeResult({ federal: 80 }) },
          { label: "B",    result: fakeResult({ federal: 50 }) },
          { label: "C",    result: fakeResult({ federal: 30 }) },
        ]}
      />,
    );
    // 1 label header + 4 plan columns
    expect(screen.getAllByRole("columnheader")).toHaveLength(5);
  });

  it("non-baseline columns show ±delta beneath the absolute value", () => {
    render(
      <EstateTaxComparisonTable
        plans={[
          { label: "Base", result: fakeResult({ federal: 100_000 }) },
          { label: "B",    result: fakeResult({ federal: 70_000 }) },
        ]}
      />,
    );
    expect(screen.getAllByText(/−\$30,000/).length).toBeGreaterThan(0);
  });
});
