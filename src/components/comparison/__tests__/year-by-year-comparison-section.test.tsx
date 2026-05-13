// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { YearByYearComparisonSection } from "../year-by-year-comparison-section";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";

function mkPlan(
  label: string,
  rows: Array<{
    year: number;
    totalIncome: number;
    totalExpenses: number;
    netCashFlow: number;
    withdrawals: number;
  }>,
): ComparisonPlan {
  return {
    index: 0,
    isBaseline: label === "A",
    ref: { kind: "scenario", id: label },
    id: label,
    label,
    tree: {} as ComparisonPlan["tree"],
    result: {
      years: rows.map((r) => ({
        year: r.year,
        totalIncome: r.totalIncome,
        totalExpenses: r.totalExpenses,
        netCashFlow: r.netCashFlow,
        withdrawals: { byAccount: {}, total: r.withdrawals },
      })) as ComparisonPlan["result"]["years"],
    } as ComparisonPlan["result"],
    lifetime: {} as ComparisonPlan["lifetime"],
    liquidityRows: [],
    finalEstate: null,
    panelData: null,
    allocation: null,
  };
}

describe("YearByYearComparisonSection", () => {
  it("renders 4 tab buttons", () => {
    render(
      <YearByYearComparisonSection
        plans={[
          mkPlan("A", [
            { year: 2030, totalIncome: 100, totalExpenses: 80, netCashFlow: 20, withdrawals: 0 },
          ]),
        ]}
        yearRange={null}
      />,
    );
    expect(screen.getByRole("tab", { name: /income/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /expenses/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /net cash flow/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /withdrawals/i })).toBeTruthy();
  });

  it("defaults to the Income tab and shows totalIncome values", () => {
    render(
      <YearByYearComparisonSection
        plans={[
          mkPlan("A", [
            { year: 2030, totalIncome: 12345, totalExpenses: 0, netCashFlow: 0, withdrawals: 0 },
          ]),
        ]}
        yearRange={null}
      />,
    );
    expect(screen.getByText(/\$12,345/)).toBeTruthy();
  });

  it("switching to Expenses shows totalExpenses values", () => {
    render(
      <YearByYearComparisonSection
        plans={[
          mkPlan("A", [
            { year: 2030, totalIncome: 0, totalExpenses: 54321, netCashFlow: 0, withdrawals: 0 },
          ]),
        ]}
        yearRange={null}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /expenses/i }));
    expect(screen.getByText(/\$54,321/)).toBeTruthy();
  });

  it("shows Δ column when N ≥ 2 but not for the baseline plan", () => {
    const { container } = render(
      <YearByYearComparisonSection
        plans={[
          mkPlan("A", [
            { year: 2030, totalIncome: 100, totalExpenses: 0, netCashFlow: 0, withdrawals: 0 },
          ]),
          mkPlan("B", [
            { year: 2030, totalIncome: 130, totalExpenses: 0, netCashFlow: 0, withdrawals: 0 },
          ]),
        ]}
        yearRange={null}
      />,
    );
    // Header should have: Year | A | B | Δ vs A  (only one Δ — B's column)
    const headers = container.querySelectorAll("thead th");
    const labels = Array.from(headers).map((h) => h.textContent?.trim() ?? "");
    expect(labels).toEqual(expect.arrayContaining(["Year", "A", "B"]));
    expect(labels.some((l) => /Δ/.test(l) || /vs A/i.test(l))).toBe(true);
  });

  it("does NOT show Δ column for N = 1", () => {
    const { container } = render(
      <YearByYearComparisonSection
        plans={[
          mkPlan("A", [
            { year: 2030, totalIncome: 100, totalExpenses: 0, netCashFlow: 0, withdrawals: 0 },
          ]),
        ]}
        yearRange={null}
      />,
    );
    const labels = Array.from(container.querySelectorAll("thead th")).map(
      (h) => h.textContent?.trim() ?? "",
    );
    expect(labels.some((l) => /Δ/.test(l))).toBe(false);
  });

  it("respects yearRange filter", () => {
    const { container } = render(
      <YearByYearComparisonSection
        plans={[
          mkPlan("A", [
            { year: 2030, totalIncome: 100, totalExpenses: 0, netCashFlow: 0, withdrawals: 0 },
            { year: 2031, totalIncome: 200, totalExpenses: 0, netCashFlow: 0, withdrawals: 0 },
            { year: 2032, totalIncome: 300, totalExpenses: 0, netCashFlow: 0, withdrawals: 0 },
          ]),
        ]}
        yearRange={{ start: 2031, end: 2031 }}
      />,
    );
    expect(container.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(screen.getByText(/2031/)).toBeTruthy();
  });
});
