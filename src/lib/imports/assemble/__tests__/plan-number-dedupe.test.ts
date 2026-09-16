import { describe, expect, it } from "vitest";

import { mergeAcrossFiles } from "../merge-across-files";
import { er } from "./fixtures";
import type { ExtractedAccount } from "@/lib/extraction/types";

/**
 * A retirement-plan statement prints the PLAN's number, not the participant's,
 * and a Merrill 401(k) statement prints no account number at all — so the
 * extractor fills `accountNumberLast4` from whatever four digits it can see,
 * including a page-imposition code in the footer that CHANGES between pages of
 * one document.
 *
 * Every fixture here is a shape measured off Jennifer Sharesky's real import
 * (`5b35d190-98da-41d1-9628-408f757bd21e`, 2026-09-16), where it cost two of
 * her three Gensler plans their balances and booked her Stantec 401(k) twice.
 */
function onPages(
  pageRange: [number, number] | null,
  row: Partial<ExtractedAccount> & { name: string },
): ExtractedAccount {
  return (pageRange === null
    ? row
    : { ...row, __provenance: { section: "accounts", pageRange } }) as ExtractedAccount;
}

const position = [{ name: "Vanguard Target 2045" }] as ExtractedAccount["holdings"];

function accountsOf(files: Record<string, ExtractedAccount[]>) {
  return mergeAcrossFiles(
    Object.fromEntries(
      Object.entries(files).map(([name, accounts]) => [name, er(name, { accounts })]),
    ),
  ).payload.accounts;
}

describe("a number several accounts share is a plan number, not an account number", () => {
  it("keeps three plans that one statement labelled with one contract number", () => {
    // The defect this exists for: all three rows keyed on "0410", so the
    // profit-sharing plan and the ESOP merged into the 401(k) and their
    // balances were discarded as "another statement reported…".
    const kept = accountsOf({
      "gensler-q2.pdf": [
        onPages([1, 1], {
          name: "401(k) Savings x0410",
          accountNumberLast4: "0410",
          custodian: "John Hancock",
          value: 361262.23,
        }),
        onPages([1, 1], {
          name: "Profit Sharing x0410",
          accountNumberLast4: "0410",
          custodian: "John Hancock",
          value: 48033.54,
        }),
        onPages([1, 1], {
          name: "Employee Stock Ownership x0410",
          accountNumberLast4: "0410",
          custodian: "John Hancock",
          value: 94829.35,
        }),
      ],
    });

    expect(kept.map((a) => a.value)).toEqual([361262.23, 48033.54, 94829.35]);
    expect(kept.map((a) => a.accountNumberLast4)).toEqual([undefined, undefined, undefined]);
    // The suffix goes with the field. It is the half that reaches the screen,
    // and three plans wearing one number reads as three readings of one.
    expect(kept.map((a) => a.name)).toEqual([
      "401(k) Savings",
      "Profit Sharing",
      "Employee Stock Ownership",
    ]);
  });

  it("keeps three plans that arrived as three SEPARATE files", () => {
    // One plan per PDF is the normal way a household uploads retirement plans,
    // and it is the shape a per-FILE check cannot see: each file holds one row,
    // so nothing inside it contradicts anything. Measured before the check was
    // widened to the whole import — three plans became one row and $142,862
    // was discarded.
    const plan = (name: string, value: number) => ({
      name,
      accountNumberLast4: "0410",
      custodian: "John Hancock",
      category: "retirement" as const,
      subType: "401k",
      owner: "client" as const,
      statementDate: "2026-06-30",
      value,
    }) as ExtractedAccount;

    const kept = accountsOf({
      "401k.pdf": [plan("401(k) Savings x0410", 361262.23)],
      "profit-sharing.pdf": [plan("Profit Sharing x0410", 48033.54)],
      "esop.pdf": [plan("Employee Stock Ownership x0410", 94829.35)],
    });

    expect(kept.map((a) => a.value).sort((x, y) => x - y)).toEqual([48033.54, 94829.35, 361262.23]);
  });

  it("does NOT clear a number when two statements disagree about ONE account", () => {
    // The mirror hazard, and the reason shape 1 tests the NAMES. Two documents
    // reporting one IRA at one date and disagreeing about the balance is an
    // ordinary stale-statement conflict — the merge collapses it and discloses
    // both figures. Clearing the number splits the account in two instead.
    const kept = accountsOf({
      "a.pdf": [
        onPages(null, { name: "Roth IRA x7734", accountNumberLast4: "7734", custodian: "Fidelity", owner: "client", statementDate: "2026-06-30", value: 190000 }),
      ],
      "b.pdf": [
        onPages(null, { name: "Roth IRA x7734", accountNumberLast4: "7734", custodian: "Fidelity", owner: "client", statementDate: "2026-06-30", value: 201900 }),
      ],
    });

    expect(kept).toHaveLength(1);
    expect(kept[0].accountNumberLast4).toBe("7734");
  });

  it("leaves a real account number alone when both readings agree on the balance", () => {
    // The guard against over-stripping: a cover page and a detail section
    // reading ONE account print the same number at the same balance, and that
    // is the pairing the collapse needs the number for.
    const kept = accountsOf({
      "schwab.pdf": [
        onPages([1, 1], { name: "Taxable x9426", accountNumberLast4: "9426", custodian: "Charles Schwab", value: 25804.52 }),
        onPages([3, 5], { name: "Taxable x9426", accountNumberLast4: "9426", custodian: "Charles Schwab", value: 25804.52, holdings: position }),
      ],
    });

    expect(kept).toHaveLength(1);
    expect(kept[0].accountNumberLast4).toBe("9426");
  });

  it("clears a number that was never four digits, and the name suffix built from it", () => {
    const kept = accountsOf({
      "gensler-q1.pdf": [
        onPages([3, 4], { name: "401(k) Savings Plan x3350", accountNumberLast4: "433350", custodian: "John Hancock", value: 313554.32 }),
      ],
    });

    expect(kept[0].accountNumberLast4).toBeUndefined();
    expect(kept[0].name).toBe("401(k) Savings Plan");
  });
});

