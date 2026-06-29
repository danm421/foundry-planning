// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { SolverYearDetailPanel } from "../solver-year-detail-panel";

// Reuse the same minimal factories as the helper test.
import type { ClientData, ProjectionYear } from "@/engine";

function makeYear(): ProjectionYear {
  return {
    year: 2034,
    ages: { client: 67, spouse: 65 },
    income: { salaries: 0, socialSecurity: 40_000, business: 0, trust: 0, deferred: 0, capitalGains: 0, other: 0, total: 70_000, bySource: { "inc-ss": 40_000, "inc-pen": 30_000 } },
    withdrawals: { byAccount: { "acc-brokerage": 20_000 }, total: 20_000 },
    accountLedgers: { "acc-ira": { rmdAmount: 15_000 } as never },
    expenses: { living: 60_000, liabilities: 12_000, other: 0, insurance: 0, realEstate: 0, taxes: 9_000, cashGifts: 0, discretionary: 0, total: 81_000, bySource: {}, byLiability: { "liab-mortgage": 12_000 }, interestByLiability: {} },
    savings: { byAccount: { "acc-401k": 10_000 }, total: 10_000, employerTotal: 0 },
    totalIncome: 105_000, totalExpenses: 91_000, netCashFlow: 14_000,
    portfolioAssets: { taxable: {}, cash: {}, retirement: {}, realEstate: {}, business: {}, lifeInsurance: {}, stockOptions: {}, taxableTotal: 0, cashTotal: 0, retirementTotal: 0, realEstateTotal: 0, businessTotal: 0, lifeInsuranceTotal: 0, stockOptionsTotal: 0, trustsAndBusinesses: {}, trustsAndBusinessesTotal: 0, accessibleTrustAssets: {}, accessibleTrustAssetsTotal: 0, total: 1_000_000, liquidTotal: 800_000 },
  } as unknown as ProjectionYear;
}
function makeClientData(): ClientData {
  return {
    client: { firstName: "A", lastName: "B" },
    incomes: [ { id: "inc-ss", name: "Social Security", type: "social_security" }, { id: "inc-pen", name: "Pension", type: "deferred" } ],
    entities: [], accounts: [ { id: "acc-ira", name: "Traditional IRA", category: "retirement" }, { id: "acc-brokerage", name: "Joint Brokerage", category: "taxable" }, { id: "acc-401k", name: "401(k)", category: "retirement" } ],
    liabilities: [{ id: "liab-mortgage", name: "Home Mortgage" }], expenses: [], assetTransactions: [], stockOptionPlans: [], notesReceivable: [], medicareCoverage: [],
  } as unknown as ClientData;
}

describe("SolverYearDetailPanel", () => {
  it("renders the year/age header and both column headings", () => {
    render(<SolverYearDetailPanel year={makeYear()} clientData={makeClientData()} />);
    expect(screen.getByText("2034")).toBeInTheDocument();
    expect(screen.getByText("Age 67 / 65")).toBeInTheDocument();
    expect(screen.getByText("Inflows")).toBeInTheDocument();
    expect(screen.getByText("Outflows")).toBeInTheDocument();
  });

  it("shows category rows and reveals items on expand", () => {
    render(<SolverYearDetailPanel year={makeYear()} clientData={makeClientData()} />);
    const incomeRow = screen.getByRole("button", { name: /Income/ });
    // Items hidden until expanded
    expect(screen.queryByText("Social Security")).not.toBeInTheDocument();
    fireEvent.click(incomeRow);
    expect(screen.getByText("Social Security")).toBeInTheDocument();
    expect(screen.getByText("Pension")).toBeInTheDocument();
  });

  it("renders the net cash flow with a positive tone when in surplus", () => {
    render(<SolverYearDetailPanel year={makeYear()} clientData={makeClientData()} />);
    const net = screen.getByTestId("year-detail-net");
    expect(within(net).getByText(/\$14,000/)).toBeInTheDocument();
    expect(net.className).toContain("text-pos");
  });
});
