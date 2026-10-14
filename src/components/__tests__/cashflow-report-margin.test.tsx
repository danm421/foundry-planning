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
});