describe("two quarters of one plan that carries no usable number", () => {
  const q1 = (over: Partial<ExtractedAccount>): ExtractedAccount =>
    ({ custodian: "John Hancock", category: "retirement", owner: "client", statementDate: "2026-03-31", ...over }) as ExtractedAccount;
  const q2 = (over: Partial<ExtractedAccount>): ExtractedAccount =>
    ({ custodian: "John Hancock", category: "retirement", owner: "client", statementDate: "2026-06-30", ...over }) as ExtractedAccount;

  it("joins them into one row at the newer balance", () => {
    const kept = accountsOf({
      "q1.pdf": [q1({ name: "401(k) Savings Plan", subType: "401k", value: 313554.32 })],
      "q2.pdf": [q2({ name: "401(k) Savings", subType: "401k", value: 361262.23 })],
    });

    expect(kept).toHaveLength(1);
    expect(kept[0].value).toBe(361262.23);
  });

  it("joins them even when the model classified the sub-type differently", () => {
    // Measured: Jennifer's ESOP read as `401k` off March and `other` off June.
    // Sub-type is the finer of the two classifications and it flips, so it
    // must not be part of the identity.
    const kept = accountsOf({
      "q1.pdf": [q1({ name: "ESOP", subType: "401k", value: 94795.39 })],
      "q2.pdf": [q2({ name: "ESOP", subType: "other", value: 94829.35 })],
    });

    expect(kept).toHaveLength(1);
    expect(kept[0].value).toBe(94829.35);
  });

  it("keeps two DIFFERENT plans at one recordkeeper apart", () => {
    const kept = accountsOf({
      "q1.pdf": [
        q1({ name: "401(k) Savings Plan", subType: "401k", value: 313554.32 }),
        q1({ name: "Profit Sharing Plan", subType: "401k", value: 43029.84 }),
      ],
      "q2.pdf": [
        q2({ name: "401(k) Savings Plan", subType: "401k", value: 361262.23 }),
        q2({ name: "Profit Sharing Plan", subType: "401k", value: 48033.54 }),
      ],
    });

    expect(kept.map((a) => [a.name, a.value])).toEqual([
      ["401(k) Savings Plan", 361262.23],
      ["Profit Sharing Plan", 48033.54],
    ]);
  });

  it("NEVER joins two accounts read off ONE statement", () => {
    // The shape that has actually lost money here: four UBS accounts masked
    // identically in one document. One document carries one date, and a
    // matching date is what this path refuses.
    const kept = accountsOf({
      "ubs.pdf": [
        onPages([1, 4], { name: "Traditional IRA", custodian: "UBS", category: "retirement", owner: "client", statementDate: "2026-04-30", value: 390609 }),
        onPages([5, 9], { name: "Traditional IRA", custodian: "UBS", category: "retirement", owner: "client", statementDate: "2026-04-30", value: 633226 }),
      ],
    });

    expect(kept).toHaveLength(2);
  });

  it("never joins two accounts at one custodian in different CATEGORIES", () => {
    const kept = accountsOf({
      "q1.pdf": [q1({ name: "Brokerage", category: "taxable", value: 50000 })],
      "q2.pdf": [q2({ name: "Brokerage", category: "retirement", value: 52000 })],
    });

    expect(kept).toHaveLength(2);
  });

  it("never joins rows with no custodian to compare", () => {
    const kept = accountsOf({
      "q1.pdf": [q1({ name: "Checking", custodian: undefined, category: "cash", value: 5000 })],
      "q2.pdf": [q2({ name: "Checking", custodian: undefined, category: "cash", value: 6000 })],
    });

    expect(kept).toHaveLength(2);
  });
});

