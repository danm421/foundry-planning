// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Annotated } from "@/lib/imports/types";
import type { ExtractedAccount, ExtractedLiability } from "@/lib/extraction/types";
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

/**
 * ── Spec §7 / final review I1(a) ────────────────────────────────────────
 *
 * "The liabilities table's Commit button posts `tabs: ["accounts",
 * "liabilities"]` WITH BOTH ROW IDS when the liability has a synthesized
 * property that is not yet committed."
 *
 * `EntityTable`'s button calls `onCommitRows([rowId])` — a singleton — so only
 * this table can contribute the second id. The plan's own test for this called
 * the HOOK with a hand-built two-element array, which pinned the hook and
 * never the UI that has to build it; the behaviour was never written. These
 * tests start at the interface, which is the only place the clause is about.
 */
describe("LiabilitiesTable co-commits the property a mortgage is secured on", () => {
  /** The row `splitMortgageEscrow` synthesizes: an address, no value. */
  const synthesizedProperty: Annotated<ExtractedAccount> = {
    __rowId: "account:synthesized:5304-hudson-avenue",
    name: "5304 Hudson Avenue",
    category: "real_estate",
    subType: "primary_residence",
    propertyAddress: "5304 Hudson Avenue",
  };
  const pricedProperty = { ...synthesizedProperty, value: 850_000 };
  const securedMortgage: Annotated<ExtractedLiability> = {
    ...mortgageRow,
    propertyAddress: "5304 Hudson Avenue",
  };

  it("posts the property's row id alongside the debt's", async () => {
    const onCommitRows = vi.fn();
    render(
      <LiabilitiesTable
        {...base}
        onCommitRows={onCommitRows}
        rows={[securedMortgage]}
        accounts={[pricedProperty]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /commit/i }));
    expect(onCommitRows).toHaveBeenCalledWith(["r1", "account:synthesized:5304-hudson-avenue"]);
  });

  /**
   * Matching is by ADDRESS, not by "there happens to be a house on the table".
   * Without this a second, unrelated property would be committed by a click on
   * a mortgage that has nothing to do with it.
   */
  it("leaves a property at a different address out of the post", async () => {
    const onCommitRows = vi.fn();
    render(
      <LiabilitiesTable
        {...base}
        onCommitRows={onCommitRows}
        rows={[securedMortgage]}
        accounts={[{ ...pricedProperty, __rowId: "account:larkspur", propertyAddress: "19 Larkspur Lane" }]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /commit/i }));
    expect(onCommitRows).toHaveBeenCalledWith(["r1"]);
  });

  /**
   * An ALREADY-COMMITTED property is on the plan, so the server's own
   * `matchMortgageToProperty` finds it. Re-posting it would re-commit a row
   * whose Commit button is spent.
   */
  it("leaves an already-committed property out of the post", async () => {
    const onCommitRows = vi.fn();
    render(
      <LiabilitiesTable
        {...base}
        onCommitRows={onCommitRows}
        committedRowIds={["account:synthesized:5304-hudson-avenue"]}
        rows={[securedMortgage]}
        accounts={[pricedProperty]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /commit/i }));
    expect(onCommitRows).toHaveBeenCalledWith(["r1"]);
  });

  /**
   * ── Ruling 73: the seam between I1(a) and I5 ──────────────────────────
   *
   * The co-post above is a new door onto `commitAccounts`, which writes an
   * absent value as "0". Left open, one click on the mortgage commits a $0
   * house with a real mortgage against it — I5's defect reached through I1's
   * fix, which neither finding's own change can see.
   */
  it("withholds Commit while the property it would co-post has no value", () => {
    render(
      <LiabilitiesTable {...base} rows={[securedMortgage]} accounts={[synthesizedProperty]} />,
    );
    expect(screen.getByRole("button", { name: /commit/i })).toBeDisabled();
    expect(screen.getByText(/enter the property's value first/i)).toBeInTheDocument();
  });

  it("allows Commit once that property has a value", () => {
    render(<LiabilitiesTable {...base} rows={[securedMortgage]} accounts={[pricedProperty]} />);
    expect(screen.getByRole("button", { name: /commit/i })).toBeEnabled();
  });

  /**
   * The block is about the row this click would COMMIT, not about every
   * value-less house on the table. A property nobody is co-posting is the
   * accounts table's business.
   */
  it("does not withhold Commit for a value-less property this debt is not secured on", () => {
    render(
      <LiabilitiesTable
        {...base}
        rows={[mortgageRow]}
        accounts={[synthesizedProperty]}
      />,
    );
    expect(screen.getByRole("button", { name: /commit/i })).toBeEnabled();
  });
});
