// src/components/tax-ledger/__tests__/tax-ledger-table.test.tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import TaxLedgerTable from "../tax-ledger-table";
import type { LedgerFilterState } from "../tax-ledger-filters";
import type { TaxLedger, TaxLedgerDiagnostics } from "@/lib/tax-ledger";

const diagnostics: TaxLedgerDiagnostics = {
  agi: 0,
  taxableIncome: 0,
  totalFederalTax: 0,
  totalStateTax: 0,
  totalTax: 0,
  effectiveRate: 0,
  marginalRate: 0,
  bracketHeadroom: null,
  niit: { active: false, base: 0, thresholdDistance: null },
  irmaa: { tier: 0, headroomToNextTier: null },
  amt: { bound: false, additional: 0 },
  ssTaxablePercent: null,
  taxByType: {
    federalOrdinary: 0,
    capitalGains: 0,
    niit: 0,
    ficaMedicare: 0,
    amt: 0,
    earlyWithdrawalPenalty: 0,
    state: 0,
  },
};

const ledger: TaxLedger = {
  year: 2026,
  sections: [
    {
      id: "household",
      label: "Household",
      kind: "household",
      passThrough: false,
      rows: [
        { type: "RMD", description: "Traditional IRA", character: "ordinary", account: "John IRA", amount: 52_000, taxable: true },
        // An ordinary $0 row — genuine noise, hidden when "hide zero rows" is on.
        { type: "Investment Income", description: "Ordinary dividends", character: "ordinary", account: "Joint Brokerage", amount: 0, taxable: true },
        // A conversion the IRMAA cap zeroed. $0 is the RESULT here, not noise.
        { type: "Roth Conversion", description: "2026 Conversion (limited by IRMAA Tier 0)", character: "ordinary", account: null, amount: 0, taxable: true, zeroIsMeaningful: true },
      ],
      characterSubtotals: { ordinary: 52_000 },
      subtotal: 52_000,
      taxableSubtotal: 52_000,
      grossSubtotal: 52_000,
      unreconciled: false,
    },
  ],
  diagnostics,
};

const showAll: LedgerFilterState = { characters: new Set(), hideNonTaxable: false, hideZero: false };

describe("TaxLedgerTable — hide zero rows", () => {
  it("hides an ordinary $0 row but keeps a capped-to-$0 Roth conversion", () => {
    const { rerender } = render(<TaxLedgerTable ledger={ledger} filter={showAll} />);
    expect(screen.queryByText("Ordinary dividends")).not.toBeNull();
    expect(screen.queryByText(/2026 Conversion/)).not.toBeNull();

    rerender(<TaxLedgerTable ledger={ledger} filter={{ ...showAll, hideZero: true }} />);
    expect(screen.queryByText("Ordinary dividends")).toBeNull();
    // The whole point of Task 7's build-side exception: an enforced cap must
    // not read as a technique that never ran, on the advisor's default view.
    expect(screen.queryByText(/2026 Conversion/)).not.toBeNull();
  });

  it("still lets a character filter exclude the capped conversion", () => {
    // `zeroIsMeaningful` opts out of hideZero ONLY — an advisor who filters
    // by character deliberately still gets exactly what they asked for.
    render(
      <TaxLedgerTable
        ledger={ledger}
        filter={{ characters: new Set(["long_term_gain" as const]), hideNonTaxable: false, hideZero: true }}
      />,
    );
    expect(screen.queryByText(/2026 Conversion/)).toBeNull();
  });
});
