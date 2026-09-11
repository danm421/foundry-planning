import { describe, it, expect } from "vitest";
import { mergeAccountsByRowId, rebaseOntoFreshMerge } from "@/lib/statement-chat/rebase";
import type { Annotated } from "@/lib/imports/types";
import type { ExtractedAccount } from "@/lib/extraction/types";

type Row = Annotated<ExtractedAccount>;

function row(rowId: string, name: string, value: number | undefined): Row {
  return { __rowId: rowId, name, value } as Row;
}

/** A row carrying the `__provenance` the merge actually stamps on it. */
function sourced(rowId: string, name: string, value: number, sourceFileId: string, rest: Partial<Row> = {}): Row {
  return { __rowId: rowId, name, value, __provenance: { sourceFileId, section: "accounts" }, ...rest } as Row;
}

/**
 * Ruling 117. The advisor's standing row still WINS a re-extraction — that
 * behaviour is unchanged and deliberately so — but the override is no longer
 * silent: `rebaseOntoFreshMerge` now reports every row whose figure it held
 * back, so the narrator can name BOTH figures.
 *
 * Measured failure this pins: a June statement showing $100,000 and a
 * September statement showing $130,000 for the same untouched account left
 * $100,000 on screen with no explanation, while the caveat printed directly
 * above it named $130,000.
 */
