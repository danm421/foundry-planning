// src/components/asset-ledger/__tests__/asset-ledger-table.test.tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import AssetLedgerTable from "../asset-ledger-table";
import type { AssetFilterState } from "../asset-ledger-filters";
import type { AssetLedger } from "@/lib/asset-ledger";

const ledger: AssetLedger = {
  year: 2031,
  ages: { client: 64 },
  sections: [
    {
      id: "household",
      label: "Household",
      kind: "household",
      accounts: [
        {
          id: "brokerage",
          name: "Joint Brokerage",
          category: "taxable",
          beginningValue: 500_000,
          endingValue: 537_000,
          netChange: 37_000,
          summary: { growth: 32_000, contributions: 12_000, distributions: 0, rmd: 0, fees: 0, internalContributions: 0, internalDistributions: 0 },
          basisBoY: 0,
          basisEoY: 0,
          basisResidual: 0,
          rows: [
            { category: "bookend", label: "Beginning of Year", amount: 500_000, basis: 0, bookend: true, internal: false },
            { category: "growth", label: "Growth", amount: 32_000, basis: 32_000, internal: false },
            { category: "withdrawal", label: "Supplemental withdrawal", amount: -7_000, basis: -7_000, internal: true, counterpartyName: "John IRA" },
            { category: "tax", label: "Phantom", amount: 0, basis: 0, internal: false },
            { category: "bookend", label: "End of Year", amount: 537_000, basis: 0, bookend: true, internal: false },
          ],
          reconciles: false,
          residual: 12_000,
        },
      ],
    },
  ],
};

const showAll: AssetFilterState = { hideZero: false };

describe("AssetLedgerTable", () => {
  it("renders Beginning of Year and End of Year rows", () => {
    render(<AssetLedgerTable ledger={ledger} filter={showAll} />);
    expect(screen.getAllByText("Beginning of Year").length).toBeGreaterThan(0);
    expect(screen.getAllByText("End of Year").length).toBeGreaterThan(0);
  });

  it("shows the Other Account column header and a counterparty value", () => {
    render(<AssetLedgerTable ledger={ledger} filter={showAll} />);
    expect(screen.getByText("Other Account")).toBeDefined();
    expect(screen.getByText("John IRA")).toBeDefined();
  });

  it("renders outflows in accounting parentheses", () => {
    render(<AssetLedgerTable ledger={ledger} filter={showAll} />);
    expect(screen.getAllByText(/\(\$7,000\)/).length).toBeGreaterThan(0);
  });

  it("renders a reconcile warning when an account does not reconcile", () => {
    render(<AssetLedgerTable ledger={ledger} filter={showAll} />);
    expect(screen.getByText(/off by/)).toBeDefined();
  });

  it("hides zero-amount rows when hideZero is on, but never bookend rows", () => {
    const { rerender } = render(<AssetLedgerTable ledger={ledger} filter={showAll} />);
    expect(screen.queryByText("Phantom")).not.toBeNull();
    rerender(<AssetLedgerTable ledger={ledger} filter={{ hideZero: true }} />);
    expect(screen.queryByText("Phantom")).toBeNull();
    // Bookend rows must still be visible even when hideZero is on
    expect(screen.getAllByText("Beginning of Year").length).toBeGreaterThan(0);
    expect(screen.getAllByText("End of Year").length).toBeGreaterThan(0);
  });
});
