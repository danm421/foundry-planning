import { describe, it, expect } from "vitest";
import { reannotateAccountRows } from "../annotate-accounts";
import type { AccountCandidate } from "../match-keys/account";
import type { Annotated } from "../types";
import type { ExtractedAccount } from "@/lib/extraction/types";

const CANDIDATES: AccountCandidate[] = [
  {
    id: "acct-1",
    name: "Schwab Brokerage",
    category: "taxable",
    accountNumberLast4: "0990",
    custodian: "Charles Schwab",
    value: 8_600,
  },
  {
    id: "acct-2",
    name: "Schwab Roth IRA",
    category: "retirement",
    accountNumberLast4: "1168",
    custodian: "Charles Schwab",
    value: 22_800,
  },
];

function row(over: Partial<Annotated<ExtractedAccount>>): Annotated<ExtractedAccount> {
  return {
    name: "Schwab Brokerage",
    category: "taxable",
    accountNumberLast4: "0990",
    custodian: "Charles Schwab",
    value: 8_618,
    ...over,
  } as Annotated<ExtractedAccount>;
}

describe("reannotateAccountRows", () => {
  it("stamps an account-number-backed row as an exact match", () => {
    const [only] = reannotateAccountRows([row({})], CANDIDATES, []);
    expect(only.match).toEqual({ kind: "exact", existingId: "acct-1" });
  });

  // The loop guard. A `fuzzy` row stays re-annotatable forever by design, so
  // a second pass MUST hand back the identical array — the effect that calls
  // this bails out on `rows === prev.rows`, and a fresh array would re-enter
  // the effect that produced it.
  it("returns the same array when a re-run changes nothing", () => {
    const first = reannotateAccountRows([row({}), row({ name: "Vanguard", accountNumberLast4: undefined })], CANDIDATES, []);
    const second = reannotateAccountRows(first, CANDIDATES, []);
    expect(second).toBe(first);
  });

  it("leaves a row a human ruled on alone", () => {
    const locked = row({ match: { kind: "new" }, matchLocked: true });
    const [out] = reannotateAccountRows([locked], CANDIDATES, []);
    expect(out).toBe(locked);
    expect(out.match).toEqual({ kind: "new" });
  });

  // A skipped row's link still has to be RESERVED. Without the pre-claim seed
  // the undecided duplicate would score `exact` on acct-1 too, and the commit
  // would issue two UPDATEs against one account — last-wins, the other row's
  // figures gone with no warning.
  it("will not re-match an account a skipped row already holds", () => {
    const held = row({ match: { kind: "exact", existingId: "acct-1" } });
    const duplicate = row({});
    const [, second] = reannotateAccountRows([held, duplicate], CANDIDATES, []);
    expect(second.match?.kind).not.toBe("exact");
  });

  // And it must not degrade all the way to `new` either — `new` INSERTs, so the
  // same account would land in the plan twice.
  it("degrades a blocked duplicate to fuzzy, never to new", () => {
    const held = row({ match: { kind: "exact", existingId: "acct-1" } });
    const [, second] = reannotateAccountRows([held, row({})], CANDIDATES, []);
    expect(second.match).toEqual({ kind: "fuzzy", candidates: [] });
  });

  it("annotates a row with no candidates as new", () => {
    const [only] = reannotateAccountRows([row({})], [], []);
    expect(only.match).toEqual({ kind: "new" });
  });
});
