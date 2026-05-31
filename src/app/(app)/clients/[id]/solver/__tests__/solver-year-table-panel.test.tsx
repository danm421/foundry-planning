// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SolverYearTablePanel } from "../solver-year-table-panel";
import type { ProjectionYear } from "@/engine/types";

// Enriched with the minimal fields touched by retirementYearColumns renderers:
// - row.year, row.ages.{client,spouse}
// - row.income.{socialSecurity,salaries,business,deferred,capitalGains,trust,other}
// - row.accountLedgers (iterated for RMD sums)
// - row.withdrawals.total
// - row.totalExpenses
// - row.expenses.{living,taxes}
// - row.portfolioAssets.{taxableTotal,cashTotal,retirementTotal}
function makeYear(year: number): ProjectionYear {
  return {
    year,
    ages: { client: 40, spouse: null },
    income: {
      socialSecurity: 0,
      salaries: 0,
      business: 0,
      deferred: 0,
      capitalGains: 0,
      trust: 0,
      other: 0,
    },
    accountLedgers: {},
    withdrawals: { total: 0 },
    totalExpenses: 0,
    expenses: { living: 0, taxes: 0 },
    portfolioAssets: { taxableTotal: 0, cashTotal: 0, retirementTotal: 0 },
  } as unknown as ProjectionYear;
}

const years = [makeYear(2026), makeYear(2027), makeYear(2040)];

describe("SolverYearTablePanel", () => {
  it("renders a row for EVERY plan year (not just retirement years)", () => {
    render(<SolverYearTablePanel years={years} hasSpouse={false} />);
    expect(screen.getByText("2026")).toBeInTheDocument();
    expect(screen.getByText("2027")).toBeInTheDocument();
    expect(screen.getByText("2040")).toBeInTheDocument();
  });
});
