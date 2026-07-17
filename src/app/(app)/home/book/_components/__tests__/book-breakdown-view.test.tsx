// src/app/(app)/home/book/_components/__tests__/book-breakdown-view.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

// react-chartjs-2 needs canvas, which jsdom doesn't implement; stub it so the
// view can render its embedded BookSplitChart without touching a real canvas.
vi.mock("react-chartjs-2", () => ({
  Chart: () => <div data-testid="chart" />,
  Bar: () => <div data-testid="chart" />,
}));

import { BookBreakdownView } from "../book-breakdown-view";
import type { BookBreakdown } from "@/lib/home/book-breakdown";

const DATA: BookBreakdown = {
  households: [
    {
      householdId: "h1",
      householdName: "Anderson",
      bookValue: 200000,
      heldAway: 50000,
      total: 250000,
      accounts: [
        { accountId: "a1", name: "Anderson Brokerage", category: "taxable", value: 200000, countsTowardAum: true },
        { accountId: "a2", name: "Anderson Held IRA", category: "retirement", value: 50000, countsTowardAum: false },
      ],
    },
    {
      householdId: "h2",
      householdName: "Baxter",
      bookValue: 400000,
      heldAway: 0,
      total: 400000,
      accounts: [
        { accountId: "b1", name: "Baxter 401k", category: "retirement", value: 400000, countsTowardAum: true },
      ],
    },
  ],
  totals: { bookValue: 600000, heldAway: 50000, total: 650000, heldAwayAccounts: 1, householdCount: 2 },
  concentration: { top5BookSharePct: 100, largestHeldAway: { householdName: "Anderson", value: 50000 }, heldAwayHouseholdCount: 1 },
};

function rowOrder(): string[] {
  return screen
    .getAllByTestId("household-row")
    .map((tr) => within(tr).getByTestId("household-name").textContent ?? "");
}

describe("BookBreakdownView", () => {
  it("defaults to book-value sort (desc) when focus=book", () => {
    render(<BookBreakdownView data={DATA} focus="book" />);
    expect(rowOrder()).toEqual(["Baxter", "Anderson"]); // 400k before 200k
  });

  it("defaults to held-away sort when focus=held-away", () => {
    render(<BookBreakdownView data={DATA} focus="held-away" />);
    expect(rowOrder()).toEqual(["Anderson", "Baxter"]); // 50k before 0
  });

  it("re-sorts when a column header is clicked", () => {
    render(<BookBreakdownView data={DATA} focus="book" />);
    fireEvent.click(screen.getByRole("button", { name: /household/i }));
    expect(rowOrder()).toEqual(["Anderson", "Baxter"]); // name asc
  });

  it("expands a household to reveal its accounts", () => {
    render(<BookBreakdownView data={DATA} focus="book" />);
    expect(screen.queryByText("Anderson Brokerage")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Anderson/ }));
    expect(screen.getByText("Anderson Brokerage")).toBeInTheDocument();
    expect(screen.getByText("Anderson Held IRA")).toBeInTheDocument();
  });

  it("shows an empty state with no households", () => {
    const empty: BookBreakdown = {
      households: [],
      totals: { bookValue: 0, heldAway: 0, total: 0, heldAwayAccounts: 0, householdCount: 0 },
      concentration: { top5BookSharePct: 0, largestHeldAway: null, heldAwayHouseholdCount: 0 },
    };
    render(<BookBreakdownView data={empty} focus="book" />);
    expect(screen.getByText(/No book value or held-away assets yet/i)).toBeInTheDocument();
  });
});
