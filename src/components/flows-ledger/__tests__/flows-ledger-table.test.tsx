// src/components/flows-ledger/__tests__/flows-ledger-table.test.tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import FlowsLedgerTable from "../flows-ledger-table";
import type { FlowsFilterState } from "../flows-ledger-filters";
import type { FlowsLedger } from "@/lib/flows-ledger";

const ledger: FlowsLedger = {
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
          rows: [
            { category: "growth", label: "Growth", amount: 32_000, internal: false },
            { category: "withdrawal", label: "Supplemental withdrawal", amount: -7_000, internal: true },
            { category: "tax", label: "Phantom", amount: 0, internal: false },
          ],
          reconciles: true,
          residual: 0,
        },
        {
          id: "ira",
          name: "John IRA",
          category: "retirement",
          beginningValue: 100_000,
          endingValue: 120_000,
          netChange: 20_000,
          summary: { growth: 5_000, contributions: 0, distributions: 0, rmd: 0, fees: 0, internalContributions: 0, internalDistributions: 0 },
          rows: [{ category: "growth", label: "Growth", amount: 5_000, internal: false }],
          reconciles: false,
          residual: 15_000,
        },
      ],
    },
  ],
};

const showAll: FlowsFilterState = { categories: new Set(), hideZero: false };

describe("FlowsLedgerTable", () => {
  it("renders an internal tag on internal-transfer rows", () => {
    render(<FlowsLedgerTable ledger={ledger} filter={showAll} />);
    expect(screen.getByText("internal")).toBeDefined();
  });

  it("renders a reconcile warning when an account does not reconcile", () => {
    render(<FlowsLedgerTable ledger={ledger} filter={showAll} />);
    expect(screen.getByText(/off by/)).toBeDefined();
  });

  it("hides zero-amount rows when hideZero is on", () => {
    const { rerender } = render(<FlowsLedgerTable ledger={ledger} filter={showAll} />);
    expect(screen.queryByText("Phantom")).not.toBeNull();
    rerender(<FlowsLedgerTable ledger={ledger} filter={{ categories: new Set(), hideZero: true }} />);
    expect(screen.queryByText("Phantom")).toBeNull();
  });
});
