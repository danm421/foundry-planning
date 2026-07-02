// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SolverYearTablePanel } from "../solver-year-table-panel";
import type { ClientData, ProjectionYear } from "@/engine/types";

// Minimal stand-in — this test only checks that every plan year renders a
// row, not the drill-down content, so the real ClientData shape is irrelevant.
const clientData = {
  client: { firstName: "A", lastName: "B" },
  incomes: [], entities: [], accounts: [], liabilities: [], expenses: [],
  assetTransactions: [], stockOptionPlans: [], notesReceivable: [], medicareCoverage: [],
} as unknown as ClientData;

// Enriched with the minimal fields touched by retirementYearColumns renderers
// AND buildYearCellDrill (now wired via clientData, so its drill fn runs on
// every cell render, not just on click):
// - row.year, row.ages.{client,spouse}
// - row.income.{socialSecurity,salaries,business,deferred,capitalGains,trust,other,bySource}
// - row.accountLedgers (iterated for RMD sums)
// - row.withdrawals.{total,byAccount}
// - row.totalExpenses
// - row.expenses.{living,taxes,bySource,liabilities,other,insurance,realEstate,discretionary}
// - row.savings.total
// - row.portfolioAssets.{taxableTotal,cashTotal,retirementTotal,taxable,cash,retirement}
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
      bySource: {},
    },
    accountLedgers: {},
    withdrawals: { total: 0, byAccount: {} },
    totalExpenses: 0,
    expenses: {
      living: 0,
      taxes: 0,
      bySource: {},
      liabilities: 0,
      other: 0,
      insurance: 0,
      realEstate: 0,
      discretionary: 0,
    },
    savings: { total: 0 },
    portfolioAssets: {
      taxableTotal: 0,
      cashTotal: 0,
      retirementTotal: 0,
      taxable: {},
      cash: {},
      retirement: {},
    },
  } as unknown as ProjectionYear;
}

const years = [makeYear(2026), makeYear(2027), makeYear(2040)];

describe("SolverYearTablePanel", () => {
  it("renders a row for EVERY plan year (not just retirement years)", () => {
    render(
      <SolverYearTablePanel years={years} hasSpouse={false} clientData={clientData} />,
    );
    expect(screen.getByText("2026")).toBeInTheDocument();
    expect(screen.getByText("2027")).toBeInTheDocument();
    expect(screen.getByText("2040")).toBeInTheDocument();
  });
});
