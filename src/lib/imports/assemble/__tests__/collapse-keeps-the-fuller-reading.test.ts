import { describe, expect, it } from "vitest";

import { mergeAcrossFiles } from "../merge-across-files";
import { er } from "./fixtures";
import type { ExtractedAccount, ExtractionResult } from "@/lib/extraction/types";

/**
 * When one document is read twice and the two readings disagree about the
 * NAME or the CUSTODIAN, the collapse has to keep the fuller of the two — not
 * whichever reading happened to prove more about the money.
 *
 * MEASURED on production import `31acfca2-5c91-4f63-8bc4-8c65bcf50659`.
 * Jennifer's Gensler statement is read once off its cover page and once off
 * each plan's detail pages:
 *
 *   cover  (page 1)   "Employee Stock Ownership"  "John Hancock Retirement Plan Services"  no holdings
 *   detail (pages 15-16) "ESOP"                   "John Hancock"                           2 holdings
 *
 * `readingStrength` rightly prefers the detail reading — it has the positions
 * an advisor acts on. But it then carried the detail reading's name and
 * custodian wholesale, and both are the WORSE spelling. That is what stopped
 * Q1 ever meeting Q2: Q2's rows say "John Hancock Retirement Plan Services",
 * so the two quarters bucketed separately, and "ESOP" shares no word at all
 * with Q2's "Employee Stock Ownership" so nothing downstream could rescue it.
 * Three plans, two quarters, six rows on the advisor's table for three
 * accounts — $451,380 of double count.
 */
const COVER: [number, number] = [1, 1];

function gensler(
  name: string,
  custodian: string,
  value: number,
  pageRange: [number, number],
  holdings?: ExtractedAccount["holdings"],
): ExtractedAccount {
  return {
    name,
    custodian,
    category: "retirement",
    value,
    statementDate: "2026-03-31",
    ...(holdings ? { holdings } : {}),
    __provenance: { section: "accounts", pageRange },
  } as ExtractedAccount;
}

function collapsed(rows: ExtractedAccount[]): ExtractedAccount[] {
  return mergeAcrossFiles({ f1: er("gensler-q1.pdf", { accounts: rows }) }).payload.accounts;
}

const position = [{ name: "Vanguard Target 2045" }] as ExtractedAccount["holdings"];

describe("a collapse keeps the fuller custodian spelling", () => {
  it("takes the cover page's full institution name over the detail page's short one", () => {
    const kept = collapsed([
      gensler("Employee Stock Ownership", "John Hancock Retirement Plan Services", 94795.39, COVER),
      gensler("ESOP", "John Hancock", 94795.39, [15, 16], position),
    ]);

    expect(kept).toHaveLength(1);
    expect(kept[0].custodian).toBe("John Hancock Retirement Plan Services");
    // The detail reading still wins everything it was winning before — this
    // only changes the two fields it was winning WRONGLY.
    expect(kept[0].holdings).toHaveLength(1);
  });

  it("keeps the shorter spelling when it is the one the stronger reading chose and the longer disagrees", () => {
    // "Fidelity" and "Vanguard Brokerage" are not one institution spelled two
    // ways, so there is no fuller spelling to prefer — the stronger reading's
    // custodian stands. Two readings of one document CAN disagree this badly:
    // `isSameAccountReadTwice` pairs on the balance and the page range and
    // never looks at the custodian at all.
    const kept = collapsed([
      gensler("Brokerage", "Vanguard Brokerage", 94795.39, COVER),
      gensler("Brokerage", "Fidelity", 94795.39, [15, 16], position),
    ]);

    expect(kept).toHaveLength(1);
    expect(kept[0].custodian).toBe("Fidelity");
  });

  it("fills a custodian the stronger reading did not have at all", () => {
    // Already true before this change (`unionFields` backfills a null), and
    // pinned so the new rule cannot regress it.
    const kept = collapsed([
      gensler("Employee Stock Ownership", "John Hancock Retirement Plan Services", 94795.39, COVER),
      { ...gensler("ESOP", "", 94795.39, [15, 16], position), custodian: undefined } as ExtractedAccount,
    ]);

    expect(kept[0].custodian).toBe("John Hancock Retirement Plan Services");
  });
});

