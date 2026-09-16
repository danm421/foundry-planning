import { describe, expect, it } from "vitest";

import { mergeAcrossFiles } from "../merge-across-files";
import { er } from "./fixtures";
import type { ExtractedAccount, ExtractedLiability } from "@/lib/extraction/types";

/**
 * A mortgage statement that reported the same debt twice — once correctly as a
 * liability, and once as an ASSET.
 *
 * MEASURED on production import `31acfca2-5c91-4f63-8bc4-8c65bcf50659`. "Mortgage
 * Secondary Residence Statement 08-2026.pdf" produced BOTH:
 *
 *   liabilities: "Mortgage - 5304 Hudson Avenue D"  $99,802.55  3.25%
 *   accounts:    "Mortgage x3596"                   $99,802.55  real_estate / primary_residence
 *
 * The accounts row is wrong three ways: a mortgage is a debt, not an asset; it
 * is filed under the category that renders on the real-estate side, so it
 * inflates the balance sheet by $99,802.55 as PROPERTY; and its sub-type says
 * primary residence on a statement for the SECONDARY one. The primary-residence
 * file, from the same lender in the same import, produced one liability and no
 * accounts row — so this is extraction variance, not the prompt's intent.
 *
 * THE DEBT IS NEVER DROPPED, only the asset row, and only when the same
 * document already recorded the debt AS a debt at the same balance. That
 * condition is the safety argument: with no matching liability the row is left
 * alone, because a row that is the only record of $99,802 is not one to delete
 * on a naming hunch — and a mortgage note RECEIVABLE really is an asset.
 */
const MORTGAGE_LIABILITY = {
  name: "Mortgage - 5304 Hudson Avenue D",
  balance: 99802.55,
  interestRate: 3.25,
  monthlyPayment: 1030.31,
} as ExtractedLiability;

function asAsset(extra: Partial<ExtractedAccount> = {}): ExtractedAccount {
  return {
    name: "Mortgage x3596",
    accountNumberLast4: "3596",
    custodian: "Citizens Bank",
    category: "real_estate",
    subType: "primary_residence",
    value: 99802.55,
    statementDate: "2026-08-10",
    ...extra,
  } as ExtractedAccount;
}

function merged(accounts: ExtractedAccount[], liabilities: ExtractedLiability[]) {
  return mergeAcrossFiles({
    f1: er("mortgage-secondary.pdf", { accounts, liabilities }),
  }).payload;
}

describe("a mortgage the document already reported as a debt is not also an asset", () => {
  it("drops the accounts row and keeps the liability", () => {
    const { accounts, liabilities } = merged([asAsset()], [MORTGAGE_LIABILITY]);

    expect(accounts).toHaveLength(0);
    expect(liabilities).toHaveLength(1);
    expect(liabilities[0].balance).toBe(99802.55);
  });

  it("says so, because a dropped $99,802 row needs explaining", () => {
    const { warnings } = merged([asAsset()], [MORTGAGE_LIABILITY]);
    expect(warnings.join(" ")).toContain("Mortgage x3596");
  });

  it("keeps a real account that happens to sit beside a mortgage", () => {
    const escrow = {
      name: "Escrow Balance",
      custodian: "Citizens Bank",
      category: "cash",
      value: 4120.18,
      statementDate: "2026-08-10",
    } as ExtractedAccount;

    const { accounts } = merged([asAsset(), escrow], [MORTGAGE_LIABILITY]);
    expect(accounts.map((r) => r.name)).toEqual(["Escrow Balance"]);
  });

  it("leaves the row alone when the document reported no matching debt", () => {
    // The row is then the only record of the money, and deleting it would lose
    // $99,802 outright. A mortgage note RECEIVABLE lands here too, correctly.
    const { accounts } = merged([asAsset({ name: "Mortgage Note Receivable" })], []);
    expect(accounts).toHaveLength(1);
  });

  it("leaves the row alone when the debt is a different size", () => {
    // Two different mortgages on two properties, one of them reported as an
    // asset — the asset row is still wrong, but which debt it duplicates is
    // not established, so this rule does not get to guess.
    const { accounts } = merged([asAsset()], [{ ...MORTGAGE_LIABILITY, balance: 431957.71 }]);
    expect(accounts).toHaveLength(1);
  });

  it("does not touch an ordinary account that shares a balance with a debt", () => {
    // A brokerage account worth exactly what the mortgage owes is a
    // coincidence, not a misfiling — the NAME is what says "this is a debt".
    const brokerage = {
      name: "Rollover IRA x8403",
      custodian: "Charles Schwab",
      category: "retirement",
      value: 99802.55,
      statementDate: "2026-07-31",
    } as ExtractedAccount;

    const { accounts } = merged([brokerage], [MORTGAGE_LIABILITY]);
    expect(accounts).toHaveLength(1);
  });

  it("catches the other names a lender prints for the same thing", () => {
    for (const name of ["Home Equity Line of Credit", "HELOC x3596", "Auto Loan x3596"]) {
      const { accounts } = merged([asAsset({ name })], [MORTGAGE_LIABILITY]);
      expect(accounts, name).toHaveLength(0);
    }
  });
});