describe("rebaseOntoFreshMerge", () => {
  it("keeps the standing figure AND reports the override naming both figures", () => {
    const fresh = [row("account:1", "Joint Brokerage", 130_000)];
    const standing = [row("account:1", "Joint Brokerage", 100_000)];

    const { rows, overrides } = rebaseOntoFreshMerge(fresh, standing);

    // The advisor's row is still what commits — Ruling 117 does not change this.
    expect(rows.map((r) => r.value)).toEqual([100_000]);
    expect(overrides).toEqual([
      {
        __rowId: "account:1",
        name: "Joint Brokerage",
        freshName: "Joint Brokerage",
        standingValue: 100_000,
        freshValue: 130_000,
      },
    ]);
  });

  /**
   * Ruling 128. The two names on an override are DIFFERENT sources: `name`
   * is the standing row's (the label on screen, which the advisor may have
   * renamed) and `freshName` is the fresh survivor's (what the merge's
   * decision log calls it). Nothing above distinguishes them — every other
   * case here has the two spellings agree — so this is the test that stops
   * `freshName` being quietly wired to the standing name, which would leave
   * `narrate`'s rename join no better off than a name-only join.
   */
  it("carries the FRESH row's name alongside the standing one after a rename", () => {
    const { overrides } = rebaseOntoFreshMerge(
      [row("account:1", "Joint Brokerage", 130_000)],
      [row("account:1", "Schwab Joint — taxable", 100_000)],
    );
    expect(overrides).toEqual([
      {
        __rowId: "account:1",
        name: "Schwab Joint — taxable",
        freshName: "Joint Brokerage",
        standingValue: 100_000,
        freshValue: 130_000,
      },
    ]);
  });

  // The ordinary re-upload: the same statement read again, or a new statement
  // that happens to agree. No caveat noise.
  it("reports no override when the two figures agree", () => {
    const { rows, overrides } = rebaseOntoFreshMerge(
      [row("account:1", "IRA", 100_000)],
      [row("account:1", "IRA", 100_000)],
    );
    expect(rows.map((r) => r.value)).toEqual([100_000]);
    expect(overrides).toEqual([]);
  });

  // Compared BY VALUE, not by reference identity: the standing row is a
  // separately-parsed jsonb object and is never the same object as the fresh
  // one, so a reference test would call every single row an override.
  it("compares by value, not reference — an equal-valued clone is not an override", () => {
    const { overrides } = rebaseOntoFreshMerge(
      [{ __rowId: "account:1", name: "IRA", value: 7 } as Row],
      [{ __rowId: "account:1", name: "IRA", value: 7 } as Row],
    );
    expect(overrides).toEqual([]);
  });

  it("carries through a genuinely new account off the new statement, with no override", () => {
    const { rows, overrides } = rebaseOntoFreshMerge(
      [row("account:1", "IRA", 100), row("account:2", "New Brokerage", 55)],
      [row("account:1", "IRA", 100)],
    );
    expect(rows.map((r) => r.name)).toEqual(["IRA", "New Brokerage"]);
    expect(overrides).toEqual([]);
  });

  it("drops a standing row the new extraction no longer produces, with no override and no crash", () => {
    const { rows, overrides } = rebaseOntoFreshMerge(
      [row("account:1", "IRA", 100)],
      [row("account:1", "IRA", 100), row("account:gone", "Closed Account", 900)],
    );
    expect(rows.map((r) => r.name)).toEqual(["IRA"]);
    expect(overrides).toEqual([]);
  });

  // One side undefined is a real difference the advisor should be told about,
  // so it is an override — `undefined !== 130_000`.
  it("reports an override when only one side carries a figure", () => {
    const { overrides } = rebaseOntoFreshMerge(
      [row("account:1", "IRA", 130_000)],
      [row("account:1", "IRA", undefined)],
    );
    expect(overrides).toEqual([
      { __rowId: "account:1", name: "IRA", freshName: "IRA", standingValue: undefined, freshValue: 130_000 },
    ]);
  });

  /**
   * Final review #2, C-1 / Ruling 146 — the join guard, at the REBASE
   * boundary.
   *
   * Uploading another statement re-runs the whole merge, and a bucket that
   * holds two entries can hand a row id that used to name account P to
   * account Q. The join was `__rowId` and nothing else, so the advisor's
   * standing P row was adopted onto Q's slot: Q silently gone, P duplicated,
   * $403,800 on screen against a truth of $289,900, and a caveat quoting a
   * figure no statement reported about P.
   *
   * The fingerprint is `__provenance.sourceFileId` — see the docstring on
   * `plausiblySameAccount` for why every OTHER candidate is either editable
   * (so it would reject a legitimate join and silently discard the advisor's
   * edit — the same family of defect) or already pinned by the id itself.
   *
   * Mutation this catches: deleting the guard. The rows come back as
   * ["Fidelity Roth IRA", "Fidelity Roth IRA"], "Schwab Brokerage" vanishes,
   * and `overrides` gains the fabricated $88,000 caveat.
   */
  it("refuses to adopt a standing row onto a fresh row from a different source file", () => {
    const EXISTING = "9c3f1a02-4f7b-4c0e-9a11-2d5b8e7f6a31";
    const ADDED = "0b7e4d19-8a2c-4f31-b6d0-1e9c3a5f2b84";

    // What the fresh merge produced after the new upload renumbered the
    // bucket: the newly-arrived Schwab account now holds `#0`.
    const fresh = [
      sourced("account:7734#0", "Schwab Brokerage", 88_000, ADDED, {
        custodian: "Schwab", accountNumberLast4: "7734",
      }),
      sourced("account:7734#1", "Fidelity Roth IRA", 201_900, EXISTING, {
        custodian: "Fidelity", accountNumberLast4: "7734",
      }),
    ];
    // What the advisor has been working on: the Fidelity row, committed.
    const standing = [
      sourced("account:7734#0", "Fidelity Roth IRA", 201_900, EXISTING, {
        custodian: "Fidelity",
        accountNumberLast4: "7734",
        match: { kind: "exact", existingId: "acct-1" },
      }),
    ];

    const { rows, overrides, refusals } = rebaseOntoFreshMerge(fresh, standing);

    // Both real accounts are on screen, once each, at their own figures.
    expect(rows.map((r) => r.name)).toEqual(["Schwab Brokerage", "Fidelity Roth IRA"]);
    expect(rows.reduce((sum, r) => sum + (r.value ?? 0), 0)).toBe(289_900);
    // No caveat naming a figure against the wrong account.
    expect(overrides).toEqual([]);
    // The advisor is TOLD, rather than the swap happening silently.
    expect(refusals).toEqual([
      { __rowId: "account:7734#0", name: "Fidelity Roth IRA", freshName: "Schwab Brokerage" },
    ]);
  });

  /**
   * The measurement behind the fingerprint choice, pinned as a test.
   *
   * `custodian` and `accountNumberLast4` are both on `EDITABLE_ACCOUNT_FIELDS`
   * (`tools.ts`), so an advisor correcting a misread institution or a misread
   * masked number legitimately makes the standing row disagree with the fresh
   * one on both. A fingerprint built from either would refuse THIS join and
   * throw the correction away — trading C-1 for a new defect in the same
   * family. `__provenance` is not on that list, and `edit_row` rejects it
   * explicitly.
   *
   * Every editable field is mutated at once, deliberately: the guard must key
   * off none of them.
   *
   * Mutation this catches: fingerprinting on `custodian` and/or
   * `accountNumberLast4` — the edited row is refused and the advisor's
   * corrections vanish from the table.
   */
  it("still adopts a standing row the advisor edited on EVERY editable field", () => {
    const FILE = "9c3f1a02-4f7b-4c0e-9a11-2d5b8e7f6a31";
    const fresh = [
      sourced("account:7734#0", "Roth IRA", 190_000, FILE, {
        custodian: "Fidelty Investments",
        accountNumberLast4: "7734",
        owner: "client",
        category: "retirement",
        subType: "roth_ira",
        basis: 50_000,
      }),
    ];
    const standing = [
      sourced("account:7734#0", "Julia — Roth (rollover)", 201_900, FILE, {
        custodian: "Charles Schwab",
        accountNumberLast4: "0042",
        owner: "spouse",
        category: "taxable",
        subType: "brokerage",
        basis: 61_000,
      }),
    ];

    const { rows, refusals } = rebaseOntoFreshMerge(fresh, standing);

    expect(refusals).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "Julia — Roth (rollover)",
      value: 201_900,
      custodian: "Charles Schwab",
      accountNumberLast4: "0042",
      owner: "spouse",
    });
  });

  /**
   * No evidence never blocks. A row with no `__provenance` on either side
   * gives the guard nothing to compare, and the direction that costs money
   * here is refusing a join the advisor's work depends on — so an absent
   * fingerprint adopts, exactly as it did before the guard existed.
   *
   * Mutation this catches: comparing the two `sourceFileId`s without the
   * missing-side clause, which turns every legacy row (and every row the
   * merge's `concatSection` path emits) into a silent refusal.
   */
  it("adopts when either side carries no __provenance to compare", () => {
    const FILE = "9c3f1a02-4f7b-4c0e-9a11-2d5b8e7f6a31";
    const a = rebaseOntoFreshMerge([sourced("account:1", "IRA", 1, FILE)], [row("account:1", "IRA", 2)]);
    expect(a.refusals).toEqual([]);
    expect(a.rows.map((r) => r.value)).toEqual([2]);

    const b = rebaseOntoFreshMerge([row("account:1", "IRA", 1)], [sourced("account:1", "IRA", 2, FILE)]);
    expect(b.refusals).toEqual([]);
    expect(b.rows.map((r) => r.value)).toEqual([2]);
  });

  // A row with no `__rowId` cannot be matched to anything, in either
  // direction — it must not produce a phantom override.
  it("ignores rows carrying no __rowId", () => {
    const { rows, overrides } = rebaseOntoFreshMerge(
      [{ name: "Unkeyed", value: 1 } as Row],
      [{ name: "Unkeyed", value: 2 } as Row],
    );
    expect(rows.map((r) => r.value)).toEqual([1]);
    expect(overrides).toEqual([]);
  });
});

