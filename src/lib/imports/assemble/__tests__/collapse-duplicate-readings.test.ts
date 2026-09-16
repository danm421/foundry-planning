import { describe, expect, it } from "vitest";

import { mergeAcrossFiles } from "../merge-across-files";
import { er } from "./fixtures";
import type { ExtractedAccount } from "@/lib/extraction/types";

/**
 * One document read twice — the summary page and the detail pages — is the
 * shape `collapseDuplicateReadings` exists for. Exercised through
 * `mergeAcrossFiles`, because what matters is the table the advisor ends up
 * with, not the helper in isolation.
 *
 * Every fixture is a shape read off a real import
 * (`93ff2c60-e3d0-4a75-b13e-3f2877306103`, 2026-09-15).
 */

/** An account row carrying the page range a multi-pass read stamps on it. */
function onPages(
  pageRange: [number, number] | null,
  row: Partial<ExtractedAccount> & { name: string },
): ExtractedAccount {
  return (pageRange === null
    ? row
    : { ...row, __provenance: { section: "accounts", pageRange } }) as ExtractedAccount;
}

function accountsOf(rows: ExtractedAccount[]) {
  return mergeAcrossFiles({ f1: er("gensler-q2.pdf", { accounts: rows }) }).payload.accounts;
}

describe("collapsing a document read twice", () => {
  it("folds a cover-page summary into the detail row that carries the account number", () => {
    const kept = accountsOf([
      onPages([1, 1], {
        name: "401(k) Savings",
        custodian: "John Hancock Retirement Plan Services",
        value: 361262.23,
      }),
      onPages([3, 4], {
        name: "401(k) Savings Plan x0210",
        accountNumberLast4: "0210",
        custodian: "John Hancock",
        value: 361262.23,
        statementDate: "2026-06-30",
      }),
    ]);

    expect(kept).toHaveLength(1);
    expect(kept[0].name).toBe("401(k) Savings Plan x0210");
    // The detail row wins every field EXCEPT the custodian, and that one
    // exception is `betterCustodian`. This assertion used to read "John
    // Hancock" — the detail page's running-header spelling — and that was the
    // defect, not the contract: the cross-file bucket for an unnumbered row
    // keys on the custodian, so carrying the shorter spelling put Q1 in one
    // bucket and Q2's fuller spelling in another and the two quarters of all
    // three Gensler plans never met. Measured on production import
    // `31acfca2-5c91-4f63-8bc4-8c65bcf50659`. Same institution either way —
    // `custodianMatches` is what licenses the swap — so nothing here changes
    // WHICH account this is, only how completely it is named.
    expect(kept[0].custodian).toBe("John Hancock Retirement Plan Services");
  });

  it("folds when the summary row carries a plan number instead of a real last-4", () => {
    // "07264" is the five-digit plan contract number off the Stantec cover;
    // "7265" is the account's own masked digits.
    const kept = accountsOf([
      onPages([1, 1], {
        name: "401(k) Plan x7264",
        accountNumberLast4: "07264",
        custodian: "Merrill",
        value: 126591.46,
      }),
      onPages([3, 5], {
        name: "401(k) Plan x7265",
        accountNumberLast4: "7265",
        custodian: "Stantec Consulting Services Inc.",
        value: 126591.46,
      }),
    ]);

    expect(kept).toHaveLength(1);
    expect(kept[0].accountNumberLast4).toBe("7265");
  });

  it("backfills a field only the summary row had", () => {
    const kept = accountsOf([
      onPages([1, 1], {
        name: "401(k) Savings",
        custodian: "John Hancock",
        value: 361262.23,
        ownerNameHint: "SHARESKY, JENNIFER L",
      }),
      onPages([3, 4], {
        name: "401(k) Savings Plan x0210",
        accountNumberLast4: "0210",
        value: 361262.23,
      }),
    ]);

    expect(kept[0].accountNumberLast4).toBe("0210");
    expect(kept[0].ownerNameHint).toBe("SHARESKY, JENNIFER L");
  });

  it("keeps three plans listed on one cover page apart — they differ by value", () => {
    const kept = accountsOf([
      onPages([1, 1], { name: "401(k) Savings", value: 361262.23 }),
      onPages([1, 1], { name: "Profit Sharing", value: 48033.54 }),
      onPages([1, 1], { name: "Employee Stock Ownership", value: 94829.35 }),
      onPages([3, 4], { name: "401(k) Savings Plan x0210", accountNumberLast4: "0210", value: 361262.23 }),
      onPages([7, 8], { name: "Profit Sharing Plan x0410", accountNumberLast4: "0410", value: 48033.54 }),
      onPages([11, 12], { name: "ESOP x0211", accountNumberLast4: "0211", value: 94829.35 }),
    ]);

    expect(kept.map((a) => a.name)).toEqual([
      "401(k) Savings Plan x0210",
      "Profit Sharing Plan x0410",
      "ESOP x0211",
    ]);
  });

  it("NEVER folds two accounts the extractor listed on the SAME pages", () => {
    // The load-bearing guard. One read of pages 3-5 returning two $25,000 CDs
    // is the model deliberately listing two accounts; folding them would make
    // a real account disappear, which is the error that costs money.
    const kept = accountsOf([
      onPages([3, 5], { name: "CD 1", value: 25000 }),
      onPages([3, 5], { name: "CD 2", value: 25000 }),
    ]);

    expect(kept).toHaveLength(2);
  });

  it("never folds rows from a single-pass read, which has no page range", () => {
    const kept = accountsOf([
      onPages(null, { name: "Checking", value: 10000 }),
      onPages(null, { name: "Savings", value: 10000 }),
    ]);

    expect(kept).toHaveLength(2);
  });

  it("never folds a row that has no page range into one that does", () => {
    // Nothing says the two readings overlap, so there is no evidence they are
    // one account — and folding on a bare balance match is how a real account
    // disappears.
    const kept = accountsOf([
      onPages(null, { name: "Checking", value: 10000 }),
      onPages([3, 5], { name: "Checking x0479", accountNumberLast4: "0479", value: 10000 }),
    ]);

    expect(kept).toHaveLength(2);
  });

  it("never folds two accounts with different four-digit numbers", () => {
    const kept = accountsOf([
      onPages([1, 1], { name: "Savings x6049", accountNumberLast4: "6049", custodian: "Capital One", value: 7479.31 }),
      onPages([2, 2], { name: "Savings x8952", accountNumberLast4: "8952", custodian: "Capital One", value: 7479.31 }),
    ]);

    expect(kept).toHaveLength(2);
  });

  it("never folds zero balances, into each other or into a funded account", () => {
    expect(
      accountsOf([
        onPages([1, 1], { name: "Savings", value: 0 }),
        onPages([2, 2], { name: "Checking", value: 0 }),
      ]),
    ).toHaveLength(2);

    expect(
      accountsOf([
        onPages([1, 1], { name: "Savings", value: 0 }),
        onPages([2, 2], { name: "Savings x8952", accountNumberLast4: "8952", value: 7479.31 }),
      ]),
    ).toHaveLength(2);
  });

  it("never folds balances that merely look close, or a row with no balance", () => {
    expect(
      accountsOf([
        onPages([1, 1], { name: "Taxable", value: 100000 }),
        onPages([2, 2], { name: "Taxable x9426", accountNumberLast4: "9426", value: 90000 }),
      ]),
    ).toHaveLength(2);

    expect(
      accountsOf([
        // The custodian is here so the row survives `dropEmptyRows` — a row
        // with NOTHING on it is not an account at all and is dropped before
        // the collapse ever sees it, which would make this assertion pass for
        // the wrong reason. What is being tested is that a valueless row does
        // not FOLD into a valued one: there is no balance to match on, so
        // there is no evidence the two readings are the same account.
        onPages([1, 1], { name: "401k Savings Plan", custodian: "John Hancock" }),
        onPages([2, 2], { name: "401(k) Savings Plan x0210", accountNumberLast4: "0210", value: 361262.23 }),
      ]),
    ).toHaveLength(2);
  });

  it("keeps the row with the real account number even when the other says more", () => {
    const kept = accountsOf([
      onPages([1, 1], {
        name: "401(k) Savings",
        custodian: "John Hancock Retirement Plan Services",
        value: 361262.23,
        owner: "client",
        ownerNameHint: "SHARESKY, JENNIFER L",
        statementDate: "2026-06-30",
        category: "retirement",
      }),
      onPages([3, 4], { name: "401(k) Savings Plan x0210", accountNumberLast4: "0210", value: 361262.23 }),
    ]);

    expect(kept[0].name).toBe("401(k) Savings Plan x0210");
    expect(kept[0].ownerNameHint).toBe("SHARESKY, JENNIFER L");
  });

  it("prefers the row carrying holdings when neither has a real account number", () => {
    const kept = accountsOf([
      onPages([1, 1], {
        name: "Checking",
        value: 7321.95,
        custodian: "Wells Fargo",
        owner: "joint",
        ownerNameHint: "MICHAEL V SHARESKY",
        statementDate: "2026-08-31",
      }),
      onPages([3, 5], {
        name: "Checking (detail)",
        value: 7321.95,
        holdings: [{ name: "Cash", marketValue: 7321.95 }],
      }),
    ]);

    expect(kept[0].name).toBe("Checking (detail)");
    expect(kept[0].holdings).toHaveLength(1);
  });

  it("falls back to the fuller row when neither has an account number or holdings", () => {
    const kept = accountsOf([
      onPages([1, 1], { name: "401(k) Plan", value: 112218.06 }),
      onPages([3, 5], {
        name: "401(k) Plan — Stantec",
        value: 112218.06,
        custodian: "Stantec Consulting Services Inc.",
        statementDate: "2026-03-31",
      }),
    ]);

    expect(kept[0].name).toBe("401(k) Plan — Stantec");
  });

  it("says what it collapsed, naming the file and both page ranges", () => {
    const r = mergeAcrossFiles({
      f1: er("gensler-q2.pdf", {
        accounts: [
          onPages([1, 1], { name: "401(k) Savings", value: 361262.23 }),
          onPages([3, 4], { name: "401(k) Savings Plan x0210", accountNumberLast4: "0210", value: 361262.23 }),
        ],
      }),
    });

    expect(r.payload.warnings).toContainEqual(
      '"401(k) Savings Plan x0210" was read twice from gensler-q2.pdf (pages 1-1 and 3-4) ' +
        "at the same balance; kept the more detailed reading.",
    );
  });

  it("heals a draft extracted before this shipped — the rows are re-read every assemble", () => {
    // The reason this lives in the merge and not in `extractWithMultiPass`:
    // `fileResults` is persisted, so a collapse at extraction time would fix
    // new imports only.
    const stored = [
      onPages([1, 1], { name: "401(k) Savings", value: 361262.23 }),
      onPages([3, 4], { name: "401(k) Savings Plan x0210", accountNumberLast4: "0210", value: 361262.23 }),
    ];

    expect(mergeAcrossFiles({ f1: er("old-draft.pdf", { accounts: stored }) }).payload.accounts).toHaveLength(1);
  });
});
