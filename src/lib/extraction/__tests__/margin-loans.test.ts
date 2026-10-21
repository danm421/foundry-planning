import { describe, expect, it } from "vitest";

import { applyMarginLoans, grossUpMarginLoans } from "../margin-loans";
import type { ExtractedAccount, ExtractedLiability } from "../types";

const brokerage = (extra: Partial<ExtractedAccount> = {}): ExtractedAccount => ({
  name: "Joint Brokerage",
  category: "taxable",
  subType: "brokerage",
  value: 500_000,
  ...extra,
});

const run = (accounts: ExtractedAccount[], liabilities: ExtractedLiability[] = []) =>
  applyMarginLoans({ accounts, liabilities });

describe("applyMarginLoans: the loan as the document states it", () => {
  it("keeps the printed net value and the loan beside it", () => {
    const { accounts, warnings } = run([brokerage({ marginBalance: 40_000, marginInterestRate: 0.085 })]);
    expect(accounts[0]).toMatchObject({ value: 500_000, marginBalance: 40_000, marginInterestRate: 0.085 });
    expect(warnings).toEqual([]);
  });

  it("reads a debit printed as negative as the amount owed", () => {
    expect(run([brokerage({ marginBalance: -40_000 })]).accounts[0].marginBalance).toBe(40_000);
  });

  it("drops the loan's negative cash line, but not a short sale", () => {
    const short = { ticker: "XYZ", shares: -100, price: 50, marketValue: -5_000 };
    const { accounts } = run([
      brokerage({
        marginBalance: 40_000,
        holdings: [{ ticker: "VTI", marketValue: 545_000 }, short, { name: "Cash", shares: -40_000, price: 1 }],
      }),
    ]);
    expect(accounts[0].holdings).toEqual([{ ticker: "VTI", marketValue: 545_000 }, short]);
  });

  it("keeps a loan off an account that can't carry one, and says so", () => {
    const { accounts, warnings } = run([
      { name: "Rollover IRA", category: "retirement", subType: "traditional_ira", value: 300_000, marginBalance: 10_000 },
    ]);
    expect(accounts[0]).toEqual({ name: "Rollover IRA", category: "retirement", subType: "traditional_ira", value: 300_000 });
    expect(warnings).toHaveLength(1);
  });

  it("leaves an account with no loan untouched", () => {
    expect(run([brokerage()]).accounts).toEqual([brokerage()]);
  });
});

describe("applyMarginLoans: a margin loan listed as a debt", () => {
  const debt: ExtractedLiability = { name: "Margin Loan", balance: 40_000, interestRate: 0.08 };

  // A document listing the loan apart states the account at its full value,
  // as a balance sheet does; netting it here lets the gross-up restore it.
  it("moves onto the document's one taxable account, which survives the gross-up at its stated value", () => {
    const { accounts, liabilities, warnings } = run(
      [brokerage({ value: 540_000 }), { name: "Checking", category: "cash", subType: "checking", value: 5_000 }],
      [debt],
    );
    expect(liabilities).toEqual([]);
    expect(accounts[0]).toMatchObject({ value: 500_000, marginBalance: 40_000, marginInterestRate: 0.08 });
    expect(grossUpMarginLoans(accounts)[0].value).toBe(540_000);
    expect(warnings).toEqual([]);
  });

  it("is dropped as a duplicate when the account already carries the same loan", () => {
    const { accounts, liabilities } = run([brokerage({ marginBalance: 40_000 })], [debt]);
    expect(liabilities).toEqual([]);
    expect(accounts[0]).toMatchObject({ value: 500_000, marginBalance: 40_000 });
  });

  it("stays a debt when two taxable accounts could owe it, and says so", () => {
    const { accounts, liabilities, warnings } = run([brokerage(), brokerage({ name: "Individual Brokerage" })], [debt]);
    expect(liabilities).toEqual([debt]);
    expect(accounts.every((a) => a.marginBalance === undefined)).toBe(true);
    expect(warnings).toHaveLength(1);
  });

  it("leaves every other debt alone", () => {
    const mortgage: ExtractedLiability = { name: "Mortgage", balance: 300_000 };
    expect(run([brokerage()], [mortgage]).liabilities).toEqual([mortgage]);
  });
});

describe("grossUpMarginLoans", () => {
  it("turns the net value into the securities' value, without touching its input", () => {
    const rows = [brokerage({ marginBalance: 40_000 })];
    expect(grossUpMarginLoans(rows)[0]).toMatchObject({ value: 540_000, marginBalance: 40_000 });
    expect(rows[0].value).toBe(500_000);
  });

  it("leaves a value the positions show is already gross", () => {
    const row = brokerage({ value: 540_000, marginBalance: 40_000, holdings: [{ ticker: "VTI", marketValue: 540_000 }] });
    expect(grossUpMarginLoans([row])[0].value).toBe(540_000);
  });

  it("returns a row with no loan as it was", () => {
    const row = brokerage();
    expect(grossUpMarginLoans([row])[0]).toBe(row);
  });
});