/**
 * `mergeAccountsByRowId` is the SHARED mechanism the turn route depends on
 * (`chat/turn/route.ts:281`). Ruling 117 changes `rebaseOntoFreshMerge`'s
 * signature only — this stays byte-compatible, and these pin that.
 */
describe("mergeAccountsByRowId (unchanged by Ruling 117)", () => {
  it("still returns a bare array", () => {
    const fresh = [row("account:1", "IRA", 100)];
    expect(Array.isArray(mergeAccountsByRowId(fresh, [], fresh))).toBe(true);
  });

  it("still treats reference inequality against a non-empty start as the changed signal", () => {
    const start = row("account:1", "IRA", 100);
    const untouched = [start];
    // Same reference in both start and changed => NOT changed => the fresh
    // row (a concurrent write's stamps and all) survives.
    const merged = mergeAccountsByRowId([row("account:1", "IRA", 999)], untouched, untouched);
    expect(merged.map((r) => r.value)).toEqual([999]);
  });

  it("still retires a row present in start but absent from changed", () => {
    const start = [row("account:1", "IRA", 100), row("account:2", "Dropped", 5)];
    const merged = mergeAccountsByRowId(start, start, [start[0]]);
    expect(merged.map((r) => r.name)).toEqual(["IRA"]);
  });

  /**
   * Ruling 146. C-1's join guard belongs at the REBASE boundary, not here.
   *
   * Both of this function's arrays come from the SAME extraction on the turn
   * path (`chat/turn/route.ts`), so no id can have been recycled and
   * `__rowId` IS a valid identity there. Pushing the guard down into the
   * shared mechanism would make the turn path — which has no defect — start
   * refusing its own writes the moment a tool hands back a row whose
   * provenance differs from the fresh read's.
   *
   * Mutation this catches: moving the `plausiblySameAccount` test out of
   * `rebaseOntoFreshMerge` and into `mergeAccountsByRowId`. The edit below
   * stops landing and `value` falls back to 100.
   */
  it("adopts a changed row regardless of provenance — the guard is NOT here", () => {
    const fresh = [
      { __rowId: "account:1", name: "IRA", value: 100, __provenance: { sourceFileId: "file-a", section: "accounts" } } as Row,
    ];
    const start = [
      { __rowId: "account:1", name: "IRA", value: 100, __provenance: { sourceFileId: "file-b", section: "accounts" } } as Row,
    ];
    const changed = [
      { __rowId: "account:1", name: "IRA", value: 999, __provenance: { sourceFileId: "file-b", section: "accounts" } } as Row,
    ];
    expect(mergeAccountsByRowId(fresh, start, changed).map((r) => r.value)).toEqual([999]);
  });
});
