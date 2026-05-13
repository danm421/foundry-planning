// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExpenseDetailComparisonSection } from "../expense-detail-comparison-section";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";

function mkPlan(): ComparisonPlan {
  return {
    index: 0,
    isBaseline: true,
    ref: { kind: "scenario", id: "A" },
    id: "A",
    label: "A",
    tree: {
      client: {
        dateOfBirth: "1975-06-20",
        retirementAge: 65,
        spouseDob: "1979-01-01",
        spouseRetirementAge: 61,
      },
      expenses: [
        { id: "e1", type: "living", name: "Household", annualAmount: 55_000, startYear: 2025, endYear: 2080 },
        { id: "e2", type: "living", name: "Travel", annualAmount: 12_000, startYear: 2025, endYear: 2080 },
        { id: "e3", type: "other", name: "College for Child", annualAmount: 39_000, startYear: 2033, endYear: 2036 },
      ],
    } as unknown as ComparisonPlan["tree"],
    result: {
      years: [
        { year: 2026, expenses: { bySource: { e1: 55_000, e2: 12_000 } } },
        { year: 2040, expenses: { bySource: { e1: 70_000, e2: 40_000 } } },
      ] as unknown as ComparisonPlan["result"]["years"],
    } as ComparisonPlan["result"],
    lifetime: {} as ComparisonPlan["lifetime"],
    liquidityRows: [],
    finalEstate: null,
    panelData: null,
    allocation: null,
  };
}

describe("ExpenseDetailComparisonSection", () => {
  it("renders current and retirement amounts per living expense", () => {
    render(<ExpenseDetailComparisonSection plans={[mkPlan()]} />);
    expect(screen.getByText("Household")).toBeTruthy();
    expect(screen.getByText("Travel")).toBeTruthy();
    expect(screen.getByText(/\$55,000/)).toBeTruthy();
    expect(screen.getByText(/\$70,000/)).toBeTruthy();
    expect(screen.getByText("Total Living Expenses")).toBeTruthy();
  });

  it("renders one-off events table", () => {
    render(<ExpenseDetailComparisonSection plans={[mkPlan()]} />);
    expect(screen.getByText("College for Child")).toBeTruthy();
    expect(screen.getByText(/2033.+2036/)).toBeTruthy();
  });
});