describe("a cover page numbered differently from the detail pages", () => {
  it("folds when the balances agree to the cent and only one side lists positions", () => {
    // Merrill prints no account number; the extractor reads the page-imposition
    // code in the footer, which is "00007264" on page 1 and "00007265" on
    // page 3. Two real-looking numbers, one real 401(k).
    const kept = accountsOf({
      "stantec-q2.pdf": [
        onPages([1, 1], { name: "401(k) Plan x7264", accountNumberLast4: "7264", custodian: "Merrill", value: 126591.46 }),
        onPages([3, 5], { name: "401(k) Plan x7265", accountNumberLast4: "7265", custodian: "Merrill", value: 126591.46, holdings: position }),
      ],
    });

    expect(kept).toHaveLength(1);
    expect(kept[0].holdings).toHaveLength(1);
    // And the footer code does NOT survive as the account's identity. It is
    // exactly what `matchAccount` would auto-write a stored account from.
    expect(kept[0].accountNumberLast4).toBeUndefined();
    expect(kept[0].name).toBe("401(k) Plan");
  });

  it("still refuses two sibling accounts that happen to sit at the same balance", () => {
    // Both are detail readings — neither is a summary of the other — so the
    // two different numbers stand.
    const kept = accountsOf({
      "capital-one.pdf": [
        onPages([1, 1], { name: "Savings x6049", accountNumberLast4: "6049", custodian: "Capital One", value: 7479.31, holdings: position }),
        onPages([2, 2], { name: "Savings x8952", accountNumberLast4: "8952", custodian: "Capital One", value: 7479.31, holdings: position }),
      ],
    });

    expect(kept).toHaveLength(2);
  });

  it("refuses two differently-named accounts even in the summary/detail shape", () => {
    const kept = accountsOf({
      "consolidated.pdf": [
        onPages([1, 1], { name: "Money Market x1111", accountNumberLast4: "1111", custodian: "Fidelity", value: 50000 }),
        onPages([3, 5], { name: "Rollover IRA x2222", accountNumberLast4: "2222", custodian: "Fidelity", value: 50000, holdings: position }),
      ],
    });

    expect(kept).toHaveLength(2);
  });

  it("keeps the un-truncated name when the stronger reading clipped it", () => {
    const kept = accountsOf({
      "gensler-q2.pdf": [
        onPages([1, 1], { name: "401(k) Savings", custodian: "John Hancock", value: 361262.23 }),
        onPages([3, 4], { name: "401(k", custodian: "John Hancock", value: 361262.23, holdings: position }),
      ],
    });

    expect(kept).toHaveLength(1);
    expect(kept[0].name).toBe("401(k) Savings");
  });
});
