// src/app/(app)/clients/[id]/assets/investments/__tests__/holdings-tab.test.tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import HoldingsTab from "../holdings-tab";
import type { AccountHoldingsGroup } from "@/lib/investments/holdings-inventory";

const GROUPS: AccountHoldingsGroup[] = [
  {
    accountId: "a1", accountName: "Brokerage", category: "taxable",
    totalValue: 300, pctOfTotal: 0.6,
    holdings: [
      { id: "h1", ticker: "AAA", name: "Alpha", shares: 1, price: 100, priceAsOf: null, marketValue: 100, pctOfTotal: 0.2, costBasis: 50, gainLoss: 50, gainLossPct: 1 },
      { id: "h2", ticker: "CCC", name: "Gamma", shares: 1, price: 200, priceAsOf: null, marketValue: 200, pctOfTotal: 0.4, costBasis: null, gainLoss: null, gainLossPct: null },
    ],
  },
  {
    accountId: "a2", accountName: "IRA", category: "retirement",
    totalValue: 200, pctOfTotal: 0.4,
    holdings: [
      { id: "h3", ticker: "BBB", name: "Beta", shares: 1, price: 200, priceAsOf: null, marketValue: 200, pctOfTotal: 0.4, costBasis: 100, gainLoss: 100, gainLossPct: 1 },
    ],
  },
];

describe("HoldingsTab", () => {
  it("renders an account section per group in by-account mode", () => {
    render(<HoldingsTab groups={GROUPS} />);
    expect(screen.getByText("Brokerage")).toBeTruthy();
    expect(screen.getByText("IRA")).toBeTruthy();
    expect(screen.getByText("AAA")).toBeTruthy();
  });

  it("switches to a single flat table with an Account column in all-holdings mode", () => {
    render(<HoldingsTab groups={GROUPS} />);
    fireEvent.click(screen.getByRole("radio", { name: /all holdings/i }));
    expect(screen.getByText("Account")).toBeTruthy();
    // every ticker appears once in the single table
    expect(screen.getAllByText("AAA")).toHaveLength(1);
    expect(screen.getByText("BBB")).toBeTruthy();
  });

  it("sorts the flat table when a column header is clicked", () => {
    render(<HoldingsTab groups={GROUPS} />);
    fireEvent.click(screen.getByRole("radio", { name: /all holdings/i }));
    // default sort is marketValue desc -> first data row is a 200 holding.
    fireEvent.click(screen.getByRole("button", { name: /ticker/i }));
    const table = screen.getByRole("table");
    const firstDataRow = within(table).getAllByRole("row")[1];
    expect(within(firstDataRow).getByText("AAA")).toBeTruthy();
  });

  it("shows an empty state when there are no holdings", () => {
    render(<HoldingsTab groups={[]} />);
    expect(screen.getByText(/no holdings recorded/i)).toBeTruthy();
  });
});