describe("a collapse does not keep an acronym over its own expansion", () => {
  it("prefers 'Employee Stock Ownership' to 'ESOP'", () => {
    const kept = collapsed([
      gensler("Employee Stock Ownership", "John Hancock", 94795.39, COVER),
      gensler("ESOP", "John Hancock", 94795.39, [15, 16], position),
    ]);

    expect(kept[0].name).toBe("Employee Stock Ownership");
  });

  it("still prefers the untruncated name when the stronger reading clipped it", () => {
    // The existing prefix rule, pinned: the detail read's header is "401(k"
    // where the cover read the whole "401(k) Savings".
    const kept = collapsed([
      gensler("401(k) Savings", "John Hancock", 361262.23, COVER),
      gensler("401(k", "John Hancock", 361262.23, [3, 4], position),
    ]);

    expect(kept[0].name).toBe("401(k) Savings");
  });

  it("does not swap in a longer name that is a different description", () => {
    // The guard the acronym rule must not break. "Profit Sharing" is not what
    // "ESOP" stands for, and a collapse is not licence to rename an account
    // after the other reading — only to un-abbreviate it.
    const kept = collapsed([
      gensler("Profit Sharing Plan and Trust", "John Hancock", 94795.39, COVER),
      gensler("ESOP", "John Hancock", 94795.39, [15, 16], position),
    ]);

    expect(kept[0].name).toBe("ESOP");
  });

  it("does not treat an ordinary short name as an acronym", () => {
    // "Roth" is not an acronym, so the stronger reading keeps its own name.
    const kept = collapsed([
      gensler("Retirement Or Taxable Holdings", "Schwab", 94795.39, COVER),
      gensler("Roth", "Schwab", 94795.39, [15, 16], position),
    ]);

    expect(kept[0].name).toBe("Roth");
  });
});

/**
 * The whole point of the two fixes above, end to end: the real six rows,
 * across the two real quarters, becoming three accounts.
 */
describe("Jennifer's three Gensler plans, read across two quarters", () => {
  // Both quarters print a plan-wide code where the account number belongs —
  // "433350" on Q1 (six digits, refused on shape) and "0410" on Q2 (one number
  // on three differently-named plans). Neither survives as an identity, so
  // these rows meet on the unnumbered path or not at all.
  // The detail rows carry the plan code; the cover rows carry no number at all.
  const q1: ExtractedAccount[] = [
    gensler("401(k) Savings", "John Hancock Retirement Plan Services", 313554.32, COVER),
    { ...gensler("401(k x3350", "John Hancock", 313554.32, [3, 4], position), accountNumberLast4: "433350" },
    gensler("Profit Sharing", "John Hancock Retirement Plan Services", 43029.84, COVER),
    { ...gensler("Profit Sharing Plan x3350", "John Hancock", 43029.84, [9, 10], position), accountNumberLast4: "433350" },
    gensler("Employee Stock Ownership", "John Hancock Retirement Plan Services", 94795.39, COVER),
    { ...gensler("ESOP x3350", "John Hancock", 94795.39, [15, 16], position), accountNumberLast4: "433350" },
  ];

  const q2: ExtractedAccount[] = [
    { ...gensler("401(k) Savings x0410", "John Hancock Retirement Plan Services", 361262.23, [1, 1]), statementDate: "2026-06-30", accountNumberLast4: "0410" },
    { ...gensler("Profit Sharing x0410", "John Hancock Retirement Plan Services", 48033.54, [1, 1]), statementDate: "2026-06-30", accountNumberLast4: "0410" },
    { ...gensler("Employee Stock Ownership x0410", "John Hancock Retirement Plan Services", 94829.35, [1, 1]), statementDate: "2026-06-30", accountNumberLast4: "0410" },
  ];

  function bothQuarters(): ExtractionResult[] {
    return [er("gensler-q1.pdf", { accounts: q1 }), er("gensler-q2.pdf", { accounts: q2 })];
  }

  it("ends with three accounts, each at its June balance", () => {
    const [f1, f2] = bothQuarters();
    const kept = mergeAcrossFiles({ q1: f1, q2: f2 }).payload.accounts;

    expect(kept).toHaveLength(3);
    expect(kept.map((r) => r.value).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([
      48033.54, 94829.35, 361262.23,
    ]);
  });

  it("reads the same either way round, because a jsonb column does not preserve file order", () => {
    const [f1, f2] = bothQuarters();
    const forward = mergeAcrossFiles({ q1: f1, q2: f2 }).payload.accounts;
    const reverse = mergeAcrossFiles({ q2: f2, q1: f1 }).payload.accounts;
    expect(reverse).toHaveLength(forward.length);
  });
});
