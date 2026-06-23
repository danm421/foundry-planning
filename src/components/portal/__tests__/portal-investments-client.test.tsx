// src/components/portal/__tests__/portal-investments-client.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { PortalInvestmentsData } from "@/lib/portal/load-portal-investments";
import { fmtUsd } from "@/lib/portal/format";

const mockFetch = vi.fn(async () => ({
  ok: true,
  json: async () => ({ quotes: { VTI: { price: 999, changePct: 1.5 } } }),
}));

vi.mock("@/components/portal/investment-trend-chart", () => ({
  InvestmentTrendChart: () => null,
}));

vi.mock("@/components/portal/investment-allocation-bars", () => ({
  InvestmentAllocationBars: () => null,
}));

vi.mock("@/components/portal/portal-mode-context", () => ({
  usePortalFetch: () => mockFetch,
}));

// Dynamic import after mocks are set up
const { PortalInvestmentsClient } = await import("../portal-investments-client");

const EMPTY_DATA: PortalInvestmentsData = {
  totalValue: 0,
  totalSeries: [],
  overallAllocations: [],
  accounts: [],
};

const ONE_ACCOUNT_DATA: PortalInvestmentsData = {
  totalValue: 10000,
  totalSeries: [],
  overallAllocations: [],
  accounts: [
    {
      id: "acct-1",
      name: "Brokerage",
      category: "taxable",
      last4: null,
      value: 10000,
      series: [],
      allocations: [],
      holdings: [
        {
          ticker: "VTI",
          name: "Vanguard Total Stock Market ETF",
          shares: 10,
          price: 100,
          marketValue: 1000,
          costBasis: 900,
        },
      ],
    },
  ],
};

describe("PortalInvestmentsClient", () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  it("shows empty state when there are no accounts", () => {
    render(<PortalInvestmentsClient data={EMPTY_DATA} asOfDate="2026-06-23" />);
    expect(
      screen.getByText(/no investment accounts yet/i),
    ).toBeInTheDocument();
  });

  it("fetches live quotes via usePortalFetch for selected account holdings", async () => {
    render(<PortalInvestmentsClient data={ONE_ACCOUNT_DATA} asOfDate="2026-06-23" />);

    // Wait for the quotes fetch to be called
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    const calls = mockFetch.mock.calls as unknown as [string, ...unknown[]][];
    const fetchArg = calls[0][0];
    expect(fetchArg).toContain("/api/portal/investments/quotes?tickers=");
    expect(fetchArg).toContain("VTI");
  });

  it("displays the live price overriding the static price after quotes resolve", async () => {
    render(<PortalInvestmentsClient data={ONE_ACCOUNT_DATA} asOfDate="2026-06-23" />);

    // Static price is $100; live quote returns $999
    await waitFor(() => {
      expect(screen.getByText(fmtUsd(999))).toBeInTheDocument();
    });

    // The static price $100 should no longer appear (overridden by live quote)
    expect(screen.queryByText(fmtUsd(100))).not.toBeInTheDocument();
  });
});
