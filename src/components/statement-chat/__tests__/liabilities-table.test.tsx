// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { Annotated } from "@/lib/imports/types";
import type { ExtractedLiability } from "@/lib/extraction/types";
import LiabilitiesTable from "../liabilities-table";

/**
 * $412,000 balance + $2,538 P&I + a $625/mo escrow ($3,163 total payment,
 * $7,500/yr annualized) — chosen so the escrow arithmetic
 * (`totalPayment - monthlyPayment) * 12`) lands on a round number.
 */
const mortgageRow: Annotated<ExtractedLiability> = {
  __rowId: "r1",
  name: "Primary Mortgage",
  balance: 412_000,
  balanceAsOfDate: "2026-08-31",
  maturityDate: "2041-08-01",
  interestRate: 0.0625,
  monthlyPayment: 2_538,
  totalPayment: 3_163,
};

/** Balance chosen so it sums with `mortgageRow` to the $430,000 Test 3 asserts. */
const autoLoanRow: Annotated<ExtractedLiability> = {
  __rowId: "r2",
  name: "Auto Loan",
  balance: 18_000,
};

const base = {
  excluded: [],
  committedRowIds: [],
  onCommitRows: vi.fn(),
  onEditCell: vi.fn(),
};

describe("LiabilitiesTable", () => {
  it("renders a row's balance, dates, rate and P&I", () => {
    render(<LiabilitiesTable {...base} rows={[mortgageRow]} />);
    // Scoped: Balance is a `total: true` column, and with a single row the
    // body cell and the tfoot sum both print "$412,000" — an unscoped
    // `getByText` throws "found multiple elements" (Controller ruling 1).
    const row = screen.getByRole("row", { name: /Primary Mortgage/ });
    expect(within(row).getByText("$412,000")).toBeInTheDocument();
    expect(screen.getByText("Aug 31, 2026")).toBeInTheDocument();
    expect(screen.getByText("Aug 1, 2041")).toBeInTheDocument();
    expect(screen.getByText("6.25%")).toBeInTheDocument();
    expect(screen.getByText("$2,538")).toBeInTheDocument();
  });

  it("shows the escrow as an annual figure with the PITI beneath it", () => {
    render(<LiabilitiesTable {...base} rows={[mortgageRow]} />);
    expect(screen.getByText("$7,500/yr")).toBeInTheDocument();
    expect(screen.getByText("$3,163/mo PITI")).toBeInTheDocument();
  });

  it("totals the balance across rows", () => {
    render(<LiabilitiesTable {...base} rows={[mortgageRow, autoLoanRow]} />);
    // The footer figure, by design — with two rows nothing else on screen
    // reads "$430,000", so this stays unscoped (Controller ruling 1).
    expect(screen.getByText("$430,000")).toBeInTheDocument();
  });

  it("blocks commit on an unresolved fuzzy match", () => {
    const row = {
      ...mortgageRow,
      match: {
        kind: "fuzzy" as const,
        candidates: [
          { id: "a", score: 0.9 },
          { id: "b", score: 0.8 },
        ],
      },
    };
    render(<LiabilitiesTable {...base} rows={[row]} />);
    expect(screen.getByRole("button", { name: /commit/i })).toBeDisabled();
    expect(screen.getByText(/pick a match first/i)).toBeInTheDocument();
  });

  it("disables every commit button while a turn is sending", () => {
    render(<LiabilitiesTable {...base} rows={[mortgageRow]} disableCommit />);
    expect(screen.getByRole("button", { name: /commit/i })).toBeDisabled();
  });
});
