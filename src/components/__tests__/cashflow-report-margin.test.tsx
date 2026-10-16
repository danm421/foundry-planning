// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import CashFlowReport from "../cashflow-report";
import { BORROWER, CHECKING, spending } from "@/engine/__tests__/_fixtures/margin";
import { buildClientData, basePlanSettings } from "@/engine/__tests__/fixtures";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/clients/c1/cashflow",
  useSearchParams: () => new URLSearchParams("view=withdrawals"),
}));
vi.mock("react-chartjs-2", () => ({ Bar: () => null, Chart: () => null }));
vi.mock("@/components/cashflow/charts/drill-chart", () => ({ DrillChart: () => null }));
vi.mock("@/components/exports/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/components/charts/portfolio-bars-chart", () => ({ PortfolioBarsChart: () => null }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function data(over: Partial<typeof basePlanSettings> = {}, accounts = [CHECKING, BORROWER]) {
  return buildClientData({
    accounts, incomes: [], expenses: [spending(100_000)], liabilities: [], savingsRules: [], withdrawalStrategy: [],
    planSettings: { ...basePlanSettings, flatFederalRate: 0, flatStateRate: 0, planStartYear: 2026, planEndYear: 2028, ...over },
  });
}

describe("Cash Flow — margin borrowing (spec 2026-10-14)", () => {
  it("splits a borrowing account into sold and borrowed columns in the Withdrawals drill (R6)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => data() })));
    render(<CashFlowReport clientId="c1" />);
    fireEvent.click(await screen.findByRole("button", { name: /Taxable Assets/ }));
    expect(await screen.findByText("Schwab Brokerage (borrowed)")).toBeTruthy();
  });
  it("flags a forced-sale year with what was sold", async () => {
    const crashed = data({ marketShock: { year: 2027, drawdownPct: 0.6 } },
      [CHECKING, { ...BORROWER, marginBorrowEnabled: false, marginBalance: 500_000, marginInterestRate: 0 }]);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => crashed })));
    render(<CashFlowReport clientId="c1" />);
    expect(await screen.findByTitle(/^Margin call: sold \$?[\d,]+ of Schwab Brokerage to pay down the loan$/)).toBeTruthy();
  });
  it("an account with no securities left says so instead of promising a sale (W1)", async () => {
    // engine margin-calls.test.ts I2 fixture: 2034's call sells every
    // security; 2035 charges interest on the $3,090 left.
    const exhausted = buildClientData({
      accounts: [CHECKING, BORROWER], incomes: [], expenses: [spending(110_000)], liabilities: [], savingsRules: [], withdrawalStrategy: [],
      planSettings: { ...basePlanSettings, flatFederalRate: 0, flatStateRate: 0, planStartYear: 2026, planEndYear: 2035 },
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => exhausted })));
    render(<CashFlowReport clientId="c1" />);
    fireEvent.click(await screen.findByRole("button", { name: /Taxable Assets/ }));
    await screen.findAllByTitle("View account ledger");
    // Re-query: the drill renders again after the first match, detaching it.
    const ledgerButtons = screen.getAllByTitle("View account ledger");
    fireEvent.click(ledgerButtons[ledgerButtons.length - 1]); // 2035, the last row
    expect(await screen.findByText("Year 2035 Ledger")).toBeTruthy();
    expect(screen.getByText("No securities left to sell — $3,337 of margin loan remains.")).toBeTruthy();
    expect(screen.queryByText(/sells securities to meet the call/)).toBeNull();
  });
});
